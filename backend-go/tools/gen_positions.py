#!/usr/bin/env python3
"""Generate golden fixtures for the backend-go positions module (REQ-0035 P1).

Ports covered, with their reference for every expected value:

  - backend/app/core/positions.py (position matrix, scope helpers, reviewer
    assignment, principal resolution, monolith commands) and
    backend/app/core/sod_guard.py (proposal validation, approval transition,
    line/entry hashes, chain verification): the frozen implementation itself,
    imported below. Full behaviour must golden-match; no SRC-0026 finding is
    fixed inside these two files at P1.

  - Solo mode (一人公司模式) and the self-approval flag rule: no Python
    implementation exists anywhere in the backend, so the expected values
    below encode the owner decisions directly — SRC-0028 (solo qualification
    by active human-principal count, confirmed 2026-10-30) and the
    one-person-company profile of ADR-0001 D4 / the BL-31 owner decision of
    2026-10-21 (solo self-approvals allowed, flagged, listed in the year-end
    audit pack; agents never approve). These cases are spec-derived, not
    reference-derived; the Go invariant tests cite the same sources.

The SoD guard's auto-approve depth thresholds and confidence gating are
legacy pending REQ-0007; their fixtures (approval_legacy_*) pin the frozen
behaviour as-is. Golden parity is not control endorsement.

Run (from the repository root):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_positions.py

Output: backend-go/fixtures/positions/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.
"""

from __future__ import annotations

import json
import sys
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures"

sys.path.insert(0, str(REPO / "backend"))

from app.core.positions import (
    POSITIONS,
    PRINCIPAL_POSITIONS,
    in_scope,
    may_review,
    monolith_commands,
    out_of_scope,
    position_for_accounts,
    position_for_principal,
    required_reviewer,
    visible_accounts,
)
from app.core.sod_guard import (
    AccountingInvariantError,
    AgentIdentity,
    AgentRole,
    DeterministicSoDGuard,
    PeriodStatus,
    ProposedLine,
)

COUNTS: dict[str, int] = {}


def write(module: str, name: str, case_input: dict, output=None, error: str | None = None) -> None:
    """Write one fixture case file. output xor expected_error is present."""
    doc = {"module": module, "case": name, "input": case_input}
    if error is not None:
        doc["expected_error"] = error
    else:
        doc["output"] = output
    path = OUT / module / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    COUNTS[module] = COUNTS.get(module, 0) + 1


MAKER_ID = "11111111-1111-1111-1111-111111111111"
CHECKER_ID = "22222222-2222-2222-2222-222222222222"
CPA_ID = "33333333-3333-3333-3333-333333333333"

GENESIS = "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"


def pos_record(p) -> dict:
    """The JSON form of a Position, shared by inputs and outputs."""
    return {
        "position_id": p.position_id,
        "title_en": p.title_en,
        "title_zh": p.title_zh,
        "principal_key": p.principal_key,
        "account_scope": sorted(p.account_scope),
        "can_prepare": p.can_prepare,
        "can_review": p.can_review,
        "cash_custody": p.cash_custody,
        "review_level": p.review_level,
        "read_all_accounts": p.read_all_accounts,
        "mandate_en": p.mandate_en,
        "mandate_zh": p.mandate_zh,
        "is_human": p.is_human,
    }


def gen_position_catalog() -> None:
    """The seeded matrix itself, plus unknown-key resolution."""
    for pid in POSITIONS:
        write("positions", f"position_{pid.lower()}", {"op": "position", "position_id": pid},
              output=pos_record(POSITIONS[pid]))
    write("positions", "position_unknown", {"op": "position", "position_id": "NO_SUCH"}, output=None)


