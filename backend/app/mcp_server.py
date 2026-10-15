"""
Official Model Context Protocol (MCP) Server for SMEs, OPCs & Sole Proprietors.
Built on https://github.com/modelcontextprotocol/python-sdk using Stateless Streamable HTTP (`stateless_http=True`).

Exposes:
  - MCP Resources:
    * `accounting://entities/sme-opc-profiles`: SME, OPC & Sole Proprietor profiles across CN, HK, SG, AU, US, EU
    * `accounting://workpapers/{entity_code}/{period}/full-pack`: Complete Standalone 3-Statement Working Paper Pack
  - MCP Tools:
    * `propose_expense_with_personal_split`: Splits mixed business/personal expenses (`business_use_pct`) and updates W/P DD
    * `propose_adjusting_workpaper_entry`: Posts balanced Month-End Adjusting Journal Entries (AJE) to the Extended Trial Balance (ETB)
    * `generate_three_statements_working_paper`: Compiles ETB, Lead Schedules, P&L, B/S, Cash Flow, Tax Return Boxes & Close Checklist
    * `lock_and_sign_working_paper_pack`: Human CPA / Founder sign-off that seals the Working Paper Pack (`CPA_SIGNED_LOCKED`)
    * `review_and_approve_proposal`: Enforces Maker != Checker SoD and seals entries with SHA-256 hash chain
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:  # pragma: no cover
    from mcp.server import MCPServer as FastMCP  # type: ignore

from app.core.localization import GlobalLocalizationEngine, Jurisdiction, q4
from app.core.sod_guard import (
    AccountingInvariantError,
    AgentIdentity,
    AgentRole,
    DeterministicSoDGuard,
    JournalStatus,
    PeriodStatus,
    ProposedLine,
)
from app.core.repository import repo
from app.core.working_papers import (
    ETBAccountRow,
    EntityLegalStructure,
    StandaloneWorkingPaperEngine,
)
from app.orchestrator.event_bus import orchestrator

mcp = FastMCP(
    "SmeOpcAgenticAccountingSystem",
    stateless_http=True,
    json_response=True,
)

PRINCIPALS: Dict[str, AgentIdentity] = {
    "bookkeeper-maker-01": AgentIdentity(
        principal_id=UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001"),
        agent_name="bookkeeper-and-split-agent",
        role=AgentRole.MAKER_AP,
        max_auto_approve_func_amount=Decimal("0.0000"),
        min_confidence_threshold=Decimal("0.9000"),
    ),
    "workpaper-close-01": AgentIdentity(
        principal_id=UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002"),
        agent_name="close-and-workpaper-agent",
        role=AgentRole.MAKER_CLOSE_CONSOL,
        max_auto_approve_func_amount=Decimal("0.0000"),
        min_confidence_threshold=Decimal("0.9200"),
    ),
    "controller-checker-01": AgentIdentity(
        principal_id=UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001"),
        agent_name="controller-reviewer-agent",
        role=AgentRole.CHECKER_CONTROLLER,
        max_auto_approve_func_amount=Decimal("25000.0000"),
        min_confidence_threshold=Decimal("0.9500"),
    ),
    "cpa-griffin": AgentIdentity(
        principal_id=UUID("dddddddd-dddd-dddd-dddd-dddddddd0001"),
        agent_name="Griffin (CPA / External Reviewer)",
        role=AgentRole.HUMAN_CPA,
        max_auto_approve_func_amount=Decimal("999999999.0000"),
        min_confidence_threshold=Decimal("0.0000"),
    ),
}

ENTITIES: Dict[str, Dict[str, Any]] = {
    "AU-OPC-01": {
        "legal_name": "Spark AI Studio Pty Ltd (Single-Director OPC)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "AU",
        "currency": "AUD",
        "accounting_standard": "AASB_TIER2",
        "tax_id": "51824753556",
    },
    "CN-OPC-01": {
        "legal_name": "上海智算一人有限公司 (PRC One-Person Ltd)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "CN",
        "currency": "CNY",
        "accounting_standard": "PRC_SMALL",
        "tax_id": "91310000MA1FL8888X",
    },
    "HK-SME-01": {
        "legal_name": "Pacific Nexus Tech Limited (HK SME)",
        "entity_structure": EntityLegalStructure.SME_CORP.value,
        "jurisdiction": "HK",
        "currency": "HKD",
        "accounting_standard": "SME_FRS_HK",
        "tax_id": "38910291",
    },
    "SG-OPC-01": {
        "legal_name": "Merlion Autonomous Labs Pte. Ltd. (SG Exempt Private OPC)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "SG",
        "currency": "SGD",
        "accounting_standard": "SFRS_SMALL",
        "tax_id": "202612345K",
    },
    "US-SOLE-01": {
        "legal_name": "Griffin Analytics LLC (US Single-Member Disregarded LLC / Schedule C)",
        "entity_structure": EntityLegalStructure.SOLE_PROPRIETOR.value,
        "jurisdiction": "US",
        "currency": "USD",
        "accounting_standard": "US_GAAP",
        "tax_id": "84-2910482",
    },
    "EU-OPC-01": {
        "legal_name": "rheinAI Cloud UG / GmbH (EU Single-Member OPC)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "EU",
        "currency": "EUR",
        "accounting_standard": "IFRS",
        "tax_id": "DE123456789",
    },
}

SEED_ETB_LEDGER: Dict[str, List[ETBAccountRow]] = {}
PERSONAL_SPLITS_LOG: Dict[str, List[Dict[str, Any]]] = {}
CUSTOM_AJE_LOG: Dict[str, List[Dict[str, Any]]] = {}
PACK_STATUS_STATE: Dict[str, str] = {}
JOURNAL_LEDGER: Dict[str, Dict[str, Any]] = {}


async def sync_state_from_db() -> None:
    """Synchronizes in-memory caches from local SQLite / PostgreSQL storage."""
    entities = await repo.get_all_entities()
    for code in entities:
        accounts = await repo.get_etb_accounts(code)
        if accounts:
            SEED_ETB_LEDGER[code] = accounts
        splits = await repo.get_personal_splits(code)
        PERSONAL_SPLITS_LOG[code] = splits
        ajes = await repo.get_custom_ajes(code)
        CUSTOM_AJE_LOG[code] = ajes
        PACK_STATUS_STATE[code] = entities[code].get("pack_status", "READY_FOR_CPA")
    journals = await repo.get_journals()
    for j in journals:
        JOURNAL_LEDGER[j["journal_id"]] = j


def _get_or_init_etb(entity_code: str) -> List[ETBAccountRow]:
    if entity_code not in SEED_ETB_LEDGER:
        SEED_ETB_LEDGER[entity_code] = [
            ETBAccountRow(
                account_code="1110",
                account_name="Cash at Bank - Operating Account (銀行存款)",
                account_type="ASSET",
                fs_category="CASH",
                wp_ref="W/P A",
                cash_flow_activity="CASH_EQUIV",
                opening_balance=Decimal("85000.0000"),
                period_op_debit=Decimal("142000.0000"),
                period_op_credit=Decimal("64500.0000"),
            ),
            ETBAccountRow(
                account_code="1210",
                account_name="Accounts Receivable Control (應收賬款)",
                account_type="ASSET",
                fs_category="AR",
                wp_ref="W/P B",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("18000.0000"),
                period_op_debit=Decimal("165000.0000"),
                period_op_credit=Decimal("142000.0000"),
            ),
            ETBAccountRow(
                account_code="1420",
                account_name="Prepayments & Input VAT/GST Recoverable (預付費用及進項稅額)",
                account_type="ASSET",
                fs_category="PREPAY_TAX",
                wp_ref="W/P C",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("4000.0000"),
                period_op_debit=Decimal("6500.0000"),
                period_op_credit=Decimal("0.0000"),
                aje_debit=Decimal("0.0000"),
                aje_credit=Decimal("1500.0000"),
            ),
            ETBAccountRow(
                account_code="1610",
                account_name="Computer & AI Server Equipment - Cost (固定資產原值)",
                account_type="ASSET",
                fs_category="FIXED_ASSET",
                wp_ref="W/P F",
                cash_flow_activity="INVESTING",
                opening_balance=Decimal("36000.0000"),
                period_op_debit=Decimal("12000.0000"),
                period_op_credit=Decimal("0.0000"),
            ),
            ETBAccountRow(
                account_code="1650",
                account_name="Accumulated Depreciation (累計折舊)",
                account_type="ASSET",
                fs_category="CONTRA_ASSET",
                wp_ref="W/P F",
                cash_flow_activity="NON_CASH",
                opening_balance=Decimal("-6000.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("0.0000"),
                aje_debit=Decimal("0.0000"),
                aje_credit=Decimal("2000.0000"),
            ),
            ETBAccountRow(
                account_code="2110",
                account_name="Accounts Payable & Accrued Expenses (應付賬款及應計費用)",
                account_type="LIABILITY",
                fs_category="AP_ACCRUAL",
                wp_ref="W/P AA",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("-12000.0000"),
                period_op_debit=Decimal("52500.0000"),
                period_op_credit=Decimal("58000.0000"),
                aje_debit=Decimal("0.0000"),
                aje_credit=Decimal("3500.0000"),
            ),
            ETBAccountRow(
                account_code="2190",
                account_name="Director's Loan / Owner's Current Account (股東/董事往來 / 業主往來)",
                account_type="LIABILITY",
                fs_category="DIRECTOR_LOAN",
                wp_ref="W/P DD",
                cash_flow_activity="FINANCING",
                opening_balance=Decimal("-15000.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("0.0000"),
            ),
            ETBAccountRow(
                account_code="2210",
                account_name="Statutory Taxes Payable - GST/VAT/CIT (應交稅費)",
                account_type="LIABILITY",
                fs_category="TAX_PAYABLE",
                wp_ref="W/P CC",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("-10000.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("15000.0000"),
                aje_debit=Decimal("0.0000"),
                aje_credit=Decimal("11200.0000"),
            ),
            ETBAccountRow(
                account_code="3100",
                account_name="Share Capital / Owner's Capital & Opening Surplus (實收資本及期初留存)",
                account_type="EQUITY",
                fs_category="EQUITY",
                wp_ref="W/P EQ",
                cash_flow_activity="FINANCING",
                opening_balance=Decimal("-100000.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("0.0000"),
            ),
            ETBAccountRow(
                account_code="4100",
                account_name="AI Consulting & SaaS Subscription Revenue (主營業務收入)",
                account_type="REVENUE",
                fs_category="REVENUE",
                wp_ref="W/P PL-10",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("0.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("150000.0000"),
            ),
            ETBAccountRow(
                account_code="5100",
                account_name="Direct Cloud GPU & LLM API Token Cost (主營業務成本)",
                account_type="EXPENSE",
                fs_category="COGS",
                wp_ref="W/P PL-20",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("0.0000"),
                period_op_debit=Decimal("24000.0000"),
                period_op_credit=Decimal("0.0000"),
            ),
            ETBAccountRow(
                account_code="6100",
                account_name="Operating, Software, Rent & Professional Expenses (管理及營運費用)",
                account_type="EXPENSE",
                fs_category="OPEX",
                wp_ref="W/P PL-40",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("0.0000"),
                period_op_debit=Decimal("27500.0000"),
                period_op_credit=Decimal("0.0000"),
                aje_debit=Decimal("5000.0000"),
                aje_credit=Decimal("0.0000"),
            ),
            ETBAccountRow(
                account_code="6410",
                account_name="Depreciation Expense (折舊費用)",
                account_type="EXPENSE",
                fs_category="DEPRECIATION",
                wp_ref="W/P F",
                cash_flow_activity="NON_CASH",
                opening_balance=Decimal("0.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("0.0000"),
                aje_debit=Decimal("2000.0000"),
                aje_credit=Decimal("0.0000"),
            ),
            ETBAccountRow(
                account_code="7500",
                account_name="Income Tax Expense (所得稅費用)",
                account_type="EXPENSE",
                fs_category="TAX_EXPENSE",
                wp_ref="W/P CC",
                cash_flow_activity="OPERATING_WC",
                opening_balance=Decimal("0.0000"),
                period_op_debit=Decimal("0.0000"),
                period_op_credit=Decimal("0.0000"),
                aje_debit=Decimal("11200.0000"),
                aje_credit=Decimal("0.0000"),
            ),
        ]
    return SEED_ETB_LEDGER[entity_code]


@mcp.resource("accounting://entities/sme-opc-profiles")
def get_sme_opc_profiles() -> str:
    return json.dumps({"entities": ENTITIES}, indent=2, ensure_ascii=False)


@mcp.resource("accounting://workpapers/{entity_code}/{period}/full-pack")
def get_entity_working_paper_pack(entity_code: str, period: str) -> str:
    entity = ENTITIES.get(entity_code)
    if not entity:
        return json.dumps({"error": f"Unknown entity_code {entity_code}"})
    etb = _get_or_init_etb(entity_code)
    pack = StandaloneWorkingPaperEngine.generate_working_paper_pack(
        entity_code=entity_code,
        legal_name=entity["legal_name"],
        entity_structure=EntityLegalStructure(entity["entity_structure"]),
        jurisdiction=entity["jurisdiction"],
        accounting_standard=entity["accounting_standard"],
        currency=entity["currency"],
        period=period,
        etb_accounts=etb,
        personal_split_transactions=PERSONAL_SPLITS_LOG.get(entity_code, []),
        custom_aje_history=CUSTOM_AJE_LOG.get(entity_code, []),
        pack_status=PACK_STATUS_STATE.get(entity_code, "READY_FOR_CPA"),
    )
    return json.dumps(pack.__dict__, indent=2, ensure_ascii=False)


@mcp.tool()
async def propose_expense_with_personal_split(
    agent_principal_key: str,
    entity_code: str,
    expense_description: str,
    gross_amount_paid: str,
    tax_rate: str,
    business_use_pct: str,
    evidence_uri: str,
) -> Dict[str, Any]:
    """Apportions a mixed business & personal expense and updates the ETB and W/P DD schedule."""
    maker = PRINCIPALS.get(agent_principal_key)
    if not maker:
        return {"status": "ERROR", "reason": f"Unknown maker agent principal key: '{agent_principal_key}'"}

    if not maker.role.value.startswith("MAKER_"):
        return {"status": "ERROR", "reason": f"INVALID_MAKER_ROLE: SOD_ROLE_VIOLATION: Principal '{maker.agent_name}' with role '{maker.role.value}' cannot create proposals."}

    entity = ENTITIES.get(entity_code)
    if not entity:
        return {"status": "ERROR", "reason": f"Unknown entity_code: {entity_code}"}

    if PACK_STATUS_STATE.get(entity_code) == "CPA_SIGNED_LOCKED":
        return {"status": "ERROR", "reason": f"PERIOD_CUTOFF_VIOLATION: Cannot propose expenses for entity '{entity_code}' in CPA_SIGNED_LOCKED status."}

    try:
        gross = q4(gross_amount_paid)
        if gross <= Decimal("0.0000"):
            return {"status": "ERROR", "reason": "Gross amount paid must be greater than 0.0000"}
    except Exception as e:
        return {"status": "ERROR", "reason": f"Invalid gross_amount_paid: {e}"}

    try:
        biz_pct = Decimal(str(business_use_pct))
        if not (Decimal("0.0000") <= biz_pct <= Decimal("1.0000")):
            return {"status": "ERROR", "reason": "business_use_pct must be between 0.00 and 1.00 (inclusive)"}
    except Exception as e:
        return {"status": "ERROR", "reason": f"Invalid business_use_pct: {e}"}

    try:
        rate = Decimal(str(tax_rate))
        if not (Decimal("0.0000") <= rate <= Decimal("0.5000")):
            return {"status": "ERROR", "reason": "tax_rate must be between 0.00 and 0.50"}
    except Exception as e:
        return {"status": "ERROR", "reason": f"Invalid tax_rate: {e}"}

    if not evidence_uri:
        return {"status": "ERROR", "reason": "EVIDENCE_REQUIRED_VIOLATION: Every agentic journal proposal must include at least one immutable evidence URI."}

    total_net = q4(gross / (Decimal("1.0000") + rate))
    total_tax = q4(gross - total_net)

    biz_expense = q4(total_net * biz_pct)
    biz_recoverable_tax = q4(total_tax * biz_pct)
    personal_drawing_or_loan = q4(gross - biz_expense - biz_recoverable_tax)

    etb = _get_or_init_etb(entity_code)
    etb_map = {r.account_code: r for r in etb}
    for acc in ["1110", "6100", "1420", "2190"]:
        if acc not in etb_map:
            return {"status": "ERROR", "reason": f"COA_MISSING_ACCOUNT: Account '{acc}' does not exist in entity CoA."}

    raw_lines = []
    line_no = 1
    if biz_expense > Decimal("0.0000"):
        raw_lines.append({"line_number": line_no, "account_code": "6100", "debit": str(biz_expense), "credit": "0.0000", "memo": f"Business portion ({biz_pct * 100:.0f}%) [W/P PL-40]"})
        line_no += 1
    if biz_recoverable_tax > Decimal("0.0000"):
        raw_lines.append({"line_number": line_no, "account_code": "1420", "debit": str(biz_recoverable_tax), "credit": "0.0000", "memo": "Recoverable Input GST/VAT [W/P C]"})
        line_no += 1
    if personal_drawing_or_loan > Decimal("0.0000"):
        raw_lines.append({"line_number": line_no, "account_code": "2190", "debit": str(personal_drawing_or_loan), "credit": "0.0000", "memo": "Personal portion routed to Director Loan / Drawings [W/P DD]"})
        line_no += 1
    raw_lines.append({"line_number": line_no, "account_code": "1110", "debit": "0.0000", "credit": str(gross), "memo": "Paid from Business Bank Account [W/P A]"})

    proposed_lines = [
        ProposedLine(
            line_number=l["line_number"],
            account_code=l["account_code"],
            is_control_account=l["account_code"] in {"1110", "1210", "2110"},
            tx_debit=Decimal(l["debit"]),
            tx_credit=Decimal(l["credit"]),
            func_debit=Decimal(l["debit"]),
            func_credit=Decimal(l["credit"]),
            memo=l["memo"],
        )
        for l in raw_lines
    ]
    try:
        DeterministicSoDGuard.validate_proposal_submission(
            maker=maker,
            source_module="EXPENSE_SPLIT",
            period_status=PeriodStatus.OPEN,
            lines=proposed_lines,
            evidence_uris=[evidence_uri],
            confidence_score=Decimal("0.9700"),
        )
    except AccountingInvariantError as e:
        return {"status": "ERROR", "reason": str(e)}

    split_entry = {
        "journal_id": str(uuid4()),
        "entity_code": entity_code,
        "description": expense_description,
        "gross_amount": str(gross),
        "business_use_pct": f"{biz_pct * 100:.0f}%",
        "business_expense_debit": str(biz_expense),
        "recoverable_tax_debit": str(biz_recoverable_tax),
        "personal_amount": str(personal_drawing_or_loan),
        "evidence_uri": evidence_uri,
        "created_by": maker.agent_name,
    }
    PERSONAL_SPLITS_LOG.setdefault(entity_code, []).append(split_entry)

    journal_id = split_entry["journal_id"]
    JOURNAL_LEDGER[journal_id] = {
        "journal_id": journal_id,
        "entity_code": entity_code,
        "book_scope": "PRIMARY_STANDALONE",
        "source_module": "EXPENSE_SPLIT",
        "status": JournalStatus.PENDING_CHECKER.value,
        "accounting_date": date.today().isoformat(),
        "currency": entity["currency"],
        "total_debit": str(gross),
        "total_credit": str(gross),
        "created_by_principal_key": agent_principal_key,
        "created_by_principal_id": str(maker.principal_id),
        "approved_by_principal_key": None,
        "approved_by_principal_id": None,
        "ai_confidence_score": "0.9700",
        "ai_reasoning_summary": (
            f"Mixed Expense Apportionment ({split_entry['business_use_pct']} Business): "
            f"{expense_description}. Personal portion ({entity['currency']} {personal_drawing_or_loan}) "
            "routed to W/P DD (Director Loan / Owner Drawings)."
        ),
        "evidence_uris": [evidence_uri],
        "compliance_warnings": [
            f"Personal split of {entity['currency']} {personal_drawing_or_loan} charged to W/P DD (2190)."
        ],
        "statutory_return_boxes": {"RECOVERABLE_INPUT_TAX": str(biz_recoverable_tax)},
        "lines": raw_lines,
    }

    await repo.save_personal_split(split_entry)
    await repo.save_journal(JOURNAL_LEDGER[journal_id])

    await orchestrator.publish_outbox_event(
        event_type="workpaper.personal_split_proposed",
        entity_code=entity_code,
        aggregate_id=journal_id,
        payload=split_entry,
    )
    return {
        "status": "PROPOSED_AWAITING_REVIEW",
        "journal_id": journal_id,
        "split_entry": split_entry,
        "journal": JOURNAL_LEDGER[journal_id],
    }


@mcp.tool()
async def propose_adjusting_workpaper_entry(
    entity_code: str,
    debit_account_code: str,
    credit_account_code: str,
    amount: str,
    memo: str,
    wp_ref: str = "W/P AA",
    maker_principal_key: str = "workpaper-close-01",
) -> Dict[str, Any]:
    """
    Close & Working Paper Agent / CPA Tool: Posts a balanced Month-End Adjusting Journal Entry (AJE)
    directly to the AJE columns of the Extended Trial Balance (ETB) and recalculates all 3 Financial Statements.
    """
    entity = ENTITIES.get(entity_code)
    if not entity:
        return {"status": "ERROR", "reason": f"Unknown entity_code: {entity_code}"}

    if PACK_STATUS_STATE.get(entity_code) == "CPA_SIGNED_LOCKED":
        return {"status": "ERROR", "reason": f"PERIOD_CUTOFF_VIOLATION: Cannot post AJE to entity '{entity_code}' in CPA_SIGNED_LOCKED status."}

    maker = PRINCIPALS.get(maker_principal_key)
    if not maker or not maker.role.value.startswith("MAKER_"):
        return {"status": "ERROR", "reason": f"SOD_ROLE_VIOLATION: Principal '{maker_principal_key}' is not authorized to create AJE proposals."}

    try:
        amt = q4(amount)
        if amt <= Decimal("0.0000"):
            return {"status": "ERROR", "reason": "AJE amount must be strictly positive."}
    except Exception as e:
        return {"status": "ERROR", "reason": f"Invalid amount: {e}"}

    if debit_account_code == credit_account_code:
        return {"status": "ERROR", "reason": "Debit and credit accounts must differ."}

    etb = _get_or_init_etb(entity_code)
    etb_map = {row.account_code: row for row in etb}

    if debit_account_code not in etb_map:
        return {"status": "ERROR", "reason": f"COA_MISSING_ACCOUNT: Debit account '{debit_account_code}' does not exist in ETB."}
    if credit_account_code not in etb_map:
        return {"status": "ERROR", "reason": f"COA_MISSING_ACCOUNT: Credit account '{credit_account_code}' does not exist in ETB."}

    # Atomically apply to AJE columns
    etb_map[debit_account_code].aje_debit = q4(etb_map[debit_account_code].aje_debit + amt)
    etb_map[credit_account_code].aje_credit = q4(etb_map[credit_account_code].aje_credit + amt)

    aje_record = {
        "aje_id": f"AJE-{uuid4().hex[:8].upper()}",
        "entity_code": entity_code,
        "debit_account_code": debit_account_code,
        "credit_account_code": credit_account_code,
        "amount": str(amt),
        "wp_ref": wp_ref,
        "memo": memo,
        "created_by": maker.agent_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    CUSTOM_AJE_LOG.setdefault(entity_code, []).append(aje_record)

    await repo.save_custom_aje(aje_record)
    await repo.save_etb_accounts(entity_code, etb)

    await orchestrator.publish_outbox_event(
        event_type="workpaper.aje_posted",
        entity_code=entity_code,
        aggregate_id=aje_record["aje_id"],
        payload=aje_record,
    )
    return {"status": "AJE_POSTED", "aje": aje_record}


@mcp.tool()
async def lock_and_sign_working_paper_pack(
    entity_code: str,
    cpa_principal_key: str = "cpa-griffin",
    period: str = "2026-10",
) -> Dict[str, Any]:
    """Seals the Standalone 3-Statement Working Paper Pack as `CPA_SIGNED_LOCKED` after verifying mathematical proofs."""
    cpa = PRINCIPALS.get(cpa_principal_key)
    if not cpa or cpa.role != AgentRole.HUMAN_CPA:
        return {
            "status": "ERROR",
            "reason": f"UNAUTHORIZED_SIGNER: Principal '{cpa_principal_key}' is not an authorized HUMAN_CPA.",
        }

    # Verify reconciliation proofs before allowing lock
    pack = await generate_three_statements_working_paper(entity_code=entity_code, period=period)
    proofs = pack.get("reconciliation_proofs", {})
    if not proofs.get("etb_unadjusted_balanced"):
        return {"status": "ERROR", "reason": "RECONCILIATION_PROOF_FAILED: Unadjusted Trial Balance is out of balance."}
    if not proofs.get("etb_adjustments_balanced"):
        return {"status": "ERROR", "reason": "RECONCILIATION_PROOF_FAILED: Adjusting Journal Entries are out of balance."}
    if not proofs.get("etb_adjusted_balanced"):
        return {"status": "ERROR", "reason": "RECONCILIATION_PROOF_FAILED: Adjusted Trial Balance is out of balance."}
    if not proofs.get("balance_sheet_equation_balanced"):
        return {"status": "ERROR", "reason": f"RECONCILIATION_PROOF_FAILED: Balance Sheet equation out of balance (variance: {proofs.get('balance_sheet_variance')})."}
    if not proofs.get("cash_flow_reconciles_to_bs_cash"):
        return {"status": "ERROR", "reason": f"RECONCILIATION_PROOF_FAILED: Cash Flow does not reconcile to Balance Sheet cash (variance: {proofs.get('cash_flow_variance')})."}

    PACK_STATUS_STATE[entity_code] = "CPA_SIGNED_LOCKED"
    await repo.set_pack_status(entity_code, "CPA_SIGNED_LOCKED")
    await orchestrator.publish_outbox_event(
        event_type="workpaper.cpa_signed_locked",
        entity_code=entity_code,
        aggregate_id=f"{entity_code}-{period}",
        payload={"signed_by": cpa.agent_name, "period": period},
    )
    return await generate_three_statements_working_paper(entity_code=entity_code, period=period)


@mcp.tool()
async def review_and_approve_proposal(
    agent_principal_key: str = "",
    journal_id: str = "",
    action: str = "APPROVE",
    rejection_reason: str = "",
    reviewer_principal_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Controller Reviewer Agent / Human CPA Tool:
    Enforces Maker != Checker Segregation of Duties (SoD), validates proposal confidence
    and materiality threshold, and seals POSTED entries with a SHA-256 cryptographic hash chain.
    """
    effective_key = reviewer_principal_key or agent_principal_key
    reviewer = PRINCIPALS.get(effective_key)
    if not reviewer:
        return {"status": "ERROR", "reason": f"Unknown reviewer principal key: '{effective_key}'"}

    if reviewer.role not in (AgentRole.CHECKER_CONTROLLER, AgentRole.HUMAN_CPA):
        return {
            "status": "ERROR",
            "reason": f"SOD_MAKER_CHECKER_VIOLATION: Principal '{reviewer.agent_name}' with role '{reviewer.role.value}' cannot review proposals.",
        }

    journal = JOURNAL_LEDGER.get(journal_id)
    if not journal:
        journal = await repo.get_journal(journal_id)
        if journal:
            JOURNAL_LEDGER[journal_id] = journal
    if not journal:
        return {"status": "ERROR", "reason": f"Journal entry '{journal_id}' not found."}

    current_status = journal.get("status")
    if current_status not in (JournalStatus.PENDING_CHECKER.value, JournalStatus.AWAITING_CPA.value):
        return {
            "status": "ERROR",
            "reason": f"CANNOT_REVIEW_FINALIZED_JOURNAL: Journal '{journal_id}' is already in status '{current_status}'. Cannot review multiple times.",
        }

    # Strict Maker != Checker enforcement: Maker cannot review/approve/reject their own proposal
    if str(reviewer.principal_id) == str(journal.get("created_by_principal_id")):
        return {
            "status": "ERROR",
            "reason": "SOD_MAKER_CHECKER_VIOLATION: Approver/Reviewer Principal ID cannot equal Creator Principal ID.",
        }

    entity_code = journal["entity_code"]
    if PACK_STATUS_STATE.get(entity_code) == "CPA_SIGNED_LOCKED":
        return {"status": "ERROR", "reason": f"PERIOD_CUTOFF_VIOLATION: Cannot review entries for locked entity '{entity_code}'"}

    if action.upper() == "REJECT":
        journal["status"] = JournalStatus.REJECTED.value
        journal["rejection_reason"] = rejection_reason
        if rejection_reason:
            journal["ai_reasoning_summary"] = f"REJECTED: {rejection_reason}"
        await repo.save_journal(journal)
        await orchestrator.publish_outbox_event(
            event_type="proposal.rejected",
            entity_code=entity_code,
            aggregate_id=journal_id,
            payload={"rejected_by": reviewer.agent_name, "reason": rejection_reason},
        )
        return {"status": "SUCCESS", "action": "REJECTED", "entry_status": "REJECTED", "journal": journal}

    created_by_str = journal.get("created_by_principal_id")
    if not created_by_str:
        return {"status": "ERROR", "reason": "Journal missing created_by_principal_id."}

    created_by_id = UUID(created_by_str)

    try:
        new_status = DeterministicSoDGuard.evaluate_approval_transition(
            created_by_principal_id=created_by_id,
            reviewer=reviewer,
            total_func_debit=Decimal(str(journal["total_debit"])),
            proposal_confidence=Decimal(str(journal.get("ai_confidence_score", "0.9500"))),
            involves_intercompany_or_statutory_adj=False,
        )
    except AccountingInvariantError as e:
        return {"status": "ERROR", "reason": str(e)}

    journal["approved_by_principal_key"] = effective_key
    journal["approved_by_principal_id"] = str(reviewer.principal_id)
    journal["status"] = new_status.value

    if new_status == JournalStatus.POSTED:
        etb = _get_or_init_etb(entity_code)
        etb_map = {row.account_code: row for row in etb}

        # Check all accounts exist BEFORE modifying anything
        for line in journal.get("lines", []):
            acc_code = line["account_code"]
            if acc_code not in etb_map:
                return {"status": "ERROR", "reason": f"COA_MISSING_ACCOUNT: Account '{acc_code}' does not exist in ETB."}

        # Apply lines
        for line in journal.get("lines", []):
            acc_code = line["account_code"]
            dr = Decimal(str(line.get("debit", "0.0000")))
            cr = Decimal(str(line.get("credit", "0.0000")))
            row = etb_map[acc_code]
            if dr > Decimal("0.0000"):
                row.period_op_debit = q4(row.period_op_debit + dr)
            if cr > Decimal("0.0000"):
                row.period_op_credit = q4(row.period_op_credit + cr)

        prev_hash = await repo.get_latest_posted_hash(entity_code)
        next_block_index = await repo.get_next_block_index(entity_code)
        lines_hash = DeterministicSoDGuard.compute_lines_sha256(journal.get("lines", []))
        entry_hash = DeterministicSoDGuard.compute_entry_sha256_hash(
            prev_entry_hash=prev_hash,
            journal_id=str(journal_id),
            entity_code=entity_code,
            accounting_date=journal.get("accounting_date", date.today().isoformat()),
            func_debit=Decimal(str(journal["total_debit"])),
            func_credit=Decimal(str(journal["total_credit"])),
            lines_sha256=lines_hash,
            created_by=str(journal["created_by_principal_id"]),
            approved_by=str(reviewer.principal_id),
        )
        journal["prev_entry_hash"] = prev_hash
        journal["entry_hash"] = entry_hash
        journal["block_index"] = next_block_index

        await repo.post_journal_and_update_etb(entity_code, journal, etb)

        await orchestrator.publish_outbox_event(
            event_type="journal.posted",
            entity_code=entity_code,
            aggregate_id=journal_id,
            payload={"posted_by": reviewer.agent_name, "entry_hash": entry_hash, "block_index": next_block_index},
        )
        return {
            "status": "SUCCESS",
            "action": "APPROVED",
            "entry_status": "POSTED",
            "journal": journal,
            "entry_hash": entry_hash,
        }
    else:
        await repo.save_journal(journal)
        await orchestrator.publish_outbox_event(
            event_type="proposal.awaiting_cpa",
            entity_code=entity_code,
            aggregate_id=journal_id,
            payload={"reviewer": reviewer.agent_name, "reason": "Exceeds materiality threshold"},
        )
        return {
            "status": "SUCCESS",
            "action": "AWAITING_CPA",
            "entry_status": "AWAITING_CPA",
            "journal": journal,
            "note": "Exceeds auto-approve materiality threshold; escalated to Human CPA.",
        }


