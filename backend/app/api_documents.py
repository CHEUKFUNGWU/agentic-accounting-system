"""
單據 API — the Transaction page's backend.

A document is captured first and becomes an entry second. That ordering matters:
it is the difference between recording what happened and inventing a journal
entry that happens to balance.

The flow is deliberately three calls:

    POST /documents                    capture the paper + what was read off it
    POST /documents/{id}/to-voucher     turn it into a draft journal entry
    (the ordinary voucher path)         review, then post

Nothing here posts to the ledger. Posting stays in `core/posting.py`, reached
only through review, so a document cannot reach the books without a reviewer.
"""

from __future__ import annotations

import mimetypes
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.auth import AuthPrincipal, get_current_principal
from app.core.positions import out_of_scope
from app.core import vouchers as vz
from app.core.ledger import LedgerError, account_by_code, resolve_counterparty
from app.core.localization import q4
from app.core.repository import repo

router = APIRouter(prefix="/api/v1", tags=["documents"])

DOC_TYPES = {"INVOICE", "RECEIPT", "BILL", "BANK_SLIP", "CONTRACT", "OTHER"}
MAX_BYTES = 15 * 1024 * 1024


def _slug(name: str) -> str:
    import re

    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", (name or "").strip().lower())[:60] or "document"


@router.get("/documents")
async def list_documents(entity_code: str, status: str = "") -> Dict[str, Any]:
    rows = await repo.get_documents(entity_code=entity_code, status=status or None)
    counts: Dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {"documents": rows, "counts": counts}


@router.post("/documents")
async def create_document(
    file: UploadFile = File(...),
    entity_code: str = Form(...),
    doc_type: str = Form("OTHER"),
    doc_date: str = Form(""),
    counterparty_name: str = Form(""),
    amount: str = Form("0.0000"),
    currency: str = Form(""),
    note: str = Form(""),
    principal: AuthPrincipal = Depends(get_current_principal),
) -> Dict[str, Any]:
    doc_type = (doc_type or "OTHER").upper()
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"INVALID_DOC_TYPE: '{doc_type}'")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="EMPTY_FILE: 檔案是空的。")
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="FILE_TOO_LARGE: 單一單據上限 15 MB。")

    entity = await repo.get_entity(entity_code)
    if not entity:
        raise HTTPException(status_code=404, detail=f"ENTITY_NOT_FOUND: '{entity_code}'")

    stored = vz.save_attachment(
        entity_code=entity_code,
        filename=file.filename or "document",
        content=content,
        mime=file.content_type or "",
        uploaded_by=principal.principal_key,
    )

    counterparty_id = None
    counterparty_label = counterparty_name.strip()
    if counterparty_label:
        try:
            counterparty_id = (await resolve_counterparty(entity_code, counterparty_label))["counterparty_id"]
        except LedgerError:
            counterparty_id = None

    record = {
        "document_id": str(uuid4()),
        "entity_code": entity_code,
        "doc_type": doc_type,
        "doc_date": doc_date or date.today().isoformat(),
        "counterparty_id": counterparty_id,
        "counterparty_name": counterparty_label,
        "amount": str(q4(amount or 0)),
        "currency": currency or entity.get("currency", ""),
        "status": "NEW",
        "filename": stored["name"],
        "stored_name": stored["stored_name"],
        "mime": stored["mime"],
        "size": stored["size"],
        "sha256": stored["sha256"],
        "uploaded_by": principal.principal_key,
        "note": note,
    }
    await repo.save_document(record)
    return {"document": record}


class ToVoucherRequest(BaseModel):
    model_config = {"extra": "forbid"}
    debit_account_code: str = Field(default="")
    credit_account_code: str = Field(default="")
    memo: str = Field(default="")


