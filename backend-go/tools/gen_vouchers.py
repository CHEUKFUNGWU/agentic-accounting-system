#!/usr/bin/env python3
"""Generate golden fixtures for the backend-go voucher module (REQ-0035 P1).

Ports covered, with their reference for every expected value:

  - backend/app/core/vouchers.py pure rules, imported below: q4,
    normal_balance (+ CONTRA_CREDIT_CATEGORIES / CONTROL_FS_CATEGORIES),
    parse_lines, assert_balanced, to_proposed_lines.

  - backend/app/core/posting.py reversal rules, driven for real over a
    seeded in-memory SQLite reference database: build_reversal_lines,
    _reversal_original (the value rules of it) and _validate_reversal_lines.
    These are the BL-03 remediation semantics (mirror transaction and
    functional amounts, accounts, currencies and entry layers from the
    persisted ledger rows) — the reference implements them and parity
    applies. The existence check for another effective posted reversal and
    the row locks are store queries: not fixture-reproducible here and not
    ported at P1 (documented in internal/core/domain/voucher/reversal.go).

  - The submitted-snapshot guard of post_voucher: SNAPSHOT_FIELDS is the
    frozen module-level constant, imported below; the changed-field
    comparison mirrors post_voucher's
    `[f for f in SNAPSHOT_FIELDS if submitted.get(f) != current.get(f)]`
    (posting.py:212) over plain dict values.

  - The voucher lifecycle transition map, copied VERBATIM from
    repository.save_journal (backend/app/core/repository.py:395–409) — the
    dict is a local inside that function and not importable. The finalized
    branch (POSTED/REVERSED/VOID: status-only changes only, the sole
    transition being POSTED→REVERSED) and the posting precondition
    (PENDING_CHECKER/AWAITING_CPA, posting.py:208 and
    repository.py:818) mirror the same two functions.

  - Spec-derived cases with NO Python implementation (owner-decided new
    behaviour, like gen_positions.py's solo-mode block): the BL-36 voucher
    numbering — FormatVoucherNumber's neutral prefix-year-sequence default
    and the pure gap report. Sources: BL-36 owner decision 2026-10-21
    (SRC-0017, 07-reviews/2026-10-21-ais-textbook-gap-review.md) and SRC-0027
    (01-inputs/2026-10-24-bl14-bl31-bl36-decisions.md): uniqueness and gap
    reporting are system-level guarantees, the visible format ships per
    jurisdiction pack (REQ-0014 onward) with the neutral default until then.

EXCLUDED: vouchers.next_voucher_no / voucher_prefix scenarios — the defected
BL-36 behaviour (numbers allocated at draft creation, gaps unreported). The
owner decision replaces it; nothing golden-pins it.

Rejection kinds: the harness pins error kinds, not message text. The
reference's VoucherError messages carry no prefixes, so gen maps the frozen
message templates onto the kind taxonomy of
internal/core/domain/voucher/validation.go; PostingError kinds are the
reference's own message prefixes (REVERSAL_INVALID, REVERSAL_CONFLICT,
VOUCHER_SNAPSHOT_CHANGED).

Run (from the repository root):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_vouchers.py

Output: backend-go/fixtures/vouchers/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime
from decimal import InvalidOperation
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures"

# Point the module-level db_manager at a throwaway in-memory engine BEFORE
# any app import touches it; the generator's own seeded engine is below.
os.environ["DATABASE_URL"] = "sqlite+aiosqlite://"
sys.path.insert(0, str(REPO / "backend"))

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core import vouchers as vz
from app.core.db import Base, JournalEntryModel, JournalLineModel
from app.core.posting import (
    SNAPSHOT_FIELDS,
    PostingError,
    _reversal_original,
    _validate_reversal_lines,
    build_reversal_lines,
)
from app.core.repository import repo

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


# ---------------------------------------------------------------------------
# VoucherError message → kind. The frozen messages are the classifier; the
# kinds are the Go port's stable taxonomy (validation.go).
# ---------------------------------------------------------------------------

VOUCHER_ERROR_KINDS = [
    ("未選擇科目", "LINE_MISSING_ACCOUNT"),
    ("不可為負數", "LINE_NEGATIVE_AMOUNT"),
    ("同時有借方與貸方", "LINE_BOTH_SIDES"),
    ("沒有金額", "LINE_ZERO_AMOUNT"),
    ("至少要兩行", "TOO_FEW_LINES"),
    ("借貸不平衡", "UNBALANCED"),
    ("必須大於零", "NON_POSITIVE_TOTAL"),
]


def voucher_error_kind(exc: Exception) -> str:
    for needle, kind in VOUCHER_ERROR_KINDS:
        if needle in str(exc):
            return kind
    raise AssertionError(f"unmapped VoucherError message: {exc!s}")


def posting_error_kind(exc: PostingError) -> str:
    return str(exc).split(":", 1)[0]


# ---------------------------------------------------------------------------
# Pure vouchers.py rules
# ---------------------------------------------------------------------------


def gen_q4() -> None:
    cases = [
        ("q4_integer", "5"),
        ("q4_halves", "1.5"),
        ("q4_half_even_down", "0.00005"),
        ("q4_half_even_up", "0.00015"),
        ("q4_half_even_even_digit", "1.00005"),
        ("q4_half_even_odd_digit", "1.00015"),
        ("q4_negative", "-2.5"),
        ("q4_negative_zero", "-0.00001"),
        ("q4_tiny_scientific", "1E-7"),
        ("q4_large_scientific", "1E+2"),
        ("q4_string_zero", "0"),
    ]
    for name, value in cases:
        write("vouchers", name, {"op": "q4", "value": value}, output=str(vz.q4(value)))
    # Over context precision: quantize raises decimal.InvalidOperation (an
    # ArithmeticError, not a VoucherError) — the one non-VoucherError escape
    # of the validation path.
    write("vouchers", "q4_over_precision",
          {"op": "q4", "value": "1234567890123456789012345.67895"},
          error="DECIMAL_INVALID_OPERATION")


def gen_normal_balance() -> None:
    cases = [
        ("normal_balance_asset", "ASSET", None),
        ("normal_balance_expense", "EXPENSE", None),
        ("normal_balance_liability", "LIABILITY", None),
        ("normal_balance_equity", "EQUITY", None),
        ("normal_balance_revenue", "REVENUE", None),
        ("normal_balance_contra_asset", "ASSET", "CONTRA_ASSET"),
        ("normal_balance_unknown_type", "BANK", None),
    ]
    for name, account_type, fs_category in cases:
        write("vouchers", name,
              {"op": "normal_balance", "account_type": account_type, "fs_category": fs_category},
              output=vz.normal_balance(account_type, fs_category))


def gen_account_classification() -> None:
    """The chart_account derivation: normal balance + control flag."""
    cases = [
        ("classification_expense", "EXPENSE", None),
        ("classification_asset", "ASSET", None),
        ("classification_contra_asset", "ASSET", "CONTRA_ASSET"),
        ("classification_fixed_asset_control", "ASSET", "FIXED_ASSET"),
        ("classification_ap_control", "LIABILITY", "AP_ACCRUAL"),
        ("classification_tax_control", "LIABILITY", "TAX_PAYABLE"),
        ("classification_director_loan_control", "EQUITY", "DIRECTOR_LOAN"),
        ("classification_revenue", "REVENUE", None),
    ]
    for name, account_type, fs_category in cases:
        write("vouchers", name,
              {"op": "account_classification", "account_type": account_type, "fs_category": fs_category},
              output={
                  "normal_balance": vz.normal_balance(account_type, fs_category),
                  "is_control_account": fs_category in vz.CONTROL_FS_CATEGORIES,
              })


def raw_line(account_code: str, debit: str, credit: str, **kw) -> dict:
    line = {
        "account_code": account_code,
        "account_name": kw.get("account_name", ""),
        "debit": debit,
        "credit": credit,
        "memo": kw.get("memo", ""),
        "counterparty": kw.get("counterparty", ""),
        "tax_code": kw.get("tax_code", ""),
        "business_use_pct": kw.get("business_use_pct", ""),
    }
    return line


def gen_parse_lines() -> None:
    ok_cases = [
        ("parse_ok_basic", [
            raw_line("6100", "100.0000", "0.0000", account_name="管理及營運費用",
                     memo="  辦公室租金  ", counterparty=" 宏達有限公司 "),
            raw_line("2110", "0.0000", "100.0000", account_name="應付帳款及應計費用"),
        ]),
        ("parse_ok_tax_and_use", [
            raw_line("1420", "50.0000", "0.0000", tax_code=" TX-001 ", business_use_pct="0.8000"),
            raw_line("2110", "0.0000", "50.0000"),
        ]),
        ("parse_ok_single_line", [
            raw_line("6100", "1.0000", "0.0000"),
        ]),
        ("parse_ok_empty_debit_string", [
            raw_line("6100", "", "5.0000"),
            raw_line("2110", "0", "5.0000"),
        ]),
    ]
    for name, lines in ok_cases:
        write("vouchers", name, {"op": "parse_lines", "lines": lines},
              output=vz.parse_lines(lines))
    write("vouchers", "parse_empty", {"op": "parse_lines", "lines": []},
          output=vz.parse_lines([]))

    # Rejections, in the reference's per-line check order.
    rejects = [
        ("parse_missing_account", [raw_line("6100", "1.0000", "0.0000"),
                                   raw_line("", "0.0000", "1.0000")]),
        ("parse_blank_account", [raw_line("6100", "1.0000", "0.0000"),
                                 raw_line("   ", "0.0000", "1.0000")]),
        ("parse_negative_debit", [raw_line("6100", "-5.0000", "0.0000"),
                                  raw_line("2110", "0.0000", "1.0000")]),
        ("parse_negative_credit", [raw_line("6100", "5.0000", "0.0000"),
                                   raw_line("2110", "0.0000", "-1.0000")]),
        ("parse_both_sides", [raw_line("6100", "5.0000", "5.0000"),
                              raw_line("2110", "0.0000", "1.0000")]),
        ("parse_zero_amount", [raw_line("6100", "0.0000", "0.0000"),
                               raw_line("2110", "0.0000", "1.0000")]),
    ]
    for name, lines in rejects:
        try:
            vz.parse_lines(lines)
        except vz.VoucherError as exc:
            write("vouchers", name, {"op": "parse_lines", "lines": lines},
                  error=voucher_error_kind(exc))
        else:  # pragma: no cover - generation invariant
            raise AssertionError(f"{name}: reference accepted a refusal case")
    try:
        vz.parse_lines([raw_line("6100", "abc", "0.0000"),
                        raw_line("2110", "0.0000", "5.0000")])
    except ArithmeticError as exc:  # decimal.InvalidOperation, not VoucherError
        assert isinstance(exc, InvalidOperation)
        write("vouchers", "parse_garbage_amount",
              {"op": "parse_lines", "lines": [raw_line("6100", "abc", "0.0000"),
                                              raw_line("2110", "0.0000", "5.0000")]},
              error="DECIMAL_INVALID_OPERATION")
    else:  # pragma: no cover
        raise AssertionError("parse_garbage_amount: reference parsed 'abc'")


def bal_line(debit: str, credit: str) -> dict:
    return {"debit": debit, "credit": credit}


def run_assert_balanced(name: str, lines: list) -> None:
    inp = {"op": "assert_balanced", "lines": lines}
    try:
        dr, cr = vz.assert_balanced(lines)
    except vz.VoucherError as exc:
        write("vouchers", name, inp, error=voucher_error_kind(exc))
        return
    write("vouchers", name, inp, output={"total_debit": str(dr), "total_credit": str(cr)})


def gen_assert_balanced() -> None:
    run_assert_balanced("balanced_ok", [bal_line("100.0000", "0.0000"),
                                        bal_line("0.0000", "100.0000")])
    run_assert_balanced("balanced_scale_sums", [bal_line("10.00", "0.0000"),
                                                bal_line("1.2555", "0.0000"),
                                                bal_line("0.0000", "11.2555")])
    run_assert_balanced("balanced_one_line", [bal_line("100.0000", "0.0000")])
    run_assert_balanced("balanced_empty", [])
    run_assert_balanced("balanced_unbalanced", [bal_line("100.0000", "0.0000"),
                                                bal_line("0.0000", "101.0000")])
    run_assert_balanced("balanced_all_zero", [bal_line("0.0000", "0.0000"),
                                              bal_line("0.0000", "0.0000")])
    run_assert_balanced("balanced_all_credit", [bal_line("0.0000", "5.0000"),
                                                bal_line("0.0000", "5.0000")])


def stored_line(line_number: int, account_code: str, debit: str, credit: str, **kw) -> dict:
    return {
        "line_number": line_number,
        "account_code": account_code,
        "account_name": kw.get("account_name", ""),
        "debit": debit,
        "credit": credit,
        "memo": kw.get("memo", ""),
        "counterparty": kw.get("counterparty", ""),
        "tax_code": kw.get("tax_code", ""),
        "business_use_pct": kw.get("business_use_pct", "1.0000"),
    }


def proposed_wire(pl) -> dict:
    return {
        "line_number": pl.line_number,
        "account_code": pl.account_code,
        "is_control_account": pl.is_control_account,
        "tx_debit": str(pl.tx_debit),
        "tx_credit": str(pl.tx_credit),
        "func_debit": str(pl.func_debit),
        "func_credit": str(pl.func_credit),
        "tax_code": pl.tax_code,
        "memo": pl.memo,
    }


def run_to_proposed(name: str, lines: list, control: list) -> None:
    out = vz.to_proposed_lines(lines, set(control))
    write("vouchers", name,
          {"op": "to_proposed_lines", "lines": lines, "control_accounts": control},
          output=[proposed_wire(pl) for pl in out])


def gen_to_proposed_lines() -> None:
    run_to_proposed("to_proposed_basic",
                    [stored_line(1, "6100", "100.0000", "0.0000", memo="租金"),
                     stored_line(2, "2110", "0.0000", "100.0000")],
                    ["2110"])
    run_to_proposed("to_proposed_tax_code",
                    [stored_line(1, "1420", "50.0000", "0.0000", tax_code="TX-001"),
                     stored_line(2, "2110", "0.0000", "50.0000")],
                    [])
    run_to_proposed("to_proposed_all_control",
                    [stored_line(1, "1210", "10.0000", "0.0000"),
                     stored_line(2, "2110", "0.0000", "10.0000")],
                    ["1210", "2110"])


# ---------------------------------------------------------------------------
# Reference DB harness: the reversal rules run for real over seeded rows.
# ---------------------------------------------------------------------------

engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
SESSION = async_sessionmaker(bind=engine, expire_on_commit=False)


class _StubManager:
    """Redirects repo.manager so build_reversal_lines / _reversal_original /
    repo.get_journal hit the in-memory reference database."""

    def __init__(self, factory):
        self.session_factory = factory


repo.manager = _StubManager(SESSION)


async def _reset_tables() -> None:
    async with SESSION() as session, session.begin():
        await session.execute(delete(JournalLineModel))
        await session.execute(delete(JournalEntryModel))


async def _seed_lines(rows: list) -> None:
    async with SESSION() as session, session.begin():
        for r in rows:
            session.add(JournalLineModel(**r))


def ledger_row(line_id: str, journal_id: str, line_number: int, account_code: str,
               debit: str, credit: str, *, func_debit: str | None = None,
               func_credit: str | None = None, entity: str = "ACME",
               layer: str = "OPERATIONAL", currency: str = "HKD",
               rate: str = "1.00000000", account_name: str = "",
               memo: str = "", counterparty_id: str | None = None,
               counterparty_name: str = "", tax_code_id: str | None = None,
               func_tax: str = "0.0000", use_pct: str = "1.0000",
               statement_ref: str = "IS", period: str = "2026-10",
               date: str = "2026-10-05", account_id: str | None = None) -> dict:
    """One seeded JournalLineModel row, single-currency unless overridden."""
    return {
        "line_id": line_id,
        "journal_id": journal_id,
        "entity_code": entity,
        "line_number": line_number,
        "account_id": account_id or f"acc-{account_code}",
        "account_code": account_code,
        "account_name": account_name,
        "period_code": period,
        "entry_layer": layer,
        "accounting_date": date,
        "tx_currency": currency,
        "exchange_rate": rate,
        "tx_debit": debit,
        "tx_credit": credit,
        "func_debit": func_debit if func_debit is not None else debit,
        "func_credit": func_credit if func_credit is not None else credit,
        "counterparty_id": counterparty_id,
        "counterparty_name": counterparty_name,
        "tax_code_id": tax_code_id,
        "func_tax_amount": func_tax,
        "business_use_pct": use_pct,
        "statement_ref": statement_ref,
        "memo": memo,
    }


ORIGINAL_ID = "j-orig"
REVERSAL_ID = "j-rev"
ORIGINAL_NO = "記-2026-10-0001"


def original_voucher(entry_layer="OPERATIONAL", lines=None) -> dict:
    """The posted original as build_reversal_lines receives it (the fields it
    reads: entity_code, voucher_no, entry_layer, lines metadata)."""
    if lines is None:
        lines = [
            stored_line(1, "6100", "100.0000", "0.0000", account_name="管理及營運費用",
                        memo="辦公室租金", counterparty="宏達有限公司"),
            stored_line(2, "2110", "0.0000", "100.0000", account_name="應付帳款及應計費用"),
        ]
    return {
        "journal_id": ORIGINAL_ID,
        "entity_code": "ACME",
        "voucher_no": ORIGINAL_NO,
        "entry_layer": entry_layer,
        "lines": lines,
    }


def original_rows(**kw) -> list:
    return [
        ledger_row("l-orig-1", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                   account_name="管理及營運費用", memo="辦公室租金",
                   counterparty_id="cp-001", counterparty_name="宏達有限公司", **kw),
        ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000",
                   account_name="應付帳款及應計費用", **kw),
    ]


async def run_build_reversal(name: str, original: dict, rows: list, reason: str = "") -> None:
    inp = {"op": "build_reversal_lines", "reason": reason, "original": original, "rows": rows}
    await _reset_tables()
    await _seed_lines(rows)
    try:
        lines = await build_reversal_lines(original, reason=reason)
    except PostingError as exc:
        write("vouchers", name, inp, error=posting_error_kind(exc))
        return
    write("vouchers", name, inp, output=lines)


async def gen_build_reversal() -> None:
    await run_build_reversal("build_reversal_same_currency",
                             original_voucher(), original_rows())
    await run_build_reversal("build_reversal_with_reason",
                             original_voucher(), original_rows(), reason="錯誤重開")
    await run_build_reversal("build_reversal_aje_layer",
                             original_voucher(entry_layer="AJE_MONTH_END"),
                             original_rows(layer="AJE_MONTH_END"))
    await run_build_reversal("build_reversal_fx",
                             original_voucher(),
                             [
                                 ledger_row("l-fx-1", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                            func_debit="780.0000", func_credit="0.0000",
                                            currency="USD", rate="7.80000000",
                                            account_name="管理及營運費用", memo="辦公室租金"),
                                 ledger_row("l-fx-2", ORIGINAL_ID, 2, "1210", "0.0000", "100.0000",
                                            func_debit="0.0000", func_credit="780.0000",
                                            currency="USD", rate="7.80000000",
                                            account_name="應收帳款"),
                             ])
    # Metadata merge: the voucher line's tax_code survives; the row's
    # counterparty_name lands under the voucher-line key.
    await run_build_reversal("build_reversal_metadata_merge",
                             original_voucher(lines=[
                                 stored_line(1, "6100", "100.0000", "0.0000",
                                             account_name="管理及營運費用", memo="辦公室租金",
                                             tax_code="TX-001", counterparty="舊名稱"),
                                 stored_line(2, "2110", "0.0000", "100.0000"),
                             ]),
                             original_rows())
    await run_build_reversal("build_reversal_no_lines", original_voucher(), [])
    await run_build_reversal("build_reversal_entity_mismatch",
                             original_voucher(), original_rows(entity="OTHER"))
    await run_build_reversal("build_reversal_layer_mismatch",
                             original_voucher(), original_rows(layer="AJE_MONTH_END"))
    await run_build_reversal("build_reversal_missing_layer",
                             original_voucher(entry_layer=None), original_rows())
    await run_build_reversal("build_reversal_missing_account_code",
                             original_voucher(),
                             [ledger_row("l-blank", ORIGINAL_ID, 1, "", "100.0000", "0.0000"),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_missing_currency",
                             original_voucher(),
                             [ledger_row("l-nocur", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                         currency=""),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_missing_rate",
                             original_voucher(),
                             [ledger_row("l-norate", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                         rate=""),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_duplicate_line_number",
                             original_voucher(),
                             [ledger_row("l-dup-1", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000"),
                              ledger_row("l-dup-2", ORIGINAL_ID, 1, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_unquantized_amount",
                             original_voucher(),
                             [ledger_row("l-frac", ORIGINAL_ID, 1, "6100", "5.00005", "0.0000"),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_zero_rate",
                             original_voucher(),
                             [ledger_row("l-rate0", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                         rate="0"),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_business_use_over_one",
                             original_voucher(),
                             [ledger_row("l-use", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                         use_pct="1.5000"),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    await run_build_reversal("build_reversal_business_use_negative",
                             original_voucher(),
                             [ledger_row("l-useneg", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                         use_pct="-0.1000"),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])
    # No signed-tax reversal policy: a nonzero persisted functional tax
    # amount fails closed (BL-03 remediation boundary).
    await run_build_reversal("build_reversal_nonzero_tax",
                             original_voucher(),
                             [ledger_row("l-tax", ORIGINAL_ID, 1, "6100", "100.0000", "0.0000",
                                         func_tax="12.0000"),
                              ledger_row("l-orig-2", ORIGINAL_ID, 2, "2110", "0.0000", "100.0000")])


def journal_entry_seed(journal_id: str, *, entity: str = "ACME", status: str = "POSTED",
                       source_module: str = "MANUAL", currency: str = "HKD",
                       total_debit: str = "100.0000", total_credit: str = "100.0000",
                       voucher_no: str | None = ORIGINAL_NO,
                       reversal_of: str | None = None,
                       entry_layer: str | None = "OPERATIONAL") -> dict:
    return {
        "journal_id": journal_id,
        "revision": 1,
        "entity_code": entity,
        "source_module": source_module,
        "status": status,
        "accounting_date": "2026-10-05",
        "currency": currency,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "created_by_principal_key": "ap-bot-01",
        "created_by_principal_id": "11111111-1111-1111-1111-111111111111",
        "voucher_no": voucher_no,
        "period": "2026-10",
        "memo": "辦公室租金",
        "reversal_of_journal_id": reversal_of,
        "entry_layer": entry_layer,
        "created_at": datetime(2026, 10, 1, 9, 0, 0),
    }


def reversal_draft(**kw) -> dict:
    """A valid reversal draft for the base original, as the reviewer submits
    it (the fields _reversal_original reads)."""
    draft = {
        "journal_id": REVERSAL_ID,
        "entity_code": "ACME",
        "source_module": "REVERSAL",
        "status": "PENDING_CHECKER",
        "currency": "HKD",
        "total_debit": "100.0000",
        "total_credit": "100.0000",
        "reversal_of_journal_id": ORIGINAL_ID,
        "lines": [
            {"line_number": 1, "account_code": "6100", "debit": "0.0000",
             "credit": "100.0000", "func_debit": "0.0000", "func_credit": "100.0000"},
            {"line_number": 2, "account_code": "2110", "debit": "100.0000",
             "credit": "0.0000", "func_debit": "100.0000", "func_credit": "0.0000"},
        ],
    }
    draft.update(kw)
    return draft


async def run_validate_reversal(name: str, current: dict, original_seed: dict | None) -> None:
    await _reset_tables()
    original_record = None
    if original_seed is not None:
        async with SESSION() as session, session.begin():
            session.add(JournalEntryModel(**original_seed))
        async with SESSION() as session:
            original_record = await repo.get_journal(original_seed["journal_id"], session=session)
    inp = {"op": "validate_reversal", "current": current, "original": original_record}
    try:
        async with SESSION() as session:
            original = await _reversal_original(current, session)
    except PostingError as exc:
        write("vouchers", name, inp, error=posting_error_kind(exc))
        return
    write("vouchers", name, inp,
          output={"original_journal_id": original["journal_id"]} if original else None)


async def gen_validate_reversal() -> None:
    await run_validate_reversal("reversal_valid", reversal_draft(),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal(
        "reversal_valid_fx", reversal_draft(
            total_debit="780.0000", total_credit="780.0000",
            lines=[
                {"line_number": 1, "account_code": "6100", "debit": "0.0000",
                 "credit": "100.0000", "func_debit": "0.0000", "func_credit": "780.0000"},
                {"line_number": 2, "account_code": "1210", "debit": "100.0000",
                 "credit": "0.0000", "func_debit": "780.0000", "func_credit": "0.0000"},
            ]),
        journal_entry_seed(ORIGINAL_ID, total_debit="780.0000", total_credit="780.0000"))
    await run_validate_reversal("reversal_not_a_reversal",
                                reversal_draft(source_module="AP",
                                               reversal_of_journal_id=None),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal("reversal_unlinked_reversal_module",
                                reversal_draft(reversal_of_journal_id=None),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal("reversal_original_missing",
                                reversal_draft(reversal_of_journal_id="j-nope"),
                                None)
    await run_validate_reversal("reversal_cross_entity",
                                reversal_draft(reversal_of_journal_id="j-other"),
                                journal_entry_seed("j-other", entity="OTHER"))
    # Reversing a posted reversal is refused (reference behaviour, BL-03).
    await run_validate_reversal("reversal_of_reversal_link",
                                reversal_draft(reversal_of_journal_id="j-rev1"),
                                journal_entry_seed("j-rev1", source_module="REVERSAL",
                                                   reversal_of=ORIGINAL_ID))
    await run_validate_reversal("reversal_of_reversal_module",
                                reversal_draft(reversal_of_journal_id="j-rev1"),
                                journal_entry_seed("j-rev1", source_module="REVERSAL"))
    await run_validate_reversal("reversal_original_not_posted",
                                reversal_draft(),
                                journal_entry_seed(ORIGINAL_ID, status="PENDING_CHECKER"))
    await run_validate_reversal("reversal_currency_mismatch",
                                reversal_draft(currency="USD"),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal("reversal_totals_mismatch",
                                reversal_draft(total_debit="101.0000"),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal("reversal_duplicate_line_numbers",
                                reversal_draft(lines=[
                                    {"line_number": 1, "account_code": "6100",
                                     "debit": "0.0000", "credit": "100.0000",
                                     "func_debit": "0.0000", "func_credit": "100.0000"},
                                    {"line_number": 1, "account_code": "2110",
                                     "debit": "100.0000", "credit": "0.0000",
                                     "func_debit": "100.0000", "func_credit": "0.0000"},
                                ]),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal("reversal_empty_account_code",
                                reversal_draft(lines=[
                                    {"line_number": 1, "account_code": "",
                                     "debit": "0.0000", "credit": "100.0000",
                                     "func_debit": "0.0000", "func_credit": "100.0000"},
                                    {"line_number": 2, "account_code": "2110",
                                     "debit": "100.0000", "credit": "0.0000",
                                     "func_debit": "100.0000", "func_credit": "0.0000"},
                                ]),
                                journal_entry_seed(ORIGINAL_ID))
    await run_validate_reversal("reversal_no_lines",
                                reversal_draft(lines=[]),
                                journal_entry_seed(ORIGINAL_ID))


async def run_mirror(name: str, original_rows_in: list, reversal_rows_in: list) -> None:
    inp = {"op": "validate_reversal_mirror",
           "original_rows": original_rows_in, "reversal_rows": reversal_rows_in}
    await _reset_tables()
    await _seed_lines(original_rows_in + reversal_rows_in)
    try:
        async with SESSION() as session:
            await _validate_reversal_lines({"journal_id": REVERSAL_ID},
                                           {"journal_id": ORIGINAL_ID}, session)
    except PostingError as exc:
        write("vouchers", name, inp, error=posting_error_kind(exc))
        return
    write("vouchers", name, inp, output={"ok": True})


async def gen_mirror() -> None:
    swapped = [
        ledger_row("l-rev-1", REVERSAL_ID, 1, "6100", "0.0000", "100.0000",
                   account_name="管理及營運費用", memo="辦公室租金"),
        ledger_row("l-rev-2", REVERSAL_ID, 2, "2110", "100.0000", "0.0000",
                   account_name="應付帳款及應計費用"),
    ]
    await run_mirror("mirror_valid", original_rows(), swapped)
    # Decimal equality is numeric: "100" and "100.0000" are one signature key.
    scaled = [
        ledger_row("l-rev-1", REVERSAL_ID, 1, "6100", "0", "100",
                   account_name="管理及營運費用", memo="辦公室租金"),
        ledger_row("l-rev-2", REVERSAL_ID, 2, "2110", "100.0", "0.000",
                   account_name="應付帳款及應計費用"),
    ]
    await run_mirror("mirror_scale_insensitive", original_rows(), scaled)
    amount_off = [
        ledger_row("l-rev-1", REVERSAL_ID, 1, "6100", "0.0000", "101.0000",
                   account_name="管理及營運費用", memo="辦公室租金"),
        ledger_row("l-rev-2", REVERSAL_ID, 2, "2110", "100.0000", "0.0000",
                   account_name="應付帳款及應計費用"),
    ]
    await run_mirror("mirror_amount_mismatch", original_rows(), amount_off)
    currency_off = [
        ledger_row("l-rev-1", REVERSAL_ID, 1, "6100", "0.0000", "100.0000",
                   currency="USD", account_name="管理及營運費用", memo="辦公室租金"),
        ledger_row("l-rev-2", REVERSAL_ID, 2, "2110", "100.0000", "0.0000",
                   account_name="應付帳款及應計費用"),
    ]
    await run_mirror("mirror_currency_mismatch", original_rows(), currency_off)
    layer_off = [
        ledger_row("l-rev-1", REVERSAL_ID, 1, "6100", "0.0000", "100.0000",
                   layer="AJE_MONTH_END", account_name="管理及營運費用", memo="辦公室租金"),
        ledger_row("l-rev-2", REVERSAL_ID, 2, "2110", "100.0000", "0.0000",
                   account_name="應付帳款及應計費用"),
    ]
    await run_mirror("mirror_layer_mismatch", original_rows(), layer_off)
    await run_mirror("mirror_no_original_rows", [], swapped)


# ---------------------------------------------------------------------------
# Submitted-snapshot guard (posting.py:212 over the frozen SNAPSHOT_FIELDS)
# ---------------------------------------------------------------------------

BASE_JOURNAL = {
    "journal_id": "j-1",
    "revision": 3,
    "entity_code": "ACME",
    "source_module": "AP",
    "status": "PENDING_CHECKER",
    "accounting_date": "2026-10-05",
    "currency": "HKD",
    "period": "2026-10",
    "total_debit": "100.0000",
    "total_credit": "100.0000",
    "created_by_principal_key": "ap-bot-01",
    "created_by_principal_id": "11111111-1111-1111-1111-111111111111",
    "lines": [
        stored_line(1, "6100", "100.0000", "0.0000", account_name="管理及營運費用",
                    memo="辦公室租金", counterparty="宏達有限公司"),
        stored_line(2, "2110", "0.0000", "100.0000", account_name="應付帳款及應計費用"),
    ],
    "entry_layer": "OPERATIONAL",
    "basis": "EXTRACTED",
    "memo": "辦公室租金",
    "evidence_uris": ["s3://evidence/inv-001.pdf"],
    "reversal_of_journal_id": None,
    "proposal_json": None,
    "ai_confidence_score": "0.9700",
    "ai_reasoning_summary": "extracted from invoice",
    "voucher_no": None,
}


def changed_fields(submitted: dict, current: dict) -> list:
    """post_voucher's snapshot comparison (posting.py:212) over the frozen
    SNAPSHOT_FIELDS constant."""
    return [f for f in SNAPSHOT_FIELDS if submitted.get(f) != current.get(f)]


def snapshot_case(name: str, mutate, expect_changed: list, kind: str | None = None) -> None:
    submitted = json.loads(json.dumps(BASE_JOURNAL))
    current = json.loads(json.dumps(BASE_JOURNAL))
    mutate(current)
    got = changed_fields(submitted, current)
    assert got == expect_changed, f"{name}: reference changed {got}, expected {expect_changed}"
    inp = {"op": "snapshot_check", "submitted": submitted, "current": current}
    if expect_changed:
        write("vouchers", name + "_refused", inp, error="VOUCHER_SNAPSHOT_CHANGED")
        write("vouchers", name + "_fields",
              {"op": "snapshot_changed_fields", "submitted": submitted, "current": current},
              output={"changed_fields": got})
    else:
        write("vouchers", name, inp, output={"ok": True})
        write("vouchers", name + "_fields",
              {"op": "snapshot_changed_fields", "submitted": submitted, "current": current},
              output={"changed_fields": []})


def gen_snapshot() -> None:
    snapshot_case("snapshot_identical", lambda j: None, [])
    snapshot_case("snapshot_total_debit_changed",
                  lambda j: j.update(total_debit="101.0000"), ["total_debit"])
    # Textual drift on a money string is a change (the reference compares the
    # stored strings, not numeric values).
    snapshot_case("snapshot_total_scale_text_changed",
                  lambda j: j.update(total_debit="100.000"), ["total_debit"])
    snapshot_case("snapshot_two_fields_changed",
                  lambda j: j.update(accounting_date="2026-10-06", memo="另一張"),
                  ["accounting_date", "memo"])
    snapshot_case("snapshot_lines_amount_changed",
                  lambda j: j["lines"][0].update(debit="100.0001"), ["lines"])
    snapshot_case("snapshot_line_added",
                  lambda j: j["lines"].append(stored_line(3, "2210", "0.0000", "0.0001")),
                  ["lines"])
    snapshot_case("snapshot_reversal_link_set",
                  lambda j: j.update(reversal_of_journal_id="j-orig"),
                  ["reversal_of_journal_id"])
    # Reviewers may change review metadata and status — not snapshot fields.
    snapshot_case("snapshot_status_and_review_notes_changed",
                  lambda j: j.update(status="AWAITING_CPA", review_notes="checked"), [])


# ---------------------------------------------------------------------------
# Lifecycle transition map — copied VERBATIM from repository.save_journal
# (backend/app/core/repository.py:395–409); the dict is a local there.
# ---------------------------------------------------------------------------

SAVE_TRANSITIONS = {
    "DRAFT": {"DRAFT", "PENDING_CHECKER", "VOID"},
    "REJECTED": {"REJECTED", "DRAFT", "PENDING_CHECKER", "VOID"},
    "PENDING_CHECKER": {"PENDING_CHECKER", "AWAITING_CPA", "REJECTED"},
    "AWAITING_CPA": {"AWAITING_CPA", "REJECTED"},
}
FINALIZED_STATUSES = ("POSTED", "REVERSED", "VOID")
POSTABLE_STATUSES = ("PENDING_CHECKER", "AWAITING_CPA")  # posting.py:208


def allowed_save_transitions(current: str) -> list:
    if current in FINALIZED_STATUSES:
        out = {current}
        if current == "POSTED":
            out.add("REVERSED")
        return sorted(out)
    return sorted(SAVE_TRANSITIONS.get(current, set()))


def can_save_transition(current: str, proposed: str) -> bool:
    if current in FINALIZED_STATUSES:
        return proposed == current or (current == "POSTED" and proposed == "REVERSED")
    return proposed in SAVE_TRANSITIONS.get(current, set())


def finalized_save_allowed(current: str, proposed: str, content_changed: bool) -> bool:
    """The finalized branch: no field except status may change, and the only
    status change is the status-only POSTED→REVERSED reversal."""
    if content_changed:
        return False
    return can_save_transition(current, proposed)


def gen_transitions() -> None:
    states = ["DRAFT", "REJECTED", "PENDING_CHECKER", "AWAITING_CPA",
              "POSTED", "REVERSED", "VOID"]
    for current in states:
        write("vouchers", f"allowed_save_transitions_{current.lower()}",
              {"op": "allowed_save_transitions", "from": current},
              output=allowed_save_transitions(current))
    pairs = [
        ("DRAFT", "DRAFT"), ("DRAFT", "PENDING_CHECKER"), ("DRAFT", "VOID"),
        ("DRAFT", "POSTED"), ("DRAFT", "REJECTED"),
        ("REJECTED", "DRAFT"), ("REJECTED", "PENDING_CHECKER"), ("REJECTED", "VOID"),
        ("REJECTED", "REJECTED"), ("REJECTED", "POSTED"),
        ("PENDING_CHECKER", "AWAITING_CPA"), ("PENDING_CHECKER", "REJECTED"),
        ("PENDING_CHECKER", "POSTED"), ("PENDING_CHECKER", "DRAFT"),
        ("AWAITING_CPA", "REJECTED"), ("AWAITING_CPA", "PENDING_CHECKER"),
        ("POSTED", "REVERSED"), ("POSTED", "DRAFT"), ("POSTED", "POSTED"),
        ("REVERSED", "REVERSED"), ("REVERSED", "POSTED"),
        ("VOID", "VOID"), ("VOID", "DRAFT"),
    ]
    for current, proposed in pairs:
        name = (f"can_save_{current.lower()}_to_{proposed.lower()}"
                if current != proposed else f"can_save_{current.lower()}_stays")
        write("vouchers", name,
              {"op": "can_save_transition", "from": current, "to": proposed},
              output=can_save_transition(current, proposed))
    finalized_cases = [
        ("finalized_save_posted_stays", "POSTED", "POSTED", False),
        ("finalized_save_posted_reversal", "POSTED", "REVERSED", False),
        ("finalized_save_posted_edited", "POSTED", "POSTED", True),
        ("finalized_save_posted_to_draft", "POSTED", "DRAFT", False),
        ("finalized_save_reversed_stays", "REVERSED", "REVERSED", False),
        ("finalized_save_reversed_edited", "REVERSED", "REVERSED", True),
        ("finalized_save_reversed_reopen", "REVERSED", "POSTED", False),
        ("finalized_save_void_stays", "VOID", "VOID", False),
        ("finalized_save_void_to_draft", "VOID", "DRAFT", False),
    ]
    for name, current, proposed, content_changed in finalized_cases:
        write("vouchers", name,
              {"op": "finalized_save", "current": current, "proposed": proposed,
               "content_changed": content_changed},
              output=finalized_save_allowed(current, proposed, content_changed))
    for status in states:
        write("vouchers", f"can_post_{status.lower()}",
              {"op": "can_post", "from": status},
              output=status in POSTABLE_STATUSES)


# ---------------------------------------------------------------------------
# BL-36 numbering — spec-derived (SRC-0017 owner decision 2026-10-21,
# SRC-0027 2026-10-24). No Python implementation exists; the expected values
# encode the owner decision: uniqueness and gap reporting are system-level
# guarantees, the neutral prefix-year-sequence default applies until the
# jurisdiction packs (REQ-0014 onward).
# ---------------------------------------------------------------------------


def gen_numbering() -> None:
    format_cases = [
        ("format_number_basic", "ACME", "2026-10", 1),
        ("format_number_sequence_two", "ACME", "2026-10", 2),
        ("format_number_quarterly_period", "ACME", "2026-Q3", 12),
        ("format_number_entity_not_rendered", "OTHER", "2026-10", 1),
        ("format_number_boundary_9999", "ACME", "2026-12", 9999),
        ("format_number_beyond_pad", "ACME", "2026-12", 10000),
    ]
    for name, entity, period, sequence in format_cases:
        number = f"JV-{period[:4]}-{sequence:04d}"
        write("vouchers", name,
              {"op": "format_voucher_number", "entity": entity, "period": period,
               "sequence": sequence},
              output=number)
    invalid_format_cases = [
        ("format_number_zero_sequence", "ACME", "2026-10", 0),
        ("format_number_negative_sequence", "ACME", "2026-10", -1),
        ("format_number_short_period", "ACME", "26-10", 1),
        ("format_number_empty_period", "ACME", "", 1),
        ("format_number_yearless_period", "ACME", "20261", 1),
        ("format_number_alpha_period", "ACME", "abcd-10", 1),
    ]
    for name, entity, period, sequence in invalid_format_cases:
        write("vouchers", name,
              {"op": "format_voucher_number", "entity": entity, "period": period,
               "sequence": sequence},
              error="VOUCHER_NUMBER_INVALID")

    gap_cases = [
        ("gaps_none", [], []),
        ("gaps_continuous_from_one", [1], []),
        ("gaps_first_missing", [2], [1]),
        ("gaps_middle", [1, 2, 4, 5], [3]),
        ("gaps_continuous_run", [1, 2, 3], []),
        ("gaps_high_start", [5], [1, 2, 3, 4]),
        ("gaps_single_high", [3], [1, 2]),
    ]
    for name, posted, gaps in gap_cases:
        write("vouchers", name, {"op": "report_gaps", "posted": posted},
              output={"gaps": gaps})
    invalid_gap_cases = [
        ("gaps_duplicate", [1, 1]),
        ("gaps_unsorted", [2, 1]),
        ("gaps_zero", [0]),
        ("gaps_negative", [-1]),
    ]
    for name, posted in invalid_gap_cases:
        write("vouchers", name, {"op": "report_gaps", "posted": posted},
              error="VOUCHER_GAP_REPORT_INVALID")


async def gen_all() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    gen_q4()
    gen_normal_balance()
    gen_account_classification()
    gen_parse_lines()
    gen_assert_balanced()
    gen_to_proposed_lines()
    await gen_build_reversal()
    await gen_validate_reversal()
    await gen_mirror()
    gen_snapshot()
    gen_transitions()
    gen_numbering()


def main() -> None:
    asyncio.run(gen_all())
    print(f"generated {COUNTS['vouchers']} vouchers fixtures under {OUT / 'vouchers'}")


if __name__ == "__main__":
    main()
