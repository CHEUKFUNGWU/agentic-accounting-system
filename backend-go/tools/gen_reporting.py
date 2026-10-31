#!/usr/bin/env python3
"""Generate golden fixtures for the reporting module (REQ-0035 P1).

The frozen Python reference (backend/app/core/reporting.py) is the source of
every expected value: this script drives generate_reporting_pack — pure over
its TrialBalanceAccountRow inputs — and records the statement slices. Rows
for the cash-flow cases come from the reference's own
trial_balance_from_ledger, served by the same in-memory fake session
machinery tools/gen_ledger.py uses (the SQL WHERE clauses the reference
issues are applied to the seeded rows; everything else is the reference's
own code running unmodified).

Finding defect scenarios are NOT exercised here — they are excluded from
the golden baseline by design (ADR-0002 D3) and pinned by the Go
regression tests TestBL12_*, TestBL13_*, TestBL14_*, TestBL17_*, TestBL18_*
and TestBL20_* instead:

  - BL-12: every seeded entry's movements are cash-settled or symmetric
    noncash accruals, so the reference's cash-flow derivation is correct.
  - BL-13: no INVENTORY (or other unmapped) category appears in any row set.
  - BL-14: every P&L row's opening balance is zero — the cases where the
    reference's all-time adjusted ending coincides with the window's
    activity. The decided window semantics belong to the ledger package's
    fiscal.go and the Go regressions.
  - BL-18: no compound entry mixes a cash leg with noncash legs in these
    seeds; the BL-18-shaped scenario lives only in the Go regressions.
  - BL-20: tax fixtures carry a zero prepayment balance, so the reference's
    fabricated input-credit boxes evaluate to 0.0000 and stay encodable; CA
    and UK (the AU-fallback defect) never appear.

Run (from the backend directory):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_reporting.py

Output: backend-go/fixtures/reporting/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.
"""

from __future__ import annotations

import asyncio
import json
import sys
from decimal import Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures" / "reporting"
sys.path.insert(0, str(REPO / "backend"))

from sqlalchemy.sql import operators as sa_ops
from sqlalchemy.sql.elements import BinaryExpression, BooleanClauseList

from app.core import ledger as L
from app.core.db import ChartOfAccountsModel, FiscalPeriodModel, JournalLineModel
from app.core.localization import q4
from app.core.reporting import (
    EntityLegalStructure,
    StandaloneWorkingPaperEngine,
    TrialBalanceAccountRow,
)

# ---------------------------------------------------------------------------
# Fake session: serves the seeded rows for exactly the queries ledger.py
# issues (mirrors tools/gen_ledger.py; see that file for the reasoning).
# ---------------------------------------------------------------------------


def _conditions(clause):
    if clause is None:
        return
    if isinstance(clause, BooleanClauseList):
        for c in clause.clauses:
            yield from _conditions(c)
    elif isinstance(clause, BinaryExpression):
        yield clause


class _AsyncResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeBegin:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *exc):
        return False


class _FakeSession:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def begin(self):
        return _FakeBegin()

    def add(self, obj):
        pass  # ensure_period's insert; the row is built and returned in-memory

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def get(self, model, pk, **kw):
        if model is ChartOfAccountsModel:
            for a in self._db.chart:
                if a.account_id == pk:
                    return a
            return None
        if model is FiscalPeriodModel:
            for p in self._db.periods:
                if p.period_id == pk:
                    return p
            return None
        raise AssertionError(f"unexpected session.get({model.__name__}, {pk!r})")

    async def execute(self, stmt):
        entity = stmt.column_descriptions[0]["entity"]
        if entity is ChartOfAccountsModel:
            rows = self._apply(list(self._db.chart), stmt)
            rows.sort(key=lambda a: a.account_code)  # ORDER BY account_code
            return _AsyncResult(rows)
        if entity is JournalLineModel:
            rows = self._apply(list(self._db.lines), stmt)
            # ORDER BY accounting_date, line_number
            rows.sort(key=lambda r: (r.accounting_date, r.line_number))
            limit = getattr(stmt._limit_clause, "value", None)
            if limit:
                rows = rows[:limit]
            return _AsyncResult(rows)
        raise AssertionError(f"unexpected select over {entity.__name__}")

    @staticmethod
    def _apply(rows, stmt):
        for cond in _conditions(stmt.whereclause):
            col = cond.left.name
            val = getattr(cond.right, "value", None)
            op = cond.operator
            if op is sa_ops.eq:
                rows = [r for r in rows if getattr(r, col) == val]
            elif op is sa_ops.ge:
                rows = [r for r in rows if getattr(r, col) >= val]
            elif op is sa_ops.le:
                rows = [r for r in rows if getattr(r, col) <= val]
            else:
                raise AssertionError(f"unhandled condition on {col}: {cond!r}")
        return rows