@router.post("/documents/{document_id}/to-voucher")
async def document_to_voucher(document_id: str, body: ToVoucherRequest, principal: AuthPrincipal = Depends(get_current_principal)) -> Dict[str, Any]:
    """
    Turn a captured document into a *draft* journal entry with the document
    attached. It still has to be submitted and reviewed — this call records, it
    does not post.
    """
    from app.core.positions import position_for_accounts

    document = await repo.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"DOCUMENT_NOT_FOUND: '{document_id}'")
    if document["status"] != "NEW":
        raise HTTPException(
            status_code=400,
            detail=f"DOCUMENT_ALREADY_USED: 單據狀態為 {document['status']}，已轉成憑證或已作廢。",
        )
    if not body.debit_account_code or not body.credit_account_code:
        raise HTTPException(status_code=400, detail="ACCOUNTS_REQUIRED: 需要借方與貸方科目。")

    debit = await account_by_code(document["entity_code"], body.debit_account_code)
    credit = await account_by_code(document["entity_code"], body.credit_account_code)
    if not debit or not credit:
        raise HTTPException(status_code=400, detail="COA_MISSING_ACCOUNT: 科目不存在於科目表。")

    amount = q4(document["amount"] or 0)
    if amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="AMOUNT_REQUIRED: 單據金額為零，無法產生分錄。請先補上金額。",
        )

    owner = position_for_accounts([body.debit_account_code, body.credit_account_code])
    from app.mcp_server import PRINCIPALS

    if out_of_scope(principal.position, [body.debit_account_code, body.credit_account_code]):
        raise HTTPException(403, "ACCOUNT_OUT_OF_SCOPE")
    maker_key = principal.principal_key
    maker = PRINCIPALS.get(maker_key)
    if not maker:
        raise HTTPException(status_code=404, detail=f"UNKNOWN_PRINCIPAL: '{maker_key}'")

    label = document["counterparty_name"] or document["filename"]
    memo = body.memo or f"{document['doc_type']} · {label}"
    journal = {
        "journal_id": str(uuid4()),
        "entity_code": document["entity_code"],
        "period": (document["doc_date"] or date.today().isoformat())[:7],
        "voucher_no": await vz.next_voucher_no(document["entity_code"], (document["doc_date"] or date.today().isoformat())[:7]),
        "accounting_date": document["doc_date"] or date.today().isoformat(),
        "currency": document["currency"],
        "status": "DRAFT",
        "source_module": "GL_MANUAL",
        "entry_layer": "OPERATIONAL",
        "basis": "EXTRACTED",
        "memo": memo,
        "total_debit": str(amount),
        "total_credit": str(amount),
        "lines": [
            {
                "line_number": 1,
                "account_code": debit["account_code"],
                "account_name": debit["account_name"],
                "debit": str(amount),
                "credit": "0.0000",
                "memo": memo,
                "counterparty": document["counterparty_name"],
                "counterparty_id": document["counterparty_id"],
                "tax_code": "",
            },
            {
                "line_number": 2,
                "account_code": credit["account_code"],
                "account_name": credit["account_name"],
                "debit": "0.0000",
                "credit": str(amount),
                "memo": memo,
                "counterparty": document["counterparty_name"],
                "counterparty_id": document["counterparty_id"],
                "tax_code": "",
            },
        ],
        # The document itself is the evidence, already content-addressed.
        "evidence_uris": [
            {
                "kind": "voucher_attachment",
                "name": document["filename"],
                "stored_name": document["stored_name"],
                "mime": document["mime"],
                "size": document["size"],
                "sha256": document["sha256"],
                "uploaded_by": document["uploaded_by"],
                "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        ],
        "created_by_principal_key": maker_key,
        "created_by_principal_id": str(maker.principal_id),
        "ai_confidence_score": "1.0000",
        "ai_reasoning_summary": "",
    }
    await repo.save_journal(journal)
    await repo.link_document_to_journal(document_id, journal["journal_id"])
    return {"journal_id": journal["journal_id"], "voucher_no": journal["voucher_no"], "status": "DRAFT"}


@router.post("/documents/{document_id}/void")
async def void_document(document_id: str, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    document = await repo.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"DOCUMENT_NOT_FOUND: '{document_id}'")
    if document["status"] == "POSTED":
        raise HTTPException(
            status_code=400,
            detail="DOCUMENT_LINKED: 單據已轉成憑證，請改用沖銷分錄。",
        )
    reason = str((body or {}).get("reason") or "")
    if not reason.strip():
        raise HTTPException(status_code=400, detail="REASON_REQUIRED: 作廢必須填寫理由。")
    await repo.set_document_status(document_id, "VOID", note=reason.strip())
    return {"document_id": document_id, "status": "VOID"}


@router.get("/documents/{document_id}/file")
async def download_document(document_id: str):
    document = await repo.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"DOCUMENT_NOT_FOUND: '{document_id}'")
    path = vz.attachment_file(document["entity_code"], document["stored_name"])
    if not path:
        raise HTTPException(status_code=404, detail="ATTACHMENT_NOT_FOUND")
    media, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=media or document["mime"] or "application/octet-stream", filename=document["filename"])
