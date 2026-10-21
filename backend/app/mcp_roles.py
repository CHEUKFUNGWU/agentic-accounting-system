"""
Role-scoped MCP surfaces — one MCP server per accounting position.

Why one server per position instead of one server with permission checks:

  * In the official Python SDK (`mcp.server.fastmcp`), a tool has no scopes
    field and `list_tools()` does not filter. The only way to make a tool
    invisible to a role is to not register it.
  * Invisibility is a security property, not tidiness. MCP's `tools/list` is
    the attack surface of an agent: a tool the bot can see is a tool a hostile
    document can talk it into calling through prompt injection. A tool that was
    never registered cannot be called even if the model is convinced to try.
  * Agent identity comes from the credential on the connection, never from a
    request argument. The old surface took `reviewer_principal_key` as a
    parameter with a default, which meant any client could claim to be the CPA.

Exposure matrix (see core/positions.py for the authoritative scopes):

    tool                  cashier  clerks  chief acct  fin mgr  cpa  auditor
    whoami                     x       x        x          x      x       x
    list_accounts              x       x        x          x      x       x
    get_account_ledger         x       x        x          x      x       x
    list_vouchers              x       x        x          x      x       x
    get_voucher                x       x        x          x      x       x
    get_reporting_pack         .       .        x          x      x       x
    create_voucher             x       x        x          x      .       .
    attach_evidence            x       x        x          x      .       .
    submit_voucher             .       x        x          x      .       .
    reverse_voucher            .       x        x          x      .       .
    get_pending_reviews        .       .        x          x      x       .
    review_voucher             .       .        .          .      .       .   (human only; not on agent surfaces)
    raise_exception            x       x        x          x      .       .
    list_exceptions            .       .        x          x      .       .
    resolve_exception          .       .        .          x      .       .
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import uuid4

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from app.core import vouchers as vz
from app.core.localization import q4
from app.core.positions import (
    POSITIONS,
    Position,
    in_scope,
    may_review,
    out_of_scope,
    position_for_principal,
    required_reviewer,
    visible_accounts,
)
from app.core.posting import PostingError, build_reversal_lines, post_voucher
from app.core.repository import repo

logger = logging.getLogger("agentic_accounting.mcp_audit")

DEFAULT_ENTITY = "AU-OPC-01"

BASES = {"TEMPLATE", "RECURRING", "MATCHED", "EXTRACTED", "JUDGEMENT", "MANUAL"}


# ---------------------------------------------------------------------------
# Session: resolved from the bearer credential on the connection
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PositionSession:
    token: str
    position: Position
    principal_key: str
    principal_id: str
    credential_id: str = ""

    @property
    def label(self) -> str:
        return f"{self.position.title_zh} / {self.position.title_en}"


_session_var: ContextVar[Optional[PositionSession]] = ContextVar("position_session", default=None)


def current_session() -> PositionSession:
    session = _session_var.get()
    if session is None:
        raise ToolError(
            "UNAUTHENTICATED: 這個呼叫沒有可解析的身份憑證（Authorization: Bearer <token>）。"
        )
    return session


async def resolve_token(token: str) -> Optional[PositionSession]:
    from app.core.auth import resolve_api_key
    principal = await resolve_api_key(token)
    if not principal:
        return None
    return PositionSession(token="", position=principal.position,
        principal_key=principal.principal_key, principal_id=principal.principal_id,
        credential_id=principal.credential_id)


# ---------------------------------------------------------------------------
# Audit capture
#
# Agent activity must be auditable, and the only place that sees every tool call
# regardless of how many surfaces exist is the transport. So the middleware
# buffers the JSON-RPC request and response and writes one row per tools/call.
# ---------------------------------------------------------------------------

class _BodyCapture:
    """ASGI receive wrapper that keeps a copy of the request body."""

    def __init__(self, receive):
        self._receive = receive
        self.chunks: List[bytes] = []

    async def __call__(self):
        message = await self._receive()
        if message.get("type") == "http.request":
            self.chunks.append(message.get("body", b""))
        return message


class _ResponseCapture:
    """ASGI send wrapper that keeps a copy of the response body."""

    def __init__(self, send):
        self._send = send
        self.status = 0
        self.chunks: List[bytes] = []

    async def __call__(self, message):
        if message.get("type") == "http.response.start":
            self.status = message.get("status", 0)
        elif message.get("type") == "http.response.body":
            self.chunks.append(message.get("body", b""))
        await self._send(message)


_SENSITIVE_KEYS = {"content_base64"}
_REFUSAL_CODE = re.compile(r"\b([A-Z][A-Z0-9_]{5,})\b")


def _redact(value: Any, documents: List[str], depth: int = 0) -> Any:
    """
    Keep the audit row useful without storing the documents themselves: file
    content is replaced by its sha256, long strings are truncated.
    """
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in value.items():
            if key in _SENSITIVE_KEYS and isinstance(item, str):
                digest = None
                try:
                    digest = hashlib.sha256(base64.b64decode(item, validate=True)).hexdigest()
                except Exception:
                    pass
                if digest:
                    documents.append(digest)
                out[key] = {"redacted": True, "sha256": digest, "base64_length": len(item)}
            else:
                out[key] = _redact(item, documents, depth + 1)
        return out
    if isinstance(value, list):
        return [_redact(v, documents, depth + 1) for v in value[:20]]
    if isinstance(value, str) and len(value) > 300:
        return value[:300] + "…"
    return value


class RequirePosition:
    """
    Pure-ASGI guard around one role server.

    Sets the resolved session in a ContextVar for the duration of the request so
    tool handlers never take identity from arguments, and refuses a credential
    that does not belong to this surface.
    """

    def __init__(self, app, position_id: str):
        self.app = app
        self.position_id = position_id

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        raw = headers.get("authorization", "")
        token = raw[7:].strip() if raw.lower().startswith("bearer ") else ""
        session = await resolve_token(token)

        if not session:
            return await self._deny(
                send,
                401,
                "UNAUTHENTICATED",
                "缺少或無效的憑證。請以 Authorization: Bearer <token> 連線。",
            )
        if session.position.position_id != self.position_id:
            return await self._deny(
                send,
                403,
                "POSITION_MISMATCH",
                f"憑證所屬崗位為 {session.position.title_zh}，不可使用 {self.position_id} 這個介面。",
            )

        capture_in = _BodyCapture(receive)
        capture_out = _ResponseCapture(send)
        started = time.perf_counter()
        reset = _session_var.set(session)
        try:
            return await self.app(scope, capture_in, capture_out)
        finally:
            _session_var.reset(reset)
            await self._audit(session, capture_in, capture_out, started)

    @staticmethod
    async def _audit(session: PositionSession, capture_in, capture_out, started: float) -> None:
        """Never allowed to break a request: an audit failure must not fail work."""
        try:
            raw = b"".join(capture_in.chunks)
            if not raw:
                return
            request = json.loads(raw)
            if request.get("method") != "tools/call":
                return  # tools/list is discovery traffic, not activity
            params = request.get("params") or {}
            args = params.get("arguments") or {}

            documents: List[str] = []
            redacted = _redact(args, documents)
            redacted["_authenticated_credential_id"] = session.credential_id

            outcome, error_code, error_message, journal_id = "OK", None, None, args.get("journal_id")
            body = b"".join(capture_out.chunks)
            if body:
                try:
                    payload = json.loads(body)
                    result = payload.get("result") or {}
                    if result.get("isError") or payload.get("error"):
                        outcome = "REFUSED"
                        text = " ".join(
                            c.get("text", "") for c in (result.get("content") or []) if c.get("type") == "text"
                        ) or json.dumps(payload.get("error") or {}, ensure_ascii=False)
                        error_message = text[:600]
                        found = _REFUSAL_CODE.search(text)
                        error_code = found.group(1) if found else "TOOL_REFUSED"
                    else:
                        text = " ".join(
                            c.get("text", "") for c in (result.get("content") or []) if c.get("type") == "text"
                        )
                        try:
                            structured = json.loads(text)
                            journal_id = structured.get("journal_id") or journal_id
                        except Exception:
                            pass
                except Exception:
                    pass

            await repo.save_audit_log(
                {
                    "log_id": str(uuid4()),
                    "position": session.position.position_id,
                    "principal_key": session.principal_key,
                    "tool": params.get("name") or "unknown",
                    "outcome": outcome,
                    "error_code": error_code,
                    "error_message": error_message,
                    "entity_code": args.get("entity_code") or DEFAULT_ENTITY,
                    "journal_id": journal_id,
                    "params_json": json.dumps(redacted, ensure_ascii=False)[:4000],
                    "document_sha256s": json.dumps(documents),
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                }
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("MCP audit log write failed: %s", exc)

    @staticmethod
    async def _deny(send, status: int, code: str, message: str):
        payload = json.dumps({"error": code, "detail": message}, ensure_ascii=False).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(payload)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload})


# ---------------------------------------------------------------------------
# Shared implementation
# ---------------------------------------------------------------------------

async def _accounts_by_code(entity_code: str) -> Dict[str, Dict[str, Any]]:
    return await vz.account_map(entity_code)


async def _whoami(session: PositionSession) -> Dict[str, Any]:
    position = session.position
    return {
        "position": position.position_id,
        "title_zh": position.title_zh,
        "title_en": position.title_en,
        "principal_key": session.principal_key,
        "principal_id": session.principal_id,
        "account_scope": sorted(position.account_scope),
        "can_prepare": position.can_prepare,
        "can_review": position.can_review,
        "cash_custody": position.cash_custody,
        "review_level": position.review_level,
        "read_all_accounts": position.read_all_accounts,
        "mandate_zh": position.mandate_zh,
        "mandate_en": position.mandate_en,
        "reviews_required_from": required_reviewer(position).position_id if position.can_prepare else None,
    }


async def _list_accounts(session: PositionSession, entity_code: str) -> Dict[str, Any]:
    accounts = await _accounts_by_code(entity_code)
    codes = visible_accounts(session.position, accounts.keys())
    return {
        "scope": "all accounts" if session.position.read_all_accounts else "accounts within your position",
        "accounts": [accounts[c] for c in sorted(codes)],
    }


async def _get_account_ledger(session: PositionSession, entity_code: str, account_code: str) -> Dict[str, Any]:
    if not in_scope(session.position, account_code) and not session.position.read_all_accounts:
        raise ToolError(
            f"ACCOUNT_OUT_OF_SCOPE: {account_code} 不在 {session.position.title_zh} 的負責範圍"
            f"（{', '.join(sorted(session.position.account_scope)) or '無'}）。"
        )
    led = await vz.account_ledger(entity_code, account_code)
    if led.get("status") == "ERROR":
        raise ToolError(led["reason"])
    return led


async def _list_vouchers(session: PositionSession, entity_code: str, status: str = "") -> Dict[str, Any]:
    journals = await repo.get_journals(entity_code=entity_code, status=status or None)
    journals.sort(key=lambda j: (j.get("accounting_date") or "", j.get("voucher_no") or ""))
    return {"count": len(journals), "vouchers": [vz.summarise(j) for j in journals]}


async def _get_voucher(session: PositionSession, journal_id: str) -> Dict[str, Any]:
    journal = await repo.get_journal(journal_id)
    if not journal:
        raise ToolError(f"VOUCHER_NOT_FOUND: '{journal_id}'")
    detail = vz.summarise(journal)
    detail["lines"] = journal.get("lines", [])
    detail["evidence_uris"] = journal.get("evidence_uris", [])
    detail["review_notes"] = journal.get("review_notes")
    detail["proposal"] = json.loads(journal["proposal_json"]) if journal.get("proposal_json") else None
    preparer = position_for_principal(journal.get("created_by_principal_key") or "")
    detail["prepared_by_position"] = preparer.position_id if preparer else None
    detail["review_required_from"] = required_reviewer(preparer).position_id if preparer else None
    return detail


async def _get_pending_reviews(session: PositionSession, entity_code: str) -> Dict[str, Any]:
    journals = await repo.get_journals(entity_code=entity_code)
    queue = []
    for j in journals:
        if j.get("status") not in ("PENDING_CHECKER", "AWAITING_CPA"):
            continue
        preparer = position_for_principal(j.get("created_by_principal_key") or "")
        if not preparer or not may_review(session.position, preparer):
            continue
        # A reviewer never sees their own work in the queue.
        if str(j.get("created_by_principal_id")) == session.principal_id:
            continue
        row = vz.summarise(j)
        row["prepared_by_position"] = preparer.position_id
        # A reviewer needs to know how much the proposer was unsure about before
        # opening anything; that is the single most useful triage signal.
        if j.get("proposal_json"):
            try:
                row["proposal_uncertain_count"] = len(json.loads(j["proposal_json"]).get("uncertain") or [])
            except Exception:
                row["proposal_uncertain_count"] = None
        queue.append(row)
    return {"count": len(queue), "queue": queue}


async def _get_reporting_pack(session: PositionSession, entity_code: str, period: str) -> Dict[str, Any]:
    from app.mcp_server import generate_three_statements_reporting

    return await generate_three_statements_reporting(entity_code=entity_code, period=period)


# ---------------------------------------------------------------------------
# Prepare
# ---------------------------------------------------------------------------

async def _create_voucher(
    session: PositionSession,
    entity_code: str,
    accounting_date: str,
    memo: str,
    basis: str,
    lines: List[Dict[str, Any]],
    uncertain: Optional[List[str]] = None,
    attachments: Optional[List[Dict[str, str]]] = None,
    *,
    db_session=None,
    proposal=None,
) -> Dict[str, Any]:
    position = session.position
    if not position.can_prepare:
        raise ToolError(f"SOD_ROLE_VIOLATION: {position.title_zh} 不能製單。")

    # Refuse a locked period at creation, not at posting time: a draft that can
    # never be posted is a trap, not a draft.
    from app.core.ledger import LedgerError, assert_writable

    try:
        await assert_writable(entity_code, period_of(accounting_date), accounting_date, session=db_session)
    except LedgerError as e:
        raise ToolError(str(e))

    basis = (basis or "").upper()
    if basis not in BASES:
        raise ToolError(
            f"BASIS_REQUIRED: 必須聲明這筆分錄的判定基礎（{', '.join(sorted(BASES))}）。"
            "判定基礎決定這筆分錄能不能由機器自行產生。"
        )
    # 代理人不可以假裝自己很確定：判定基礎是 JUDGEMENT 時，必須講明不確定的地方。
    if basis == "JUDGEMENT" and not (uncertain or []):
        raise ToolError(
            "UNCERTAINTY_UNDECLARED: 判定基礎為 JUDGEMENT 時，必須在 uncertain 列出你不確定的地方，"
            "由複核人判斷。不確定不是錯，隱藏不確定才是。"
        )

    try:
        parsed = vz.parse_lines(lines)
        total_dr, total_cr = vz.assert_balanced(parsed)
    except vz.VoucherError as e:
        raise ToolError(str(e))

    # 製單範圍：這個崗位只對自己負責的科目負責。
    codes = [l["account_code"] for l in parsed]
    outside = out_of_scope(position, codes)
    if outside:
        raise ToolError(
            f"ACCOUNT_OUT_OF_SCOPE: {position.title_zh} 只能編制 "
            f"{', '.join(sorted(position.account_scope)) or '（無）'} 的分錄，"
            f"但這張憑證包含 {', '.join(outside)}。請交對應崗位編制。"
        )

    if db_session is None:
        accounts = await _accounts_by_code(entity_code)
    else:
        from app.core.ledger import get_chart
        accounts = {a["account_code"]: a for a in await get_chart(entity_code, include_inactive=True, session=db_session)}
    missing = [c for c in codes if c not in accounts]
    if missing:
        raise ToolError(f"COA_MISSING_ACCOUNT: 科目 {', '.join(missing)} 不存在於科目表。")
    for l in parsed:
        l["account_name"] = accounts[l["account_code"]]["account_name"]

    evidence: List[Dict[str, Any]] = []
    for item in attachments or []:
        try:
            content = base64.b64decode(item.get("content_base64", ""), validate=True)
        except Exception:
            raise ToolError(f"BAD_ATTACHMENT: '{item.get('filename')}' 不是有效的 base64。")
        evidence.append(
            vz.save_attachment(
                entity_code=entity_code,
                filename=item.get("filename") or "attachment",
                content=content,
                mime=item.get("mime") or "application/octet-stream",
                uploaded_by=session.principal_key,
            )
        )

    journal = {
        "journal_id": str(uuid4()),
        "entity_code": entity_code,
        "period": period_of(accounting_date),
        "voucher_no": await vz.next_voucher_no(entity_code, period_of(accounting_date), session=db_session),
        "accounting_date": accounting_date,
        "currency": "AUD",
        "status": "DRAFT",
        "source_module": "GL_MANUAL",
        "basis": basis,
        "memo": memo.strip(),
        "total_debit": str(total_dr),
        "total_credit": str(total_cr),
        "lines": parsed,
        "evidence_uris": evidence,
        "created_by_principal_key": session.principal_key,
        "created_by_principal_id": session.principal_id,
        # The declarer's own uncertainty is carried into the record so the
        # reviewer sees what the machine was unsure about, not just its output.
        "ai_reasoning_summary": ("UNCERTAIN: " + "；".join(uncertain)) if uncertain else "",
        "ai_confidence_score": "1.0000",
    }
    entity = await repo.get_entity(entity_code)
    if entity:
        journal["currency"] = entity.get("currency", "AUD")

    if proposal is not None:
        journal["proposal_json"] = json.dumps(proposal, ensure_ascii=False)
    if db_session is None:
        await repo.save_journal(journal)
    else:
        await repo.insert_draft(journal, session=db_session)
    return {
        "journal_id": journal["journal_id"],
        "voucher_no": journal["voucher_no"],
        "status": journal["status"],
        "total_debit": str(total_dr),
        "attachment_count": len(evidence),
        "next_step": "submit_voucher" if evidence else "attach_evidence（提交複核前必須有原始單據）",
    }


def period_of(accounting_date: str) -> str:
    from app.core.ledger import validate_posting_date

    return validate_posting_date(accounting_date)


async def _propose_entry_from_document(
    session: PositionSession,
    entity_code: str,
    accounting_date: str,
    memo: str,
    document: Dict[str, str],
    document_kind: str,
    extracted_fields: Dict[str, Any],
    declared_sha256: str,
    proposed_lines: List[Dict[str, Any]],
    uncertain: Optional[List[str]] = None,
    matched_to: str = "",
) -> Dict[str, Any]:
    """
    The document-first path: a bot reads a receipt/invoice/bank slip and proposes
    the entry it implies.

    Two things make this more than create_voucher with an attachment:

      * The document's sha256 is *declared* by the proposer and verified against
        the bytes it uploaded. If they differ the proposal is refused, so "I read
        this document" is a checkable claim rather than a statement in prose.
      * The extraction is stored as a first-class object next to the document, so
        the reviewer compares the paper against what the model claims it read —
        instead of trusting a paragraph of reasoning.
    """
    position = session.position
    if not position.can_prepare:
        raise ToolError(f"SOD_ROLE_VIOLATION: {position.title_zh} 不能製單。")

    filename = (document or {}).get("filename") or "document"
    content_b64 = (document or {}).get("content_base64") or ""
    if not content_b64:
        raise ToolError("MISSING_DOCUMENT: 缺少 document.content_base64。")
    try:
        content = base64.b64decode(content_b64, validate=True)
    except Exception:
        raise ToolError("BAD_ATTACHMENT: document.content_base64 不是有效的 base64。")
    if not content:
        raise ToolError("EMPTY_DOCUMENT: 文件是空的。")

    actual_sha256 = hashlib.sha256(content).hexdigest()
    if not declared_sha256:
        raise ToolError(
            "DOCUMENT_HASH_REQUIRED: 必須聲明 declared_sha256 —— 你讀取的那份文件的 sha256。"
            f"（上傳內容的實際 sha256 為 {actual_sha256}）"
        )
    if declared_sha256.lower() != actual_sha256:
        raise ToolError(
            "DOCUMENT_HASH_MISMATCH: declared_sha256 與上傳內容不符。"
            f"宣告 {declared_sha256[:16]}…，實際 {actual_sha256[:16]}…。"
            "提案必須綁定到具體那份文件，不能張冠李戴。"
        )
    if not extracted_fields:
        raise ToolError(
            "EXTRACTION_REQUIRED: 必須提供 extracted_fields —— 你從這份文件讀到的欄位"
            "（例如 vendor / amount / date / tax）。複核人要比對的是你讀到了什麼。"
        )

    from app.core import document_sources as sources

    proposal = {
        "document_kind": document_kind or "unknown",
        "document_name": filename,
        "document_sha256": actual_sha256,
        "matched_to": matched_to or None,
        "extracted_fields": extracted_fields,
        "uncertain": uncertain or [],
        "proposed_by_position": position.position_id,
        "proposed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    try:
        async with sources.entity_transaction(entity_code) as db_session:
            source = await sources.require_unused(db_session, entity_code, actual_sha256)
            result = await _create_voucher(
                session,
                entity_code=entity_code,
                accounting_date=accounting_date,
                memo=memo,
                basis="MATCHED" if matched_to else "EXTRACTED",
                lines=proposed_lines,
                uncertain=uncertain,
                attachments=[{"filename": filename, "content_base64": content_b64, "mime": (document or {}).get("mime", "")}],
                db_session=db_session,
                proposal=proposal,
            )
            await sources.link_source(db_session, source, result["journal_id"])
    except (sources.SourceError, vz.VoucherError) as e:
        raise ToolError(str(e))
    result["proposal"] = proposal

    result["message"] = (
        "提案已建立並綁定文件雜湊。複核人會比對 extracted_fields 與原始單據，"
        "再決定核准、駁回或升級。"
    )
    return result


async def _attach_evidence(
    session: PositionSession, journal_id: str, filename: str, content_base64: str, mime: str = ""
) -> Dict[str, Any]:
    journal = await repo.get_journal(journal_id)
    if not journal:
        raise ToolError(f"VOUCHER_NOT_FOUND: '{journal_id}'")
    if journal.get("status") not in ("DRAFT", "REJECTED"):
        raise ToolError(
            f"VOUCHER_IMMUTABLE: 憑證 {journal.get('voucher_no')} 狀態為 {journal.get('status')}，"
            "不可再附加單據。請以沖銷分錄更正後重開。"
        )
    try:
        content = base64.b64decode(content_base64, validate=True)
    except Exception:
        raise ToolError("BAD_ATTACHMENT: content_base64 不是有效的 base64。")
    if not content:
        raise ToolError("EMPTY_FILE: 檔案是空的。")

    record = vz.save_attachment(journal["entity_code"], filename, content, mime, session.principal_key)
    evidence = list(journal.get("evidence_uris") or [])
    evidence.append(record)
    journal["evidence_uris"] = evidence
    await repo.save_journal(journal)
    return {"stored_name": record["stored_name"], "sha256": record["sha256"], "attachment_count": len(evidence)}


async def _submit_voucher(session: PositionSession, journal_id: str) -> Dict[str, Any]:
    journal = await repo.get_journal(journal_id)
    if not journal:
        raise ToolError(f"VOUCHER_NOT_FOUND: '{journal_id}'")
    if journal.get("status") not in ("DRAFT", "REJECTED"):
        raise ToolError(f"INVALID_STATE: 憑證狀態為 {journal.get('status')}，不可提交。")
    if str(journal.get("created_by_principal_id")) != session.principal_id:
        raise ToolError(
            "NOT_YOUR_VOUCHER: 只能提交自己編制的憑證。"
            f"這張由 {journal.get('created_by_principal_key')} 編制。"
        )
    evidence = journal.get("evidence_uris") or []
    if not evidence:
        raise ToolError("EVIDENCE_REQUIRED_VIOLATION: 提交複核前必須附上至少一張原始單據。")

    preparer = position_for_principal(journal.get("created_by_principal_key") or "")
    journal["status"] = "PENDING_CHECKER"
    journal["submitted_at"] = datetime.now(timezone.utc)
    journal["reject_reason"] = None
    await repo.save_journal(journal)
    return {
        "voucher_no": journal.get("voucher_no"),
        "status": "PENDING_CHECKER",
        "awaiting_review_by": required_reviewer(preparer or session.position).position_id,
        "message": "已提交。製單人不可複核自己編制的憑證。",
    }


async def _void_voucher(session: PositionSession, journal_id: str, reason: str) -> Dict[str, Any]:
    """
    Void a draft or rejected voucher.

    Voiding rather than deleting, because the voucher number must not be reused:
    a gap in the sequence is an audit finding, and a number that reappears on a
    different entry is worse. The row stays, marked VOID, with the reason.
    """
    if not reason.strip():
        raise ToolError("REASON_REQUIRED: 作廢必須填寫理由。")
    journal = await repo.get_journal(journal_id)
    if not journal:
        raise ToolError(f"VOUCHER_NOT_FOUND: '{journal_id}'")
    if journal.get("status") not in ("DRAFT", "REJECTED"):
        raise ToolError(
            f"CANNOT_VOID: 只有草稿或已駁回的憑證可以作廢（目前 {journal.get('status')}）。"
            "已過賬的憑證只能沖銷。"
        )
    if str(journal.get("created_by_principal_id")) != session.principal_id:
        raise ToolError(
            f"NOT_YOUR_VOUCHER: 只能作廢自己編制的憑證（這張由 {journal.get('created_by_principal_key')} 編制）。"
        )
    journal["status"] = "VOID"
    journal["reject_reason"] = f"作廢：{reason.strip()}"
    await repo.save_journal(journal)
    return {
        "voucher_no": journal.get("voucher_no"),
        "status": "VOID",
        "message": "已作廢。憑證號保留、不得重用，號碼不會出現空隙。",
    }


async def _reverse_voucher(session: PositionSession, journal_id: str, reason: str) -> Dict[str, Any]:
    if not reason.strip():
        raise ToolError("REASON_REQUIRED: 沖銷必須填寫理由。")
    original = await repo.get_journal(journal_id)
    if not original:
        raise ToolError(f"VOUCHER_NOT_FOUND: '{journal_id}'")
    if original.get("status") != "POSTED":
        raise ToolError(f"CANNOT_REVERSE: 只有已過賬憑證可沖銷（目前 {original.get('status')}）。")

    if original.get("reversal_of_journal_id") or original.get("source_module") == "REVERSAL":
        raise ToolError("REVERSAL_INVALID: reversing a posted reversal is not supported.")
    try:
        lines = await build_reversal_lines(original, reason=reason)
    except PostingError as exc:
        raise ToolError(str(exc)) from exc
    original_codes = [line["account_code"] for line in lines]
    outside = out_of_scope(session.position, original_codes)
    if outside:
        raise ToolError(
            f"ACCOUNT_OUT_OF_SCOPE: 這張憑證涉及 {', '.join(outside)}，不在 {session.position.title_zh} 的範圍，"
            "請交對應崗位或會計主任沖銷。"
        )

    from app.mcp_server import PRINCIPALS

    principal = PRINCIPALS[session.principal_key]
    entity_code = original["entity_code"]
    from app.core.ledger import LedgerError, assert_writable

    accounting_date = date.today().isoformat()
    try:
        period = period_of(accounting_date)
        await assert_writable(entity_code, period, accounting_date)
    except LedgerError as e:
        raise ToolError(str(e))
    journal = {
        "journal_id": str(uuid4()),
        "entity_code": entity_code,
        "period": period,
        "voucher_no": await vz.next_voucher_no(entity_code, period),
        "accounting_date": accounting_date,
        "currency": original.get("currency"),
        "status": "DRAFT",
        "source_module": "REVERSAL",
        "entry_layer": original["entry_layer"],
        "basis": "MANUAL",
        "memo": f"沖銷憑證 {original.get('voucher_no')}：{reason}",
        "total_debit": original.get("total_credit"),
        "total_credit": original.get("total_debit"),
        "lines": lines,
        # 沖銷的證據就是被沖銷的那張憑證本身。
        "evidence_uris": [
            {
                "kind": "reversal_of",
                "name": f"{original.get('voucher_no')}.voucher",
                "stored_name": original.get("journal_id"),
                "mime": "application/vnd.agentic-accounting.voucher",
                "size": 0,
                "sha256": original.get("entry_hash") or "",
                "uploaded_by": session.principal_key,
                "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        ],
        "created_by_principal_key": session.principal_key,
        "created_by_principal_id": str(principal.principal_id),
        "reversal_of_journal_id": original["journal_id"],
        "ai_confidence_score": "1.0000",
        "ai_reasoning_summary": "",
    }
    await repo.save_journal(journal)
    return {
        "voucher_no": journal["voucher_no"],
        "reverses": original.get("voucher_no"),
        "status": "DRAFT",
        "message": "已建立沖銷憑證（原憑證不會被刪除或修改）。提交後仍需複核。",
    }


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------

async def _review_voucher(
    session: PositionSession,
    journal_id: str,
    verdict: str,
    checked: Optional[List[str]] = None,
    reason: str = "",
) -> Dict[str, Any]:
    journal = await repo.get_journal(journal_id)
    if not journal:
        raise ToolError(f"VOUCHER_NOT_FOUND: '{journal_id}'")
    if journal.get("status") not in ("PENDING_CHECKER", "AWAITING_CPA"):
        raise ToolError(
            f"INVALID_STATE: 憑證 {journal.get('voucher_no')} 狀態為 {journal.get('status')}，不在待複核佇列。"
        )

    from app.core.reviewer import authorize_review, validate_verdict

    try:
        verdict = validate_verdict(verdict)
        authority = await authorize_review(session.principal_key, journal, principal_id=session.principal_id)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc
    preparer = authority.preparer
    # Use current auth-bound authority, never a stale/display session position.
    session = replace(session, position=authority.position,
                      principal_id=str(authority.identity.principal_id))

    # 3) 複核要有內容：核准必須附上檢查清單，否則只是蓋章。
    if verdict == "APPROVE" and not (checked or []):
        raise ToolError(
            "REVIEW_CHECKLIST_REQUIRED: 核准必須在 checked 列出你實際核對過的項目"
            "（例如「金額與發票相符」「科目性質正確」「期間正確」）。沒有檢查清單的複核不算複核。"
        )
    if verdict in ("REJECT", "ESCALATE") and not reason.strip():
        raise ToolError("REASON_REQUIRED: 駁回或升級必須填寫理由。")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    journal["review_notes"] = json.dumps(
        {
            "verdict": verdict,
            "reviewer_position": session.position.position_id,
            "reviewer_principal_key": session.principal_key,
            "checked": checked or [],
            "reason": reason,
            "reviewed_at": now,
        },
        ensure_ascii=False,
    )

    if verdict == "REJECT":
        journal["status"] = "REJECTED"
        journal["reject_reason"] = reason.strip()
        await repo.save_journal(journal)
        return {
            "voucher_no": journal.get("voucher_no"),
            "status": "REJECTED",
            "returned_to": preparer.position_id,
            "reason": reason.strip(),
        }

    if verdict == "ESCALATE":
        journal["status"] = "AWAITING_CPA"
        await repo.save_journal(journal)
        next_up = (
            POSITIONS["FINANCE_MANAGER"]
            if session.position.review_level == 2
            else POSITIONS["CPA_ADVISOR"]
        )
        return {
            "voucher_no": journal.get("voucher_no"),
            "status": "AWAITING_CPA",
            "escalated_to": next_up.position_id,
            "reason": reason.strip(),
            "message": "已升級。升級的觸發條件是能力、範圍或證據不足，不是金額。",
        }

    # APPROVE -> post. One implementation, shared with the legacy REST review
    # path (see core/posting.py).
    try:
        sealed = await post_voucher(
            journal,
            approver_principal_id=session.principal_id,
            approver_principal_key=session.principal_key,
        )
    except PostingError as e:
        raise ToolError(str(e))

    return {
        "voucher_no": journal.get("voucher_no"),
        "status": "POSTED",
        "reviewed_by_position": session.position.position_id,
        "checked": checked or [],
        "block_index": sealed["block_index"],
        "entry_hash": sealed["entry_hash"],
        "prev_entry_hash": sealed["prev_entry_hash"],
        "columns": sealed["columns"],
        "message": "已過賬至總帳，並寫入試算表。此憑證自此不可修改，只能沖銷。",
    }


# ---------------------------------------------------------------------------
# Exceptions: how a bot hands something to a human
# ---------------------------------------------------------------------------

async def _raise_exception(
    session: PositionSession, entity_code: str, subject: str, detail: str = "", journal_id: str = ""
) -> Dict[str, Any]:
    record = {
        "exception_id": str(uuid4()),
        "entity_code": entity_code,
        "journal_id": journal_id or None,
        "subject": subject.strip() or "未命名例外",
        "detail": detail,
        "raised_by_principal_key": session.principal_key,
        "raised_by_position": session.position.position_id,
        "status": "OPEN",
    }
    await repo.save_exception(record)
    return {
        "exception_id": record["exception_id"],
        "status": "OPEN",
        "message": "已交給人處理。不確定時不要猜——升級比編一個看起來合理的分錄安全。",
    }


async def _get_agent_activity(
    session: PositionSession, entity_code: str, tool: str = "", principal_key: str = "", limit: int = 50
) -> Dict[str, Any]:
    rows = await repo.get_audit_logs(
        entity_code=entity_code, tool=tool or None, principal_key=principal_key or None, limit=limit
    )
    refused = [r for r in rows if r["outcome"] == "REFUSED"]
    return {
        "count": len(rows),
        "refused_count": len(refused),
        "activity": rows,
    }


async def _get_unreviewed_agent_entries(session: PositionSession, entity_code: str) -> Dict[str, Any]:
    """
    The auditor's first question: which posted entries were prepared AND reviewed
    by machines, with no human anywhere in the loop?

    The answer is not automatically alarming — an entry whose basis is verifiable
    by rule (TEMPLATE / RECURRING / MATCHED) is exactly what automation is for.
    What matters is the mix: JUDGEMENT and EXTRACTED entries in this list are the
    ones a human should sample.
    """
    journals = await repo.get_journals(entity_code=entity_code)
    rows: List[Dict[str, Any]] = []
    for j in journals:
        if j.get("status") not in ("POSTED", "REVERSED"):
            continue
        preparer = position_for_principal(j.get("created_by_principal_key") or "")
        reviewer = position_for_principal(j.get("approved_by_principal_key") or "")
        if (preparer and preparer.is_human) or (reviewer and reviewer.is_human):
            continue
        rows.append(
            {
                "voucher_no": j.get("voucher_no"),
                "journal_id": j.get("journal_id"),
                "accounting_date": j.get("accounting_date"),
                "basis": j.get("basis"),
                "amount": j.get("total_debit"),
                "prepared_by_position": preparer.position_id if preparer else j.get("created_by_principal_key"),
                "reviewed_by_position": reviewer.position_id if reviewer else j.get("approved_by_principal_key"),
                "verifiable_by_rule": (j.get("basis") or "") in ("TEMPLATE", "RECURRING", "MATCHED"),
                "requires_human_sampling": (j.get("basis") or "") in ("JUDGEMENT", "EXTRACTED", "MANUAL"),
            }
        )

    sample = [r for r in rows if r["requires_human_sampling"]]
    return {
        "entity_code": entity_code,
        "fully_automated_count": len(rows),
        "needs_sampling_count": len(sample),
        "entries": rows,
        "note": (
            "這份清單是「製單與複核都是代理人、過程中沒有真人」的已過賬分錄。"
            "判定基礎為 TEMPLATE／RECURRING／MATCHED 者屬自動化的正常產出；"
            "JUDGEMENT／EXTRACTED／MANUAL 者應安排人工抽樣覆核。"
        ),
    }


async def _list_exceptions(session: PositionSession, entity_code: str, status: str = "OPEN") -> Dict[str, Any]:
    rows = await repo.get_exceptions(entity_code=entity_code, status=status or None)
    return {"count": len(rows), "exceptions": rows}


async def _resolve_exception(
    session: PositionSession, exception_id: str, note: str
) -> Dict[str, Any]:
    if not note.strip():
        raise ToolError("NOTE_REQUIRED: 結案必須說明處理方式。")
    ok = await repo.resolve_exception(exception_id, session.principal_key, note)
    if not ok:
        raise ToolError(f"EXCEPTION_NOT_FOUND: '{exception_id}'")
    return {"exception_id": exception_id, "status": "RESOLVED", "resolved_by": session.principal_key}


# ---------------------------------------------------------------------------
# Server construction — the exposure matrix lives here
# ---------------------------------------------------------------------------

def build_role_server(position: Position) -> FastMCP:
    server = FastMCP(
        name=f"agentic-accounting-{position.position_id.lower()}",
        instructions=(
            f"會計崗位：{position.title_zh}（{position.title_en}）。\n"
            f"職責：{position.mandate_zh}\n"
            f"可編制科目：{', '.join(sorted(position.account_scope)) or '無'}\n"
            f"複核權限：{'有' if position.can_review else '無'}\n"
            "身分由連線憑證決定，任何工具都不接受身分參數。\n"
            "單據優先：有原始單據時用 propose_entry_from_document（它把抽取欄位與文件雜湊一併存證），"
            "沒有單據只有判斷時才用 create_voucher。"
        ),
        streamable_http_path="/",
        json_response=True,
        stateless_http=True,
    )

    # ---- identity & read (every position) ------------------------------
    @server.tool()
    async def whoami() -> Dict[str, Any]:
        """Return this bot's position, account scope and capabilities."""
        return await _whoami(current_session())

    @server.tool()
    async def list_accounts(entity_code: str = DEFAULT_ENTITY) -> Dict[str, Any]:
        """List the chart-of-accounts entries this position is allowed to see."""
        return await _list_accounts(current_session(), entity_code)

    @server.tool()
    async def get_account_ledger(account_code: str, entity_code: str = DEFAULT_ENTITY) -> Dict[str, Any]:
        """General ledger for one account: opening, posted movements, running balance, closing."""
        return await _get_account_ledger(current_session(), entity_code, account_code)

    @server.tool()
    async def list_vouchers(status: str = "", entity_code: str = DEFAULT_ENTITY) -> Dict[str, Any]:
        """List vouchers. status: DRAFT / PENDING_CHECKER / POSTED / REJECTED / REVERSED, or empty for all."""
        return await _list_vouchers(current_session(), entity_code, status)

    @server.tool()
    async def get_voucher(journal_id: str) -> Dict[str, Any]:
        """Fetch one voucher with its lines, attachments and review notes."""
        return await _get_voucher(current_session(), journal_id)

    # ---- read, restricted ----------------------------------------------
    if position.read_all_accounts or position.can_review:
        @server.tool()
        async def get_reporting_pack(period: str, entity_code: str = DEFAULT_ENTITY) -> Dict[str, Any]:
            """Three-statement schedule pack (trial balance, P&L, B/S, cash flow, lead schedules)."""
            return await _get_reporting_pack(current_session(), entity_code, period)

    # ---- prepare --------------------------------------------------------
    if position.can_prepare:
        @server.tool()
        async def create_voucher(
            accounting_date: str,
            memo: str,
            basis: str,
            lines: List[Dict[str, Any]],
            uncertain: Optional[List[str]] = None,
            attachments: Optional[List[Dict[str, str]]] = None,
        ) -> Dict[str, Any]:
            """
            Record a journal voucher (記賬憑證).

            Only accounts inside your position's scope are accepted; anything
            outside must be prepared by the position that owns it.

            basis declares how the entry was derived and is REQUIRED:
              TEMPLATE / RECURRING / MATCHED  - machine-verifiable, derived by rule
              EXTRACTED                       - read off a document, needs confirmation
              JUDGEMENT                       - accrual, allocation, classification
              MANUAL                          - hand-typed with no derivation
            For JUDGEMENT you must also declare what you were unsure about.

            lines: [{"account_code","debit","credit","memo","counterparty"}]
            attachments: [{"filename","content_base64","mime"}] — at least one is
            required before the voucher can be submitted for review.
            """
            return await _create_voucher(
                current_session(),
                entity_code=entity_code_for(position),
                accounting_date=accounting_date,
                memo=memo,
                basis=basis,
                lines=lines,
                uncertain=uncertain,
                attachments=attachments,
            )

        @server.tool()
        async def propose_entry_from_document(
            accounting_date: str,
            memo: str,
            document: Dict[str, str],
            document_kind: str,
            extracted_fields: Dict[str, Any],
            declared_sha256: str,
            proposed_lines: List[Dict[str, Any]],
            uncertain: Optional[List[str]] = None,
            matched_to: str = "",
        ) -> Dict[str, Any]:
            """
            Propose a journal entry from a source document. This is the path to
            prefer whenever a receipt, invoice or bank slip exists.

            document: {"filename", "content_base64", "mime"}
            document_kind: invoice | receipt | bank_slip | statement | contract
            extracted_fields: what you read off the document (vendor, amount, date, tax…)
            declared_sha256: the sha256 of the document you read; verified against
                             the uploaded bytes, so the proposal is bound to one
                             specific piece of paper
            proposed_lines: [{"account_code","debit","credit","memo","counterparty"}]
            uncertain: anything you could not determine — say so, it is not a failure
            """
            return await _propose_entry_from_document(
                current_session(),
                entity_code=DEFAULT_ENTITY,
                accounting_date=accounting_date,
                memo=memo,
                document=document,
                document_kind=document_kind,
                extracted_fields=extracted_fields,
                declared_sha256=declared_sha256,
                proposed_lines=proposed_lines,
                uncertain=uncertain,
                matched_to=matched_to,
            )

        @server.tool()
        async def attach_evidence(
            journal_id: str, filename: str, content_base64: str, mime: str = ""
        ) -> Dict[str, Any]:
            """Attach a source document to a draft voucher (content-addressed by sha256)."""
            return await _attach_evidence(current_session(), journal_id, filename, content_base64, mime)

    if position.can_prepare and not position.cash_custody:
        @server.tool()
        async def submit_voucher(journal_id: str) -> Dict[str, Any]:
            """Submit a draft voucher for review. Refused without at least one attachment."""
            return await _submit_voucher(current_session(), journal_id)

        @server.tool()
        async def void_voucher(journal_id: str, reason: str) -> Dict[str, Any]:
            """Void a draft or rejected voucher. The number is kept, never reused."""
            return await _void_voucher(current_session(), journal_id, reason)

        @server.tool()
        async def reverse_voucher(journal_id: str, reason: str) -> Dict[str, Any]:
            """Create a mirror-image voucher that reverses a posted one. Nothing is ever deleted."""
            return await _reverse_voucher(current_session(), journal_id, reason)

    # ---- review ---------------------------------------------------------
    if position.can_review:
        @server.tool()
        async def get_pending_reviews(entity_code: str = DEFAULT_ENTITY) -> Dict[str, Any]:
            """Vouchers waiting for this position. Never includes your own work."""
            return await _get_pending_reviews(current_session(), entity_code)

        # review_voucher is deliberately not registered: these surfaces only admit
        # agent credentials, and review decisions require a human (ADR-0001 O2-g).
        # _review_voucher remains the shared implementation, guarded again by
        # authorize_review for any future human-authenticated session.

    # ---- exceptions -----------------------------------------------------
    if position.can_prepare or position.can_review:
        @server.tool()
        async def raise_exception(
            subject: str, detail: str = "", journal_id: str = "", entity_code: str = DEFAULT_ENTITY
        ) -> Dict[str, Any]:
            """Hand something to a human instead of guessing."""
            return await _raise_exception(current_session(), entity_code, subject, detail, journal_id)

    if position.read_all_accounts and (position.can_review or position.is_human):
        @server.tool()
        async def get_agent_activity(
            entity_code: str = DEFAULT_ENTITY, tool: str = "", principal_key: str = "", limit: int = 50
        ) -> Dict[str, Any]:
            """Every tool call an agent made, with identity, parameters and whether it was refused."""
            return await _get_agent_activity(current_session(), entity_code, tool, principal_key, limit)

        @server.tool()
        async def get_unreviewed_agent_entries(entity_code: str = DEFAULT_ENTITY) -> Dict[str, Any]:
            """Posted entries whose preparer AND reviewer were machines, with no human in the loop."""
            return await _get_unreviewed_agent_entries(current_session(), entity_code)

    if position.position_id in ("GL_ACCOUNTANT", "FINANCE_MANAGER") or position.is_human:
        @server.tool()
        async def list_exceptions(entity_code: str = DEFAULT_ENTITY, status: str = "OPEN") -> Dict[str, Any]:
            """The human queue: exceptions raised by bots."""
            return await _list_exceptions(current_session(), entity_code, status)

    if position.position_id == "FINANCE_MANAGER" or position.is_human:
        @server.tool()
        async def resolve_exception(exception_id: str, note: str) -> Dict[str, Any]:
            """Close an exception with a note explaining what was done."""
            return await _resolve_exception(current_session(), exception_id, note)

    return server