class _FakeDBManager:
    def __init__(self, periods=(), chart=(), lines=(), counterparties=()):
        self.periods = list(periods)
        self.chart = list(chart)
        self.lines = list(lines)
        self.counterparties = list(counterparties)

    def session_factory(self):
        return _FakeSession(self)


# ---------------------------------------------------------------------------
# Seed builders: the seed dicts are the single source — they feed the fake
# models for the reference AND serialize into the fixture input for the Go
# replay, so the two can never drift.
# ---------------------------------------------------------------------------


def account_seed(**kw):
    d = {
        "entity_code": "DEMO", "parent_account_id": None, "account_code": "", "account_name": "",
        "account_type": "", "normal_balance": "", "fs_category": "", "statement_ref": "TB",
        "cash_flow_activity": "OPERATING_WC", "is_control_account": False,
        "allow_manual_je": True, "tax_code_default": None, "is_active": True,
    }
    d.update(kw)
    d.setdefault("account_id", f"{d['entity_code']}:{d['account_code']}")
    return d


def account_model(seed):
    kw = dict(seed)
    # The model column is default_statement_ref; the dict/JSON key is
    # statement_ref (as _account_dict renders it).
    kw["default_statement_ref"] = kw.pop("statement_ref", "TB")
    return ChartOfAccountsModel(**kw)


def line_seed(**kw):
    d = {
        "line_id": "", "journal_id": "", "entity_code": "DEMO", "line_number": 1,
        "account_id": None, "account_code": "", "account_name": "", "period_code": "",
        "entry_layer": "OPERATIONAL", "accounting_date": "", "tx_currency": "",
        "exchange_rate": "1.00000000", "tx_debit": "0.0000", "tx_credit": "0.0000",
        "func_debit": "0.0000", "func_credit": "0.0000", "counterparty_id": None,
        "counterparty_name": "", "tax_code_id": None, "func_tax_amount": "0.0000",
        "business_use_pct": "1.0000", "statement_ref": "", "memo": "",
    }
    d.update(kw)
    d.setdefault("account_id", f"{d['entity_code']}:{d['account_code']}")
    return d


def line_model(seed):
    return JournalLineModel(**seed)


def acc(code, name, atype, nb, cat, **kw):
    return account_seed(
        account_code=code, account_name=name, account_type=atype,
        normal_balance=nb, fs_category=cat, **kw
    )


def ln(journal, no, code, layer, date, dr, cr):
    return line_seed(
        line_id=f"{journal}-L{no}", journal_id=journal, line_number=no,
        account_code=code, account_name=code, period_code=date[:7],
        entry_layer=layer, accounting_date=date,
        tx_debit=dr, tx_credit=cr, func_debit=dr, func_credit=cr,
    )


def row(code, name, atype, cat, opening, op_dr, op_cr, aj_dr="0.0000", aj_cr="0.0000"):
    return TrialBalanceAccountRow(
        account_code=code, account_name=name, account_type=atype, fs_category=cat,
        statement_ref="TB", cash_flow_activity="OPERATING_WC",
        opening_balance=q4(Decimal(opening)),
        period_op_debit=q4(Decimal(op_dr)),
        period_op_credit=q4(Decimal(op_cr)),
        adjustment_debit=q4(Decimal(aj_dr)),
        adjustment_credit=q4(Decimal(aj_cr)),
    )


