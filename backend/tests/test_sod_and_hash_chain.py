import hashlib
import json
import pytest
from app.mcp_server import (
    propose_expense_with_personal_split,
    review_and_approve_proposal,
    JOURNAL_LEDGER,
)
from app.core.repository import repo

@pytest.mark.asyncio
async def test_maker_cannot_approve_own_proposal():
    """
    Enforces Maker != Checker SoD rule:
    The agent that proposed/prepared the entry cannot approve it.
    """
    maker_key = "bookkeeper-maker-01"

    # 1. Propose mixed expense
    prop_res = await propose_expense_with_personal_split(
        agent_principal_key=maker_key,
        entity_code="AU-OPC-01",
        expense_description="Test Office Internet & Cloud Hardware",
        gross_amount_paid="1100.0000",
        tax_rate="0.10",
        business_use_pct="0.80",
        evidence_uri="s3://evidence/invoice-2026.pdf",
    )
    assert prop_res["status"] == "PROPOSED_AWAITING_REVIEW"
    journal_id = prop_res["journal_id"]

    # 2. Attempt self-approval by maker -> Must fail
    self_approve_res = await review_and_approve_proposal(
        agent_principal_key=maker_key,
        journal_id=journal_id,
        action="APPROVE",
    )
    assert self_approve_res["status"] == "ERROR"
    assert "SOD_MAKER_CHECKER_VIOLATION" in self_approve_res["reason"]

    # 3. Checker approval -> Must succeed and produce SHA-256 hash
    checker_key = "controller-checker-01"
    approve_res = await review_and_approve_proposal(
        agent_principal_key=checker_key,
        journal_id=journal_id,
        action="APPROVE",
    )
    assert approve_res["status"] == "SUCCESS"
    assert approve_res["action"] == "APPROVED"
    assert approve_res["entry_hash"] is not None
    assert len(approve_res["entry_hash"]) == 64  # SHA-256 hex string

    # 4. Verify cryptographic hash integrity in journal ledger
    saved_j = await repo.get_journal(journal_id)
    assert saved_j is not None
    assert saved_j["status"] == "POSTED"
    assert saved_j["approved_by_principal_key"] == checker_key
    assert saved_j["entry_hash"] == approve_res["entry_hash"]

@pytest.mark.asyncio
async def test_rejection_flow():
    """
    Validates that a reviewer can reject a proposal with a formal reason.
    """
    maker_key = "bookkeeper-maker-01"
    checker_key = "controller-checker-01"

    prop_res = await propose_expense_with_personal_split(
        agent_principal_key=maker_key,
        entity_code="SG-OPC-01",
        expense_description="Questionable Personal Subscription",
        gross_amount_paid="500.0000",
        tax_rate="0.09",
        business_use_pct="0.50",
        evidence_uri="s3://evidence/suspicious.pdf",
    )
    journal_id = prop_res["journal_id"]

    reject_res = await review_and_approve_proposal(
        agent_principal_key=checker_key,
        journal_id=journal_id,
        action="REJECT",
        rejection_reason="Insufficient business substantiation for private streaming service",
    )
    assert reject_res["status"] == "SUCCESS"
    assert reject_res["action"] == "REJECTED"

    saved_j = await repo.get_journal(journal_id)
    assert saved_j is not None
    assert saved_j["status"] == "REJECTED"
    assert "REJECTED: Insufficient business substantiation" in saved_j["ai_reasoning_summary"]
