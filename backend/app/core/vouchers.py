"""
Voucher (記賬憑證) layer — the recording path.

Everything in this module exists to answer four questions the product could not
answer before:

  1. 能不能記帳   -> create a voucher with arbitrary lines, persisted, numbered
  2. 附件放哪     -> content-addressed files on disk + sha256 in evidence_uris
  3. 誰編制誰複核 -> maker != checker, enforced by the existing SoD guard
  4. 帳在哪       -> general ledger derived from POSTED vouchers, not from a
                     hand-maintained trial balance cache

Deliberately NOT reimplemented here:
  * double-entry / control-account / period-cut-off validation  -> sod_guard.py
  * hash chain + atomic posting + ledger propagation               -> mcp_server.py
    `review_and_approve_proposal()` + repository.post_journal_and_update_etb()

A voucher is a 記賬憑證, not an abstract "transaction": it carries a sequential
number, a per-line 摘要, the attached source documents, and a signature strip.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import uuid4

from app.core.db import db_manager, get_default_db_path
from app.core.repository import repo
from app.core.sod_guard import ProposedLine

# ---------------------------------------------------------------------------
# Money helpers
# ---------------------------------------------------------------------------

CENT = Decimal("0.0001")


def q4(value: Decimal | str | float) -> Decimal:
    return Decimal(str(value)).quantize(CENT)


# ---------------------------------------------------------------------------
# Attachments: content-addressed, never overwritten, never silently replaced
# ---------------------------------------------------------------------------

def attachment_root() -> Path:
    """Attachments live next to the ledger file, so backup covers both."""
    root = get_default_db_path().parent / "attachments"
    root.mkdir(parents=True, exist_ok=True)
    return root


_SAFE_NAME = re.compile(r"[^0-9A-Za-z._\u4e00-\u9fff-]+")


def _safe_filename(name: str) -> str:
    base = Path(name).name.strip() or "attachment"
    return _SAFE_NAME.sub("_", base)[:120]


def _entity_dir(entity_code: str) -> Path:
    d = attachment_root() / entity_code
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_attachment(entity_code: str, filename: str, content: bytes, mime: str, uploaded_by: str) -> Dict[str, Any]:
    """
    Store one source document and return its evidence record.

    The stored file name is the content hash, so uploading the same receipt
    twice is idempotent and a receipt cannot be swapped out under the same
    reference. The original file name is kept only as display metadata.
    """
    sha256 = hashlib.sha256(content).hexdigest()
    stored_name = f"{sha256[:16]}-{_safe_filename(filename)}"
    target = _entity_dir(entity_code) / stored_name
    # Publish complete bytes with an exclusive link. Other processes must not
    # observe a partially written evidence file, or overwrite existing evidence.
    fd, staging = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
        try:
            os.link(staging, target)
        except FileExistsError:
            if target.read_bytes() != content:
                raise VoucherError("DOCUMENT_HASH_MISMATCH: Existing evidence bytes differ.")
    finally:
        os.unlink(staging)  # Only the private staging link, never evidence.
    return {
        "kind": "voucher_attachment",
        "name": _safe_filename(filename),
        "stored_name": stored_name,
        "mime": mime or "application/octet-stream",
        "size": len(content),
        "sha256": sha256,
        "uploaded_by": uploaded_by,
        "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def attachment_file(entity_code: str, stored_name: str) -> Optional[Path]:
    """Resolve a stored attachment, refusing anything that escapes the folder."""
    if "/" in stored_name or "\\" in stored_name or stored_name.startswith("."):
        return None
    p = (_entity_dir(entity_code) / stored_name).resolve()
    root = attachment_root().resolve()
    if root not in p.parents:
        return None
    return p if p.is_file() else None


# ---------------------------------------------------------------------------
# Voucher numbering: sequential per entity + period, gaps are an audit finding
# ---------------------------------------------------------------------------

def voucher_prefix(period: str) -> str:
    return f"記-{period}"


async def next_voucher_no(entity_code: str, period: str, *, session=None) -> str:
    if session is None:
        existing = await repo.get_journals(entity_code=entity_code)
        used = [j.get("voucher_no") or "" for j in existing]
    else:
        from sqlalchemy import select
        from app.core.db import JournalEntryModel

        used = list((await session.scalars(select(JournalEntryModel.voucher_no).where(
            JournalEntryModel.entity_code == entity_code,
        ))).all())
    n = 1
    while f"{voucher_prefix(period)}-{n:04d}" in used:
        n += 1
    return f"{voucher_prefix(period)}-{n:04d}"


# ---------------------------------------------------------------------------
# Structural validation (cheap checks that must pass before anything is stored)
# ---------------------------------------------------------------------------

class VoucherError(ValueError):
    pass


# Contra accounts accumulate on the opposite side of their class: accumulated
# depreciation is an ASSET-category account with a CREDIT normal balance, and
# getting this wrong flips the sign of every ledger balance the account shows.
CONTRA_CREDIT_CATEGORIES = {"CONTRA_ASSET"}


def normal_balance(account_type: str, fs_category: str | None = None) -> str:
    """ASSET/EXPENSE are debit-nature; contra-assets and everything else credit."""
    if fs_category in CONTRA_CREDIT_CATEGORIES:
        return "CREDIT"
    return "DEBIT" if account_type in ("ASSET", "EXPENSE") else "CREDIT"


def parse_lines(raw_lines: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalise the client payload into the canonical stored line shape."""
    lines: List[Dict[str, Any]] = []
    for idx, raw in enumerate(raw_lines or [], start=1):
        account_code = str(raw.get("account_code") or "").strip()
        if not account_code:
            raise VoucherError(f"第 {idx} 行未選擇科目。")
        debit = q4(raw.get("debit") or 0)
        credit = q4(raw.get("credit") or 0)
        if debit < 0 or credit < 0:
            raise VoucherError(f"第 {idx} 行金額不可為負數；貸方請填在貸方欄。")
        if debit > 0 and credit > 0:
            raise VoucherError(f"第 {idx} 行同時有借方與貸方金額，請拆成兩行。")
        if debit == 0 and credit == 0:
            raise VoucherError(f"第 {idx} 行沒有金額。")
        lines.append(
            {
                "line_number": idx,
                "account_code": account_code,
                "account_name": str(raw.get("account_name") or ""),
                "debit": str(debit),
                "credit": str(credit),
                "memo": str(raw.get("memo") or "").strip(),
                "counterparty": str(raw.get("counterparty") or "").strip(),
                "tax_code": str(raw.get("tax_code") or "").strip(),
                "business_use_pct": str(raw.get("business_use_pct") or "1.0000"),
            }
        )
    return lines