def row_dict(r):
    return {
        "account_code": r.account_code,
        "account_name": r.account_name,
        "account_type": r.account_type,
        "fs_category": r.fs_category,
        "statement_ref": r.statement_ref,
        "cash_flow_activity": r.cash_flow_activity,
        "opening_balance": str(r.opening_balance),
        "period_op_debit": str(r.period_op_debit),
        "period_op_credit": str(r.period_op_credit),
        "adjustment_debit": str(r.adjustment_debit),
        "adjustment_credit": str(r.adjustment_credit),
    }


def write(name: str, case_input: dict, output) -> None:
    doc = {"module": "reporting", "case": name, "input": case_input, "output": output}
    path = OUT / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def pack_of(rows, jurisdiction="HK", structure=EntityLegalStructure.SME_CORP,
            period="2026-10", currency="HKD"):
    return StandaloneWorkingPaperEngine.generate_reporting_pack(
        entity_code="DEMO", legal_name="Demo Limited", entity_structure=structure,
        jurisdiction=jurisdiction, accounting_standard="IFRS", currency=currency,
        period=period, trial_balance_accounts=rows,
    )


async def rows_from_ledger(chart_seeds, line_seeds, period_code):
    """The reference's own row derivation, over the fake session."""
    L.db_manager = _FakeDBManager(
        chart=[account_model(s) for s in chart_seeds],
        lines=[line_model(s) for s in line_seeds],
    )
    return await L.trial_balance_from_ledger("DEMO", period_code)


# ---------------------------------------------------------------------------
# Row seeds (balanced; every P&L opening is zero — the BL-14 note above).
# ---------------------------------------------------------------------------

CASH_MONTH_ROWS = [
    row("1000", "銀行存款", "ASSET", "CASH", "5000.0000", "1200.0000", "300.0000"),
    row("3100", "實收資本及期初留存", "EQUITY", "EQUITY", "-5000.0000", "0.0000", "0.0000"),
    row("4100", "主營業務收入", "REVENUE", "REVENUE", "0.0000", "0.0000", "1200.0000"),
    row("6100", "管理及營運費用", "EXPENSE", "OPEX", "0.0000", "300.0000", "0.0000"),
]

MARGIN_THIRD_ROWS = [
    # P&L amounts ride the activity columns; the P&L openings stay zero
    # (the BL-14 parity condition).
    row("1000", "銀行存款", "ASSET", "CASH", "3.0000", "0.0000", "0.0000"),
    row("5100", "主營業務成本", "EXPENSE", "COGS", "0.0000", "2.0000", "0.0000"),
    row("4100", "主營業務收入", "REVENUE", "REVENUE", "0.0000", "0.0000", "3.0000"),
]

# Gross margin 49/400 = 12.25 exactly: the one-decimal render must round
# half-even to "12.2%", not half-up to "12.3%".
MARGIN_HALF_EVEN_ROWS = [
    row("1000", "銀行存款", "ASSET", "CASH", "400.0000", "0.0000", "0.0000"),
    row("5100", "主營業務成本", "EXPENSE", "COGS", "0.0000", "351.0000", "0.0000"),
    row("4100", "主營業務收入", "REVENUE", "REVENUE", "0.0000", "0.0000", "400.0000"),
]

DIRECTOR_ASSET_ROWS = [
    row("1000", "銀行存款", "ASSET", "CASH", "9200.0000", "0.0000", "0.0000"),
    row("2190", "業主往來", "LIABILITY", "DIRECTOR_LOAN", "800.0000", "0.0000", "0.0000"),
    row("3100", "實收資本及期初留存", "EQUITY", "EQUITY", "-10000.0000", "0.0000", "0.0000"),
]

DIRECTOR_LIABILITY_ROWS = [
    row("1000", "銀行存款", "ASSET", "CASH", "10800.0000", "0.0000", "0.0000"),
    row("2190", "業主往來", "LIABILITY", "DIRECTOR_LOAN", "-800.0000", "0.0000", "0.0000"),
    row("3100", "實收資本及期初留存", "EQUITY", "EQUITY", "-10000.0000", "0.0000", "0.0000"),
]

