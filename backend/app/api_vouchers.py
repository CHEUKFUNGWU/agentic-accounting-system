"""
Voucher (記賬憑證) REST surface.

Kept out of main.py on purpose: the recording path is a new capability, and it
must not destabilise the shipping reporting endpoints.

The control flow is deliberate and is the whole point of this module:

    create  -> DRAFT            cheap structural checks only (you can save a
                                half-finished voucher without receipts)
    submit  -> PENDING_CHECKER  full SoD guard: >=2 lines, DR==CR, per-line
                                exclusivity, control-account isolation, period
                                cut-off, MAKER_* role, AND at least one
                                attachment
    approve -> POSTED           maker != checker, role authorised, scope
                                gate; hash-chained and applied to the ledger
                                atomically by the existing posting engine
    reject  -> REJECTED         reason mandatory, returned to the maker

Everything a human can do here is refused somewhere. That is the feature.
"""

from __future__ import annotations

import mimetypes
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.auth import AuthPrincipal, get_current_principal
from app.core.positions import out_of_scope
from app.core import vouchers as vz
from app.core import ledger as lg
from app.core.repository import repo
from app.core.sod_guard import (
    AccountingInvariantError,
    AgentIdentity,
    DeterministicSoDGuard,
    PeriodStatus,
)

router = APIRouter(prefix="/api/v1", tags=["vouchers"])

MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class VoucherLineRequest(BaseModel):
    account_code: str
    debit: str = Field(default="0.0000")
    credit: str = Field(default="0.0000")
    memo: str = Field(default="")
    counterparty: str = Field(default="")
    tax_code: str = Field(default="")
    business_use_pct: str = Field(default="1.0000")


class VoucherCreateRequest(BaseModel):
    entity_code: str = Field(default="AU-OPC-01")
    period: str = Field(default="2026-10")
    accounting_date: str = Field(default_factory=lambda: date.today().isoformat())
    memo: str = Field(default="")
    source_module: str = Field(default="GL_MANUAL", examples=["GL_MANUAL", "BANK_REC", "EXPENSE_SPLIT"])
    model_config = {"extra": "forbid"}
    lines: List[VoucherLineRequest] = Field(default_factory=list)
    # Agent-proposed vouchers carry their own provenance; human ones leave the
    # confidence at 1.0 and an empty reasoning string.
    ai_confidence_score: str = Field(default="1.0000")
    ai_reasoning_summary: str = Field(default="")


class VoucherActionRequest(BaseModel):
    model_config = {"extra": "forbid"}
    reason: str = Field(default="")


class VoucherUpdateRequest(BaseModel):
    accounting_date: Optional[str] = None
    memo: Optional[str] = None
    lines: Optional[List[VoucherLineRequest]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _principals() -> Dict[str, AgentIdentity]:
    from app.mcp_server import PRINCIPALS

    return PRINCIPALS


def _maker(key: str) -> AgentIdentity:
    p = _principals().get(key)
    if not p:
        raise HTTPException(status_code=404, detail=f"UNKNOWN_PRINCIPAL: '{key}'")
    return p


def _reporting_status(entity_code: str) -> str:
    from app.mcp_server import PACK_STATUS_STATE

    return PACK_STATUS_STATE.get(entity_code, "READY")


def _period_status(entity_code: str) -> PeriodStatus:
    """
    Until fiscal_periods is a real table (it is designed in database/schema.sql),
    the period's openness is derived from the pack status: a signed-off pack
    means the period is locked.
    """
    return PeriodStatus.LOCKED if _reporting_status(entity_code) == "REVIEWED_AND_LOCKED" else PeriodStatus.OPEN


async def _load_voucher(journal_id: str) -> Dict[str, Any]:
    j = await repo.get_journal(journal_id)
    if not j:
        raise HTTPException(status_code=404, detail=f"VOUCHER_NOT_FOUND: '{journal_id}'")
    return j


async def _control_accounts(entity_code: str) -> set[str]:
    accounts = await vz.account_map(entity_code)
    return {code for code, a in accounts.items() if a["is_control_account"]}


async def _assert_accounts_exist(entity_code: str, lines: List[Dict[str, Any]]) -> None:
    accounts = await vz.account_map(entity_code)
    missing = [l["account_code"] for l in lines if l["account_code"] not in accounts]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"COA_MISSING_ACCOUNT: 科目 {', '.join(missing)} 不存在於科目表。",
        )