def gen_scope_helpers() -> None:
    """in_scope / out_of_scope / visible_accounts over the seeded matrix."""
    cases = [
        ("in_scope_cashier_1110", "CASHIER", "1110"),
        ("in_scope_cashier_4100", "CASHIER", "4100"),
        ("in_scope_finance_manager_9999", "FINANCE_MANAGER", "9999"),
        ("in_scope_gl_2190", "GL_ACCOUNTANT", "2190"),
        ("in_scope_gl_4100", "GL_ACCOUNTANT", "4100"),
        ("in_scope_admin_1110", "ADMIN", "1110"),
    ]
    for name, pid, code in cases:
        write("positions", name,
              {"op": "in_scope", "position_id": pid, "account_code": code},
              output=in_scope(POSITIONS[pid], code))

    outs = [
        ("out_of_scope_ap_mixed", "AP_CLERK", ["2110", "1110", "4100", ""]),
        ("out_of_scope_none", "AP_CLERK", ["2110", "6100"]),
        ("out_of_scope_finance_manager", "FINANCE_MANAGER", ["1110", "9999"]),
        ("out_of_scope_empty", "CASHIER", []),
        ("out_of_scope_duplicates", "CASHIER", ["1110", "1110"]),
    ]
    for name, pid, codes in outs:
        write("positions", name,
              {"op": "out_of_scope", "position_id": pid, "account_codes": codes},
              output=out_of_scope(POSITIONS[pid], codes))

    vis = [
        ("visible_gl_all", "GL_ACCOUNTANT", ["1110", "1210", "6100", ""]),
        ("visible_cashier_filtered", "CASHIER", ["1110", "1210", "6100", "1110"]),
        ("visible_auditor_all", "AUDITOR_READONLY", ["1110", "1210", "6100"]),
        ("visible_empty", "CASHIER", []),
    ]
    for name, pid, codes in vis:
        write("positions", name,
              {"op": "visible_accounts", "position_id": pid, "all_codes": codes},
              output=visible_accounts(POSITIONS[pid], codes))


def gen_reviewer_assignment() -> None:
    """required_reviewer per position and the full may_review matrix."""
    for pid in POSITIONS:
        write("positions", f"required_reviewer_{pid.lower()}",
              {"op": "required_reviewer", "position_id": pid},
              output=required_reviewer(POSITIONS[pid]).position_id)
    for reviewer_id in POSITIONS:
        matrix = {prep: may_review(POSITIONS[reviewer_id], POSITIONS[prep]) for prep in POSITIONS}
        write("positions", f"may_review_matrix_{reviewer_id.lower()}",
              {"op": "may_review_matrix", "reviewer_id": reviewer_id}, output=matrix)


def gen_position_for_accounts() -> None:
    """Entry ownership by account coverage, narrowest scope first."""
    cases = [
        ("pfa_ar", ["1210", "4100"]),
        ("pfa_tax", ["2210", "7500"]),
        ("pfa_gl_set", ["3100", "2190"]),
        ("pfa_fallback_mixed", ["1110", "4100"]),
        ("pfa_empty", []),
        ("pfa_only_empty_strings", ["", ""]),
        ("pfa_filters_empty_strings", ["", "1210"]),
        ("pfa_single_fa", ["6410"]),
        ("pfa_ap_full", ["2110", "6100", "1420", "5100"]),
        ("pfa_unknown_code", ["9999"]),
        ("pfa_single_ap", ["2110"]),
        ("pfa_cross_clerks", ["1210", "2110"]),
    ]
    for name, codes in cases:
        owner = position_for_accounts(codes)
        write("positions", name, {"op": "position_for_accounts", "account_codes": codes},
              output=owner.position_id if owner is not None else None)