def assert_balanced(lines: List[Dict[str, Any]]) -> Tuple[Decimal, Decimal]:
    if len(lines) < 2:
        raise VoucherError("分錄至少要兩行（一借一貸）。")
    dr = sum((Decimal(l["debit"]) for l in lines), Decimal("0"))
    cr = sum((Decimal(l["credit"]) for l in lines), Decimal("0"))
    if dr != cr:
        raise VoucherError(f"借貸不平衡：借方 {dr}，貸方 {cr}，差額 {dr - cr}。")
    if dr <= 0:
        raise VoucherError("分錄金額必須大於零。")
    return dr, cr


def to_proposed_lines(lines: List[Dict[str, Any]], control_accounts: set[str]) -> List[ProposedLine]:
    """Adapt stored lines to the guard's dataclass so one implementation validates."""
    out: List[ProposedLine] = []
    for l in lines:
        out.append(
            ProposedLine(
                line_number=int(l["line_number"]),
                account_code=l["account_code"],
                is_control_account=l["account_code"] in control_accounts,
                tx_debit=Decimal(l["debit"]),
                tx_credit=Decimal(l["credit"]),
                # Single-currency desktop v0.4: functional == transaction amount.
                func_debit=Decimal(l["debit"]),
                func_credit=Decimal(l["credit"]),
                tax_code=l.get("tax_code") or None,
                memo=l.get("memo", ""),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Chart of accounts (today: derived from the trial balance rows; the real chart_of_accounts
# table exists in database/schema.sql and should replace this)
# ---------------------------------------------------------------------------

CONTROL_FS_CATEGORIES = {"AR", "AP_ACCRUAL", "INVENTORY", "FIXED_ASSET", "TAX_PAYABLE", "DIRECTOR_LOAN"}


async def chart_of_accounts(entity_code: str) -> List[Dict[str, Any]]:
    rows = await repo.get_trial_balance_accounts(entity_code)
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "account_code": r.account_code,
                "account_name": r.account_name,
                "account_type": r.account_type,
                "fs_category": r.fs_category,
                "statement_ref": r.statement_ref,
                "normal_balance": normal_balance(r.account_type, r.fs_category),
                "is_control_account": r.fs_category in CONTROL_FS_CATEGORIES,
                "is_active": True,
            }
        )
    return out


async def account_map(entity_code: str) -> Dict[str, Dict[str, Any]]:
    return {a["account_code"]: a for a in await chart_of_accounts(entity_code)}


# ---------------------------------------------------------------------------
# General ledger — derived from POSTED vouchers, not from a stored trial balance
# ---------------------------------------------------------------------------

async def account_ledger(entity_code: str, account_code: str) -> Dict[str, Any]:
    """
    Opening balance + every POSTED voucher line for one account + running balance.

    The trial balance keeps `opening_balance` as the period's opening position (it is
    seeded today; once opening balances are entered as their own voucher this
    reads from there instead).
    """
    accounts = await account_map(entity_code)
    account = accounts.get(account_code)
    if not account:
        return {"status": "ERROR", "reason": f"COA_MISSING_ACCOUNT: '{account_code}'"}

    trial_balance_rows = {r.account_code: r for r in await repo.get_trial_balance_accounts(entity_code)}
    tb_row = trial_balance_rows.get(account_code)
    opening = q4(tb_row.opening_balance) if tb_row else Decimal("0")

    journals = await repo.get_journals(entity_code=entity_code)
    posted = [j for j in journals if j.get("status") == "POSTED"]
    posted.sort(key=lambda j: (j.get("accounting_date") or "", int(j.get("block_index") or 0)))

    debit_nature = account["normal_balance"] == "DEBIT"
    # Sign convention: positive running balance always means "on the account's
    # normal side", so an asset at 1,234 Dr and a loan at 1,234 Cr both read +1234.
    running = opening if debit_nature else -opening
    movements: List[Dict[str, Any]] = []
    total_dr = Decimal("0")
    total_cr = Decimal("0")

    for j in posted:
        for line in j.get("lines", []):
            if line.get("account_code") != account_code:
                continue
            dr = q4(line.get("debit") or 0)
            cr = q4(line.get("credit") or 0)
            total_dr += dr
            total_cr += cr
            running += (dr - cr) if debit_nature else (cr - dr)
            movements.append(
                {
                    "date": j.get("accounting_date"),
                    "voucher_no": j.get("voucher_no"),
                    "journal_id": j.get("journal_id"),
                    "memo": line.get("memo") or j.get("memo") or "",
                    "counterparty": line.get("counterparty") or "",
                    "debit": str(dr),
                    "credit": str(cr),
                    "balance": str(running),
                    "balance_side": account["normal_balance"] if running >= 0 else ("CREDIT" if debit_nature else "DEBIT"),
                    "entry_hash": j.get("entry_hash"),
                }
            )

    return {
        "status": "SUCCESS",
        "account": account,
        "opening_balance": str(opening),
        "opening_side": account["normal_balance"] if opening >= 0 else ("CREDIT" if debit_nature else "DEBIT"),
        "total_debit": str(total_dr),
        "total_credit": str(total_cr),
        "closing_balance": str(running),
        "closing_side": account["normal_balance"] if running >= 0 else ("CREDIT" if debit_nature else "DEBIT"),
        "movements": movements,
    }


async def trial_balance(entity_code: str) -> List[Dict[str, Any]]:
    """Every account with opening / movement / closing from the GL."""
    out: List[Dict[str, Any]] = []
    for a in await chart_of_accounts(entity_code):
        led = await account_ledger(entity_code, a["account_code"])
        out.append(
            {
                "account_code": a["account_code"],
                "account_name": a["account_name"],
                "statement_ref": a["statement_ref"],
                "opening_balance": led["opening_balance"],
                "total_debit": led["total_debit"],
                "total_credit": led["total_credit"],
                "closing_balance": led["closing_balance"],
                "closing_side": led["closing_side"],
            }
        )
    return out


# ---------------------------------------------------------------------------
# Voucher read model
# ---------------------------------------------------------------------------

def summarise(journal: Dict[str, Any]) -> Dict[str, Any]:
    lines = journal.get("lines", []) or []
    return {
        "journal_id": journal.get("journal_id"),
        "revision": journal.get("revision"),
        "voucher_no": journal.get("voucher_no"),
        "entity_code": journal.get("entity_code"),
        "period": journal.get("period"),
        "accounting_date": journal.get("accounting_date"),
        "currency": journal.get("currency"),
        "status": journal.get("status"),
        "source_module": journal.get("source_module"),
        "memo": journal.get("memo") or (lines[0].get("memo") if lines else ""),
        "total_debit": journal.get("total_debit"),
        "total_credit": journal.get("total_credit"),
        "line_count": len(lines),
        "attachment_count": len(journal.get("evidence_uris") or []),
        "created_by_principal_key": journal.get("created_by_principal_key"),
        "approved_by_principal_key": journal.get("approved_by_principal_key"),
        "submitted_at": journal.get("submitted_at"),
        "posted_at": journal.get("posted_at"),
        "reject_reason": journal.get("reject_reason"),
        "entry_hash": journal.get("entry_hash"),
        "prev_entry_hash": journal.get("prev_entry_hash"),
        "block_index": journal.get("block_index"),
        "reversal_of_journal_id": journal.get("reversal_of_journal_id"),
        "ai_confidence_score": journal.get("ai_confidence_score"),
        "ai_reasoning_summary": journal.get("ai_reasoning_summary"),
    }


def new_journal_id() -> str:
    return str(uuid4())


def today() -> str:
    return date.today().isoformat()