def _detail(journal: Dict[str, Any]) -> Dict[str, Any]:
    from app.mcp_server import PRINCIPALS

    maker = PRINCIPALS.get(journal.get("created_by_principal_key") or "")
    checker = PRINCIPALS.get(journal.get("approved_by_principal_key") or "")
    out = vz.summarise(journal)
    out["lines"] = journal.get("lines", [])
    out["evidence_uris"] = journal.get("evidence_uris", [])
    out["created_by_agent_name"] = maker.agent_name if maker else journal.get("created_by_principal_key")
    out["approved_by_agent_name"] = checker.agent_name if checker else None
    return out


# ---------------------------------------------------------------------------
# Reference data: who is who, and the chart of accounts
# ---------------------------------------------------------------------------

@router.get("/principals")
async def list_principals() -> Dict[str, Any]:
    """Makes '誰編制誰複核' concrete instead of a string in the source."""
    from app.core.positions import position_for_principal

    out = []
    for key, p in _principals().items():
        position = position_for_principal(key)
        out.append(
            {
                "principal_key": key,
                "position": position.position_id if position else None,
                "is_human": bool(position.is_human) if position else False,
                "principal_id": str(p.principal_id),
                "agent_name": p.agent_name,
                "role": p.role.value,
                "can_create": p.role.value.startswith("MAKER_"),
                "can_approve": p.role.value in ("CHECKER_CONTROLLER", "HUMAN_CPA"),
                "max_auto_approve_func_amount": str(p.max_auto_approve_func_amount),
                "min_confidence_threshold": str(p.min_confidence_threshold),
            }
        )
    return {"principals": out}


@router.get("/entities/{entity_code}/accounts")
async def get_chart_of_accounts(entity_code: str) -> Dict[str, Any]:
    return {"accounts": await vz.chart_of_accounts(entity_code)}


# ---------------------------------------------------------------------------
# Voucher lifecycle
# ---------------------------------------------------------------------------

@router.get("/vouchers")
async def list_vouchers(
    entity_code: Optional[str] = None,
    status: Optional[str] = None,
    period: Optional[str] = None,
) -> Dict[str, Any]:
    journals = await repo.get_journals(entity_code=entity_code, status=status)
    if period:
        journals = [j for j in journals if j.get("period") == period]
    journals.sort(key=lambda j: (j.get("accounting_date") or "", j.get("voucher_no") or ""))
    counts: Dict[str, int] = {}
    for j in journals:
        s = j.get("status") or "UNKNOWN"
        counts[s] = counts.get(s, 0) + 1
    return {"vouchers": [vz.summarise(j) for j in journals], "counts": counts}


