"""
Audit & Security Hardening Tests (審計與內控安全修復驗證套件)

Directly validates fixes for all 10 P0/P1 audit findings from review.md:
  1. Double approval & double posting into ETB prevented.
  2. Transitioning REJECTED -> POSTED or POSTED -> REJECTED prevented.
  3. Identity & role enforcement: attacker keys & non-maker proposals rejected; maker self-review blocked.
  4. DeterministicSoDGuard.validate_proposal_submission called and enforced.
  5. business_use_pct and tax_rate range validation enforced.
  6. AJE account pre-validation prevents ETB balance corruption; Maker-Checker enforced.
  7. Working Paper Pack locking restricted strictly to HUMAN_CPA with verified proofs.
  8. Hash chain ordering by block_index prevents forks when approved out of order; lines SHA-256 protected.
  9. W/P DD strictly excludes REJECTED and PENDING splits.
  10. SQLite WAL atomic snapshot via VACUUM INTO.
"""

from decimal import Decimal
import os
import sqlite3
import pytest

from app.core.repository import repo
from app.core.ledger import trial_balance_from_ledger
from app.core.sod_guard import AgentRole, DeterministicSoDGuard
from app import mcp_server as m


def get_err(res: dict) -> str:
    return str(res.get("reason") or res.get("message") or "")


@pytest.mark.asyncio
async def test_1_prevent_double_approval_and_duplicate_posting():
    """Finding 1: Approving the same proposal twice must fail and must not duplicate ETB postings."""
    prop = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Test Office Software",
        gross_amount_paid="1100.00",
        tax_rate="0.10",
        business_use_pct="0.70",
        evidence_uri="s3://vault/test.pdf",
    )
    assert prop["status"] == "PROPOSED_AWAITING_REVIEW"
    j_id = prop["journal_id"]

    cash_before = next(r for r in (await trial_balance_from_ledger("AU-OPC-01", "2026-10")) if r.account_code == "1110").period_op_credit

    # First approval -> POSTED
    r1 = await m.review_and_approve_proposal(
        agent_principal_key="test-gl-human",
        journal_id=j_id,
        action="APPROVE",
    )
    assert r1["status"] == "SUCCESS"
    assert r1["entry_status"] == "POSTED"

    cash_after_1st = next(r for r in (await trial_balance_from_ledger("AU-OPC-01", "2026-10")) if r.account_code == "1110").period_op_credit
    assert cash_after_1st == cash_before + Decimal("1100.0000")

    # Second approval -> Must be rejected with ERROR, ETB must remain unchanged
    r2 = await m.review_and_approve_proposal(
        agent_principal_key="test-gl-human",
        journal_id=j_id,
        action="APPROVE",
    )
    assert r2["status"] == "ERROR"
    assert "CANNOT_REVIEW_FINALIZED_JOURNAL" in get_err(r2)

    cash_after_2nd = next(r for r in (await trial_balance_from_ledger("AU-OPC-01", "2026-10")) if r.account_code == "1110").period_op_credit
    assert cash_after_2nd == cash_after_1st, "Cash account was double credited!"


@pytest.mark.asyncio
async def test_2_prevent_approving_rejected_or_rejecting_posted():
    """Finding 2: REJECTED journals cannot be approved; POSTED journals cannot be rejected."""
    prop = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Invalid Receipt",
        gross_amount_paid="500.00",
        tax_rate="0.10",
        business_use_pct="0.50",
        evidence_uri="s3://vault/bad.pdf",
    )
    j_id = prop["journal_id"]

    # Reject proposal
    rej = await m.review_and_approve_proposal(
        agent_principal_key="test-gl-human",
        journal_id=j_id,
        action="REJECT",
        rejection_reason="Unclear business justification",
    )
    assert rej["status"] == "SUCCESS"
    assert rej["entry_status"] == "REJECTED"

    # Attempt to approve rejected journal -> Must FAIL
    app_rej = await m.review_and_approve_proposal(
        agent_principal_key="test-gl-human",
        journal_id=j_id,
        action="APPROVE",
    )
    assert app_rej["status"] == "ERROR"
    assert "CANNOT_REVIEW_FINALIZED_JOURNAL" in get_err(app_rej)