# Charts and entries for the cash-flow cases. Every movement is
# cash-settled or a symmetric noncash accrual, so the reference's
# derivation is correct on them (see the BL-12 note above).
CHART_ALL_CASH = [
    acc("1000", "銀行存款", "ASSET", "DEBIT", "CASH"),
    acc("1610", "固定資產原值", "ASSET", "DEBIT", "FIXED_ASSET"),
    acc("3100", "實收資本及期初留存", "EQUITY", "CREDIT", "EQUITY"),
    acc("4100", "主營業務收入", "REVENUE", "CREDIT", "REVENUE"),
    acc("5100", "主營業務成本", "EXPENSE", "DEBIT", "COGS"),
    acc("6100", "管理及營運費用", "EXPENSE", "DEBIT", "OPEX"),
]

LINES_ALL_CASH = [
    ln("J1", 1, "1000", "OPENING", "2026-09-30", "5000.0000", "0.0000"),
    ln("J1", 2, "3100", "OPENING", "2026-09-30", "0.0000", "5000.0000"),
    ln("J2", 1, "1000", "OPERATIONAL", "2026-10-05", "1200.0000", "0.0000"),
    ln("J2", 2, "4100", "OPERATIONAL", "2026-10-05", "0.0000", "1200.0000"),
    ln("J3", 1, "6100", "OPERATIONAL", "2026-10-12", "300.0000", "0.0000"),
    ln("J3", 2, "1000", "OPERATIONAL", "2026-10-12", "0.0000", "300.0000"),
    ln("J4", 1, "1610", "OPERATIONAL", "2026-10-20", "800.0000", "0.0000"),
    ln("J4", 2, "1000", "OPERATIONAL", "2026-10-20", "0.0000", "800.0000"),
]

CHART_WORKING_CAPITAL = [
    acc("1000", "銀行存款", "ASSET", "DEBIT", "CASH"),
    acc("1210", "應收帳款", "ASSET", "DEBIT", "AR", is_control_account=True, allow_manual_je=False),
    acc("1410", "預付費用及進項稅額", "ASSET", "DEBIT", "PREPAY_TAX"),
    acc("1650", "累計折舊", "ASSET", "CREDIT", "CONTRA_ASSET"),
    acc("2210", "應交稅費", "LIABILITY", "CREDIT", "TAX_PAYABLE", is_control_account=True, allow_manual_je=False),
    acc("3100", "實收資本及期初留存", "EQUITY", "CREDIT", "EQUITY"),
    acc("4100", "主營業務收入", "REVENUE", "CREDIT", "REVENUE"),
    acc("6100", "管理及營運費用", "EXPENSE", "DEBIT", "OPEX"),
    acc("6410", "折舊費用", "EXPENSE", "DEBIT", "DEPRECIATION"),
    acc("7500", "所得稅費用", "EXPENSE", "DEBIT", "TAX_EXPENSE"),
]

LINES_WORKING_CAPITAL = [
    ln("J1", 1, "1000", "OPENING", "2026-09-30", "5000.0000", "0.0000"),
    ln("J1", 2, "3100", "OPENING", "2026-09-30", "0.0000", "5000.0000"),
    # Credit sale 200, collected 150: AR 50 outstanding.
    ln("J2", 1, "1210", "OPERATIONAL", "2026-10-05", "200.0000", "0.0000"),
    ln("J2", 2, "4100", "OPERATIONAL", "2026-10-05", "0.0000", "200.0000"),
    ln("J3", 1, "1000", "OPERATIONAL", "2026-10-08", "150.0000", "0.0000"),
    ln("J3", 2, "1210", "OPERATIONAL", "2026-10-08", "0.0000", "150.0000"),
    # Prepay 100, amortize 40.
    ln("J4", 1, "1410", "OPERATIONAL", "2026-10-10", "100.0000", "0.0000"),
    ln("J4", 2, "1000", "OPERATIONAL", "2026-10-10", "0.0000", "100.0000"),
    ln("J5", 1, "6100", "AJE_MONTH_END", "2026-10-15", "40.0000", "0.0000"),
    ln("J5", 2, "1410", "AJE_MONTH_END", "2026-10-15", "0.0000", "40.0000"),
    # Accrue tax 30, pay it 30.
    ln("J6", 1, "7500", "AJE_MONTH_END", "2026-10-18", "30.0000", "0.0000"),
    ln("J6", 2, "2210", "AJE_MONTH_END", "2026-10-18", "0.0000", "30.0000"),
    ln("J7", 1, "2210", "OPERATIONAL", "2026-10-22", "30.0000", "0.0000"),
    ln("J7", 2, "1000", "OPERATIONAL", "2026-10-22", "0.0000", "30.0000"),
    # Depreciation 25.
    ln("J8", 1, "6410", "AJE_MONTH_END", "2026-10-25", "25.0000", "0.0000"),
    ln("J8", 2, "1650", "AJE_MONTH_END", "2026-10-25", "0.0000", "25.0000"),
]


