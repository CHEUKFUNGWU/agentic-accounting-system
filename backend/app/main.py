"""
FastAPI Application Gateway for SME, OPC & Sole Proprietor Agentic Accounting System.
Mounts:
  1. Stateless Streamable HTTP MCP Server at `/mcp` (`modelcontextprotocol/python-sdk`)
  2. Hybrid Event-Driven Orchestrator lifespan worker
  3. REST & SSE Endpoints at `/api/v1/*` for the shadcn/ui Three-Statement Working Paper Command Center
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.repository import repo
from app.mcp_server import (
    ENTITIES,
    JOURNAL_LEDGER,
    PRINCIPALS,
    generate_three_statements_working_paper,
    lock_and_sign_working_paper_pack,
    mcp,
    propose_adjusting_workpaper_entry,
    propose_expense_with_personal_split,
    review_and_approve_proposal,
    sync_state_from_db,
)
from app.orchestrator.event_bus import orchestrator


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await repo.init_seed_data_if_needed()
    await sync_state_from_db()
    await orchestrator.start()
    yield
    await orchestrator.stop()


app = FastAPI(
    title="SME, OPC & Sole Proprietor Agentic Accounting System (3-Statement Working Papers + Stateless MCP)",
    version="0.4.0",
    description=(
        "Standalone Three Financial Statement Working Paper Engine (ETB, Lead Schedules, P&L, B/S, Cash Flow, "
        "Statutory Tax Workpaper & Close Checklist) with Stateless Streamable HTTP MCP Gateway."
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

if hasattr(mcp, "streamable_http_app"):
    app.mount("/mcp", mcp.streamable_http_app())


class PersonalExpenseSplitWebhook(BaseModel):
    entity_code: str = Field(default="AU-OPC-01")
    expense_description: str = Field(default="Founder Home Office Fibre, Mobile & AI Cloud Workstation")
    gross_amount_paid: str = Field(default="2200.0000")
    tax_rate: str = Field(default="0.10")
    business_use_pct: str = Field(default="0.70")
    evidence_uri: str = Field(default="s3://agentic-evidence-vault/2026/10/mixed-receipt-101.pdf")


class AdjustingWorkpaperEntryRequest(BaseModel):
    entity_code: str = Field(default="AU-OPC-01")
    debit_account_code: str = Field(..., examples=["6100", "6410", "7500"])
    credit_account_code: str = Field(..., examples=["2110", "1650", "1420", "2210"])
    amount: str = Field(..., examples=["1800.0000"])
    memo: str = Field(..., examples=["Month-end accrued external CPA review fee (W/P AA)"])
    wp_ref: str = Field(default="W/P AA")


class LockWorkpaperRequest(BaseModel):
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
        "mcp_endpoint": "/mcp",
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


@app.get("/api/v1/workpapers/{entity_code}/{period}")
async def get_three_statement_working_paper_pack(entity_code: str, period: str = "2026-10") -> Dict[str, Any]:
    pack = await generate_three_statements_working_paper(entity_code=entity_code, period=period)
    if pack.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=pack["reason"])
    return pack


@app.post("/api/v1/webhooks/personal-expense-split")
async def ingest_mixed_expense_and_update_workpapers(body: PersonalExpenseSplitWebhook) -> Dict[str, Any]:
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
    updated_pack = await generate_three_statements_working_paper(entity_code=body.entity_code, period="2026-10")
    return {
        "maker_result": maker_res,
        "updated_working_paper_pack": updated_pack,
    }


@app.post("/api/v1/workpapers/aje")
async def post_adjusting_workpaper_entry(body: AdjustingWorkpaperEntryRequest) -> Dict[str, Any]:
    res = await propose_adjusting_workpaper_entry(
        entity_code=body.entity_code,
        debit_account_code=body.debit_account_code,
        credit_account_code=body.credit_account_code,
        amount=body.amount,
        memo=body.memo,
        wp_ref=body.wp_ref,
    )
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=res["reason"])
    updated_pack = await generate_three_statements_working_paper(entity_code=body.entity_code, period="2026-10")
    return {"aje_result": res, "updated_working_paper_pack": updated_pack}


@app.post("/api/v1/workpapers/{entity_code}/{period}/lock")
async def lock_working_paper_pack_endpoint(entity_code: str, period: str, body: LockWorkpaperRequest) -> Dict[str, Any]:
    updated_pack = await lock_and_sign_working_paper_pack(
        entity_code=entity_code,
        cpa_principal_key=body.cpa_principal_key,
        period=period,
    )
    if updated_pack.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=updated_pack["reason"])
    return {"updated_working_paper_pack": updated_pack}


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