@router.post("/vouchers")
async def create_voucher(body: VoucherCreateRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    maker = _maker(principal.principal_key)
    if not maker.role.value.startswith("MAKER_"):
        raise HTTPException(
            status_code=400,
            detail=f"SOD_ROLE_VIOLATION: '{maker.agent_name}' ({maker.role.value}) 不能製單。",
        )
    if _reporting_status(body.entity_code) == "REVIEWED_AND_LOCKED":
        raise HTTPException(
            status_code=400,
            detail="PERIOD_LOCKED: 該賬套已簽核封存，不可再新增憑證。",
        )
    try:
        await lg.assert_writable(body.entity_code, body.period)
    except lg.LedgerError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        lines = vz.parse_lines([l.model_dump() for l in body.lines])
        total_dr, total_cr = vz.assert_balanced(lines)
    except vz.VoucherError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if out_of_scope(principal.position, [line["account_code"] for line in lines]):
        raise HTTPException(403, "ACCOUNT_OUT_OF_SCOPE")
    await _assert_accounts_exist(body.entity_code, lines)

    # Fill in account names for display so the voucher reads like a voucher even
    # if the chart of accounts is later renamed.
    accounts = await vz.account_map(body.entity_code)
    for l in lines:
        l["account_name"] = accounts[l["account_code"]]["account_name"]

    entity = await repo.get_entity(body.entity_code)
    if not entity:
        raise HTTPException(status_code=404, detail=f"ENTITY_NOT_FOUND: '{body.entity_code}'")

    journal = {
        "journal_id": vz.new_journal_id(),
        "entity_code": body.entity_code,
        "period": body.period,
        "voucher_no": await vz.next_voucher_no(body.entity_code, body.period),
        "accounting_date": body.accounting_date,
        # Currency comes from the entity, never from a label.
        "currency": entity.get("currency", "AUD"),
        "status": "DRAFT",
        "source_module": body.source_module,
        "memo": body.memo.strip(),
        "total_debit": str(total_dr),
        "total_credit": str(total_cr),
        "lines": lines,
        "evidence_uris": [],
        "created_by_principal_key": principal.principal_key,
        "created_by_principal_id": str(maker.principal_id),
        "ai_confidence_score": body.ai_confidence_score,
        "ai_reasoning_summary": body.ai_reasoning_summary,
    }

    await repo.save_journal(journal)
    return {"status": "SUCCESS", "voucher": _detail(journal)}


@router.get("/vouchers/{journal_id}")
async def get_voucher(journal_id: str) -> Dict[str, Any]:
    return {"voucher": _detail(await _load_voucher(journal_id))}


@router.put("/vouchers/{journal_id}")
async def update_voucher(journal_id: str, body: VoucherUpdateRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """Only DRAFT or REJECTED vouchers may be edited. Posted is immutable."""
    journal = await _load_voucher(journal_id)
    if journal.get("created_by_principal_key") != principal.principal_key:
        raise HTTPException(403, "NOT_YOUR_VOUCHER")
    if journal.get("status") not in ("DRAFT", "REJECTED"):
        raise HTTPException(
            status_code=400,
            detail=f"VOUCHER_IMMUTABLE: 憑證 {journal.get('voucher_no')} 狀態為 {journal.get('status')}，"
                   "過賬後不可修改，請用沖銷分錄更正。",
        )
    if body.accounting_date:
        journal["accounting_date"] = body.accounting_date
    if body.memo is not None:
        journal["memo"] = body.memo.strip()
    if body.lines is not None:
        try:
            lines = vz.parse_lines([l.model_dump() for l in body.lines])
            total_dr, total_cr = vz.assert_balanced(lines)
        except vz.VoucherError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if out_of_scope(principal.position, [line["account_code"] for line in lines]):
            raise HTTPException(403, "ACCOUNT_OUT_OF_SCOPE")
        await _assert_accounts_exist(journal["entity_code"], lines)
        accounts = await vz.account_map(journal["entity_code"])
        for l in lines:
            l["account_name"] = accounts[l["account_code"]]["account_name"]
        journal["lines"] = lines
        journal["total_debit"] = str(total_dr)
        journal["total_credit"] = str(total_cr)
    # Editing a rejected voucher sends it back to draft.
    if journal.get("status") == "REJECTED":
        journal["status"] = "DRAFT"
        journal["reject_reason"] = None
    await repo.save_journal(journal)
    return {"status": "SUCCESS", "voucher": _detail(journal)}


@router.post("/vouchers/{journal_id}/submit")
async def submit_voucher(journal_id: str, body: VoucherActionRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """
    DRAFT -> PENDING_CHECKER. This is where the deterministic guard runs, and
    where the system refuses: unbalanced, single-line, control-account-in-GL,
    locked period, wrong role, or missing evidence.
    """
    journal = await _load_voucher(journal_id)
    if journal.get("created_by_principal_key") != principal.principal_key:
        raise HTTPException(403, "NOT_YOUR_VOUCHER")
    if journal.get("status") not in ("DRAFT", "REJECTED"):
        raise HTTPException(
            status_code=400,
            detail=f"INVALID_STATE: 憑證 {journal.get('voucher_no')} 目前狀態為 {journal.get('status')}，不可提交。",
        )

    maker = _maker(principal.principal_key)
    if out_of_scope(principal.position, [line["account_code"] for line in journal.get("lines", [])]):
        raise HTTPException(403, "ACCOUNT_OUT_OF_SCOPE")
    entity_code = journal["entity_code"]
    control = await _control_accounts(entity_code)
    try:
        DeterministicSoDGuard.validate_proposal_submission(
            maker=maker,
            source_module=journal.get("source_module", "GL_MANUAL"),
            period_status=_period_status(entity_code),
            lines=vz.to_proposed_lines(journal.get("lines", []), control),
            evidence_uris=journal.get("evidence_uris") or [],
            confidence_score=Decimal(str(journal.get("ai_confidence_score") or "1.0000")),
        )
    except AccountingInvariantError as e:
        raise HTTPException(status_code=400, detail=str(e))

    journal["status"] = "PENDING_CHECKER"
    journal["submitted_at"] = datetime.now(timezone.utc)
    journal["reject_reason"] = None
    await repo.save_journal(journal)
    return {"status": "SUCCESS", "voucher": _detail(journal)}


@router.post("/vouchers/{journal_id}/approve")
async def approve_voucher(journal_id: str, body: VoucherActionRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    from app.mcp_server import review_and_approve_proposal

    journal = await _load_voucher(journal_id)
    res = await review_and_approve_proposal(
        agent_principal_key=principal.principal_key,
        journal_id=journal_id,
        action="APPROVE",
    )
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=res.get("reason", "APPROVAL_FAILED"))

    # Post-processing the shared engine does not do: a posted reversal closes
    # out the voucher it reverses.
    reversal_of = journal.get("reversal_of_journal_id")
    if reversal_of and res.get("entry_status") == "POSTED":
        original = await repo.get_journal(reversal_of)
        if original and original.get("status") == "POSTED":
            original["status"] = "REVERSED"
            await repo.save_journal(original)

    fresh = await repo.get_journal(journal_id)
    return {"status": "SUCCESS", "entry_status": res.get("entry_status"), "voucher": _detail(fresh or journal)}


@router.post("/vouchers/{journal_id}/reject")
async def reject_voucher(journal_id: str, body: VoucherActionRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    from app.mcp_server import review_and_approve_proposal

    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="REJECT_REASON_REQUIRED: 駁回必須填寫理由。")
    await _load_voucher(journal_id)
    res = await review_and_approve_proposal(
        agent_principal_key=principal.principal_key,
        journal_id=journal_id,
        action="REJECT",
        rejection_reason=body.reason.strip(),
    )
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=res.get("reason", "REJECT_FAILED"))

    # The shared reviewer stores the reason under a different key; persist it in
    # the column the UI reads.
    fresh = await repo.get_journal(journal_id)
    if fresh:
        fresh["status"] = "REJECTED"
        fresh["reject_reason"] = body.reason.strip()
        await repo.save_journal(fresh)
    return {"status": "SUCCESS", "voucher": _detail(fresh or {})}


@router.post("/vouchers/{journal_id}/void")
async def void_voucher(journal_id: str, body: VoucherActionRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """Void a draft/rejected voucher: the number is kept, never reused."""
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="REASON_REQUIRED: 作廢必須填寫理由。")
    journal = await _load_voucher(journal_id)
    if journal.get("status") not in ("DRAFT", "REJECTED"):
        raise HTTPException(
            status_code=400,
            detail=f"CANNOT_VOID: 只有草稿或已駁回的憑證可以作廢（目前 {journal.get('status')}）。已過賬的憑證只能沖銷。",
        )
    if journal.get("created_by_principal_key") != principal.principal_key:
        raise HTTPException(
            status_code=403,
            detail=f"NOT_YOUR_VOUCHER: 只能作廢自己編制的憑證（這張由 {journal.get('created_by_principal_key')} 編制）。",
        )
    journal["status"] = "VOID"
    journal["reject_reason"] = f"作廢：{body.reason.strip()}"
    await repo.save_journal(journal)
    return {"status": "SUCCESS", "voucher": _detail(journal)}


@router.post("/vouchers/{journal_id}/reverse")
async def reverse_voucher(journal_id: str, body: VoucherActionRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """
    Correction path. A posted voucher is never edited or deleted — it is
    reversed by a mirror-image voucher that goes through the same approval.
    """
    original = await _load_voucher(journal_id)
    if original.get("status") != "POSTED":
        raise HTTPException(
            status_code=400,
            detail=f"CANNOT_REVERSE: 只有已過賬憑證可以沖銷（目前 {original.get('status')}）。",
        )
    maker = _maker(principal.principal_key)
    if not maker.role.value.startswith("MAKER_"):
        raise HTTPException(status_code=400, detail=f"SOD_ROLE_VIOLATION: '{maker.agent_name}' 不能製單。")

    if out_of_scope(principal.position, [line["account_code"] for line in original.get("lines", [])]):
        raise HTTPException(403, "ACCOUNT_OUT_OF_SCOPE")
    lines = []
    for l in original.get("lines", []):
        lines.append(
            {
                "line_number": l["line_number"],
                "account_code": l["account_code"],
                "account_name": l.get("account_name", ""),
                # mirror the entry
                "debit": l.get("credit", "0.0000"),
                "credit": l.get("debit", "0.0000"),
                "memo": f"沖銷 {original.get('voucher_no')}：{l.get('memo') or ''}".strip("："),
                "counterparty": l.get("counterparty", ""),
                "tax_code": l.get("tax_code", ""),
                "business_use_pct": l.get("business_use_pct", "1.0000"),
            }
        )

    entity_code = original["entity_code"]
    journal = {
        "journal_id": vz.new_journal_id(),
        "entity_code": entity_code,
        "period": original.get("period"),
        "voucher_no": await vz.next_voucher_no(entity_code, original.get("period") or "2026-10"),
        "accounting_date": date.today().isoformat(),
        "currency": original.get("currency"),
        "status": "DRAFT",
        "source_module": "REVERSAL",
        "memo": f"沖銷憑證 {original.get('voucher_no')}",
        "total_debit": original.get("total_credit"),
        "total_credit": original.get("total_debit"),
        "lines": lines,
        # The evidence for a reversal IS the voucher being reversed.
        "evidence_uris": [
            {
                "kind": "reversal_of",
                "name": f"{original.get('voucher_no')}.voucher",
                "stored_name": original.get("journal_id"),
                "mime": "application/vnd.agentic-accounting.voucher",
                "size": 0,
                "sha256": original.get("entry_hash") or "",
                "uploaded_by": principal.principal_key,
                "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        ],
        "created_by_principal_key": principal.principal_key,
        "created_by_principal_id": str(maker.principal_id),
        "reversal_of_journal_id": original["journal_id"],
        "ai_confidence_score": "1.0000",
        "ai_reasoning_summary": "",
    }
    await repo.save_journal(journal)
    return {"status": "SUCCESS", "voucher": _detail(journal)}


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

@router.post("/vouchers/{journal_id}/attachments")
async def upload_attachment(journal_id: str, file: UploadFile = File(...), principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    journal = await _load_voucher(journal_id)
    if journal.get("created_by_principal_key") != principal.principal_key:
        raise HTTPException(403, "NOT_YOUR_VOUCHER")
    if journal.get("status") == "POSTED":
        raise HTTPException(
            status_code=400,
            detail="VOUCHER_IMMUTABLE: 已過賬憑證不可再附加單據，請以沖銷分錄更正後重開憑證。",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="EMPTY_FILE: 檔案是空的。")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="FILE_TOO_LARGE: 單一附件上限 15 MB。")

    record = vz.save_attachment(
        entity_code=journal["entity_code"],
        filename=file.filename or "attachment",
        content=content,
        mime=file.content_type or "",
        uploaded_by=principal.principal_key,
    )
    evidence = list(journal.get("evidence_uris") or [])
    evidence.append(record)
    journal["evidence_uris"] = evidence
    await repo.save_journal(journal)
    return {"status": "SUCCESS", "attachment": record, "attachment_count": len(evidence)}


@router.delete("/vouchers/{journal_id}/attachments/{stored_name}")
async def detach_attachment(journal_id: str, stored_name: str, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """
    Detaching is allowed before posting and is recorded as an evidence log entry;
    the file itself is never destroyed, because a deleted receipt is exactly what
    an audit is looking for.
    """
    journal = await _load_voucher(journal_id)
    if journal.get("created_by_principal_key") != principal.principal_key:
        raise HTTPException(403, "NOT_YOUR_VOUCHER")
    if journal.get("status") == "POSTED":
        raise HTTPException(status_code=400, detail="VOUCHER_IMMUTABLE: 已過賬憑證的單據不可移除。")
    evidence = list(journal.get("evidence_uris") or [])
    kept = [e for e in evidence if e.get("stored_name") != stored_name]
    removed = [e for e in evidence if e.get("stored_name") == stored_name]
    if removed:
        kept.append(
            {
                "kind": "detached_record",
                "name": removed[0].get("name", ""),
                "stored_name": removed[0].get("stored_name", ""),
                "mime": "text/plain",
                "size": 0,
                "sha256": removed[0].get("sha256", ""),
                "uploaded_by": principal.principal_key,
                "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        )
    journal["evidence_uris"] = kept
    await repo.save_journal(journal)
    return {"status": "SUCCESS", "attachment_count": len(kept)}


@router.get("/attachments/{entity_code}/{stored_name}")
async def download_attachment(entity_code: str, stored_name: str):
    path = vz.attachment_file(entity_code, stored_name)
    if not path:
        raise HTTPException(status_code=404, detail="ATTACHMENT_NOT_FOUND")
    media, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=media or "application/octet-stream", filename=path.name)


# ---------------------------------------------------------------------------
# General ledger, derived from POSTED vouchers
# ---------------------------------------------------------------------------

@router.get("/ledger/accounts/{account_code}")
async def get_account_ledger(entity_code: str, account_code: str, period: str = "2026-10") -> Dict[str, Any]:
    """General ledger for one account, derived from posted journal lines."""
    try:
        led = await lg.account_ledger(entity_code, account_code, period)
    except lg.LedgerError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # attach voucher numbers, which live on the entry rather than the line
    journals = {j["journal_id"]: j for j in await repo.get_journals(entity_code=entity_code)}
    for movement in led["movements"]:
        entry = journals.get(movement["journal_id"])
        movement["voucher_no"] = (entry or {}).get("voucher_no")
    return led


@router.get("/ledger/cash-flow-breakdown")
async def get_cash_flow_breakdown(entity_code: str, period: str = "2026-10") -> Dict[str, Any]:
    data = await lg.cash_flow_breakdown(entity_code, period)
    entity = await repo.get_entity(entity_code)
    data["currency"] = (entity or {}).get("currency", "")
    return data


@router.get("/ledger/trial-balance")
async def get_trial_balance(entity_code: str, period: str = "2026-10") -> Dict[str, Any]:
    return {
        "entity_code": entity_code,
        "period": period,
        "rows": await lg.trial_balance(entity_code, period),
        "proof": await lg.assert_trial_balance(entity_code, period),
    }


# ---------------------------------------------------------------------------
# Chart of accounts, periods and period close
# ---------------------------------------------------------------------------

@router.get("/entities/{entity_code}/chart-of-accounts")
async def get_chart_of_accounts_full(entity_code: str, include_inactive: bool = False) -> Dict[str, Any]:
    return {"accounts": await lg.get_chart(entity_code, include_inactive=include_inactive)}


@router.put("/entities/{entity_code}/chart-of-accounts/{account_code}")
async def put_account(entity_code: str, account_code: str, body: Dict[str, Any]) -> Dict[str, Any]:
    payload = {**body, "account_code": account_code}
    try:
        return {"account": await lg.upsert_account(entity_code, payload)}
    except lg.LedgerError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/entities/{entity_code}/tax-codes")
async def get_tax_codes(entity_code: str) -> Dict[str, Any]:
    return {"tax_codes": await lg.list_tax_codes(entity_code)}


@router.get("/entities/{entity_code}/counterparties")
async def get_counterparties(entity_code: str, counterparty_type: str = "") -> Dict[str, Any]:
    return {"counterparties": await lg.list_counterparties(entity_code, counterparty_type)}


@router.get("/entities/{entity_code}/periods")
async def get_periods(entity_code: str) -> Dict[str, Any]:
    return {"periods": await lg.list_periods(entity_code)}


class ClosePeriodRequest(BaseModel):
    model_config = {"extra": "forbid"}
    period: str = Field(default="2026-10")


@router.post("/entities/{entity_code}/periods/{period}/close")
async def close_period_endpoint(entity_code: str, period: str, body: ClosePeriodRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """
    Close the books for a period. Refuses over unposted vouchers or a ledger that
    does not balance, and records who closed it.
    """
    from app.core.positions import position_for_principal

    position = position_for_principal(principal.principal_key)
    if not position or not (position.can_review or position.is_human):
        raise HTTPException(
            status_code=403,
            detail=f"NOT_AUTHORIZED_TO_CLOSE: {principal.principal_key} 不能執行結帳。",
        )
    try:
        return await lg.close_period(entity_code, period, principal.principal_key)
    except lg.LedgerError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/entities/{entity_code}/trial-balance-proof")
async def trial_balance_proof(entity_code: str, period: str = "2026-10") -> Dict[str, Any]:
    return await lg.assert_trial_balance(entity_code, period)
