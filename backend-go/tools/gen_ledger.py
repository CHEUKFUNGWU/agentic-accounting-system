#!/usr/bin/env python3
"""Generate golden fixtures for the ledger module (REQ-0035 P1).

The frozen Python reference (backend/app/core/ledger.py) is the source of
every expected value: this script imports it and records what it returns.
ledger.py mixes pure rules with SQLAlchemy session code, so the generator
serves the reference's queries from an in-memory fake session — the SQL WHERE
clauses the reference issues are applied to the seeded rows, and everything
else (validation, derivation, arithmetic, message construction) is the
reference's own code running unmodified.

Known defects and decided semantics are NOT exercised here:
  - The BL-30 creation path: resolve_counterparty fixtures cover lookup of
    EXISTING counterparties only; a name variant that would make the reference
    create (and crash on the slug collision) never appears. The lookup-only
    rule and the "Acme Pty Ltd" / "ACME Pty Ltd." scenario are pinned by the
    Go regression test TestBL30_no_implicit_counterparty_creation.
  - The BL-14 defect scenarios (prior-fiscal-year revenue inside a later
    report's opening; P&L profit versus cash-flow starting profit). The
    decided semantics are owner-decided Go functions (fiscal.go) with
    TestBL14_* regression tests, excluded from golden parity by design
    (ADR-0002 D3).
  - The BL-18 compound-entry cash-bucket scenario (reporting package scope):
    seeded cash-flow entries are simple two-legged postings.
  - write_lines_for_entry is not fixture-generated: it stamps line ids with
    uuid4, so its output is not deterministic.

Run (from the backend directory):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_ledger.py

Output: backend-go/fixtures/ledger/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import datetime
from decimal import InvalidOperation
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures" / "ledger"
sys.path.insert(0, str(REPO / "backend"))

from sqlalchemy.sql import operators as sa_ops
from sqlalchemy.sql.elements import BinaryExpression, BooleanClauseList

from app.core import ledger as L
from app.core.db import (
    ChartOfAccountsModel,
    CounterpartyModel,
    FiscalPeriodModel,
    JournalLineModel,
)
from app.core.repository import repo

# ---------------------------------------------------------------------------
# Fake session: serves the seeded rows for exactly the queries ledger.py
# issues. The WHERE clauses are read back out of each statement and applied to
# the seeds, so the reference's own query construction decides what matches.
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

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)


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
        return _FakeBegin()  # transaction_session enters `owned.begin()`

    async def get(self, model, pk, **kw):
        if model is FiscalPeriodModel:
            for p in self._db.periods:
                if p.period_id == pk:
                    return p
            return None
        if model is ChartOfAccountsModel:
            for a in self._db.chart:
                if a.account_id == pk:
                    return a
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
        if entity is FiscalPeriodModel:
            rows = self._apply(list(self._db.periods), stmt)
            rows.sort(key=lambda p: p.period_code)  # ORDER BY period_code
            return _AsyncResult(rows)
        if entity is CounterpartyModel:
            rows = self._apply(list(self._db.counterparties), stmt)
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
            elif isinstance(val, (list, tuple, set)):  # notin_(("OPEN", "SOFT_CLOSE"))
                rows = [r for r in rows if getattr(r, col) not in val]
            else:
                raise AssertionError(f"unhandled condition on {col}: {cond!r}")
        return rows

    def add(self, obj):
        pass  # ensure_period's insert; the row is built and returned in-memory

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def delete(self, obj):
        pass


class _FakeDBManager:
    def __init__(self, periods=(), chart=(), lines=(), counterparties=()):
        self.periods = list(periods)
        self.chart = list(chart)
        self.lines = list(lines)
        self.counterparties = list(counterparties)

    def session_factory(self):
        return _FakeSession(self)


# ---------------------------------------------------------------------------
# Seed builders: JSON-able dicts are the single source; models are built from
# them so fixture input and fake rows can never drift.
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


def period_seed(**kw):
    d = {
        "entity_code": "DEMO", "period_code": "", "fiscal_year": 0, "period_number": 0,
        "start_date": "", "end_date": "", "status": "OPEN",
        "closed_by_principal_key": None, "closed_at": None,
    }
    d.update(kw)
    d.setdefault("period_id", f"{d['entity_code']}:{d['period_code']}")
    return d


def period_model(seed):
    kw = dict(seed)
    if kw.get("closed_at"):
        kw["closed_at"] = datetime.fromisoformat(kw["closed_at"])
    return FiscalPeriodModel(**kw)


def line_seed(**kw):
    d = {
        "journal_id": "", "entity_code": "DEMO", "line_number": 1, "account_code": "",
        "account_name": "", "period_code": "", "entry_layer": "OPERATIONAL",
        "accounting_date": "", "tx_currency": "", "exchange_rate": "1.00000000",
        "tx_debit": "0.0000", "tx_credit": "0.0000", "func_debit": "0.0000",
        "func_credit": "0.0000", "counterparty_id": None, "counterparty_name": "",
        "tax_code_id": None, "func_tax_amount": "0.0000", "business_use_pct": "1.0000",
        "statement_ref": "", "memo": "",
    }
    d.update(kw)
    return d


def line_model(seed):
    return JournalLineModel(**seed)


def counterparty_seed(**kw):
    d = {
        "entity_code": "DEMO", "counterparty_type": "VENDOR", "legal_name": "",
        "country_code": "", "tax_id_number": "", "withholding_rule": "NONE",
        "is_active": True,
    }
    d.update(kw)
    d.setdefault("counterparty_id", f"{d['entity_code']}:{d['legal_name']}")
    return d


def counterparty_model(seed):
    return CounterpartyModel(**seed)


def journal_seed(**kw):
    d = {"journal_id": "", "voucher_no": "", "status": "POSTED",
             "accounting_date": "", "period": None}
    d.update(kw)
    return d


# Shared chart for the DEMO entity (account-code order is the store's order).
DEMO_CHART = [
    account_seed(account_code="1000", account_name="銀行存款", account_type="ASSET",
                 normal_balance="DEBIT", fs_category="CASH"),
    account_seed(account_code="1210", account_name="應收帳款", account_type="ASSET",
                 normal_balance="DEBIT", fs_category="AR", is_control_account=True,
                 allow_manual_je=False),
    account_seed(account_code="1490", account_name="存貨", account_type="ASSET",
                 normal_balance="DEBIT", fs_category="INVENTORY",
                 is_control_account=True, allow_manual_je=False),
    account_seed(account_code="1650", account_name="累計折舊", account_type="ASSET",
                 normal_balance="CREDIT", fs_category="CONTRA_ASSET"),
    account_seed(account_code="1900", account_name="停用科目", account_type="ASSET",
                 normal_balance="DEBIT", fs_category="OPEX", is_active=False),
    account_seed(account_code="2190", account_name="業主往來", account_type="LIABILITY",
                 normal_balance="CREDIT", fs_category="DIRECTOR_LOAN",
                 is_control_account=True, allow_manual_je=False),
    account_seed(account_code="3100", account_name="實收資本及期初留存",
                 account_type="EQUITY", normal_balance="CREDIT", fs_category="EQUITY"),
    account_seed(account_code="4100", account_name="主營業務收入",
                 account_type="REVENUE", normal_balance="CREDIT", fs_category="REVENUE"),
    account_seed(account_code="5100", account_name="主營業務成本",
                 account_type="EXPENSE", normal_balance="DEBIT", fs_category="COGS"),
    account_seed(account_code="6100", account_name="管理及營運費用",
                 account_type="EXPENSE", normal_balance="DEBIT", fs_category="OPEX"),
]


def demo_lines():
    """Balanced seeded entries. Every entry balances: debits equal credits."""
    lines = [
        # Prior fiscal year (BL-14 background): December 2025 revenue 100.
        line_seed(journal_id="J1", line_number=1, account_code="1000",
                  account_name="銀行存款", period_code="2025-12", entry_layer="OPERATIONAL",
                  accounting_date="2025-12-05", tx_debit="100.0000", func_debit="100.0000",
                  statement_ref="TB"),
        line_seed(journal_id="J1", line_number=2, account_code="4100",
                  account_name="主營業務收入", period_code="2025-12", entry_layer="OPERATIONAL",
                  accounting_date="2025-12-05", tx_credit="100.0000", func_credit="100.0000"),
        # Opening capital, September 2026.
        line_seed(journal_id="J2", line_number=1, account_code="1000",
                  account_name="銀行存款", period_code="2026-09", entry_layer="OPENING",
                  accounting_date="2026-09-10", tx_debit="5000.0000", func_debit="5000.0000"),
        line_seed(journal_id="J2", line_number=2, account_code="3100",
                  account_name="實收資本及期初留存", period_code="2026-09", entry_layer="OPENING",
                  accounting_date="2026-09-10", tx_credit="5000.0000", func_credit="5000.0000"),
        # October sales.
        line_seed(journal_id="J3", line_number=1, account_code="1000",
                  account_name="銀行存款", period_code="2026-10", entry_layer="OPERATIONAL",
                  accounting_date="2026-10-05", tx_debit="300.0000", func_debit="300.0000"),
        line_seed(journal_id="J3", line_number=2, account_code="4100",
                  account_name="主營業務收入", period_code="2026-10", entry_layer="OPERATIONAL",
                  accounting_date="2026-10-05", tx_credit="300.0000", func_credit="300.0000"),
        # October accrual (adjustment layer).
        line_seed(journal_id="J4", line_number=1, account_code="6100",
                  account_name="管理及營運費用", period_code="2026-10",
                  entry_layer="AJE_MONTH_END", accounting_date="2026-10-20",
                  tx_debit="45.2500", func_debit="45.2500"),
        line_seed(journal_id="J4", line_number=2, account_code="2190",
                  account_name="業主往來", period_code="2026-10", entry_layer="AJE_MONTH_END",
                  accounting_date="2026-10-20", tx_credit="45.2500", func_credit="45.2500"),
        # October reclass (adjustment layer) into inventory.
        line_seed(journal_id="J5", line_number=1, account_code="1490",
                  account_name="存貨", period_code="2026-10", entry_layer="RJE_RECLASS",
                  accounting_date="2026-10-31", tx_debit="12.5000", func_debit="12.5000"),
        line_seed(journal_id="J5", line_number=2, account_code="1000",
                  account_name="銀行存款", period_code="2026-10", entry_layer="RJE_RECLASS",
                  accounting_date="2026-10-31", tx_credit="12.5000", func_credit="12.5000"),
        # November cost of sales.
        line_seed(journal_id="J6", line_number=1, account_code="5100",
                  account_name="主營業務成本", period_code="2026-11", entry_layer="OPERATIONAL",
                  accounting_date="2026-11-15", tx_debit="80.0000", func_debit="80.0000"),
        line_seed(journal_id="J6", line_number=2, account_code="1000",
                  account_name="銀行存款", period_code="2026-11", entry_layer="OPERATIONAL",
                  accounting_date="2026-11-15", tx_credit="80.0000", func_credit="80.0000"),
        # December credit sale.
        line_seed(journal_id="J7", line_number=1, account_code="1210",
                  account_name="應收帳款", period_code="2026-12", entry_layer="OPERATIONAL",
                  accounting_date="2026-12-10", tx_debit="250.0000", func_debit="250.0000"),
        line_seed(journal_id="J7", line_number=2, account_code="4100",
                  account_name="主營業務收入", period_code="2026-12", entry_layer="OPERATIONAL",
                  accounting_date="2026-12-10", tx_credit="250.0000", func_credit="250.0000"),
        # January 2027 revenue 20 (the BL-14 "January 2027" figure).
        line_seed(journal_id="J8", line_number=1, account_code="4100",
                  account_name="主營業務收入", period_code="2027-01", entry_layer="OPERATIONAL",
                  accounting_date="2027-01-10", tx_credit="20.0000", func_credit="20.0000"),
        line_seed(journal_id="J8", line_number=2, account_code="1000",
                  account_name="銀行存款", period_code="2027-01", entry_layer="OPERATIONAL",
                  accounting_date="2027-01-10", tx_debit="20.0000", func_debit="20.0000"),
        # October expense carrying a counterparty dimension.
        line_seed(journal_id="J9", line_number=1, account_code="6100",
                  account_name="管理及營運費用", period_code="2026-10", entry_layer="OPERATIONAL",
                  accounting_date="2026-10-12", tx_debit="60.0000", func_debit="60.0000",
                  counterparty_id="DEMO:acme-pty-ltd", counterparty_name="Acme Pty Ltd"),
        line_seed(journal_id="J9", line_number=2, account_code="1000",
                  account_name="銀行存款", period_code="2026-10", entry_layer="OPERATIONAL",
                  accounting_date="2026-10-12", tx_credit="60.0000", func_credit="60.0000"),
    ]
    for i, l in enumerate(lines, start=1):
        l.setdefault("line_id", f"L{i:03d}")
    return lines


def demo_periods():
    return [
        period_seed(period_code="2025-12", fiscal_year=2025, period_number=12,
                    start_date="2025-12-01", end_date="2025-12-31", status="LOCKED"),
        period_seed(period_code="2026-09", fiscal_year=2026, period_number=9,
                    start_date="2026-09-01", end_date="2026-09-30", status="OPEN"),
        period_seed(period_code="2026-10", fiscal_year=2026, period_number=10,
                    start_date="2026-10-01", end_date="2026-10-31", status="SOFT_CLOSE"),
        period_seed(period_code="2026-11", fiscal_year=2026, period_number=11,
                    start_date="2026-11-01", end_date="2026-11-30", status="LOCKED",
                    closed_by_principal_key="finance-manager-01",
                    closed_at="2026-12-01T09:00:00+00:00"),
        period_seed(period_code="2026-12", fiscal_year=2026, period_number=12,
                    start_date="2026-12-01", end_date="2026-12-31", status="OPEN"),
        period_seed(period_code="2026-Q3", fiscal_year=2026, period_number=3,
                    start_date="2026-07-01", end_date="2026-09-30", status="HARD_CLOSE"),
        period_seed(period_code="2026-Q4", fiscal_year=2026, period_number=4,
                    start_date="2026-10-01", end_date="2026-12-31", status="OPEN"),
        period_seed(period_code="2027-01", fiscal_year=2027, period_number=1,
                    start_date="2027-01-01", end_date="2027-01-31", status="OPEN"),
    ]


DEMO_COUNTERPARTIES = [
    counterparty_seed(counterparty_id="DEMO:acme-pty-ltd", counterparty_type="VENDOR",
                      legal_name="Acme Pty Ltd", country_code="AU"),
    counterparty_seed(counterparty_id="DEMO:hongda", counterparty_type="CUSTOMER",
                      legal_name="宏達有限公司", country_code="HK"),
]


# ---------------------------------------------------------------------------
# Op runners: each calls the reference through the fake session and returns
# its output verbatim (JSON-able already: strings for money, null for absent).
# ---------------------------------------------------------------------------


async def op_validate_posting_date(inp):
    period = L.validate_posting_date(inp["accounting_date"], inp.get("period"))
    return {"period": period}


async def op_period_bounds(inp):
    start, end, fy, n = L.period_bounds(inp["period_code"])
    return {"start": start, "end": end, "fiscal_year": fy, "period_number": n}


async def op_next_period(inp):
    return {"next_period": L.next_period_code(inp["period_code"])}


async def op_previous_period(inp):
    return {"previous_period": L.previous_period_code(inp["period_code"])}


async def op_assert_writable(inp):
    L.db_manager = _FakeDBManager(periods=[period_model(s) for s in inp["periods"]])
    period = await L.assert_writable(
        inp["entity_code"], inp["period_code"], inp.get("accounting_date")
    )
    return {"period": period}


async def op_account_by_code(inp):
    L.db_manager = _FakeDBManager(chart=[account_model(s) for s in inp["accounts"]])
    account = await L.account_by_code(inp["entity_code"], inp["account_code"])
    return {"account": account}


async def op_upsert_account(inp):
    L.db_manager = _FakeDBManager(chart=[account_model(s) for s in inp["accounts"]])
    account = await L.upsert_account(inp["entity_code"], inp["payload"])
    return {"account": account}


async def op_resolve_counterparty(inp):
    L.db_manager = _FakeDBManager(
        counterparties=[counterparty_model(s) for s in inp["counterparties"]]
    )
    resolved = await L.resolve_counterparty(
        inp["entity_code"], inp["name"],
        inp.get("counterparty_type", "VENDOR"), inp.get("country_code", ""),
    )
    return {"resolved": resolved}


async def op_filter_lines(inp):
    L.db_manager = _FakeDBManager(lines=[line_model(s) for s in inp["lines"]])
    q = inp["query"]
    rows = await L.get_lines(
        q["entity_code"], q.get("account_code", ""), q.get("period_code", ""),
        q.get("counterparty_id", ""), q.get("limit", 0),
    )
    return {"lines": rows}


async def op_derive_balances(inp):
    L.db_manager = _FakeDBManager(
        chart=[account_model(s) for s in inp["accounts"]],
        lines=[line_model(s) for s in inp["lines"]],
    )
    balances = await L.derive_balances(inp["entity_code"], inp["period_code"])
    return {"balances": {code: balance_dict(b) for code, b in balances.items()}}


def balance_dict(b):
    return {
        "account_code": b.account_code,
        "opening": str(b.opening),
        "op_debit": str(b.op_debit),
        "op_credit": str(b.op_credit),
        "aj_debit": str(b.aj_debit),
        "aj_credit": str(b.aj_credit),
        "movement": str(b.movement),
        "closing": str(b.closing),
        "closing_side": b.closing_side,
        "display_balance": str(b.display_balance),
        "debit_nature": b.debit_nature,
    }


async def op_trial_balance(inp):
    L.db_manager = _FakeDBManager(
        chart=[account_model(s) for s in inp["accounts"]],
        lines=[line_model(s) for s in inp["lines"]],
    )
    rows = await L.trial_balance(inp["entity_code"], inp["period_code"])
    return {"rows": rows}


async def op_trial_balance_report(inp):
    L.db_manager = _FakeDBManager(
        chart=[account_model(s) for s in inp["accounts"]],
        lines=[line_model(s) for s in inp["lines"]],
    )
    rows = await L.trial_balance_from_ledger(inp["entity_code"], inp["period_code"])
    return {"rows": [report_row_dict(r) for r in rows]}


def report_row_dict(r):
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


async def op_assert_trial_balance(inp):
    L.db_manager = _FakeDBManager(lines=[line_model(s) for s in inp["lines"]])
    return await L.assert_trial_balance(inp["entity_code"], inp["period_code"])


async def op_account_ledger(inp):
    L.db_manager = _FakeDBManager(
        chart=[account_model(s) for s in inp["accounts"]],
        lines=[line_model(s) for s in inp["lines"]],
    )
    report = await L.account_ledger(
        inp["entity_code"], inp["account_code"], inp["period_code"]
    )
    return {"report": report}


async def op_close_period(inp):
    L.db_manager = _FakeDBManager(
        periods=[period_model(s) for s in inp["periods"]],
        chart=[account_model(s) for s in inp["accounts"]],
        lines=[line_model(s) for s in inp["lines"]],
    )
    journals = [j for j in inp["journals"]]

    async def fake_get_journals(*args, **kwargs):
        return journals

    saved = repo.get_journals
    repo.get_journals = fake_get_journals
    try:
        result = await L.close_period(
            inp["entity_code"], inp["period_code"], inp["principal_key"]
        )
    finally:
        repo.get_journals = saved
    return {"result": result}


async def op_cash_flow_breakdown(inp):
    L.db_manager = _FakeDBManager(
        periods=[period_model(s) for s in inp["periods"]],
        chart=[account_model(s) for s in inp["accounts"]],
        lines=[line_model(s) for s in inp["lines"]],
    )
    report = await L.cash_flow_breakdown(inp["entity_code"], inp["period_code"])
    return {"report": report}


OPS = {
    "validate_posting_date": op_validate_posting_date,
    "period_bounds": op_period_bounds,
    "next_period": op_next_period,
    "previous_period": op_previous_period,
    "assert_writable": op_assert_writable,
    "account_by_code": op_account_by_code,
    "upsert_account": op_upsert_account,
    "resolve_counterparty": op_resolve_counterparty,
    "filter_lines": op_filter_lines,
    "derive_balances": op_derive_balances,
    "trial_balance": op_trial_balance,
    "trial_balance_report": op_trial_balance_report,
    "assert_trial_balance": op_assert_trial_balance,
    "account_ledger": op_account_ledger,
    "close_period": op_close_period,
    "cash_flow_breakdown": op_cash_flow_breakdown,
}


# ---------------------------------------------------------------------------
# Case catalogue. (name, op, input)
# ---------------------------------------------------------------------------


def validation_cases():
    cases = [
        # Valid dates: month bounds, absent-period derivation, leap days,
        # quarter boundaries, year edges.
        ("date_ok_month", "validate_posting_date", {"accounting_date": "2026-10-15", "period": "2026-10"}),
        ("date_ok_absent_period_derives_month", "validate_posting_date", {"accounting_date": "2026-07-15"}),
        ("date_ok_first_day", "validate_posting_date", {"accounting_date": "2026-10-01", "period": "2026-10"}),
        ("date_ok_last_day", "validate_posting_date", {"accounting_date": "2026-10-31", "period": "2026-10"}),
        ("date_ok_leap_day", "validate_posting_date", {"accounting_date": "2024-02-29", "period": "2024-02"}),
        ("date_ok_leap_century", "validate_posting_date", {"accounting_date": "2000-02-29", "period": "2000-02"}),
        ("date_ok_year_one", "validate_posting_date", {"accounting_date": "0001-01-01", "period": "0001-01"}),
        ("date_ok_year_9999", "validate_posting_date", {"accounting_date": "9999-12-31", "period": "9999-12"}),
        ("date_ok_quarter_start", "validate_posting_date", {"accounting_date": "2026-01-01", "period": "2026-Q1"}),
        ("date_ok_quarter_end", "validate_posting_date", {"accounting_date": "2026-03-31", "period": "2026-Q1"}),
        ("date_ok_q2_end", "validate_posting_date", {"accounting_date": "2026-06-30", "period": "2026-Q2"}),
        ("date_ok_q4_end", "validate_posting_date", {"accounting_date": "2026-12-31", "period": "2026-Q4"}),
        # Invalid dates: not real days, non-canonical spellings, junk.
        ("date_err_not_leap_day", "validate_posting_date", {"accounting_date": "2026-02-29"}),
        ("date_err_leap_century", "validate_posting_date", {"accounting_date": "1900-02-29"}),
        ("date_err_month_13", "validate_posting_date", {"accounting_date": "2026-13-01"}),
        ("date_err_non_canonical", "validate_posting_date", {"accounting_date": "2026-1-5"}),
        ("date_err_compact_form", "validate_posting_date", {"accounting_date": "20260105"}),
        ("date_err_empty", "validate_posting_date", {"accounting_date": ""}),
        ("date_err_datetime_suffix", "validate_posting_date", {"accounting_date": "2026-10-15T00:00:00"}),
        ("date_err_day_zero", "validate_posting_date", {"accounting_date": "2026-10-00"}),
        # Explicit periods: empty, annual, malformed are all rejected.
        ("date_err_period_empty", "validate_posting_date", {"accounting_date": "2026-07-15", "period": ""}),
        ("date_err_period_annual", "validate_posting_date", {"accounting_date": "2026-07-15", "period": "2026"}),
        ("date_err_period_quarter_bad_n", "validate_posting_date", {"accounting_date": "2026-07-15", "period": "2026-Q5"}),
        ("date_err_period_quarter_lowercase", "validate_posting_date", {"accounting_date": "2026-07-15", "period": "2026q1"}),
        ("date_err_period_trailing_junk", "validate_posting_date", {"accounting_date": "2026-10-15", "period": "2026-10x"}),
        ("date_err_period_year_zero", "validate_posting_date", {"accounting_date": "2026-10-15", "period": "0000-10"}),
        # Mismatched date/period pairs: the BL-04 cutoff, rejected before effects.
        ("date_err_mismatch_month", "validate_posting_date", {"accounting_date": "2026-11-01", "period": "2026-10"}),
        ("date_err_mismatch_quarter_start", "validate_posting_date", {"accounting_date": "2026-04-01", "period": "2026-Q1"}),
        ("date_err_mismatch_quarter_before", "validate_posting_date", {"accounting_date": "2026-09-30", "period": "2026-Q4"}),
        ("date_err_mismatch_year", "validate_posting_date", {"accounting_date": "2025-10-15", "period": "2026-10"}),
    ]

    bounds = [
        ("bounds_month_feb", "2026-02", "2026-02-01", "2026-02-28", 2026, 2),
        ("bounds_month_feb_leap", "2024-02", "2024-02-01", "2024-02-29", 2024, 2),
        ("bounds_month_jan", "2026-01", "2026-01-01", "2026-01-31", 2026, 1),
        ("bounds_month_dec", "2026-12", "2026-12-01", "2026-12-31", 2026, 12),
        ("bounds_quarter_q1", "2026-Q1", "2026-01-01", "2026-03-31", 2026, 1),
        ("bounds_quarter_q2", "2026-Q2", "2026-04-01", "2026-06-30", 2026, 2),
        ("bounds_quarter_q3", "2026-Q3", "2026-07-01", "2026-09-30", 2026, 3),
        ("bounds_quarter_q4", "2026-Q4", "2026-10-01", "2026-12-31", 2026, 4),
        ("bounds_year_one", "0001-01", "0001-01-01", "0001-01-31", 1, 1),
        ("bounds_year_9999", "9999-12", "9999-12-01", "9999-12-31", 9999, 12),
    ]
    for name, code, start, end, fy, n in bounds:
        cases.append((name, "period_bounds", {"period_code": code}))
    for name, code in [
        ("bounds_err_month_00", "2026-00"),
        ("bounds_err_month_13", "2026-13"),
        ("bounds_err_quarter_q0", "2026-Q0"),
        ("bounds_err_quarter_q5", "2026-Q5"),
        ("bounds_err_quarter_q9", "2026-Q9"),
        ("bounds_err_annual", "2026"),
        ("bounds_err_empty", ""),
        ("bounds_err_month_one_digit", "2026-1"),
        ("bounds_err_month_three_digits", "2026-101"),
        ("bounds_err_quarter_no_n", "2026-Q"),
        ("bounds_err_text", "abc"),
        ("bounds_err_year_zero", "0000-01"),
    ]:
        cases.append((name, "period_bounds", {"period_code": code}))

    for name, code in [
        ("next_jan", "2026-01"),
        ("next_nov", "2026-11"),
        ("next_dec_rolls_year", "2026-12"),
        ("next_q1", "2026-Q1"),
        ("next_q4_rolls_year", "2026-Q4"),
        ("next_year_9999_overflows", "9999-12"),
        ("next_quarter_9999", "9999-Q4"),
        # next_period_code does not bound-check the month: 13 rolls to 14,
        # exactly as the reference's re.match + arithmetic does.
        ("next_month_13_unvalidated", "2026-13"),
        ("next_err_trailing_junk", "2026-10-junk"),
    ]:
        cases.append((name, "next_period", {"period_code": code}))
    for name, code in [
        ("previous_feb", "2026-02"),
        ("previous_jan_rolls_year", "2026-01"),
        ("previous_dec", "2026-12"),
        ("previous_q1_rolls_year", "2026-Q1"),
        ("previous_q4", "2026-Q4"),
        ("previous_year_one_overflows", "0001-01"),
        ("previous_quarter_year_one", "0001-Q1"),
    ]:
        cases.append((name, "previous_period", {"period_code": code}))
    cases.append(("next_err_invalid", "next_period", {"period_code": "abc"}))
    cases.append(("previous_err_invalid", "previous_period", {"period_code": "2026"}))
    return cases


def writable_cases():
    P = demo_periods
    def seeds(*codes):
        by_code = {p["period_code"]: p for p in P()}
        return [by_code[c] for c in codes]

    return [
        ("w_open_month_no_lock", {"periods": seeds("2026-09"), "entity_code": "DEMO",
                                  "period_code": "2026-09", "accounting_date": "2026-09-15"}),
        ("w_soft_close_writable", {"periods": seeds("2026-10"), "entity_code": "DEMO",
                                   "period_code": "2026-10", "accounting_date": "2026-10-05"}),
        ("w_locked_month", {"periods": seeds("2026-11"), "entity_code": "DEMO",
                            "period_code": "2026-11", "accounting_date": "2026-11-20"}),
        ("w_locked_month_no_closer", {"periods": [
            period_seed(period_code="2026-11", fiscal_year=2026, period_number=11,
                        start_date="2026-11-01", end_date="2026-11-30", status="LOCKED")],
            "entity_code": "DEMO", "period_code": "2026-11", "accounting_date": "2026-11-05"}),
        ("w_future_blocks", {"periods": [period_seed(
            period_code="2027-01", fiscal_year=2027, period_number=1,
            start_date="2027-01-01", end_date="2027-01-31", status="FUTURE")],
            "entity_code": "DEMO", "period_code": "2027-01", "accounting_date": "2027-01-10"}),
        ("w_hard_close_quarter_blocks_date", {"periods": seeds("2026-Q3", "2026-09"),
            "entity_code": "DEMO", "period_code": "2026-09", "accounting_date": "2026-09-15"}),
        ("w_locked_month_inside_open_quarter", {"periods": seeds("2026-09", "2026-Q3"),
            "entity_code": "DEMO", "period_code": "2026-Q3", "accounting_date": "2026-09-15"}),
        ("w_open_month_in_locked_quarter", {"periods": [
            period_seed(period_code="2026-09", fiscal_year=2026, period_number=9,
                        start_date="2026-09-01", end_date="2026-09-30", status="OPEN"),
            period_seed(period_code="2026-Q3", fiscal_year=2026, period_number=3,
                        start_date="2026-07-01", end_date="2026-09-30", status="LOCKED")],
            "entity_code": "DEMO", "period_code": "2026-09", "accounting_date": "2026-09-15"}),
        ("w_open_october_q4_label_nov_locked", {"periods": seeds("2026-11", "2026-Q4"),
            "entity_code": "DEMO", "period_code": "2026-Q4", "accounting_date": "2026-10-05"}),
        ("w_undated_conservative_quarter", {"periods": seeds("2026-11"),
            "entity_code": "DEMO", "period_code": "2026-Q4"}),
        ("w_undated_month_no_overlap", {"periods": seeds("2026-11"),
            "entity_code": "DEMO", "period_code": "2026-10"}),
        ("w_undated_soft_close_overlap", {"periods": seeds("2026-10", "2026-11"),
            "entity_code": "DEMO", "period_code": "2026-Q4"}),
        ("w_missing_period_autocreate", {"periods": [], "entity_code": "DEMO",
            "period_code": "2026-08", "accounting_date": "2026-08-10"}),
        ("w_missing_period_undated", {"periods": [], "entity_code": "DEMO",
            "period_code": "2026-08"}),
        ("w_invalid_period", {"periods": [], "entity_code": "DEMO",
            "period_code": "2026-13"}),
        ("w_invalid_date", {"periods": [], "entity_code": "DEMO",
            "period_code": "2026-09", "accounting_date": "2026-02-30"}),
        ("w_date_period_mismatch", {"periods": seeds("2026-11"), "entity_code": "DEMO",
            "period_code": "2026-11", "accounting_date": "2026-09-15"}),
        ("w_bl04_cutoff_attack", {"periods": seeds("2026-09", "2026-11"),
            "entity_code": "DEMO", "period_code": "2026-11", "accounting_date": "2026-09-15"}),
        ("w_date_outside_lock_writable", {"periods": seeds("2026-11"), "entity_code": "DEMO",
            "period_code": "2026-10", "accounting_date": "2026-10-15"}),
    ]


def chart_cases():
    accounts = DEMO_CHART
    return [
        ("chart_found", {"accounts": accounts, "entity_code": "DEMO", "account_code": "1000"}),
        ("chart_found_inactive", {"accounts": accounts, "entity_code": "DEMO", "account_code": "1900"}),
        ("chart_missing", {"accounts": accounts, "entity_code": "DEMO", "account_code": "9999"}),
        ("upsert_create_minimal", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_code": "6200"}}),
        ("upsert_create_control_category", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_code": "2110", "account_name": "應付帳款及應計費用",
                        "fs_category": "AP_ACCRUAL"}}),
        ("upsert_create_contra", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_code": "1690", "account_type": "ASSET",
                        "fs_category": "CONTRA_ASSET", "account_name": "累計折舊"}}),
        ("upsert_update_partial", {"accounts": accounts, "entity_code": "DEMO",
            "payload": {"account_code": "1000", "account_name": "銀行存款-更新"}}),
        ("upsert_update_control_linkage", {"accounts": accounts, "entity_code": "DEMO",
            "payload": {"account_code": "1210", "is_control_account": False}}),
        ("upsert_update_explicit_flags", {"accounts": accounts, "entity_code": "DEMO",
            "payload": {"account_code": "1210", "is_control_account": True,
                        "allow_manual_je": True}}),
        ("upsert_normal_balance_override", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_code": "6200", "normal_balance": "debit"}}),
        ("upsert_reactivate", {"accounts": accounts, "entity_code": "DEMO",
            "payload": {"account_code": "1900", "is_active": True}}),
        ("upsert_err_invalid_type", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_code": "X1", "account_type": "BANK"}}),
        ("upsert_err_missing_code", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_type": "EXPENSE"}}),
        ("upsert_err_blank_code", {"accounts": [], "entity_code": "DEMO",
            "payload": {"account_code": "   "}}),
    ]


def counterparty_cases():
    cps = DEMO_COUNTERPARTIES
    return [
        ("counterparty_found_exact", {"counterparties": cps, "entity_code": "DEMO",
                                      "name": "Acme Pty Ltd"}),
        ("counterparty_found_trimmed", {"counterparties": cps, "entity_code": "DEMO",
                                        "name": "  Acme Pty Ltd  "}),
        ("counterparty_found_chinese", {"counterparties": cps, "entity_code": "DEMO",
                                        "name": "宏達有限公司"}),
        ("counterparty_err_blank", {"counterparties": cps, "entity_code": "DEMO",
                                    "name": ""}),
        ("counterparty_err_whitespace", {"counterparties": cps, "entity_code": "DEMO",
                                         "name": "   "}),
        # Name-variant lookups ("ACME Pty Ltd.") are excluded: the reference
        # would create — and crash on the slug collision (BL-30). Pinned by
        # TestBL30_no_implicit_counterparty_creation instead.
    ]


def line_cases():
    LINES = demo_lines()
    def with_extra(extra):
        return LINES + [dict(extra)]

    return [
        ("lines_all", {"lines": LINES, "query": {"entity_code": "DEMO"}}),
        ("lines_by_account", {"lines": LINES, "query": {"entity_code": "DEMO", "account_code": "1000"}}),
        ("lines_by_period", {"lines": LINES, "query": {"entity_code": "DEMO", "period_code": "2026-10"}}),
        ("lines_by_quarter", {"lines": LINES, "query": {"entity_code": "DEMO", "period_code": "2026-Q4"}}),
        ("lines_by_counterparty", {"lines": LINES, "query": {"entity_code": "DEMO",
                                                             "counterparty_id": "DEMO:acme-pty-ltd"}}),
        ("lines_limit", {"lines": LINES, "query": {"entity_code": "DEMO", "limit": 3}}),
        ("lines_limit_by_account", {"lines": LINES,
            "query": {"entity_code": "DEMO", "account_code": "1000", "limit": 2}}),
        ("lines_other_entity", {"lines": LINES, "query": {"entity_code": "OTHER"}}),
        ("lines_err_invalid_period", {"lines": LINES,
            "query": {"entity_code": "DEMO", "period_code": "2026-13"}}),
        ("lines_err_malformed_legacy_date", {"lines": with_extra(
            line_seed(journal_id="JX", line_number=1, account_code="1000",
                      period_code="2026-02", accounting_date="2026-02-30")),
            "query": {"entity_code": "DEMO"}}),
        ("lines_err_period_label_mismatch", {"lines": with_extra(
            line_seed(journal_id="JY", line_number=1, account_code="1000",
                      period_code="2026-11", accounting_date="2026-10-05")),
            "query": {"entity_code": "DEMO"}}),
    ]


def balance_cases():
    accounts = DEMO_CHART
    lines = demo_lines()
    unbalanced = lines + [line_seed(journal_id="JU", line_number=1,
        account_code="5100", account_name="主營業務成本", period_code="2026-12",
        entry_layer="OPERATIONAL", accounting_date="2026-12-28",
        tx_debit="999.9900", func_debit="999.9900")]
    malformed = lines + [line_seed(journal_id="JM", line_number=1,
        account_code="1000", period_code="2026-10",
        accounting_date="2026-04-31")]

    return [
        ("balances_2026_10", {"accounts": accounts, "lines": lines,
                              "entity_code": "DEMO", "period_code": "2026-10"}),
        # The carry-forward view: openings for January 2027 are everything
        # dated before it (close_period's carried_forward reads exactly this).
        ("balances_2027_01_carry_forward", {"accounts": accounts, "lines": lines,
                                            "entity_code": "DEMO", "period_code": "2027-01"}),
        ("balances_empty_lines", {"accounts": accounts, "lines": [],
                                  "entity_code": "DEMO", "period_code": "2026-10"}),
        ("balances_err_invalid_period", {"accounts": accounts, "lines": lines,
                                         "entity_code": "DEMO", "period_code": "2026"}),
        ("balances_err_malformed_legacy", {"accounts": accounts, "lines": malformed,
                                           "entity_code": "DEMO", "period_code": "2026-10"}),
        ("tb_rows_2026_10", {"accounts": accounts, "lines": lines,
                             "entity_code": "DEMO", "period_code": "2026-10"}),
        ("tb_report_rows_2026_10", {"accounts": accounts, "lines": lines,
                                    "entity_code": "DEMO", "period_code": "2026-10"}),
        ("tb_check_balanced", {"lines": lines, "entity_code": "DEMO", "period_code": "2026-10"}),
        ("tb_check_unbalanced", {"lines": unbalanced, "entity_code": "DEMO",
                                 "period_code": "2026-12"}),
        ("tb_check_err_malformed_legacy", {"lines": malformed, "entity_code": "DEMO",
                                           "period_code": "2026-10"}),
        ("ledger_1000_2026_10", {"accounts": accounts, "lines": lines,
                                 "entity_code": "DEMO", "account_code": "1000",
                                 "period_code": "2026-10"}),
        ("ledger_4100_2026_10", {"accounts": accounts, "lines": lines,
                                 "entity_code": "DEMO", "account_code": "4100",
                                 "period_code": "2026-10"}),
        ("ledger_err_missing_account", {"accounts": accounts, "lines": lines,
                                        "entity_code": "DEMO", "account_code": "8888",
                                        "period_code": "2026-10"}),
    ]


def close_cases():
    accounts = DEMO_CHART
    lines = demo_lines()
    unbalanced = lines + [line_seed(journal_id="JU", line_number=1,
        account_code="5100", account_name="主營業務成本", period_code="2026-12",
        entry_layer="OPERATIONAL", accounting_date="2026-12-28",
        tx_debit="999.9900", func_debit="999.9900")]
    P = demo_periods()

    return [
        ("close_ok_2026_12", {"periods": P, "accounts": accounts, "lines": lines,
            "journals": [journal_seed(journal_id="JP1", voucher_no="V-2026-001",
                                      status="POSTED", accounting_date="2026-12-05",
                                      period="2026-12")],
            "entity_code": "DEMO", "period_code": "2026-12",
            "principal_key": "finance-manager-01"}),
        ("close_err_already_locked", {"periods": P, "accounts": accounts, "lines": lines,
            "journals": [], "entity_code": "DEMO", "period_code": "2026-11",
            "principal_key": "finance-manager-01"}),
        ("close_err_unposted_vouchers", {"periods": P, "accounts": accounts, "lines": lines,
            "journals": [
                journal_seed(journal_id="JD1", voucher_no="V-2026-009", status="DRAFT",
                             accounting_date="2026-12-20", period="2026-12"),
                journal_seed(journal_id="JD2", voucher_no="V-2026-010",
                             status="PENDING_CHECKER", accounting_date="2026-11-30",
                             period="2026-11"),
            ],
            "entity_code": "DEMO", "period_code": "2026-12",
            "principal_key": "finance-manager-01"}),
        ("close_err_malformed_legacy_journal", {"periods": P, "accounts": accounts,
            "lines": lines,
            "journals": [journal_seed(journal_id="JDX", voucher_no="V-BAD",
                                      status="DRAFT", accounting_date="2026-02-30",
                                      period="2026-02")],
            "entity_code": "DEMO", "period_code": "2026-12",
            "principal_key": "finance-manager-01"}),
        ("close_err_trial_balance_broken", {"periods": P, "accounts": accounts,
            "lines": unbalanced, "journals": [], "entity_code": "DEMO",
            "period_code": "2026-12", "principal_key": "finance-manager-01"}),
        # Closing a soft-closed month proceeds even though the derived next
        # period (November) is already LOCKED — the reference's ensure_period
        # keeps the stored row as-is. Ported as-is for golden parity.
        ("close_into_locked_next_2026_10", {"periods": P, "accounts": accounts,
            "lines": lines, "journals": [], "entity_code": "DEMO",
            "period_code": "2026-10", "principal_key": "finance-manager-01"}),
    ]


def cashflow_cases():
    accounts = DEMO_CHART
    lines = demo_lines()
    return [
        ("cashflow_2026_10", {"periods": demo_periods(), "accounts": accounts,
                              "lines": lines, "entity_code": "DEMO",
                              "period_code": "2026-10"}),
        ("cashflow_2026_12", {"periods": demo_periods(), "accounts": accounts,
                              "lines": lines, "entity_code": "DEMO",
                              "period_code": "2026-12"}),
        ("cashflow_err_invalid_period", {"periods": demo_periods(),
                                         "accounts": accounts, "lines": lines,
                                         "entity_code": "DEMO", "period_code": "2026-13"}),
        # The BL-18 compound-entry scenario (one entry, cash and non-cash
        # debits against a single credit) is excluded: it overstates gross
        # buckets in the reference and belongs to the reporting package.
    ]


def all_cases():
    """(name, op, input) triples. validation_cases carries its own ops; the
    other sections are (name, input) pairs tagged here with the op they run."""
    out = list(validation_cases())
    out += [(n, "assert_writable", i) for n, i in writable_cases()]
    out += [
        (n, "account_by_code" if n.startswith("chart_") else "upsert_account", i)
        for n, i in chart_cases()
    ]
    out += [(n, "resolve_counterparty", i) for n, i in counterparty_cases()]
    out += [(n, "filter_lines", i) for n, i in line_cases()]
    for n, i in balance_cases():
        if n.startswith("balances_"):
            op = "derive_balances"
        elif n.startswith("tb_rows_"):
            op = "trial_balance"
        elif n.startswith("tb_report_"):
            op = "trial_balance_report"
        elif n.startswith("tb_check"):
            op = "assert_trial_balance"
        else:
            op = "account_ledger"
        out.append((n, op, i))
    out += [(n, "close_period", i) for n, i in close_cases()]
    out += [(n, "cash_flow_breakdown", i) for n, i in cashflow_cases()]
    return out


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

_KIND_RE = re.compile(r"^([A-Z0-9_]+):")


def error_kind(exc):
    if isinstance(exc, InvalidOperation):
        return "invalid_quantize"
    m = _KIND_RE.match(str(exc))
    if m:
        return m.group(1).lower()
    return None


def write(module, name, case_input, output=None, error=None, op=None):
    wire_input = {"op": op, **case_input} if op else case_input
    doc = {"module": module, "case": name, "input": wire_input}
    if error is not None:
        doc["expected_error"] = error
    else:
        doc["output"] = output
    path = OUT / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


async def run_case(name, op, case_input):
    saved_db = L.db_manager
    try:
        out = await OPS[op](case_input)
        write("ledger", name, case_input, output=out, op=op)
    except Exception as exc:
        kind = error_kind(exc)
        if kind is None:
            raise
        write("ledger", name, case_input, error=kind, op=op)
    finally:
        L.db_manager = saved_db


def main():
    # The generator needs no database; belt and braces against a set env.
    cases = all_cases()
    for name, op, case_input in cases:
        asyncio.run(run_case(name, op, case_input))
    print(f"generated {len(cases)} ledger fixtures under {OUT}")


if __name__ == "__main__":
    main()