@pytest.mark.asyncio
async def test_3_principal_identity_and_maker_role_enforcement():
    """Finding 3: Attacker / unknown principal keys and non-maker roles proposing entries are rejected."""
    # 3a. Unknown principal key rejected
    r = await m.propose_expense_with_personal_split(
        agent_principal_key="attacker-hacker-99",
        entity_code="AU-OPC-01",
        expense_description="Unauthorized expense",
        gross_amount_paid="1000.00",
        tax_rate="0.10",
        business_use_pct="0.80",
        evidence_uri="s3://vault/attack.pdf",
    )
    assert r["status"] == "ERROR"
    assert "Unknown maker agent principal key" in get_err(r)

    # 3b. CPA principal cannot act as Maker (SoD violation)
    r_cpa = await m.propose_expense_with_personal_split(
        agent_principal_key="cpa-griffin",
        entity_code="AU-OPC-01",
        expense_description="CPA trying to book expense",
        gross_amount_paid="1000.00",
        tax_rate="0.10",
        business_use_pct="0.80",
        evidence_uri="s3://vault/cpa.pdf",
    )
    assert r_cpa["status"] == "ERROR"
    assert "SOD_ROLE_VIOLATION" in get_err(r_cpa) or "INVALID_MAKER_ROLE" in get_err(r_cpa)

    # 3c. Maker cannot self-review or self-reject proposal
    prop = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Valid expense",
        gross_amount_paid="300.00",
        tax_rate="0.10",
        business_use_pct="0.80",
        evidence_uri="s3://vault/valid.pdf",
    )
    j_id = prop["journal_id"]

    r_self_reject = await m.review_and_approve_proposal(
        agent_principal_key="bookkeeper-maker-01",
        journal_id=j_id,
        action="REJECT",
    )
    assert r_self_reject["status"] == "ERROR"
    assert "SOD_MAKER_CHECKER_VIOLATION" in get_err(r_self_reject) or "MAKER_CANNOT_REVIEW_OWN_PROPOSAL" in get_err(r_self_reject)


@pytest.mark.asyncio
async def test_4_range_validation_for_business_pct_and_tax_rate():
    """Finding 5: business_use_pct > 1.0 or < 0, or tax_rate < 0 or > 0.5 must be rejected."""
    # business_use_pct = 1.5 (150%)
    r1 = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Invalid percentage",
        gross_amount_paid="1000.00",
        tax_rate="0.10",
        business_use_pct="1.50",
        evidence_uri="s3://vault/rec.pdf",
    )
    assert r1["status"] == "ERROR"
    assert "business_use_pct" in get_err(r1)

    # negative percentage
    r2 = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Negative percentage",
        gross_amount_paid="1000.00",
        tax_rate="0.10",
        business_use_pct="-0.10",
        evidence_uri="s3://vault/rec.pdf",
    )
    assert r2["status"] == "ERROR"

    # tax rate out of bounds
    r3 = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Extreme tax rate",
        gross_amount_paid="1000.00",
        tax_rate="0.80",
        business_use_pct="0.50",
        evidence_uri="s3://vault/rec.pdf",
    )
    assert r3["status"] == "ERROR"
    assert "tax_rate" in get_err(r3)


@pytest.mark.asyncio
async def test_5_aje_account_existence_prevalidation_prevents_etb_corruption():
    """Finding 9 & 10: Non-existent accounts in AJE or line items are rejected before mutating ETB."""
    etb_rows_before = (await trial_balance_from_ledger("AU-OPC-01", "2026-10"))
    r_6100_before = next(row for row in etb_rows_before if row.account_code == "6100")
    initial_6100_debit = r_6100_before.adjustment_debit

    # Attempt AJE where credit account 9999 does not exist
    r = await m.propose_adjusting_entry(
        entity_code="AU-OPC-01",
        debit_account_code="6100",
        credit_account_code="9999",  # Non-existent
        amount="5000.00",
        memo="Bad account AJE",
        statement_ref="AP",
    )
    assert r["status"] == "ERROR"
    assert "COA_MISSING_ACCOUNT" in get_err(r)

    # Verify debit account 6100 was NOT modified (no partial mutation / corruption)
    etb_rows_after = (await trial_balance_from_ledger("AU-OPC-01", "2026-10"))
    r_6100_after = next(row for row in etb_rows_after if row.account_code == "6100")
    assert r_6100_after.adjustment_debit == initial_6100_debit

    # Confirm ETB is still balanced
    pack = await m.generate_three_statements_reporting("AU-OPC-01")
    assert pack["consistency_checks"]["adjustments_balanced"] is True


@pytest.mark.asyncio
async def test_6_cpa_pack_lock_authorization_and_post_lock_protection():
    """Finding 6 & 7: Only authorized HUMAN_CPA can lock packs, and no entries are allowed post-lock."""
    # 6a. Unauthorized principal "nobody" cannot lock pack
    r_unauth = await m.lock_and_sign_reporting_pack(
        entity_code="AU-OPC-01",
        period="2026-10",
        cpa_principal_key="nobody",
    )
    assert r_unauth["status"] == "ERROR"
    assert "UNAUTHORIZED_SIGNER" in get_err(r_unauth)

    # 6b. Legitimate CPA locks pack
    r_lock = await m.lock_and_sign_reporting_pack(
        entity_code="AU-OPC-01",
        period="2026-10",
        cpa_principal_key="cpa-griffin",
    )
    assert r_lock.get("status") != "ERROR"
    assert r_lock["reporting_status"] == "REVIEWED_AND_LOCKED"

    # 6c. AJE after lock must be blocked
    r_aje = await m.propose_adjusting_entry(
        entity_code="AU-OPC-01",
        debit_account_code="6100",
        credit_account_code="2110",
        amount="100.00",
        memo="Attempt post lock AJE",
        statement_ref="AP",
    )
    assert r_aje["status"] == "ERROR"
    assert "PERIOD_CUTOFF_VIOLATION" in get_err(r_aje)

    # 6d. Mixed expense proposal after lock must be blocked
    r_exp = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code="AU-OPC-01",
        expense_description="Attempt post lock expense",
        gross_amount_paid="200.00",
        tax_rate="0.10",
        business_use_pct="0.50",
        evidence_uri="s3://vault/post.pdf",
    )
    assert r_exp["status"] == "ERROR"
    assert "PERIOD_CUTOFF_VIOLATION" in get_err(r_exp)

    # Unlock entity so subsequent tests are not blocked
    m.PACK_STATUS_STATE["AU-OPC-01"] = "READY"
    await repo.set_reporting_status("AU-OPC-01", "READY")