def entity_code_for(position: Position) -> str:
    """Single-entity desktop build: the position is bound to one company's books."""
    return DEFAULT_ENTITY


def role_path(position: Position) -> str:
    return f"/mcp/{position.position_id.lower().replace('_', '-')}"


ROLE_SERVERS: Dict[str, FastMCP] = {pid: build_role_server(pos) for pid, pos in POSITIONS.items() if pid != "ADMIN"}


def mount_role_servers(app) -> Dict[str, str]:
    """Mount one guarded MCP surface per position. Returns position -> URL."""
    mounted: Dict[str, str] = {}
    for position_id, server in ROLE_SERVERS.items():
        path = role_path(POSITIONS[position_id])
        app.mount(path, RequirePosition(server.streamable_http_app(), position_id))
        mounted[position_id] = f"{path}/"
    return mounted


async def describe_surfaces() -> List[Dict[str, Any]]:
    """Human-readable inventory: which tools each surface exposes."""
    out: List[Dict[str, Any]] = []
    for position_id, server in ROLE_SERVERS.items():
        tools = sorted(t.name for t in await server.list_tools())
        position = POSITIONS[position_id]
        out.append(
            {
                "position": position_id,
                "title": position.title_zh,
                "title_en": position.title_en,
                "principal_key": position.principal_key,
                "url": role_path(position) + "/",
                "tool_count": len(tools),
                "tools": tools,
                "account_scope": sorted(position.account_scope),
                "can_prepare": position.can_prepare,
                "can_review": position.can_review,
            }
        )
    return out
