#!/usr/bin/env python3
"""Generate golden fixtures for the backend-go workflow module (REQ-0035 P1).

The frozen Python reference (backend/app/core/monolith.py) is the source of
every expected value: the script drives the reference's own functions — the
input validators money()/text()/iso_date() directly, and the command surface
apply_command() over minimal in-memory state — and records what they return.

Determinism: monolith.py reads the wall clock and uuid4 inside append_entry
and audit(). The generator patches monolith.date, monolith.datetime and
monolith.uuid4 with fixed fakes, so every run produces byte-identical output.
The _actor contextvar stays unset (the reference's own default), so audit
events record "Imported local operation".

Defect scenarios are NOT exercised (ADR-0002 D3; the harness must never
encode a FIXED behaviour as if Python produced it):
  - BL-27: every append_entry path converts line amounts to float64
    (monolith.py:96,117–118) — no journal-producing success case is
    fixture-generated. The money() PARSER is exact (the reference's own
    0.0001/ROUND_HALF_UP rule) and is fixture-generated, including the
    999999999999.9997 boundary the review names.
  - BL-09: bank.exception's candidate-blind posting — only its zero-amount
    refusal is generated; the matching rule is the Go fix, pinned by
    TestBL09_*.
  - BL-31/32/33: bill.create's missing duplicate check, creator record and
    void transition — only the reference's state-transition refusals
    (INVALID_BILL_STATE) and the approve state change are generated; the
    self-approval, duplicate and void rules are TestBL31_*/32/33 fixes.
  - BL-34: posting_date() date-defaulting — invoice/bill/asset record
    creation is excluded (their records embed posting_date or floats); the
    reference's iso_date validator itself is generated.
  - BL-35: stored aging buckets — the reference has no derivation to pin;
    the derived rule is TestBL35_*.
  - asset.register success (float conversion in the record) and tax.provision
    success beyond the schedule's provision_journal_id (float journal lines)
    are excluded; reconcile's success state flags are float-free and generated.

Error kinds: the harness pins kinds, not message text. WorkspaceError
messages are "KIND: text" (a few, like INVALID_ASSET_CATEGORY, are bare);
the kind prefix lower-cases into expected_error.

Run (from the backend directory):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_workflow.py

Output: backend-go/fixtures/workflow/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear in a
fixture document.
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import UTC
from datetime import date as _py_date
from datetime import datetime as _py_datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures" / "workflow"
sys.path.insert(0, str(REPO / "backend"))

from app.core import monolith as M
from app.core.monolith import WorkspaceError

# ---------------------------------------------------------------------------
# Determinism patches: the frozen reference reads the clock and uuid4 inside
# append_entry/audit; the fakes fix both. (The BL-34 posting_date default is
# never recorded — patched only so patched code paths stay deterministic.)
# ---------------------------------------------------------------------------

class _FakeDate(_py_date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 15)


class _FakeDatetime(_py_datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 15, 12, 0, 0, tzinfo=UTC)


class _FakeUUID:
    def __init__(self, n: int):
        self._uuid = uuid.UUID(int=n)

    def __str__(self):
        return str(self._uuid)

    @property
    def hex(self):
        return self._uuid.hex


_counter = {"n": 0}


def _fake_uuid4():
    _counter["n"] += 1
    return _FakeUUID(_counter["n"])


M.date = _FakeDate
M.datetime = _FakeDatetime
M.uuid4 = _fake_uuid4


# ---------------------------------------------------------------------------
# Minimal workspace state for apply_command cases. Amounts cross as strings —
# money() accepts str exactly as it accepts the seed's numbers, and this keeps
# floats out of the fixtures.
# ---------------------------------------------------------------------------

PERIOD = "2026-10"

BASE_ACCOUNTS = [
    {"code": "1010", "name": "Operating Cash", "category": "Asset"},
    {"code": "1100", "name": "Accounts Receivable", "category": "Asset"},
    {"code": "2010", "name": "Accounts Payable", "category": "Liability"},
    {"code": "2150", "name": "Accrued Tax Liability", "category": "Liability"},
    {"code": "5010", "name": "Cloud & GPU Inference Hosting", "category": "Expense"},
    {"code": "6800", "name": "Corporate Tax Provision Expense", "category": "Expense"},
]


def base_state(locked=False):
    return {
        "period": PERIOD,
        "isPeriodLocked": locked,
        "accounts": [dict(a) for a in BASE_ACCOUNTS],
        "auditLogs": [],
        "closeChecklist": [
            {"id": "CLS-03", "completed": False},
            {"id": "CLS-05", "completed": False},
            {"id": "CLS-06", "completed": False},
        ],
        "bankItems": [],
        "ledgerCashItems": [],
        "payables": [],
        "receivables": [],
        "taxSchedules": [],
        "fixedAssets": [],
        "journalEntries": [],
        "agentTasks": [],
    }


def error_kind(exc: Exception) -> str:
    text = str(exc)
    prefix = text.split(": ", 1)[0] if ": " in text else text
    return prefix.lower()


def expect_apply(action, payload, state=None):
    """Run apply_command over fresh minimal state; return the state for the
    case to project, or re-raise (the harness records the error kind)."""
    s = state if state is not None else base_state()
    M.apply_command(s, action, payload)
    return s


# Seed records shared by the command cases (amounts as strings).
PENDING_BILL = {
    "id": "BILL-401", "vendor": "Amazon Web Services", "reference": "AWS-INV-10992",
    "billDate": "2026-10-03", "dueDate": "2026-10-28",
    "expenseAccountCode": "5010", "expenseAccountName": "Cloud & GPU Inference Hosting",
    "amount": "4200.0000", "status": "Pending",
}
APPROVED_BILL = dict(PENDING_BILL, status="Approved")

BANK_OPEN = {
    "id": "BF-901", "date": "2026-10-16", "counterparty": "VANECK GLOBAL CORP",
    "bankReference": "FW-88419022", "description": "FEDWIRE INCOMING",
    "amount": "185000.0000", "status": "Unmatched",
}
LEDGER_OPEN = {
    "id": "LC-01", "date": "2026-10-16", "entryId": "JE-2026-0942",
    "memo": "Wire settlement", "amount": "185000.0000", "reconciled": False,
}
BANK_SECOND = {
    "id": "BF-902", "date": "2026-10-15", "counterparty": "AMAZON WEB SERVICES INC",
    "bankReference": "ACH-2940118", "description": "ACH DEBIT",
    "amount": "-40000.0000", "status": "Matched", "matchedLedgerId": "LC-02",
}
LEDGER_SECOND = {
    "id": "LC-02", "date": "2026-10-15", "entryId": "JE-2026-0941",
    "memo": "AWS net ACH settlement", "amount": "-40000.0000", "reconciled": False,
}

NY_SCHEDULE = {
    "id": "TAX-NY-SALES", "formCode": "Form ST-100", "jurisdiction": "New York State",
    "taxableBase": "418000.0000", "statutoryRate": "8.8750",
    "creditsAndDeductions": "0.0000", "status": "In Review",
    "provisionJournalId": "",
}
NY_SCHEDULE_POSTED = dict(NY_SCHEDULE, provisionJournalId="JE-PRIOR")

COMPANY_TWO_HUMANS = [
    {"principal_key": "ap-clerk-01", "is_human": True, "active": True},
    {"principal_key": "finance-manager-01", "is_human": True, "active": True},
]

BILL_WIRE = {
    "id": "BILL-401", "status": "Pending", "created_by": "ap-clerk-01",
    "amount": "4200.0000",
}


def bank_projection(bank, ledger, cls03):
    return {
        "bank_status": bank["status"],
        "matched_ledger_id": bank.get("matchedLedgerId"),
        "match_confidence": bank.get("matchConfidence"),
        "ledger_reconciled": ledger["reconciled"],
        "close_check_completed": cls03,
    }


# ---------------------------------------------------------------------------
# The cases. Each yields (name, input wire document, output or error kind).
# ---------------------------------------------------------------------------

def cases():
    # --- money(): the exact-decimal parse rule (BL-27's parser half is
    # defect-free; the float conversion happens later, at persistence).
    amount_cases = [
        ("amount_basic", "4200", False, False, "4200.0000"),
        ("amount_quantized_half_up", "0.00005", False, False, "0.0001"),
        ("amount_signed_negative", "-1.5", True, False, "-1.5000"),
        ("amount_zero_signed", "0", True, False, "0.0000"),
        ("amount_limit_exact", "1000000000000", False, False, "1000000000000.0000"),
        ("amount_over_limit", "1000000000001", False, False, None),
        ("amount_negative_unsigned", "-2", False, False, None),
        ("amount_zero_positive", "0", False, True, None),
        ("amount_not_a_number", "abc", False, False, None),
        ("amount_bool", True, False, False, None),
        ("amount_int", 4200, False, False, "4200.0000"),
        ("amount_boundary_999999999999_99975", "999999999999.99975", False, False, "999999999999.9998"),
        ("amount_exact_retained_999999999999_9997", "999999999999.9997", False, False, "999999999999.9997"),
    ]
    for name, value, signed, positive, want in amount_cases:
        def run(value=value, signed=signed, positive=positive, want=want):
            amount = M.money(value, signed=signed, positive=positive)
            return {"amount": str(amount)}

        yield (
            name,
            {"op": "amount", "value": value, "signed": signed, "positive": positive},
            run, "invalid_amount" if want is None else None,
        )

    # --- text(): field validation.
    for name, value, field, limit, want in [
        ("text_strips_whitespace", "  AWS-INV-10992  ", "reference", 500, "AWS-INV-10992"),
        ("text_blank", "   ", "reference", 500, None),
        ("text_too_long", "x" * 501, "reference", 500, None),
    ]:
        def run(value=value, field=field, limit=limit):
            return {"text": M.text(value, field, limit)}

        yield (
            name,
            {"op": "text", "value": value, "field": field, "limit": limit},
            run, "invalid_field" if want is None else None,
        )

    # --- iso_date(): date validation and the open-period month check.
    for name, value, period, want in [
        ("iso_date_within_period", "2026-10-15", PERIOD, "2026-10-15"),
        ("iso_date_no_period", "2026-10-15", None, "2026-10-15"),
        ("iso_date_period_mismatch", "2026-09-30", PERIOD, None),
        ("iso_date_impossible_day", "2026-02-30", PERIOD, None),
        ("iso_date_bad_format", "15/10/2026", None, None),
    ]:
        def run(value=value, period=period):
            if period is None:
                return {"date": M.iso_date(value)}
            return {"date": M.iso_date(value, period)}

        kind = None
        if want is None:
            kind = "period_mismatch" if value.startswith("2026-09-30") else "invalid_date"
        yield (
            name,
            {"op": "iso_date", "value": value, "period": period},
            run, kind,
        )

    # --- journal.create's source whitelist (checked before any posting).
    # The valid-source runs post a small balanced journal (patched ids and
    # clock keep it deterministic); only the source decision is recorded —
    # the reference's journal lines are float64 (BL-27 exclusion).
    for name, source, kind in [
        ("journal_source_manual", "Manual Entry", None),
        ("journal_source_agentic", "Agentic Auto-Draft", None),
        ("journal_source_system_refused", "System Accrual", "invalid_source"),
    ]:
        def run(source=source):
            expect_apply("journal.create", {
                "memo": "Cloud hosting", "reference": "SRC-CHECK",
                "source": source,
                "lines": [
                    {"accountCode": "5010", "debit": "100.0000", "credit": 0},
                    {"accountCode": "2010", "debit": 0, "credit": "100.0000"},
                ],
            })
            return {"source": source}

        yield (name, {"op": "journal_source", "source": source}, run, kind)

    # --- apply_command's period-lock gate.
    for name, locked, action, payload, kind in [
        ("command_gate_locked_refused", True, "bill.create", {}, "period_locked"),
        ("command_gate_unlock_allowed", True, "period.unlock", {}, None),
        ("command_gate_budget_allowed", True, "budget.save", {"allocations": []}, None),
    ]:
        def run(locked=locked, action=action, payload=payload):
            expect_apply(action, payload, base_state(locked=locked))
            return {"allowed": True}

        yield (name, {"op": "command_gate", "locked": locked, "action": action}, run, kind)

    # --- bill.approve / bill.pay state rules. The Python command records no
    # creator or approver (BL-31) and no duplicate check (BL-32): the cases
    # below carry distinct principals so the Go rule agrees, and pin the
    # shared state machine only.
    def approve_run():
        s = base_state()
        s["payables"] = [dict(PENDING_BILL)]
        M.apply_command(s, "bill.approve", {"id": "BILL-401"})
        return {"status": s["payables"][0]["status"]}

    yield (
        "bill_approve_pending_to_approved",
        {"op": "approve_bill", "bill": dict(BILL_WIRE, status="Pending"),
         "approver": {"principal_key": "finance-manager-01", "is_human": True},
         "principals": COMPANY_TWO_HUMANS},
        approve_run, None,
    )

    def approve_again_run():
        s = base_state()
        s["payables"] = [dict(APPROVED_BILL)]
        M.apply_command(s, "bill.approve", {"id": "BILL-401"})
        return {}

    yield (
        "bill_approve_wrong_state",
        {"op": "approve_bill", "bill": dict(BILL_WIRE, status="Approved"),
         "approver": {"principal_key": "finance-manager-01", "is_human": True},
         "principals": COMPANY_TWO_HUMANS},
        approve_again_run, "invalid_bill_state",
    )

    def pay_wrong_state_run():
        s = base_state()
        s["payables"] = [dict(PENDING_BILL)]
        M.apply_command(s, "bill.pay", {"id": "BILL-401"})
        return {}

    yield (
        "bill_pay_requires_approved",
        {"op": "pay_bill", "bill": dict(BILL_WIRE, status="Pending"),
         "approver": {"principal_key": "finance-manager-01", "is_human": True},
         "principals": COMPANY_TWO_HUMANS},
        pay_wrong_state_run, "invalid_bill_state",
    )

    # --- bank.reconcile: the matching rules (BL-09's matching half is the
    # reference's own reconcile; the exception path is the fix).
    def reconcile_ok_run():
        s = base_state()
        s["bankItems"] = [dict(BANK_OPEN), dict(BANK_SECOND)]
        s["ledgerCashItems"] = [dict(LEDGER_OPEN), dict(LEDGER_SECOND)]
        M.apply_command(s, "bank.reconcile", {"bankId": "BF-901", "ledgerId": "LC-01"})
        return bank_projection(s["bankItems"][0], s["ledgerCashItems"][0], s["closeChecklist"][0]["completed"])

    yield (
        "reconcile_match_leaves_close_open",
        {
            "op": "reconcile",
            "bank": {"id": "BF-901", "amount": "185000.0000", "status": "Unmatched"},
            "ledger": {"id": "LC-01", "amount": "185000.0000", "reconciled": False},
            "bank_items": [
                {"id": "BF-901", "amount": "185000.0000", "status": "Unmatched"},
                {"id": "BF-902", "amount": "-40000.0000", "status": "Matched"},
            ],
            "ledger_items": [
                {"id": "LC-01", "amount": "185000.0000", "reconciled": False},
                {"id": "LC-02", "amount": "-40000.0000", "reconciled": False},
            ],
        },
        reconcile_ok_run, None,
    )

    def reconcile_completes_run():
        s = base_state()
        s["bankItems"] = [dict(BANK_OPEN)]
        s["ledgerCashItems"] = [dict(LEDGER_OPEN)]
        M.apply_command(s, "bank.reconcile", {"bankId": "BF-901", "ledgerId": "LC-01"})
        return bank_projection(s["bankItems"][0], s["ledgerCashItems"][0], s["closeChecklist"][0]["completed"])

    yield (
        "reconcile_match_completes_close_check",
        {
            "op": "reconcile",
            "bank": {"id": "BF-901", "amount": "185000.0000", "status": "Unmatched"},
            "ledger": {"id": "LC-01", "amount": "185000.0000", "reconciled": False},
            "bank_items": [{"id": "BF-901", "amount": "185000.0000", "status": "Unmatched"}],
            "ledger_items": [{"id": "LC-01", "amount": "185000.0000", "reconciled": False}],
        },
        reconcile_completes_run, None,
    )

    def reconcile_already_run():
        s = base_state()
        s["bankItems"] = [dict(BANK_OPEN, status="Matched", matchedLedgerId="LC-01")]
        s["ledgerCashItems"] = [dict(LEDGER_OPEN)]
        M.apply_command(s, "bank.reconcile", {"bankId": "BF-901", "ledgerId": "LC-01"})
        return {}

    yield (
        "reconcile_already_matched_refused",
        {
            "op": "reconcile",
            "bank": {"id": "BF-901", "amount": "185000.0000", "status": "Matched"},
            "ledger": {"id": "LC-01", "amount": "185000.0000", "reconciled": False},
            "bank_items": [{"id": "BF-901", "amount": "185000.0000", "status": "Matched"}],
            "ledger_items": [{"id": "LC-01", "amount": "185000.0000", "reconciled": False}],
        },
        reconcile_already_run, "already_reconciled",
    )

    def reconcile_mismatch_run():
        s = base_state()
        s["bankItems"] = [dict(BANK_OPEN)]
        s["ledgerCashItems"] = [dict(LEDGER_OPEN, amount="185001.0000")]
        M.apply_command(s, "bank.reconcile", {"bankId": "BF-901", "ledgerId": "LC-01"})
        return {}

    yield (
        "reconcile_amount_mismatch_refused",
        {
            "op": "reconcile",
            "bank": {"id": "BF-901", "amount": "185000.0000", "status": "Unmatched"},
            "ledger": {"id": "LC-01", "amount": "185001.0000", "reconciled": False},
            "bank_items": [{"id": "BF-901", "amount": "185000.0000", "status": "Unmatched"}],
            "ledger_items": [{"id": "LC-01", "amount": "185001.0000", "reconciled": False}],
        },
        reconcile_mismatch_run, "match_amount_mismatch",
    )

    # --- tax.provision: lookup, duplicate-post and amount-check guards. The
    # success records only the schedule's provision_journal_id (the journal
    # lines are float64 in the reference — BL-27 exclusion).
    def provision_ok_run():
        s = base_state()
        s["taxSchedules"] = [dict(NY_SCHEDULE)]
        M.apply_command(s, "tax.provision", {
            "formCode": "Form ST-100", "jurisdiction": "New York State", "amount": "37098",
        })
        return {"provision_journal_id": s["taxSchedules"][0]["provisionJournalId"]}

    yield (
        "tax_provision_posts_once",
        {
            "op": "tax_provision",
            "schedules": [{
                "id": "TAX-NY-SALES", "form_code": "Form ST-100",
                "jurisdiction": "New York State", "taxable_base": "418000.0000",
                "statutory_rate": "8.8750", "credits_and_deductions": "0.0000",
                "status": "In Review", "provision_journal_id": "",
            }],
            "form_code": "Form ST-100", "jurisdiction": "New York State",
            "amount": "37098", "entry_id": "JE-000000000000",
        },
        provision_ok_run, None,
    )

    def provision_missing_run():
        s = base_state()
        s["taxSchedules"] = [dict(NY_SCHEDULE)]
        M.apply_command(s, "tax.provision", {
            "formCode": "Form 100-ES", "jurisdiction": "California", "amount": "0",
        })
        return {}

    yield (
        "tax_provision_unknown_schedule",
        {
            "op": "tax_provision",
            "schedules": [{
                "id": "TAX-NY-SALES", "form_code": "Form ST-100",
                "jurisdiction": "New York State", "taxable_base": "418000.0000",
                "statutory_rate": "8.8750", "credits_and_deductions": "0.0000",
                "status": "In Review", "provision_journal_id": "",
            }],
            "form_code": "Form 100-ES", "jurisdiction": "California",
            "amount": "0", "entry_id": "JE-X",
        },
        provision_missing_run, "not_found",
    )

    def provision_already_run():
        s = base_state()
        s["taxSchedules"] = [dict(NY_SCHEDULE_POSTED)]
        M.apply_command(s, "tax.provision", {
            "formCode": "Form ST-100", "jurisdiction": "New York State", "amount": "37098",
        })
        return {}

    yield (
        "tax_provision_already_posted",
        {
            "op": "tax_provision",
            "schedules": [{
                "id": "TAX-NY-SALES", "form_code": "Form ST-100",
                "jurisdiction": "New York State", "taxable_base": "418000.0000",
                "statutory_rate": "8.8750", "credits_and_deductions": "0.0000",
                "status": "In Review", "provision_journal_id": "JE-PRIOR",
            }],
            "form_code": "Form ST-100", "jurisdiction": "New York State",
            "amount": "37098", "entry_id": "JE-000000000000",
        },
        provision_already_run, "already_posted",
    )

    def provision_mismatch_run():
        s = base_state()
        s["taxSchedules"] = [dict(NY_SCHEDULE)]
        M.apply_command(s, "tax.provision", {
            "formCode": "Form ST-100", "jurisdiction": "New York State", "amount": "999",
        })
        return {}

    yield (
        "tax_provision_stale_amount_refused",
        {
            "op": "tax_provision",
            "schedules": [{
                "id": "TAX-NY-SALES", "form_code": "Form ST-100",
                "jurisdiction": "New York State", "taxable_base": "418000.0000",
                "statutory_rate": "8.8750", "credits_and_deductions": "0.0000",
                "status": "In Review", "provision_journal_id": "",
            }],
            "form_code": "Form ST-100", "jurisdiction": "New York State",
            "amount": "999", "entry_id": "JE-X",
        },
        provision_mismatch_run, "provision_mismatch",
    )

    # --- asset.register's validation refusals (the success path embeds a
    # float conversion and posting_date — excluded).
    asset_refusals = [
        ("asset_register_life_zero", 0, "0", "1200", "Compute Cluster", "NVIDIA H100 Node", "invalid_asset"),
        ("asset_register_life_over", 1201, "0", "1200", "Compute Cluster", "NVIDIA H100 Node", "invalid_asset"),
        ("asset_register_life_bool", True, "0", "1200", "Compute Cluster", "NVIDIA H100 Node", "invalid_asset"),
        ("asset_register_salvage_over_cost", 36, "5000", "1200", "Compute Cluster", "NVIDIA H100 Node", "invalid_asset"),
        ("asset_register_unknown_category", 36, "0", "1200", "Vehicles", "NVIDIA H100 Node", "invalid_asset_category"),
        ("asset_register_blank_name", 36, "0", "1200", "Compute Cluster", "   ", "invalid_field"),
    ]
    for name, life, salvage, cost, category, asset_name, kind in asset_refusals:
        def run(life=life, salvage=salvage, cost=cost, category=category, asset_name=asset_name):
            expect_apply("asset.register", {
                "name": asset_name, "category": category, "usefulLifeMonths": life,
                "costBasis": cost, "salvageValue": salvage,
            })
            return {}

        yield (
            name,
            {"op": "register_asset", "name": asset_name, "category": category,
             "useful_life_months": life, "cost_basis": cost, "salvage_value": salvage,
             "in_service_date": "2026-10-01"},
            run, kind,
        )

    # --- bank.exception's zero-movement refusal (the candidate-blind
    # posting above it is the BL-09 fix, excluded here).
    def bank_exception_zero_run():
        s = base_state()
        s["bankItems"] = [{
            "id": "BF-900", "date": "2026-10-16", "counterparty": "X",
            "bankReference": "REF-0", "description": "Zero movement",
            "amount": "0.0000", "status": "Unmatched",
        }]
        M.apply_command(s, "bank.exception", {"id": "BF-900"})
        return {}

    yield (
        "bank_exception_zero_movement_refused",
        {"op": "bank_exception", "bank": {"id": "BF-900", "amount": "0.0000", "status": "Unmatched"}},
        bank_exception_zero_run, "invalid_amount",
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    count = 0
    for name, input_doc, run, kind in cases():
        _counter["n"] = 0  # every case starts from the same uuid
        case = {"module": "workflow", "case": name, "input": input_doc}
        try:
            case["output"] = run()
        except WorkspaceError as exc:
            actual = error_kind(exc)
            if kind is None:
                raise SystemExit(f"case {name}: unexpected error {exc}")
            if actual != kind:
                raise SystemExit(f"case {name}: error kind {actual!r}, want {kind!r} ({exc})")
            case["expected_error"] = kind
        else:
            if kind is not None:
                raise SystemExit(f"case {name}: expected error {kind}, replay succeeded")
        text = json.dumps(case, sort_keys=True, separators=(",", ":")) + "\n"
        (OUT / f"{name}.json").write_text(text, encoding="utf-8")
        count += 1
    print(f"wrote {count} workflow fixtures to {OUT}")


if __name__ == "__main__":
    main()
