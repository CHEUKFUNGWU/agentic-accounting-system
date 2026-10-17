"""
FastAPI Application Gateway for SME, OPC & Sole Proprietor Agentic Accounting System.
Mounts:
  1. One role-scoped Stateless Streamable HTTP MCP Server per accounting position
     (`/mcp/<role>`, `modelcontextprotocol/python-sdk`)
  2. Hybrid Event-Driven Orchestrator lifespan worker
  3. REST & SSE Endpoints at `/api/v1/*` for the shadcn/ui Three-Statement schedule Command Center
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, AsyncGenerator, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api_monolith import router as monolith_router
from app.api_documents import router as document_router
from app.api_vouchers import router as voucher_router
from app.mcp_roles import mount_role_servers
from app.core.repository import repo
from app.core.ledger import migrate_entity_core
from app.mcp_server import (
    ENTITIES,
    JOURNAL_LEDGER,
    PRINCIPALS,
    generate_three_statements_reporting,
    lock_and_sign_reporting_pack,
    propose_adjusting_entry,
    propose_expense_with_personal_split,
    review_and_approve_proposal,
    sync_state_from_db,
)
from app.orchestrator.event_bus import orchestrator

logger = logging.getLogger("agentic_accounting.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await repo.init_seed_data_if_needed()
    await sync_state_from_db()

    # Build the general-ledger core for every entity: chart of accounts, fiscal
    # periods, tax codes, and the migration vouchers that carry the old seeded
    # trial balance into the ledger as dated, traceable entries. Idempotent.
    from app.core.ledger import migrate_entity_core

    for code, meta in ENTITIES.items():
        result = await migrate_entity_core(
            code, meta.get("jurisdiction", ""), currency=meta.get("currency", "AUD")
        )
        if result.get("status") == "MIGRATED":
            logger.info("Ledger core migrated for %s: %s", code, result)

    # Starlette's Mount does NOT run a sub-app's lifespan, and every mounted MCP
    # server needs its streamable session manager running. Without this every
    # request dies with "Task group is not initialized. Make sure to use run()."
    from app.mcp_roles import ROLE_SERVERS

    async with AsyncExitStack() as stack:
        for server in ROLE_SERVERS.values():
            await stack.enter_async_context(server.session_manager.run())

        await orchestrator.start()
        try:
            yield
        finally:
            await orchestrator.stop()


app = FastAPI(
    title="SME, OPC & Sole Proprietor Agentic Accounting System (3-Statement schedules + Stateless MCP)",
    version="0.4.0",
    description=(
        "Standalone Three Financial Statement schedule Engine (trial balance, detail schedules, P&L, B/S, Cash Flow, "
        "Statutory Tax Schedule & Close Checklist) with Stateless Streamable HTTP MCP Gateway."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One MCP surface per accounting position: a tool a position may not use is not
# registered on that surface at all. The legacy single /mcp mount was removed —
# it shared one tool list with every caller and took the acting principal as a
# request argument, so any client could claim to be the CPA. Nothing called it.
MCP_ROLE_SURFACES: Dict[str, str] = mount_role_servers(app)


# Recording path (vouchers, attachments, general ledger) lives in its own module
# so the shipping reporting endpoints stay untouched.
app.include_router(voucher_router)
app.include_router(document_router)
app.include_router(monolith_router)

@app.get("/api/v1/audit/agent-activity")
async def agent_activity(entity_code: str = "AU-OPC-01", limit: int = 50) -> Dict[str, Any]:
    """Every tool call an agent made against the role-scoped MCP surfaces."""
    rows = await repo.get_audit_logs(entity_code=entity_code, limit=limit)
    return {"count": len(rows), "activity": rows}


@app.get("/api/v1/audit/no-human-review")
async def no_human_review(entity_code: str = "AU-OPC-01") -> Dict[str, Any]:
    """
    Posted entries whose preparer AND reviewer were machines.

    This is the question an auditor asks about an agentic ledger, and it used to
    be unanswerable: the vouchers carried the maker and reviewer, but nothing
    recorded who (or what) they were.
    """
    from app.core.positions import position_for_principal

    journals = await repo.get_journals(entity_code=entity_code)
    rows = []
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
                "basis": j.get("basis"),
                "amount": j.get("total_debit"),
                "prepared_by": preparer.position_id if preparer else j.get("created_by_principal_key"),
                "reviewed_by": reviewer.position_id if reviewer else j.get("approved_by_principal_key"),
                "requires_human_sampling": (j.get("basis") or "") in ("JUDGEMENT", "EXTRACTED", "MANUAL"),
            }
        )
    return {
        "entity_code": entity_code,
        "fully_automated_count": len(rows),
        "needs_sampling_count": len([r for r in rows if r["requires_human_sampling"]]),
        "entries": rows,
    }


@app.get("/api/v1/mcp/surfaces")
async def list_mcp_surfaces() -> Dict[str, Any]:
    """Inventory of role-scoped MCP surfaces and the tools each one exposes."""
    from app.mcp_roles import describe_surfaces

    return {"surfaces": await describe_surfaces()}


class PersonalExpenseSplitWebhook(BaseModel):
    entity_code: str = Field(default="AU-OPC-01")
    expense_description: str = Field(default="Founder Home Office Fibre, Mobile & AI Cloud Workstation")
    gross_amount_paid: str = Field(default="2200.0000")
    tax_rate: str = Field(default="0.10")
    business_use_pct: str = Field(default="0.70")
    evidence_uri: str = Field(default="s3://agentic-evidence-vault/2026/10/mixed-receipt-101.pdf")


class AdjustingEntryRequest(BaseModel):
    entity_code: str = Field(default="AU-OPC-01")
    debit_account_code: str = Field(..., examples=["6100", "6410", "7500"])
    credit_account_code: str = Field(..., examples=["2110", "1650", "1420", "2210"])
    amount: str = Field(..., examples=["1800.0000"])
    memo: str = Field(..., examples=["Month-end accrued external CPA review fee (AA)"])
    statement_ref: str = Field(default="AP")


class LockScheduleRequest(BaseModel):
    cpa_principal_key: str = Field(default="cpa-griffin")
    period: str = Field(default="2026-10")


class JournalReviewRequest(BaseModel):
    reviewer_principal_key: str = Field(default="controller-checker-01")
    action: str = Field(default="APPROVE", examples=["APPROVE", "REJECT"])
    rejection_reason: str = Field(default="")



@app.get("/api/v1/system/overview")
async def get_system_overview() -> Dict[str, Any]:
    return {
        "target_segments": ["SME (中小企業)", "OPC (One-Person Company / 一人有限公司)", "Sole Proprietor (個體工商戶 / Sole Trader)"],
        "mcp_transport": "Stateless Streamable HTTP (2026-07-28 Spec)",
        "mcp_endpoints": MCP_ROLE_SURFACES,
        "entities": ENTITIES,
        "agent_principals": {
            k: {
                "principal_id": str(v.principal_id),
                "agent_name": v.agent_name,
                "role": v.role.value,
                "max_auto_approve_func_amount": str(v.max_auto_approve_func_amount),
                "min_confidence_threshold": str(v.min_confidence_threshold),
            }
            for k, v in PRINCIPALS.items()
        },
    }


@app.get("/api/v1/reporting/{entity_code}/{period}")
async def get_three_statement_reporting_pack(entity_code: str, period: str = "2026-10") -> Dict[str, Any]:
    pack = await generate_three_statements_reporting(entity_code=entity_code, period=period)
    if pack.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=pack["reason"])
    return pack


@app.post("/api/v1/webhooks/personal-expense-split")
async def ingest_mixed_expense(body: PersonalExpenseSplitWebhook) -> Dict[str, Any]:
    maker_res = await propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code=body.entity_code,
        expense_description=body.expense_description,
        gross_amount_paid=body.gross_amount_paid,
        tax_rate=body.tax_rate,
        business_use_pct=body.business_use_pct,
        evidence_uri=body.evidence_uri,
    )
    if maker_res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=maker_res["reason"])
    updated_pack = await generate_three_statements_reporting(entity_code=body.entity_code, period="2026-10")
    return {
        "maker_result": maker_res,
        "reporting_pack": updated_pack,
    }


@app.post("/api/v1/reporting/aje")
async def post_adjusting_entry(body: AdjustingEntryRequest) -> Dict[str, Any]:
    res = await propose_adjusting_entry(
        entity_code=body.entity_code,
        debit_account_code=body.debit_account_code,
        credit_account_code=body.credit_account_code,
        amount=body.amount,
        memo=body.memo,
        statement_ref=body.statement_ref,
    )
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=res["reason"])
    updated_pack = await generate_three_statements_reporting(entity_code=body.entity_code, period="2026-10")
    return {"aje_result": res, "reporting_pack": updated_pack}


@app.post("/api/v1/reporting/{entity_code}/{period}/lock")
async def lock_reporting_pack_endpoint(entity_code: str, period: str, body: LockScheduleRequest) -> Dict[str, Any]:
    updated_pack = await lock_and_sign_reporting_pack(
        entity_code=entity_code,
        cpa_principal_key=body.cpa_principal_key,
        period=period,
    )
    if updated_pack.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=updated_pack["reason"])
    return {"reporting_pack": updated_pack}


@app.get("/api/v1/ledger/journals")
async def get_journals() -> Dict[str, Any]:
    return {
        "journals": list(JOURNAL_LEDGER.values()),
        "recent_outbox_events": [
            {
                "event_id": str(e.event_id),
                "event_type": e.event_type,
                "entity_code": e.entity_code,
                "aggregate_id": e.aggregate_id,
                "status": e.status,
                "created_at": e.created_at,
                "payload": e.payload,
            }
            for e in orchestrator.get_recent_events()
        ],
    }


@app.post("/api/v1/journals/{journal_id}/review")
async def review_journal_endpoint(journal_id: str, body: JournalReviewRequest) -> Dict[str, Any]:
    res = await review_and_approve_proposal(
        agent_principal_key=body.reviewer_principal_key,
        journal_id=journal_id,
        action=body.action,
        rejection_reason=body.rejection_reason,
    )
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=res["reason"])
    return res


@app.get("/api/v1/journals/pending")
async def get_pending_journals(entity_code: str | None = None) -> Dict[str, Any]:
    journals = await repo.get_journals(entity_code=entity_code)
    pending = [j for j in journals if j.get("status") in ("PENDING_CHECKER", "AWAITING_CPA")]
    return {"pending_count": len(pending), "journals": pending}


@app.get("/api/v1/desktop/company-file")
async def get_desktop_company_file_info() -> Dict[str, Any]:
    import sys
    from app.core.db import db_manager, get_default_db_path

    if db_manager.is_sqlite:
        db_path = get_default_db_path()
        exists = db_path.exists()
        size_bytes = db_path.stat().st_size if exists else 0
        return {
            "storage_type": "SQLite WAL (本地開發 / 離線模式)",
            "engine": "SQLite WAL",
            "file_path": str(db_path),
            "file_size_bytes": size_bytes,
            "file_size_formatted": f"{size_bytes / 1024:.1f} KB",
            "exists": exists,
            "app_platform": sys.platform,
            "is_postgres": False,
        }
    else:
        # PostgreSQL Production Engine
        sanitized_url = db_manager.db_url
        if "@" in sanitized_url:
            sanitized_url = "postgresql://" + sanitized_url.split("@")[-1]
        return {
            "storage_type": "PostgreSQL 16+ (生產企業級集群)",
            "engine": "PostgreSQL",
            "file_path": sanitized_url,
            "file_size_bytes": 0,
            "file_size_formatted": "Cloud Managed / RDS",
            "exists": True,
            "app_platform": sys.platform,
            "is_postgres": True,
        }


@app.post("/api/v1/desktop/backup")
async def backup_company_file() -> Dict[str, Any]:
    from datetime import datetime
    from app.core.db import db_manager, get_default_db_path

    db_path = get_default_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Company database file not found.")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_name = f"AgenticAccounting_Backup_{timestamp}.db"
    backup_path = db_path.parent / backup_name
    backup_path.unlink(missing_ok=True)

    if db_manager.is_sqlite:
        escaped_path = backup_path.as_posix().replace("'", "''")
        async with db_manager.engine.connect() as conn:
            autocommit_conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
            await autocommit_conn.exec_driver_sql(f"VACUUM INTO '{escaped_path}';")
    else:
        import shutil
        shutil.copy2(db_path, backup_path)

    return {
        "status": "BACKUP_CREATED",
        "backup_file": str(backup_path),
        "backup_size_bytes": backup_path.stat().st_size,
        "timestamp": timestamp,
    }


@app.get("/api/v1/events/stream")
async def stream_outbox_events() -> StreamingResponse:
    async def event_generator() -> AsyncGenerator[str, None]:
        q = orchestrator.subscribe_sse()
        try:
            while True:
                event = await q.get()
                data = json.dumps(
                    {
                        "event_id": str(event.event_id),
                        "event_type": event.event_type,
                        "entity_code": event.entity_code,
                        "aggregate_id": event.aggregate_id,
                        "status": event.status,
                        "created_at": event.created_at,
                        "payload": event.payload,
                    }
                )
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            orchestrator.unsubscribe_sse(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