def gen_position_for_principal() -> None:
    """Principal resolution: seeded matrix, alias table, durable overrides."""
    cases = [
        ("pfp_seeded_cashier", "cashier-01"),
        ("pfp_seeded_gl", "gl-chief-01"),
        ("pfp_alias_bookkeeper", "bookkeeper-maker-01"),
        ("pfp_alias_close", "workpaper-close-01"),
        ("pfp_alias_controller", "controller-checker-01"),
        ("pfp_unknown", "nobody-01"),
        ("pfp_empty_key", ""),
    ]
    for name, key in cases:
        resolved = position_for_principal(key)
        write("positions", name,
              {"op": "position_for_principal", "principal_key": key, "dynamic": {}},
              output=resolved.position_id if resolved is not None else None)

    # The durable principal→position overrides (Python's PRINCIPAL_POSITIONS
    # cache, filled from principal rows at request time) take precedence over
    # both the seeded matrix and the alias table. Mutate the cache, resolve,
    # restore — the frozen module stays untouched after the run.
    saved = dict(PRINCIPAL_POSITIONS)
    try:
        PRINCIPAL_POSITIONS["cashier-01"] = POSITIONS["AR_CLERK"]
        resolved = position_for_principal("cashier-01")
        write("positions", "pfp_dynamic_precedence",
              {"op": "position_for_principal", "principal_key": "cashier-01",
               "dynamic": {"cashier-01": pos_record(POSITIONS["AR_CLERK"])}},
              output=resolved.position_id if resolved is not None else None)
        PRINCIPAL_POSITIONS["user-01"] = POSITIONS["TAX_CLERK"]
        resolved = position_for_principal("user-01")
        write("positions", "pfp_dynamic_new_key",
              {"op": "position_for_principal", "principal_key": "user-01",
               "dynamic": {"user-01": pos_record(POSITIONS["TAX_CLERK"])}},
              output=resolved.position_id if resolved is not None else None)
        PRINCIPAL_POSITIONS.clear()
        PRINCIPAL_POSITIONS.update(saved)
        PRINCIPAL_POSITIONS["bookkeeper-maker-01"] = POSITIONS["FA_CLERK"]
        resolved = position_for_principal("bookkeeper-maker-01")
        write("positions", "pfp_dynamic_overrides_alias",
              {"op": "position_for_principal", "principal_key": "bookkeeper-maker-01",
               "dynamic": {"bookkeeper-maker-01": pos_record(POSITIONS["FA_CLERK"])}},
              output=resolved.position_id if resolved is not None else None)
    finally:
        PRINCIPAL_POSITIONS.clear()
        PRINCIPAL_POSITIONS.update(saved)


def gen_monolith_commands() -> None:
    """Monolith command surface per position; journal.review is human-only."""
    for pid in POSITIONS:
        write("positions", f"monolith_{pid.lower()}",
              {"op": "monolith_commands", "position": pos_record(POSITIONS[pid])},
              output=sorted(monolith_commands(POSITIONS[pid])))
    # Human variants: the review command survives when the principal is a
    # person (auth.py replaces is_human from the principal row).
    gl_human = replace(POSITIONS["GL_ACCOUNTANT"], is_human=True)
    write("positions", "monolith_gl_human",
          {"op": "monolith_commands", "position": pos_record(gl_human)},
          output=sorted(monolith_commands(gl_human)))
    fm_human = replace(POSITIONS["FINANCE_MANAGER"], is_human=True)
    write("positions", "monolith_fm_human",
          {"op": "monolith_commands", "position": pos_record(fm_human)},
          output=sorted(monolith_commands(fm_human)))
    # A minimal record that is not in the matrix: pure function of the fields.
    custom = type(POSITIONS["ADMIN"])(
        position_id="TEMP", title_en="Temp", title_zh="臨時", principal_key="temp-01",
        account_scope=frozenset(), can_prepare=False, can_review=False, cash_custody=False,
        review_level=0, read_all_accounts=True, mandate_en="", mandate_zh="", is_human=False)
    write("positions", "monolith_custom_agent_readall",
          {"op": "monolith_commands", "position": pos_record(custom)},
          output=sorted(monolith_commands(custom)))


def gl_line(n: int, acct: str, dr: str, cr: str, control: bool = False) -> dict:
    return {"line_number": n, "account_code": acct, "is_control_account": control,
            "tx_debit": dr, "tx_credit": cr, "func_debit": dr, "func_credit": cr,
            "tax_code": None, "memo": ""}