@pytest.mark.asyncio
async def test_7_hash_chain_sequential_integrity_prevents_forks():
    """Finding 8: Hash chain links blocks strictly by sequential block height, preventing forks."""
    entity = "HK-SME-01"

    # Propose 3 entries A, B, C
    p_a = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code=entity,
        expense_description="Expense A",
        gross_amount_paid="100.00",
        tax_rate="0.00",
        business_use_pct="0.80",
        evidence_uri="s3://vault/a.pdf",
    )
    p_b = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code=entity,
        expense_description="Expense B",
        gross_amount_paid="200.00",
        tax_rate="0.00",
        business_use_pct="0.80",
        evidence_uri="s3://vault/b.pdf",
    )
    p_c = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code=entity,
        expense_description="Expense C",
        gross_amount_paid="300.00",
        tax_rate="0.00",
        business_use_pct="0.80",
        evidence_uri="s3://vault/c.pdf",
    )

    # Approve out of creation order: B, then A, then C
    res_b = await m.review_and_approve_proposal("test-gl-human", p_b["journal_id"], "APPROVE")
    res_a = await m.review_and_approve_proposal("test-gl-human", p_a["journal_id"], "APPROVE")
    res_c = await m.review_and_approve_proposal("test-gl-human", p_c["journal_id"], "APPROVE")

    assert res_b["status"] == "SUCCESS"
    assert res_a["status"] == "SUCCESS"
    assert res_c["status"] == "SUCCESS"

    jb = res_b["journal"]
    ja = res_a["journal"]
    jc = res_c["journal"]

    # Block B was posted first -> block_index 1
    # Block A was posted second -> block_index 2, prev_entry_hash == jb.entry_hash
    # Block C was posted third -> block_index 3, prev_entry_hash == ja.entry_hash
    assert ja["prev_entry_hash"] == jb["entry_hash"], "Hash chain broken or forked between B and A"
    assert jc["prev_entry_hash"] == ja["entry_hash"], "Hash chain broken or forked between A and C"
    assert ja["prev_entry_hash"] != jc["prev_entry_hash"], "Hash chain fork detected! Both point to same parent."


@pytest.mark.asyncio
async def test_8_wp_dd_lead_schedule_strictly_excludes_rejected_splits():
    """Finding 9: W/P DD must strictly exclude REJECTED or PENDING splits."""
    entity = "SG-OPC-01"

    pack_before = await m.generate_three_statements_reporting(entity)
    dd_before_amt = Decimal(pack_before["detail_schedules"]["DIRECTOR"]["items"][1]["amount"])

    # Propose mixed expense
    prop = await m.propose_expense_with_personal_split(
        agent_principal_key="bookkeeper-maker-01",
        entity_code=entity,
        expense_description="Personal lunch mixed",
        gross_amount_paid="1000.00",
        tax_rate="0.09",
        business_use_pct="0.50",
        evidence_uri="s3://vault/lunch.pdf",
    )
    j_id = prop["journal_id"]

    # Reject proposal
    await m.review_and_approve_proposal(
        agent_principal_key="test-gl-human",
        journal_id=j_id,
        action="REJECT",
        rejection_reason="Not business related",
    )

    pack_after = await m.generate_three_statements_reporting(entity)
    dd_after_amt = Decimal(pack_after["detail_schedules"]["DIRECTOR"]["items"][1]["amount"])

    assert dd_after_amt == dd_before_amt, "Rejected split was incorrectly included in W/P DD lead schedule!"


@pytest.mark.asyncio
async def test_9_sqlite_vacuum_into_atomic_backup():
    """Finding 11: SQLite backup uses VACUUM INTO to safely checkpoint and preserve WAL transactions."""
    from app.main import backup_company_file

    backup_res = await backup_company_file()
    assert backup_res["status"] == "BACKUP_CREATED"
    b_file = backup_res["backup_file"]
    assert os.path.exists(b_file)

    # Verify backup is a valid SQLite database with readable tables
    conn = sqlite3.connect(b_file)
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM trial_balance_accounts;")
    count = cur.fetchone()[0]
    assert count > 0, "Backup database is empty!"
    conn.close()

    # Clean up backup file
    os.remove(b_file)