# ---------------------------------------------------------------------------
# Case generators
# ---------------------------------------------------------------------------


def gen_trial_balance() -> int:
    pack = pack_of(CASH_MONTH_ROWS)
    write("trial_balance_cash_month",
          {"op": "trial_balance", "period": "2026-10", "currency": "HKD",
           "rows": [row_dict(r) for r in CASH_MONTH_ROWS]},
          {"rows": pack.trial_balance_rows, "totals": pack.trial_balance_totals})
    return 1


def gen_income_statement() -> int:
    count = 0
    for name, rows in [
        ("income_statement_cash_month", CASH_MONTH_ROWS),
        ("income_statement_margin_third", MARGIN_THIRD_ROWS),
        ("income_statement_margin_half_even", MARGIN_HALF_EVEN_ROWS),
    ]:
        pack = pack_of(rows)
        write(name,
              {"op": "income_statement", "period": "2026-10", "currency": "HKD",
               "rows": [row_dict(r) for r in rows]},
              pack.income_statement)
        count += 1
    return count


def gen_balance_sheet() -> int:
    count = 0
    cases = [
        ("balance_sheet_cash_month", CASH_MONTH_ROWS, EntityLegalStructure.SME_CORP),
        ("balance_sheet_sole_proprietor", CASH_MONTH_ROWS, EntityLegalStructure.SOLE_PROPRIETOR),
        ("balance_sheet_director_loan_asset", DIRECTOR_ASSET_ROWS, EntityLegalStructure.SME_CORP),
        ("balance_sheet_director_loan_liability", DIRECTOR_LIABILITY_ROWS, EntityLegalStructure.SME_CORP),
    ]
    for name, rows, structure in cases:
        pack = pack_of(rows, structure=structure)
        write(name,
              {"op": "balance_sheet", "period": "2026-10", "currency": "HKD",
               "entity_structure": structure.value,
               "rows": [row_dict(r) for r in rows]},
              pack.balance_sheet)
        count += 1
    return count


def gen_cash_flow() -> int:
    async def one(name, chart, lines):
        rows = await rows_from_ledger(chart, lines, "2026-10")
        pack = pack_of(rows)
        write(name,
              {"op": "cash_flow", "period_code": "2026-10", "period": "2026-10",
               "currency": "HKD", "entity_structure": EntityLegalStructure.SME_CORP.value,
               "chart": chart, "lines": lines},
              pack.cash_flow_statement)

    asyncio.run(one("cash_flow_all_cash_month", CHART_ALL_CASH, LINES_ALL_CASH))
    asyncio.run(one("cash_flow_working_capital_month", CHART_WORKING_CAPITAL, LINES_WORKING_CAPITAL))
    return 2


def gen_tax_schedule() -> int:
    count = 0
    for name, jurisdiction in [
        ("tax_hk", "HK"),
        ("tax_us", "US"),
        ("tax_au_prepay_zero", "AU"),
        ("tax_sg_prepay_zero", "SG"),
        ("tax_cn_prepay_zero", "CN"),
    ]:
        pack = pack_of(CASH_MONTH_ROWS, jurisdiction=jurisdiction)
        write(name,
              {"op": "tax_schedule", "period": "2026-10", "currency": "HKD",
               "jurisdiction": jurisdiction,
               "rows": [row_dict(r) for r in CASH_MONTH_ROWS]},
              pack.statutory_tax_schedule)
        count += 1
    return count


def main() -> None:
    total = (
        gen_trial_balance()
        + gen_income_statement()
        + gen_balance_sheet()
        + gen_cash_flow()
        + gen_tax_schedule()
    )
    print(f"generated {total} reporting fixtures under {OUT}")


if __name__ == "__main__":
    main()