BALANCED_PAIR = [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2110", "0.0000", "100.0000")]


def proposal_input(**kw) -> dict:
    maker = {"principal_id": MAKER_ID, "agent_name": "ap-bot-01", "role": "MAKER_AP",
             "max_auto_approve_func_amount": "50000.0000", "min_confidence_threshold": "0.9000"}
    if "role" in kw:
        maker["role"] = kw.pop("role")
    base = {
        "op": "validate_proposal",
        "maker": maker,
        "source_module": "AP",
        "period_status": "OPEN",
        "lines": BALANCED_PAIR,
        "evidence_uris": ["s3://evidence/inv-001.pdf"],
        "confidence_score": "0.9700",
    }
    base.update(kw)
    return base


def run_proposal(name: str, inp: dict) -> None:
    maker = AgentIdentity(
        principal_id=MAKER_ID, agent_name=inp["maker"]["agent_name"],
        role=AgentRole(inp["maker"]["role"]),
        max_auto_approve_func_amount=Decimal(inp["maker"]["max_auto_approve_func_amount"]),
        min_confidence_threshold=Decimal(inp["maker"]["min_confidence_threshold"]))
    lines = [
        ProposedLine(
            line_number=l["line_number"], account_code=l["account_code"],
            is_control_account=l["is_control_account"],
            tx_debit=Decimal(l["tx_debit"]), tx_credit=Decimal(l["tx_credit"]),
            func_debit=Decimal(l["func_debit"]), func_credit=Decimal(l["func_credit"]),
            tax_code=l["tax_code"], memo=l["memo"],
        )
        for l in inp["lines"]
    ]
    try:
        DeterministicSoDGuard.validate_proposal_submission(
            maker=maker, source_module=inp["source_module"],
            period_status=PeriodStatus(inp["period_status"]), lines=lines,
            evidence_uris=inp["evidence_uris"], confidence_score=Decimal(inp["confidence_score"]))
    except AccountingInvariantError as e:
        write("positions", name, inp, error=str(e).split(":", 1)[0])
    else:
        write("positions", name, inp, output={"ok": True})


def with_lines(name: str, lines: list, **kw) -> None:
    run_proposal(name, proposal_input(lines=lines, **kw))


def gen_validate_proposal() -> None:
    """The guard's rule matrix: role, period, evidence, confidence, lines."""
    run_proposal("validate_ok_ap", proposal_input())
    run_proposal("validate_ok_maker_bookkeeper", proposal_input(role="MAKER_BOOKKEEPER"))
    with_lines("validate_ok_maker_close_consol",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2190", "0.0000", "100.0000")],
               role="MAKER_CLOSE_CONSOL", source_module="GL_MANUAL")

    # 1. Maker role permission: only MAKER_* may create proposals.
    run_proposal("validate_role_checker", proposal_input(role="CHECKER_CONTROLLER"))
    run_proposal("validate_role_auditor", proposal_input(role="AUDITOR_INTERNAL"))
    run_proposal("validate_role_human_cpa", proposal_input(role="HUMAN_CPA"))

    # 2. Period cut-off.
    run_proposal("validate_period_future", proposal_input(period_status="FUTURE"))
    run_proposal("validate_period_hard_close", proposal_input(period_status="HARD_CLOSE"))
    run_proposal("validate_period_locked", proposal_input(period_status="LOCKED"))
    for module in ("AP", "AR", "BANK_REC", "INVENTORY", "EXPENSE_SPLIT"):
        run_proposal(f"validate_soft_close_{module.lower()}",
                     proposal_input(period_status="SOFT_CLOSE", source_module=module))
    with_lines("validate_soft_close_fa_ok",
               [gl_line(1, "1610", "100.0000", "0.0000"), gl_line(2, "6410", "0.0000", "100.0000")],
               period_status="SOFT_CLOSE", source_module="FA")
    with_lines("validate_soft_close_gl_manual_ok",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2190", "0.0000", "100.0000")],
               period_status="SOFT_CLOSE", source_module="GL_MANUAL")
    with_lines("validate_soft_close_aje_ok", BALANCED_PAIR, period_status="SOFT_CLOSE", source_module="AJE")
    run_proposal("validate_soft_close_unknown_ok", proposal_input(period_status="SOFT_CLOSE",
                                                                  source_module="PAYROLL"))

    # 3. Evidence attachment and confidence bounds (inclusive at both ends).
    run_proposal("validate_evidence_missing", proposal_input(evidence_uris=[]))
    run_proposal("validate_confidence_negative", proposal_input(confidence_score="-0.0001"))
    run_proposal("validate_confidence_over_one", proposal_input(confidence_score="1.0001"))
    run_proposal("validate_confidence_zero_ok", proposal_input(confidence_score="0.0000"))
    run_proposal("validate_confidence_one_ok", proposal_input(confidence_score="1.0000"))

    # 4. Double-entry: at least two lines.
    run_proposal("validate_one_line", proposal_input(lines=BALANCED_PAIR[:1]))
    run_proposal("validate_no_lines", proposal_input(lines=[]))

    # Line exclusivity (TX amounts only) and control-account isolation.
    with_lines("validate_line_both_sides",
               [gl_line(1, "6100", "5.0000", "5.0000"), gl_line(2, "2110", "0.0000", "100.0000")])
    with_lines("validate_line_zero_zero",
               [gl_line(1, "6100", "0.0000", "0.0000"), gl_line(2, "2110", "0.0000", "100.0000")])
    with_lines("validate_line_negative_debit",
               [gl_line(1, "6100", "-5.0000", "0.0000"), gl_line(2, "2110", "0.0000", "100.0000")])
    with_lines("validate_line_exclusivity_line2",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2110", "5.0000", "5.0000")])
    # A debit with a negative credit passes exclusivity and fails balance.
    with_lines("validate_mixed_sign_passes_unbalanced",
               [gl_line(1, "6100", "5.0000", "-1.0000"), gl_line(2, "2110", "0.0000", "100.0000")])
    with_lines("validate_control_account_gl_manual",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2110", "0.0000", "100.0000", control=True)],
               source_module="GL_MANUAL")
    with_lines("validate_gl_manual_no_control_ok",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2190", "0.0000", "100.0000")],
               source_module="GL_MANUAL")
    with_lines("validate_control_operational_ok",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2110", "0.0000", "100.0000", control=True)],
               source_module="EXPENSE_SPLIT")

    # Balance in both currencies; the message carries the exact Decimal sums.
    with_lines("validate_unbalanced_tx",
               [gl_line(1, "6100", "100.0000", "0.0000"), gl_line(2, "2110", "0.0000", "101.0000")])
    run_proposal("validate_unbalanced_func", proposal_input(lines=[
        {"line_number": 1, "account_code": "6100", "is_control_account": False,
         "tx_debit": "100.0000", "tx_credit": "0.0000", "func_debit": "100.0000", "func_credit": "0.0000",
         "tax_code": None, "memo": ""},
        {"line_number": 2, "account_code": "2110", "is_control_account": False,
         "tx_debit": "0.0000", "tx_credit": "100.0000", "func_debit": "0.0000", "func_credit": "99.0000",
         "tax_code": None, "memo": ""},
    ]))
    with_lines("validate_all_credit",
               [gl_line(1, "2110", "0.0000", "5.0000"), gl_line(2, "2110", "0.0000", "5.0000")])
    # Sum exponents follow the 0.0000 start: min(-4, operand exponents).
    with_lines("validate_scale_sums",
               [gl_line(1, "6100", "10.00", "0.0000"), gl_line(2, "6100", "1.255", "0.0000"),
                gl_line(3, "2110", "0.0000", "11.2555")])

    # Check order: role > period > evidence > confidence > lines > per-line > balance.
    run_proposal("validate_confidence_before_lines", proposal_input(lines=BALANCED_PAIR[:1],
                                                                    confidence_score="1.5000"))
    run_proposal("validate_evidence_before_confidence", proposal_input(evidence_uris=[],
                                                                       confidence_score="1.5000"))
    run_proposal("validate_role_before_period", proposal_input(role="AUDITOR_INTERNAL",
                                                               period_status="FUTURE"))
    run_proposal("validate_period_before_evidence", proposal_input(period_status="LOCKED",
                                                                   evidence_uris=[]))
    with_lines("validate_control_before_balance",
               [gl_line(1, "2110", "100.0000", "0.0000", control=True),
                gl_line(2, "2110", "0.0000", "101.0000")],
               source_module="GL_MANUAL")
    with_lines("validate_exclusivity_before_balance",
               [gl_line(1, "6100", "3.0000", "3.0000"), gl_line(2, "2110", "0.0000", "101.0000")])


def approval_input(creator: str = MAKER_ID, reviewer_id: str = CHECKER_ID,
                   role: str = "CHECKER_CONTROLLER", total: str = "100.0000",
                   confidence: str = "0.9700", intercompany: bool = False) -> dict:
    return {
        "op": "evaluate_approval",
        "created_by_principal_id": creator,
        "reviewer": {"principal_id": reviewer_id, "agent_name": "reviewer-bot",
                     "role": role, "max_auto_approve_func_amount": "50000.0000",
                     "min_confidence_threshold": "0.9000"},
        "total_func_debit": total,
        "proposal_confidence": confidence,
        "involves_intercompany_or_statutory_adj": intercompany,
    }


def run_approval(name: str, inp: dict) -> None:
    reviewer = AgentIdentity(
        principal_id=inp["reviewer"]["principal_id"], agent_name=inp["reviewer"]["agent_name"],
        role=AgentRole(inp["reviewer"]["role"]),
        max_auto_approve_func_amount=Decimal(inp["reviewer"]["max_auto_approve_func_amount"]),
        min_confidence_threshold=Decimal(inp["reviewer"]["min_confidence_threshold"]))
    try:
        status = DeterministicSoDGuard.evaluate_approval_transition(
            created_by_principal_id=inp["created_by_principal_id"], reviewer=reviewer,
            total_func_debit=Decimal(inp["total_func_debit"]),
            proposal_confidence=Decimal(inp["proposal_confidence"]),
            involves_intercompany_or_statutory_adj=inp["involves_intercompany_or_statutory_adj"])
    except AccountingInvariantError as e:
        write("positions", name, inp, error=str(e).split(":", 1)[0])
    else:
        write("positions", name, inp, output=status.value)


def gen_evaluate_approval() -> None:
    """Self-approval refusal, approver roles, and the legacy auto-post gate."""
    # Maker-checker: the approver principal never equals the creator, and the
    # check runs before the role checks (even a HUMAN_CPA self-approval is a
    # violation in the frozen reference).
    run_approval("approval_self_checker", approval_input(creator=CHECKER_ID, reviewer_id=CHECKER_ID))
    run_approval("approval_self_human_cpa",
                 approval_input(creator=CPA_ID, reviewer_id=CPA_ID, role="HUMAN_CPA"))

    # Role authorization: only CHECKER_CONTROLLER and HUMAN_CPA may approve.
    run_approval("approval_role_maker_ap", approval_input(role="MAKER_AP"))
    run_approval("approval_role_auditor", approval_input(role="AUDITOR_INTERNAL"))

    # A human CPA finalizes posting directly, whatever the amounts.
    run_approval("approval_human_cpa_posts",
                 approval_input(role="HUMAN_CPA", total="999999.0000", confidence="0.0000"))

    # LEGACY pending REQ-0007: principal-attached auto-approve depth threshold
    # and confidence gating, pinned exactly as the frozen reference behaves.
    # Golden parity is not control endorsement.
    run_approval("approval_legacy_post", approval_input())
    run_approval("approval_legacy_boundary_amount",
                 approval_input(total="50000.0000"))
    run_approval("approval_legacy_boundary_confidence",
                 approval_input(confidence="0.9000"))
    run_approval("approval_legacy_escalate_amount",
                 approval_input(total="50000.0001"))
    run_approval("approval_legacy_escalate_confidence",
                 approval_input(confidence="0.8999"))
    run_approval("approval_legacy_escalate_intercompany",
                 approval_input(intercompany=True))
    run_approval("approval_legacy_escalate_both",
                 approval_input(total="50000.0001", confidence="0.8999"))


def gen_lines_sha256() -> None:
    """Line hashing: sort by line_number (missing = 0), missing-key renderings."""
    cases = [
        ("lines_sha_sorted", [
            {"line_number": 2, "account_code": "2110", "debit": "5.0000", "credit": "0.0000"},
            {"line_number": 1, "account_code": "6100", "debit": "0.0000", "credit": "5.0000"},
        ]),
        ("lines_sha_missing_line_number", [
            {"account_code": "6100", "debit": "1.0000", "credit": "0.0000"},
            {"line_number": 1, "account_code": "2110", "debit": "0.0000", "credit": "1.0000"},
        ]),
        ("lines_sha_missing_amounts", [
            {"line_number": 1, "account_code": "6100"},
            {"line_number": 2, "account_code": "2110", "debit": "3.0000"},
        ]),
        ("lines_sha_missing_account_code", [
            {"line_number": 1, "debit": "5.0000", "credit": "0.0000"},
        ]),
        ("lines_sha_single", [
            {"line_number": 7, "account_code": "1610", "debit": "42.0000", "credit": "0.0000"},
        ]),
        ("lines_sha_empty", []),
    ]
    for name, lines in cases:
        write("positions", name, {"op": "lines_sha256", "lines": lines},
              output=DeterministicSoDGuard.compute_lines_sha256(lines))


def gen_entry_sha256() -> None:
    """Entry hashing: the f-string payload with :.4f amount rendering."""
    cases = [
        ("entry_sha_basic", "prev-1", "JV-1", "ACME", "2026-01-31", "100.0000", "100.0000"),
        ("entry_sha_scale", "prev-2", "JV-2", "ACME", "2026-01-31", "1234.56789", "0.00015"),
        ("entry_sha_scientific", "prev-3", "JV-3", "ACME", "2026-01-31", "1E+2", "5"),
        ("entry_sha_negative", "prev-4", "JV-4", "ACME", "2026-01-31", "-5", "-0.00001"),
        ("entry_sha_huge", "prev-5", "JV-5", "ACME", "2026-01-31", "1E+30", "0"),
    ]
    for name, prev, jid, entity, date, dr, cr in cases:
        lines_sha = DeterministicSoDGuard.compute_lines_sha256([
            {"line_number": 1, "account_code": "6100", "debit": "0.0000", "credit": "0.0000"}])
        write("positions", name, {
            "op": "entry_sha256", "prev_entry_hash": prev, "journal_id": jid,
            "entity_code": entity, "accounting_date": date, "func_debit": dr,
            "func_credit": cr, "lines_sha256": lines_sha,
            "created_by": MAKER_ID, "approved_by": CHECKER_ID,
        }, output=DeterministicSoDGuard.compute_entry_sha256_hash(
            prev, jid, entity, date, Decimal(dr), Decimal(cr), lines_sha, MAKER_ID, CHECKER_ID))


def mk_journal(jid: str, prev: str, created_at: str, lines: list,
               status: str = "POSTED", entity: str = "ACME", date: str = "2026-01-31",
               total_dr: str = "100.0000", total_cr: str = "100.0000",
               creator: str = MAKER_ID, approver: str = CHECKER_ID,
               entry_hash: str | None = None) -> dict:
    """One chained journal, with its hash computed by the reference."""
    lines_sha = DeterministicSoDGuard.compute_lines_sha256(lines)
    if entry_hash is None:
        entry_hash = DeterministicSoDGuard.compute_entry_sha256_hash(
            prev, jid, entity, date, Decimal(total_dr), Decimal(total_cr), lines_sha, creator, approver)
    return {"status": status, "entry_hash": entry_hash, "prev_entry_hash": prev,
            "created_at": created_at, "journal_id": jid, "entity_code": entity,
            "accounting_date": date, "total_debit": total_dr, "total_credit": total_cr,
            "created_by_principal_id": creator, "approved_by_principal_id": approver,
            "lines": lines}


CHAIN_LINES_A = [
    {"line_number": 1, "account_code": "6100", "debit": "100.0000", "credit": "0.0000", "memo": "office rent"},
    {"line_number": 2, "account_code": "2110", "debit": "0.0000", "credit": "100.0000"},
]


def chain_fixtures() -> list:
    j1 = mk_journal("j-1", GENESIS, "2026-01-02T09:00:00", CHAIN_LINES_A)
    j2 = mk_journal("j-2", j1["entry_hash"], "2026-01-03T09:00:00", CHAIN_LINES_A)
    j3 = mk_journal("j-3", j2["entry_hash"], "2026-01-04T09:00:00", CHAIN_LINES_A)
    return j1, j2, j3


def gen_verify_chain() -> None:
    """Chain verification: validity, ordering, skips, tampering, genesis."""
    j1, j2, j3 = chain_fixtures()

    def run(name: str, journals: list) -> None:
        write("positions", name, {"op": "verify_chain", "journals": journals},
              output=DeterministicSoDGuard.verify_hash_chain(journals))

    run("chain_valid_two", [j1, j2])
    run("chain_valid_three_unsorted_input", [j3, j1, j2])
    run("chain_valid_empty", [])

    # Equal created_at keys: the stable sort keeps input order, so the chain
    # verifies only when the input order matches the chain.
    t1 = mk_journal("t-1", GENESIS, "2026-01-02T09:00:00", CHAIN_LINES_A)
    t2 = mk_journal("t-2", t1["entry_hash"], "2026-01-02T09:00:00", CHAIN_LINES_A)
    run("chain_valid_tie_created_at", [t1, t2])
    run("chain_tie_input_order_broken", [t2, t1])

    # Non-POSTED entries and entries without an entry hash are skipped.
    pending = mk_journal("j-pending", j1["entry_hash"], "2026-01-02T12:00:00", CHAIN_LINES_A,
                         status="PENDING_CHECKER")
    hashless = mk_journal("j-hashless", j2["entry_hash"], "2026-01-02T13:00:00", CHAIN_LINES_A,
                          entry_hash="")
    run("chain_skips_non_posted_and_hashless", [j1, pending, hashless, j2])

    # Broken links: a wrong genesis constant and a wrong mid-chain prev are
    # both reported with the exact expected value in the message.
    wrong_genesis = mk_journal("j-1", GENESIS[:-1] + "1", "2026-01-02T09:00:00", CHAIN_LINES_A)
    run("chain_broken_genesis", [wrong_genesis])
    broken = dict(j2)
    broken["prev_entry_hash"] = "0" * 64
    run("chain_broken_prev", [j1, broken])

    # Tampered lines: the stored hash no longer matches the recomputed one.
    tampered_lines = [dict(CHAIN_LINES_A[0]), dict(CHAIN_LINES_A[1])]
    tampered_lines[0]["debit"] = "999.0000"
    tampered = dict(j1)
    tampered["lines"] = tampered_lines
    run("chain_hash_mismatch", [tampered])


# ---------------------------------------------------------------------------
# Solo mode (一人公司模式) — spec-derived cases; there is no Python
# implementation. Sources: SRC-0028 (owner, 2026-10-30) and the
# one-person-company profile of ADR-0001 D4 / the BL-31 owner decision of
# 2026-10-21.
# ---------------------------------------------------------------------------


def solo_mode(principals: list) -> dict:
    """SRC-0028: solo while exactly one ACTIVE human principal exists."""
    humans = sum(1 for p in principals if p["is_human"] and p["active"])
    return {"human_count": humans, "solo": humans == 1}


def gen_solo_mode() -> None:
    def principal(key: str, is_human: bool, active: bool = True) -> dict:
        return {"key": key, "is_human": is_human, "active": active}

    cases = [
        ("solo_one_human", [principal("boss-01", True)]),
        ("solo_two_humans", [principal("boss-01", True), principal("bookkeeper-01", True)]),
        ("solo_human_plus_agents", [principal("boss-01", True),
                                    principal("ap-bot-01", False), principal("gl-bot-01", False)]),
        ("solo_no_humans", [principal("ap-bot-01", False), principal("gl-bot-01", False)]),
        ("solo_three_humans", [principal("boss-01", True), principal("bookkeeper-01", True),
                               principal("cashier-01", True)]),
        ("solo_second_human_inactive", [principal("boss-01", True),
                                        principal("bookkeeper-01", True, active=False)]),
        ("solo_only_human_inactive", [principal("boss-01", True, active=False)]),
    ]
    for name, principals in cases:
        write("positions", name, {"op": "solo_mode", "principals": principals},
              output=solo_mode(principals))


def self_approval(solo: bool, approver_is_creator: bool, approver_is_human: bool) -> dict:
    """ADR-0001 D4 + BL-31 owner decision (2026-10-21), SRC-0028.

    The maker never approves their own entry; in solo mode self-approval is
    allowed and flagged for the year-end audit pack. Agents never approve in
    any mode (O2-g) — reviewer.py's refusal kind is reused.
    """
    if not approver_is_human:
        return {"allowed": False, "self_approved": False, "reason": "HUMAN_REVIEWER_REQUIRED"}
    if approver_is_creator and not solo:
        return {"allowed": False, "self_approved": False, "reason": "SOD_MAKER_CHECKER_VIOLATION"}
    return {"allowed": True, "self_approved": approver_is_creator, "reason": None}


def gen_self_approval() -> None:
    for solo in (False, True):
        for creator in (False, True):
            for human in (False, True):
                name = (f"self_approval_{'solo' if solo else 'nonsolo'}_"
                        f"{'creator' if creator else 'other'}_"
                        f"{'human' if human else 'agent'}")
                inp = {"op": "self_approval", "solo": solo,
                       "approver_is_creator": creator, "approver_is_human": human}
                write("positions", name, inp, output=self_approval(solo, creator, human))


def main() -> None:
    gen_position_catalog()
    gen_scope_helpers()
    gen_reviewer_assignment()
    gen_position_for_accounts()
    gen_position_for_principal()
    gen_monolith_commands()
    gen_validate_proposal()
    gen_evaluate_approval()
    gen_lines_sha256()
    gen_entry_sha256()
    gen_verify_chain()
    gen_solo_mode()
    gen_self_approval()
    print(f"generated {COUNTS['positions']} positions fixtures under {OUT / 'positions'}")


if __name__ == "__main__":
    main()