@mcp.tool()
async def generate_three_statements_working_paper(
    entity_code: str,
    period: str = "2026-10",
) -> Dict[str, Any]:
    """Compiles and returns the complete Standalone Three Financial Statement Working Paper Pack."""
    entity = ENTITIES.get(entity_code)
    if not entity:
        return {"status": "ERROR", "reason": f"Unknown entity_code: {entity_code}"}

    etb = _get_or_init_etb(entity_code)

    # Filter personal splits: strictly include ONLY splits that have been APPROVED and POSTED!
    all_splits = PERSONAL_SPLITS_LOG.get(entity_code, [])
    posted_splits = []
    for sp in all_splits:
        j_id = sp.get("journal_id")
        j = JOURNAL_LEDGER.get(j_id)
        if j and j.get("status") == JournalStatus.POSTED.value:
            posted_splits.append(sp)

    pack = StandaloneWorkingPaperEngine.generate_working_paper_pack(
        entity_code=entity_code,
        legal_name=entity["legal_name"],
        entity_structure=EntityLegalStructure(entity["entity_structure"]),
        jurisdiction=entity["jurisdiction"],
        accounting_standard=entity["accounting_standard"],
        currency=entity["currency"],
        period=period,
        etb_accounts=etb,
        personal_split_transactions=posted_splits,
        custom_aje_history=CUSTOM_AJE_LOG.get(entity_code, []),
        pack_status=PACK_STATUS_STATE.get(entity_code, "READY_FOR_CPA"),
    )
    return pack.__dict__


@mcp.prompt("sme-opc-month-end-workpaper-sop")
def sme_opc_month_end_workpaper_sop(entity_code: str, period: str) -> str:
    return (
        f"Execute Standalone 3-Statement Working Paper SOP for `{entity_code}` ({period}):\n"
        "1. Reconcile Bank Statement Lines against Cash at Bank (`W/P A`).\n"
        "2. Apportion mixed personal/business founder expenses via `propose_expense_with_personal_split` (`W/P DD`).\n"
        "3. Post Month-End Adjusting Journal Entries (AJE) via `propose_adjusting_workpaper_entry` (`W/P F`, `W/P C`, `W/P AA`, `W/P CC`).\n"
        "4. Invoke `generate_three_statements_working_paper` to compile the Extended Trial Balance (ETB) and generate the Income Statement, Balance Sheet, and Cash Flow Statement.\n"
        "5. Verify `Assets == Liabilities + Equity`, `Opening Cash + Net CF == Ending Cash`, and sign off via `lock_and_sign_working_paper_pack`."
    )
