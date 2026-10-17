"""
General ledger core: chart of accounts, periods, and the ledger as the single
source of truth.

The rule that shapes this module: **balances are never stored.** A closing
balance is `opening + sum(lines)`, computed on demand. Storing balances is what
turned the old `trial_balance_accounts` table into a source of truth that had to be kept in
step with the journal by hand — and a cached balance that drifts is worse than a
slow one, because nothing tells you it has drifted.

Consequences worth knowing:

  * Opening balance for a period = the sum of every line dated before the period
    starts — for every account. A trial balance is cumulative from the start of
    the fiscal year, so income and expense accounts accumulate across periods and
    are only cleared by the year-end close (not built yet). Resetting them monthly
    would leave the balance sheet short by the profit earned so far.
  * A period can be locked, and locking is recorded against a principal.
  * Multi-currency is native: every line carries tx_* (transaction currency) and
    func_* (functional currency). They are equal at rate 1.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import select

from app.core.db import (
    ChartOfAccountsModel,
    CounterpartyModel,
    FiscalPeriodModel,
    JournalLineModel,
    TaxCodeModel,
    db_manager,
)
from app.core.localization import q4
from app.core.reporting import TrialBalanceAccountRow

ZERO = Decimal("0.0000")

#: Which trial balance column pair a line belongs to, by entry layer.
OPERATIONAL_LAYERS = {"OPERATIONAL"}
ADJUSTMENT_LAYERS = {"AJE_MONTH_END", "RJE_RECLASS"}
#: OPENING and REVERSAL are ordinary movements for reporting purposes; a reversal
#: of an operational entry is operational, which is why the reversing voucher
#: carries its own layer rather than inheriting one.
ALL_LAYERS = {"OPENING", "OPERATIONAL", "AJE_MONTH_END", "RJE_RECLASS", "REVERSAL"}

BS_ACCOUNT_TYPES = {"ASSET", "LIABILITY", "EQUITY"}
PL_ACCOUNT_TYPES = {"REVENUE", "EXPENSE"}

#: Control accounts hold a sub-ledger, so a manual journal may not touch them.
CONTROL_FS_CATEGORIES = {"AR", "AP_ACCRUAL", "INVENTORY", "FIXED_ASSET", "TAX_PAYABLE", "DIRECTOR_LOAN"}
#: Contra accounts accumulate on the opposite side of their class.
CONTRA_CREDIT_CATEGORIES = {"CONTRA_ASSET"}

MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
QUARTER_RE = re.compile(r"^(\d{4})-Q([1-4])$")


class LedgerError(Exception):
    """The ledger refused. Message is user-facing."""


def normal_balance_for(account_type: str, fs_category: str) -> str:
    if fs_category in CONTRA_CREDIT_CATEGORIES:
        return "CREDIT"
    return "DEBIT" if account_type in ("ASSET", "EXPENSE") else "CREDIT"


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

def period_bounds(period_code: str) -> Tuple[str, str, int, int]:
    """('2026-10') -> (start_date, end_date, fiscal_year, period_number)."""
    month = MONTH_RE.match(period_code or "")
    if month:
        year, number = int(month.group(1)), int(month.group(2))
        last = calendar.monthrange(year, number)[1]
        return f"{year}-{number:02d}-01", f"{year}-{number:02d}-{last:02d}", year, number
    quarter = QUARTER_RE.match(period_code or "")
    if quarter:
        year, q = int(quarter.group(1)), int(quarter.group(2))
        first_month = (q - 1) * 3 + 1
        last_month = first_month + 2
        last_day = calendar.monthrange(year, last_month)[1]
        return f"{year}-{first_month:02d}-01", f"{year}-{last_month:02d}-{last_day:02d}", year, q
    raise LedgerError(
        f"INVALID_PERIOD: '{period_code}' 不是可辨識的會計期間（支援 YYYY-MM 與 YYYY-Qn）。"
    )


def next_period_code(period_code: str) -> str:
    month = MONTH_RE.match(period_code or "")
    if month:
        year, number = int(month.group(1)), int(month.group(2))
        return f"{year + 1}-01" if number == 12 else f"{year}-{number + 1:02d}"
    quarter = QUARTER_RE.match(period_code or "")
    if quarter:
        year, q = int(quarter.group(1)), int(quarter.group(2))
        return f"{year + 1}-Q1" if q == 4 else f"{year}-Q{q + 1}"
    raise LedgerError(f"INVALID_PERIOD: 無法推算 '{period_code}' 的下一期。")


def previous_period_code(period_code: str) -> str:
    month = MONTH_RE.match(period_code or "")
    if month:
        year, number = int(month.group(1)), int(month.group(2))
        return f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"
    quarter = QUARTER_RE.match(period_code or "")
    if quarter:
        year, q = int(quarter.group(1)), int(quarter.group(2))
        return f"{year - 1}-Q4" if q == 1 else f"{year}-Q{q - 1}"
    raise LedgerError(f"INVALID_PERIOD: 無法推算 '{period_code}' 的上一期。")


async def ensure_period(entity_code: str, period_code: str, status: str = "OPEN") -> Dict[str, Any]:
    start, end, year, number = period_bounds(period_code)
    async with db_manager.session_factory() as session:
        period_id = f"{entity_code}:{period_code}"
        existing = await session.get(FiscalPeriodModel, period_id)
        if existing:
            return _period_dict(existing)
        model = FiscalPeriodModel(
            period_id=period_id,
            entity_code=entity_code,
            period_code=period_code,
            fiscal_year=year,
            period_number=number,
            start_date=start,
            end_date=end,
            status=status,
        )
        session.add(model)
        await session.commit()
        return _period_dict(model)


def _period_dict(m: FiscalPeriodModel) -> Dict[str, Any]:
    return {
        "period_id": m.period_id,
        "entity_code": m.entity_code,
        "period_code": m.period_code,
        "fiscal_year": m.fiscal_year,
        "period_number": m.period_number,
        "start_date": m.start_date,
        "end_date": m.end_date,
        "status": m.status,
        "closed_by_principal_key": m.closed_by_principal_key,
        "closed_at": m.closed_at.isoformat() if m.closed_at else None,
        "is_writable": m.status in ("OPEN", "SOFT_CLOSE"),
    }


async def get_period(entity_code: str, period_code: str) -> Dict[str, Any]:
    async with db_manager.session_factory() as session:
        model = await session.get(FiscalPeriodModel, f"{entity_code}:{period_code}")
    if not model:
        return await ensure_period(entity_code, period_code)
    return _period_dict(model)


async def list_periods(entity_code: str) -> List[Dict[str, Any]]:
    from sqlalchemy import select

    async with db_manager.session_factory() as session:
        stmt = (
            select(FiscalPeriodModel)
            .where(FiscalPeriodModel.entity_code == entity_code)
            .order_by(FiscalPeriodModel.period_code)
        )
        rows = (await session.execute(stmt)).scalars().all()
        return [_period_dict(r) for r in rows]


async def assert_writable(entity_code: str, period_code: str) -> Dict[str, Any]:
    period = await get_period(entity_code, period_code)
    if not period["is_writable"]:
        raise LedgerError(
            f"PERIOD_LOCKED: 期間 {period_code} 狀態為 {period['status']}"
            + (f"，由 {period['closed_by_principal_key']} 於 {period['closed_at']} 封存。" if period["closed_at"] else "。")
            + " 已封存的期間不可再寫入分錄。"
        )
    return period


# ---------------------------------------------------------------------------
# Chart of accounts
# ---------------------------------------------------------------------------

def _account_dict(m: ChartOfAccountsModel) -> Dict[str, Any]:
    return {
        "account_id": m.account_id,
        "account_code": m.account_code,
        "account_name": m.account_name,
        "account_type": m.account_type,
        "normal_balance": m.normal_balance,
        "fs_category": m.fs_category,
        "statement_ref": m.default_statement_ref,
        "cash_flow_activity": m.cash_flow_activity,
        "is_control_account": m.is_control_account,
        "allow_manual_je": m.allow_manual_je,
        "tax_code_default": m.tax_code_default,
        "is_active": m.is_active,
        "parent_account_id": m.parent_account_id,
    }


async def get_chart(entity_code: str, include_inactive: bool = False) -> List[Dict[str, Any]]:
    from sqlalchemy import select

    async with db_manager.session_factory() as session:
        stmt = (
            select(ChartOfAccountsModel)
            .where(ChartOfAccountsModel.entity_code == entity_code)
            .order_by(ChartOfAccountsModel.account_code)
        )
        rows = (await session.execute(stmt)).scalars().all()
    out = [_account_dict(r) for r in rows]
    return out if include_inactive else [a for a in out if a["is_active"]]


async def account_by_code(entity_code: str, account_code: str) -> Optional[Dict[str, Any]]:
    for account in await get_chart(entity_code, include_inactive=True):
        if account["account_code"] == account_code:
            return account
    return None


async def upsert_account(entity_code: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Create or update one account. This is what makes the chart something the
    books' owner maintains, rather than something inferred from a report."""
    code = str(payload.get("account_code") or "").strip()
    if not code:
        raise LedgerError("ACCOUNT_CODE_REQUIRED: 科目代碼不可為空。")
    account_type = str(payload.get("account_type") or "EXPENSE").upper()
    if account_type not in BS_ACCOUNT_TYPES | PL_ACCOUNT_TYPES:
        raise LedgerError(f"INVALID_ACCOUNT_TYPE: '{account_type}'")
    fs_category = str(payload.get("fs_category") or "OPEX").upper()

    async with db_manager.session_factory() as session:
        account_id = f"{entity_code}:{code}"
        model = await session.get(ChartOfAccountsModel, account_id)
        if not model:
            model = ChartOfAccountsModel(account_id=account_id, entity_code=entity_code, account_code=code)
            session.add(model)
        model.account_name = str(payload.get("account_name") or model.account_name or code)
        model.account_type = account_type
        model.normal_balance = str(
            payload.get("normal_balance") or normal_balance_for(account_type, fs_category)
        ).upper()
        model.fs_category = fs_category
        model.default_statement_ref = str(payload.get("statement_ref") or model.default_statement_ref or "TB")
        model.cash_flow_activity = str(payload.get("cash_flow_activity") or model.cash_flow_activity or "OPERATING_WC")
        model.is_control_account = bool(
            payload.get("is_control_account", fs_category in CONTROL_FS_CATEGORIES)
        )
        # A sub-ledger control account may not be posted to by hand: the entry has
        # to come from whatever maintains that sub-ledger.
        model.allow_manual_je = bool(
            payload.get("allow_manual_je", not model.is_control_account)
        )
        model.tax_code_default = payload.get("tax_code_default") or model.tax_code_default
        model.is_active = bool(payload.get("is_active", True))
        model.parent_account_id = payload.get("parent_account_id") or model.parent_account_id
        await session.commit()
        return _account_dict(model)


# ---------------------------------------------------------------------------
# Counterparties & tax codes
# ---------------------------------------------------------------------------

def _slug(text: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", (text or "").strip().lower())
    return cleaned.strip("-")[:60] or "unnamed"


async def resolve_counterparty(
    entity_code: str, name: str, counterparty_type: str = "VENDOR", country_code: str = ""
) -> Dict[str, Any]:
    """Find by name, create if new. Entries carry the dimension without the user
    having to maintain a master file first."""
    from sqlalchemy import select

    legal_name = (name or "").strip()
    if not legal_name:
        raise LedgerError("COUNTERPARTY_REQUIRED: 對方單位不可為空。")
    async with db_manager.session_factory() as session:
        stmt = select(CounterpartyModel).where(
            CounterpartyModel.entity_code == entity_code,
            CounterpartyModel.legal_name == legal_name,
        )
        model = (await session.execute(stmt)).scalars().first()
        if model:
            return {"counterparty_id": model.counterparty_id, "legal_name": model.legal_name, "counterparty_type": model.counterparty_type}
        model = CounterpartyModel(
            counterparty_id=f"{entity_code}:{_slug(legal_name)}",
            entity_code=entity_code,
            counterparty_type=counterparty_type,
            legal_name=legal_name,
            country_code=country_code or "",
        )
        session.add(model)
        await session.commit()
        return {"counterparty_id": model.counterparty_id, "legal_name": model.legal_name, "counterparty_type": model.counterparty_type}


async def list_counterparties(entity_code: str, counterparty_type: str = "") -> List[Dict[str, Any]]:
    from sqlalchemy import select

    async with db_manager.session_factory() as session:
        stmt = select(CounterpartyModel).where(CounterpartyModel.entity_code == entity_code)
        if counterparty_type:
            stmt = stmt.where(CounterpartyModel.counterparty_type == counterparty_type)
        rows = (await session.execute(stmt.order_by(CounterpartyModel.legal_name))).scalars().all()
        return [
            {
                "counterparty_id": m.counterparty_id,
                "legal_name": m.legal_name,
                "counterparty_type": m.counterparty_type,
                "country_code": m.country_code,
                "tax_id_number": m.tax_id_number,
                "withholding_rule": m.withholding_rule,
            }
            for m in rows
        ]


async def upsert_tax_code(entity_code: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    async with db_manager.session_factory() as session:
        code = str(payload["tax_code"]).strip().upper()
        tax_code_id = f"{entity_code}:{code}"
        model = await session.get(TaxCodeModel, tax_code_id)
        if not model:
            model = TaxCodeModel(
                tax_code_id=tax_code_id,
                entity_code=entity_code,
                jurisdiction=str(payload.get("jurisdiction") or ""),
                tax_code=code,
            )
            session.add(model)
        model.description = str(payload.get("description") or model.description or code)
        model.tax_mechanism = str(payload.get("tax_mechanism") or model.tax_mechanism or "VAT_GST_CREDIT")
        model.rate = str(payload.get("rate") or model.rate or "0.000000")
        model.recoverable_pct = str(payload.get("recoverable_pct") or model.recoverable_pct or "1.0000")
        model.statutory_return_box = str(payload.get("statutory_return_box") or model.statutory_return_box or "")
        model.tax_account_code = payload.get("tax_account_code") or model.tax_account_code
        model.is_active = bool(payload.get("is_active", True))
        await session.commit()
        return {"tax_code_id": model.tax_code_id, "tax_code": model.tax_code, "rate": model.rate}


async def list_tax_codes(entity_code: str) -> List[Dict[str, Any]]:
    from sqlalchemy import select

    async with db_manager.session_factory() as session:
        stmt = (
            select(TaxCodeModel)
            .where(TaxCodeModel.entity_code == entity_code)
            .order_by(TaxCodeModel.tax_code)
        )
        rows = (await session.execute(stmt)).scalars().all()
        return [
            {
                "tax_code": m.tax_code,
                "description": m.description,
                "tax_mechanism": m.tax_mechanism,
                "rate": m.rate,
                "recoverable_pct": m.recoverable_pct,
                "statutory_return_box": m.statutory_return_box,
                "tax_account_code": m.tax_account_code,
            }
            for m in rows
        ]


# ---------------------------------------------------------------------------
# The ledger
# ---------------------------------------------------------------------------

async def write_lines_for_entry(journal: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Project a posted voucher into the ledger. Called once, at posting: drafts keep
    their own `lines_json` so they stay editable, and the ledger only ever sees
    entries that have been approved.
    """
    entity_code = journal["entity_code"]
    period_code = journal.get("period") or str(journal.get("accounting_date"))[:7]
    entry_layer = journal.get("entry_layer") or "OPERATIONAL"
    currency = journal.get("currency") or ""
    rate = str(journal.get("exchange_rate") or "1.00000000")

    written: List[Dict[str, Any]] = []
    async with db_manager.session_factory() as session:
        # Replacing rather than appending makes the write idempotent: a retry
        # after a partial failure cannot double-post the same voucher.
        existing = (
            await session.execute(select(JournalLineModel).where(JournalLineModel.journal_id == journal["journal_id"]))
        ).scalars().all()
        for row in existing:
            await session.delete(row)

        for line in journal.get("lines", []):
            account = await account_by_code(entity_code, line["account_code"])
            if not account:
                raise LedgerError(f"COA_MISSING_ACCOUNT: 科目 {line['account_code']} 不存在於科目表。")
            tx_dr, tx_cr = q4(line.get("debit") or 0), q4(line.get("credit") or 0)
            func_dr = q4(line.get("func_debit") or tx_dr)
            func_cr = q4(line.get("func_credit") or tx_cr)
            model = JournalLineModel(
                line_id=str(uuid4()),
                journal_id=journal["journal_id"],
                entity_code=entity_code,
                line_number=int(line["line_number"]),
                account_id=account["account_id"],
                account_code=account["account_code"],
                account_name=account["account_name"],
                period_code=period_code,
                entry_layer=entry_layer if entry_layer in ALL_LAYERS else "OPERATIONAL",
                accounting_date=journal["accounting_date"],
                tx_currency=line.get("tx_currency") or currency,
                exchange_rate=str(line.get("exchange_rate") or rate),
                tx_debit=str(tx_dr),
                tx_credit=str(tx_cr),
                func_debit=str(func_dr),
                func_credit=str(func_cr),
                counterparty_id=line.get("counterparty_id"),
                counterparty_name=line.get("counterparty") or "",
                tax_code_id=line.get("tax_code_id"),
                func_tax_amount=str(q4(line.get("func_tax_amount") or 0)),
                business_use_pct=str(line.get("business_use_pct") or "1.0000"),
                statement_ref=line.get("statement_ref") or account["statement_ref"],
                memo=line.get("memo") or "",
            )
            session.add(model)
            written.append({"account_code": model.account_code, "line_id": model.line_id})
        await session.commit()
    return written


async def get_lines(
    entity_code: str,
    account_code: str = "",
    period_code: str = "",
    counterparty_id: str = "",
    limit: int = 0,
) -> List[Dict[str, Any]]:
    from sqlalchemy import select

    async with db_manager.session_factory() as session:
        stmt = select(JournalLineModel).where(JournalLineModel.entity_code == entity_code)
        if account_code:
            stmt = stmt.where(JournalLineModel.account_code == account_code)
        if period_code:
            stmt = stmt.where(JournalLineModel.period_code == period_code)
        if counterparty_id:
            stmt = stmt.where(JournalLineModel.counterparty_id == counterparty_id)
        stmt = stmt.order_by(JournalLineModel.accounting_date, JournalLineModel.line_number)
        if limit:
            stmt = stmt.limit(limit)
        rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "line_id": m.line_id,
            "journal_id": m.journal_id,
            "account_code": m.account_code,
            "account_name": m.account_name,
            "period_code": m.period_code,
            "entry_layer": m.entry_layer,
            "accounting_date": m.accounting_date,
            "tx_currency": m.tx_currency,
            "exchange_rate": m.exchange_rate,
            "tx_debit": m.tx_debit,
            "tx_credit": m.tx_credit,
            "func_debit": m.func_debit,
            "func_credit": m.func_credit,
            "counterparty_id": m.counterparty_id,
            "counterparty_name": m.counterparty_name,
            "tax_code_id": m.tax_code_id,
            "business_use_pct": m.business_use_pct,
            "statement_ref": m.statement_ref,
            "memo": m.memo,
        }
        for m in rows
    ]


# ---------------------------------------------------------------------------
# Derived balances
# ---------------------------------------------------------------------------

@dataclass
class AccountBalance:
    account_code: str
    opening: Decimal          # signed: positive = debit
    op_debit: Decimal
    op_credit: Decimal
    aj_debit: Decimal
    aj_credit: Decimal
    debit_nature: bool

    @property
    def movement(self) -> Decimal:
        return q4((self.op_debit - self.op_credit) + (self.aj_debit - self.aj_credit))

    @property
    def closing(self) -> Decimal:
        return q4(self.opening + self.movement)

    @property
    def closing_side(self) -> str:
        """The side the balance sits on, which is not the same as its sign for a
        contra account."""
        if self.closing >= 0:
            return "DEBIT" if self.debit_nature else "DEBIT"
        return "CREDIT"

    @property
    def display_balance(self) -> Decimal:
        """Always reported on the account's own normal side."""
        if self.debit_nature:
            return self.closing
        return -self.closing  # a credit-nature account reads positive when in credit


async def derive_balances(entity_code: str, period_code: str) -> Dict[str, AccountBalance]:
    """
    One pass over the entity's lines produces every account's opening, period
    movement, adjustments and closing balance for a given period.
    """
    period = await get_period(entity_code, period_code)
    start_date = period["start_date"]
    chart = await get_chart(entity_code, include_inactive=True)
    lines = await get_lines(entity_code)

    balances: Dict[str, AccountBalance] = {}
    for account in chart:
        debit_nature = account["normal_balance"] == "DEBIT"
        opening = ZERO
        op_dr = op_cr = aj_dr = aj_cr = ZERO
        for line in lines:
            if line["account_code"] != account["account_code"]:
                continue
            dr = Decimal(line["func_debit"] or "0")
            cr = Decimal(line["func_credit"] or "0")
            if line["period_code"] == period_code:
                if line["entry_layer"] in ADJUSTMENT_LAYERS:
                    aj_dr += dr
                    aj_cr += cr
                else:
                    op_dr += dr
                    op_cr += cr
            elif line["accounting_date"] < start_date:
                # Every account carries forward. A trial balance is cumulative
                # from the start of the fiscal year: income and expense accounts
                # accumulate until the year is closed, which is why a November
                # balance sheet balances without the P&L having to be reset.
                # Closing them into retained earnings is the fiscal-year close,
                # which is a separate routine and not built yet.
                opening += dr - cr
        balances[account["account_code"]] = AccountBalance(
            account_code=account["account_code"],
            opening=q4(opening),
            op_debit=q4(op_dr),
            op_credit=q4(op_cr),
            aj_debit=q4(aj_dr),
            aj_credit=q4(aj_cr),
            debit_nature=debit_nature,
        )
    return balances


async def trial_balance_from_ledger(entity_code: str, period_code: str) -> List[TrialBalanceAccountRow]:
    """
    The extended trial balance, computed from the ledger.

    This replaces reading balances out of a table: the schedule engine takes
    exactly this shape, so the 785 lines of statement maths are untouched — only
    where the numbers come from has changed.
    """
    chart = await get_chart(entity_code, include_inactive=True)
    balances = await derive_balances(entity_code, period_code)
    rows: List[TrialBalanceAccountRow] = []
    for account in chart:
        b = balances.get(account["account_code"])
        if not b:
            continue
        rows.append(
            TrialBalanceAccountRow(
                account_code=account["account_code"],
                account_name=account["account_name"],
                account_type=account["account_type"],
                fs_category=account["fs_category"],
                statement_ref=account["statement_ref"],
                cash_flow_activity=account["cash_flow_activity"],
                opening_balance=b.opening,
                period_op_debit=b.op_debit,
                period_op_credit=b.op_credit,
                adjustment_debit=b.aj_debit,
                adjustment_credit=b.aj_credit,
            )
        )
    return rows


async def trial_balance(entity_code: str, period_code: str) -> List[Dict[str, Any]]:
    chart = await get_chart(entity_code, include_inactive=True)
    balances = await derive_balances(entity_code, period_code)
    rows = []
    for account in chart:
        b = balances.get(account["account_code"])
        if not b:
            continue
        rows.append(
            {
                "account_code": account["account_code"],
                "account_name": account["account_name"],
                "account_type": account["account_type"],
                "fs_category": account["fs_category"],
                "statement_ref": account["statement_ref"],
                "normal_balance": account["normal_balance"],
                "opening": str(b.opening),
                "opening_side": "DEBIT" if b.opening >= 0 else "CREDIT",
                "period_debit": str(b.op_debit),
                "period_credit": str(b.op_credit),
                "adjustment_debit": str(b.aj_debit),
                "adjustment_credit": str(b.aj_credit),
                "closing": str(b.closing),
                "closing_side": "DEBIT" if b.closing >= 0 else "CREDIT",
                "display_balance": str(b.display_balance),
            }
        )
    return rows


async def assert_trial_balance(entity_code: str, period_code: str) -> Dict[str, Any]:
    """Σ debits ≡ Σ credits, entity-wide and for the period. This is the check
    that has to pass before a period may be locked."""
    lines = await get_lines(entity_code)
    all_dr = sum((Decimal(l["func_debit"] or "0") for l in lines), ZERO)
    all_cr = sum((Decimal(l["func_credit"] or "0") for l in lines), ZERO)
    period_lines = [l for l in lines if l["period_code"] == period_code]
    p_dr = sum((Decimal(l["func_debit"] or "0") for l in period_lines), ZERO)
    p_cr = sum((Decimal(l["func_credit"] or "0") for l in period_lines), ZERO)
    return {
        "ledger_balanced": q4(all_dr) == q4(all_cr),
        "ledger_debit": str(q4(all_dr)),
        "ledger_credit": str(q4(all_cr)),
        "ledger_difference": str(q4(all_dr - all_cr)),
        "period_balanced": q4(p_dr) == q4(p_cr),
        "period_debit": str(q4(p_dr)),
        "period_credit": str(q4(p_cr)),
        "period_difference": str(q4(p_dr - p_cr)),
    }


async def account_ledger(entity_code: str, account_code: str, period_code: str) -> Dict[str, Any]:
    """Opening + movements + closing for one account, with a running balance."""
    account = await account_by_code(entity_code, account_code)
    if not account:
        raise LedgerError(f"COA_MISSING_ACCOUNT: 科目 {account_code} 不存在於科目表。")
    period = await get_period(entity_code, period_code)
    balances = await derive_balances(entity_code, period_code)
    b = balances[account_code]
    debit_nature = account["normal_balance"] == "DEBIT"

    running = b.opening
    movements = []
    for line in await get_lines(entity_code, account_code=account_code, period_code=period_code):
        dr = Decimal(line["func_debit"] or "0")
        cr = Decimal(line["func_credit"] or "0")
        running = q4(running + dr - cr)
        movements.append(
            {
                "date": line["accounting_date"],
                "voucher_no": None,  # filled by the caller from the entry if needed
                "journal_id": line["journal_id"],
                "entry_layer": line["entry_layer"],
                "memo": line["memo"],
                "counterparty": line["counterparty_name"],
                "debit": str(dr),
                "credit": str(cr),
                "balance": str(running),
                "balance_side": "DEBIT" if running >= 0 else "CREDIT",
            }
        )
    return {
        "account": account,
        "period": period_code,
        "opening_balance": str(b.opening),
        "opening_side": "DEBIT" if b.opening >= 0 else "CREDIT",
        "total_debit": str(b.op_debit + b.aj_debit),
        "total_credit": str(b.op_credit + b.aj_credit),
        "closing_balance": str(b.closing),
        "closing_side": "DEBIT" if b.closing >= 0 else "CREDIT",
        "display_balance": str(b.display_balance),
        "debit_nature": debit_nature,
        "movements": movements,
    }


# ---------------------------------------------------------------------------
# Closing a period
# ---------------------------------------------------------------------------

async def close_period(entity_code: str, period_code: str, principal_key: str) -> Dict[str, Any]:
    """
    Close the books for a period.

    Three things happen, in this order, and the first two can refuse:

      1. Nothing may be awaiting a decision inside the period — closing over
         unposted work is how a ledger ends up disagreeing with its vouchers.
      2. The ledger must balance.
      3. The period is locked against a named principal, and the next period is
         opened. Opening balances are not copied anywhere: they are the sum of
         everything dated before the next period starts, which is the same thing
         but cannot drift.
    """
    period = await get_period(entity_code, period_code)
    if period["status"] == "LOCKED":
        raise LedgerError(f"PERIOD_ALREADY_LOCKED: 期間 {period_code} 已經封存。")

    journals = await _journals(entity_code)
    pending = [
        j for j in journals
        if j.get("period") == period_code and j.get("status") in ("DRAFT", "PENDING_CHECKER", "AWAITING_CPA")
    ]
    if pending:
        listing = "、".join((j.get("voucher_no") or j.get("journal_id", "")) for j in pending[:5])
        raise LedgerError(
            f"PERIOD_HAS_UNPOSTED_VOUCHERS: 期間 {period_code} 尚有 {len(pending)} 張未過賬憑證（{listing}…）。"
            "結帳前必須全部處理完畢。"
        )

    balance = await assert_trial_balance(entity_code, period_code)
    if not balance["ledger_balanced"]:
        raise LedgerError(
            f"TRIAL_BALANCE_BROKEN: 分類帳借貸不平衡，借方 {balance['ledger_debit']}，"
            f"貸方 {balance['ledger_credit']}，差額 {balance['ledger_difference']}。不可結帳。"
        )

    next_code = next_period_code(period_code)
    await ensure_period(entity_code, next_code, status="OPEN")

    async with db_manager.session_factory() as session:
        model = await session.get(FiscalPeriodModel, f"{entity_code}:{period_code}")
        model.status = "LOCKED"
        model.closed_by_principal_key = principal_key
        model.closed_at = datetime.now(timezone.utc)
        await session.commit()

    carried = await derive_balances(entity_code, next_code)
    carried_rows = [
        {"account_code": code, "opening": str(b.opening)}
        for code, b in sorted(carried.items())
        if b.opening != ZERO
    ]
    return {
        "period_code": period_code,
        "status": "LOCKED",
        "closed_by_principal_key": principal_key,
        "next_period": next_code,
        "trial_balance": balance,
        "carried_forward": carried_rows,
        "carried_forward_total": str(q4(sum((Decimal(r["opening"]) for r in carried_rows), ZERO))),
    }


async def _journals(entity_code: str) -> List[Dict[str, Any]]:
    from app.core.repository import repo

    return await repo.get_journals(entity_code=entity_code)


# ---------------------------------------------------------------------------
# One-time migration: legacy trial balance seed -> ledger
#
# The old model kept the chart of accounts and its balances in the same fourteen
# rows. The migration has to invent exactly two things, and only here:
#
#   * `normal_balance`, because the old model had no such field. From this point
#     on it is data the books' owner maintains, not a formula (a contra account
#     is the reason the derivation was never reliable).
#   * counterparties. The old seed recorded vendor and customer *names* as free
#     text inside schedule notes; rather than guess which line belonged to whom,
#     only the owner's current account is tagged, because that one is true by
#     definition. Everything else is left empty and can be filled in as the
#     entries are reviewed.
#
# The seeded figures become three vouchers per entity — opening, period activity,
# adjustments — so that every number in the ledger traces to an entry, and the
# derived trial balance reproduces the old one exactly. That equality is the acceptance
# test for the migration.
# ---------------------------------------------------------------------------

#: Tax treatments recognised by GlobalLocalizationEngine. Rates come from that
#: engine and from its documented jurisdiction notes, not from invention.
TAX_CODE_SEEDS: Dict[str, List[Dict[str, Any]]] = {
    "AU": [
        {"tax_code": "AU_GST_10", "description": "GST 10%", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.100000", "recoverable_pct": "1.0000", "statutory_return_box": "BAS_1A_1B", "tax_account_code": "2210"},
        {"tax_code": "AU_GST_FREE", "description": "GST-free supply", "tax_mechanism": "EXEMPT", "rate": "0.000000", "recoverable_pct": "0.0000", "statutory_return_box": "BAS_G1"},
        {"tax_code": "AU_INPUT_GST", "description": "Input GST credit on purchases", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.100000", "recoverable_pct": "1.0000", "statutory_return_box": "BAS_1B_GST_CREDITS", "tax_account_code": "1420"},
    ],
    "CN": [
        {"tax_code": "CN_VAT_13", "description": "增值稅 13%", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.130000", "recoverable_pct": "1.0000", "tax_account_code": "2210"},
        {"tax_code": "CN_VAT_9", "description": "增值稅 9%", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.090000", "recoverable_pct": "1.0000", "tax_account_code": "2210"},
        {"tax_code": "CN_VAT_6", "description": "增值稅 6%", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.060000", "recoverable_pct": "1.0000", "tax_account_code": "2210"},
        {"tax_code": "CN_VAT_SMALL_3", "description": "小規模納稅人 3%", "tax_mechanism": "SMALL_SCALE_VAT", "rate": "0.030000", "recoverable_pct": "0.0000", "tax_account_code": "2210"},
        {"tax_code": "CN_INPUT_VAT", "description": "進項稅額", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.130000", "recoverable_pct": "1.0000", "tax_account_code": "1420"},
    ],
    "HK": [
        {"tax_code": "HK_NO_VAT", "description": "香港不設增值稅／銷售稅", "tax_mechanism": "EXEMPT", "rate": "0.000000", "recoverable_pct": "0.0000"},
        {"tax_code": "HK_OFFSHORE", "description": "離岸利潤（非源自香港）", "tax_mechanism": "EXEMPT", "rate": "0.000000", "recoverable_pct": "0.0000"},
    ],
    "SG": [
        {"tax_code": "SG_GST_9_SR", "description": "GST 9% standard-rated", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.090000", "recoverable_pct": "1.0000", "statutory_return_box": "GST_F5_BOX1", "tax_account_code": "2210"},
        {"tax_code": "SG_GST_9_RC", "description": "GST 9% reverse charge (imported services)", "tax_mechanism": "REVERSE_CHARGE", "rate": "0.090000", "recoverable_pct": "1.0000", "statutory_return_box": "GST_F5_BOX7", "tax_account_code": "2210"},
        {"tax_code": "SG_GST_ZR", "description": "GST zero-rated", "tax_mechanism": "ZERO_RATED", "rate": "0.000000", "recoverable_pct": "1.0000"},
        {"tax_code": "SG_INPUT_GST", "description": "Input GST claimable", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.090000", "recoverable_pct": "1.0000", "tax_account_code": "1420"},
    ],
    "US": [
        {"tax_code": "US_SALES_TAX_8_25", "description": "State sales tax 8.25%", "tax_mechanism": "US_SALES_TAX", "rate": "0.082500", "recoverable_pct": "0.0000", "tax_account_code": "2210"},
        {"tax_code": "US_CONSUMER_USE_TAX_8_25", "description": "Consumer use tax 8.25% (nexus accrual)", "tax_mechanism": "US_USE_TAX_ACCRUAL", "rate": "0.082500", "recoverable_pct": "0.0000", "tax_account_code": "2210"},
        {"tax_code": "US_EXEMPT", "description": "Exempt / not subject to sales tax", "tax_mechanism": "EXEMPT", "rate": "0.000000", "recoverable_pct": "0.0000"},
    ],
    "EU": [
        {"tax_code": "EU_VAT_20_STD", "description": "VAT 20% standard rate", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.200000", "recoverable_pct": "1.0000", "tax_account_code": "2210"},
        {"tax_code": "EU_IC_REVERSE_CHARGE_20", "description": "Intra-community reverse charge 20%", "tax_mechanism": "REVERSE_CHARGE", "rate": "0.200000", "recoverable_pct": "1.0000", "tax_account_code": "2210"},
        {"tax_code": "EU_VAT_ZERO", "description": "Zero-rated intra-community supply", "tax_mechanism": "ZERO_RATED", "rate": "0.000000", "recoverable_pct": "1.0000"},
        {"tax_code": "EU_INPUT_VAT", "description": "Input VAT recoverable", "tax_mechanism": "VAT_GST_CREDIT", "rate": "0.200000", "recoverable_pct": "1.0000", "tax_account_code": "1420"},
    ],
}


async def migrate_entity_core(
    entity_code: str, jurisdiction: str, seed_period: str = "2026-10", currency: str = "AUD"
) -> Dict[str, Any]:
    """Idempotent. Safe to call on every start-up."""
    if await get_chart(entity_code, include_inactive=True):
        return {"status": "ALREADY_MIGRATED"}

    from app.core.repository import repo

    legacy = await repo.get_trial_balance_accounts(entity_code)
    if not legacy:
        return {"status": "NO_SEED_DATA"}

    # 1) chart of accounts
    for row in legacy:
        await upsert_account(
            entity_code,
            {
                "account_code": row.account_code,
                "account_name": row.account_name,
                "account_type": row.account_type,
                "fs_category": row.fs_category,
                "statement_ref": row.statement_ref,
                "cash_flow_activity": row.cash_flow_activity,
                # A control account is flagged as such, but manual posting has to
                # stay open until the AR/AP/FA sub-ledgers exist to generate those
                # entries. Blocking now would refuse every payables entry in the
                # product. Flip this to False account by account as each
                # sub-ledger lands.
                "allow_manual_je": True,
            },
        )

    # 2) periods: the period before the seed (where the opening sits) plus two ahead
    prior = previous_period_code(seed_period)
    for code in (prior, seed_period, next_period_code(seed_period), next_period_code(next_period_code(seed_period))):
        await ensure_period(entity_code, code)

    # 3) tax codes for the jurisdiction
    seeded_tax = 0
    for payload in TAX_CODE_SEEDS.get(jurisdiction, []):
        await upsert_tax_code(entity_code, {**payload, "jurisdiction": jurisdiction})
        seeded_tax += 1

    # 4) the owner's current account is the one counterparty the seed implies
    owner_type = "OWNER_DIRECTOR"
    owner = await resolve_counterparty(entity_code, "Owner / Director", owner_type)

    created: List[Dict[str, Any]] = []
    for layer, period_code, accounting_date, label, amounts in (
        (
            "OPENING",
            prior,
            f"{prior}-{calendar.monthrange(int(prior[:4]), int(prior[5:7]))[1]:02d}",
            "期初餘額",
            [(r.account_code, r.opening_balance) for r in legacy if r.opening_balance != ZERO],
        ),
        (
            "OPERATIONAL",
            seed_period,
            f"{seed_period}-15",
            "本期發生額",
            [(r.account_code, r.period_op_debit) for r in legacy if r.period_op_debit != ZERO]
            + [(r.account_code, -r.period_op_credit) for r in legacy if r.period_op_credit != ZERO],
        ),
        (
            "AJE_MONTH_END",
            seed_period,
            f"{seed_period}-28",
            "期末調整分錄",
            [(r.account_code, r.adjustment_debit) for r in legacy if r.adjustment_debit != ZERO]
            + [(r.account_code, -r.adjustment_credit) for r in legacy if r.adjustment_credit != ZERO],
        ),
    ):
        if not amounts:
            continue
        voucher = await _write_migration_voucher(
            entity_code, currency, period_code, accounting_date, layer, label, amounts,
            owner_id=owner["counterparty_id"] if layer in ("OPENING", "OPERATIONAL") else None,
        )
        created.append(voucher)

    return {
        "status": "MIGRATED",
        "accounts": len(legacy),
        "tax_codes": seeded_tax,
        "vouchers": created,
    }


async def _write_migration_voucher(
    entity_code: str,
    currency: str,
    period_code: str,
    accounting_date: str,
    entry_layer: str,
    label: str,
    amounts: List[Tuple[str, Decimal]],
    owner_id: Optional[str] = None,
) -> Dict[str, Any]:
    """One voucher carrying the whole migrated position for a layer.

    Inventing per-transaction vouchers would fabricate detail that never existed;
    a single labelled entry per layer preserves every figure exactly and is
    traceable to its origin.
    """
    from app.core.repository import repo

    lines: List[Dict[str, Any]] = []
    total_dr = total_cr = ZERO
    for index, (account_code, signed) in enumerate(amounts, start=1):
        account = await account_by_code(entity_code, account_code)
        amount = q4(abs(signed))
        if amount == ZERO:
            continue
        is_debit = signed > 0
        if is_debit:
            total_dr += amount
        else:
            total_cr += amount
        lines.append(
            {
                "line_number": index,
                "account_code": account_code,
                "account_name": account["account_name"] if account else "",
                "debit": str(amount) if is_debit else "0.0000",
                "credit": "0.0000" if is_debit else str(amount),
                "memo": f"系統遷移：{label}",
                "counterparty": "",
                "counterparty_id": owner_id if account_code == "2190" else None,
                "tax_code": "",
                "business_use_pct": "1.0000",
            }
        )

    if q4(total_dr) != q4(total_cr):
        raise LedgerError(
            f"MIGRATION_UNBALANCED: {label} 借貸不平（借 {total_dr}，貸 {total_cr}），遷移中止。"
        )

    journal = {
        "journal_id": f"MIGRATION-{entity_code}-{entry_layer}",
        "entity_code": entity_code,
        "period": period_code,
        "voucher_no": {"OPENING": "MIG-OPEN", "OPERATIONAL": "MIG-OPS", "AJE_MONTH_END": "MIG-AJE"}.get(
            entry_layer, f"MIG-{entry_layer}"
        ),
        "accounting_date": accounting_date,
        "currency": currency,
        "status": "POSTED",
        "source_module": "MIGRATION",
        "entry_layer": entry_layer,
        "basis": "MANUAL",
        "memo": f"系統遷移憑證：由舊試算表種子產生（{label}）",
        "total_debit": str(q4(total_dr)),
        "total_credit": str(q4(total_cr)),
        "lines": lines,
        "evidence_uris": [],
        "created_by_principal_key": "system-migration",
        "created_by_principal_id": SYSTEM_PRINCIPAL_ID,
        "approved_by_principal_key": "system-migration",
        "approved_by_principal_id": SYSTEM_PRINCIPAL_ID,
        "ai_confidence_score": "1.0000",
        "ai_reasoning_summary": "遷移：非業務分錄，無複核人。",
    }
    await repo.save_journal(journal)
    await write_lines_for_entry(journal)
    return {
        "journal_id": journal["journal_id"],
        "voucher_no": journal["voucher_no"],
        "entry_layer": entry_layer,
        "period": period_code,
        "lines": len(lines),
        "total_debit": journal["total_debit"],
    }


#: The migration vouchers are entry-level artefacts, not work done by a person or
#: a bot. A fixed principal id keeps the audit report honest about that.
SYSTEM_PRINCIPAL_ID = "00000000-0000-0000-0000-000000000000"


# ---------------------------------------------------------------------------
# Cash flow, by nature
# ---------------------------------------------------------------------------

async def cash_flow_breakdown(entity_code: str, period_code: str) -> Dict[str, Any]:
    """
    Where the cash came from and where it went, bucketed by what the other side
    of the entry was.

    The derivation is an identity, not an estimate. Double entry says the cash
    change equals the sum of every non-cash line's (credit - debit):

        收入貸 150,000  →  +150,000  (inflow)
        成本借  24,000  →   -24,000  (outflow)

    so the buckets cannot disagree with the ledger. The tie that matters for the
    reader is checked here too: opening + movement == the balance sheet's cash.
    """
    chart = {a["account_code"]: a for a in await get_chart(entity_code, include_inactive=True)}
    cash_codes = {code for code, a in chart.items() if a["fs_category"] == "CASH"}
    period = await get_period(entity_code, period_code)

    lines = [l for l in await get_lines(entity_code) if l["period_code"] == period_code]
    by_entry: Dict[str, List[Dict[str, Any]]] = {}
    for line in lines:
        by_entry.setdefault(line["journal_id"], []).append(line)

    buckets: Dict[str, Decimal] = {}
    for entry_lines in by_entry.values():
        if not any(l["account_code"] in cash_codes for l in entry_lines):
            continue
        for line in entry_lines:
            if line["account_code"] in cash_codes:
                continue
            contribution = q4(Decimal(line["func_credit"] or "0") - Decimal(line["func_debit"] or "0"))
            if contribution == 0:
                continue
            account = chart.get(line["account_code"], {})
            key = account.get("fs_category") or "OTHER"
            entry = buckets.setdefault(key, {"amount": ZERO, "account_type": account.get("account_type", "")})
            entry["amount"] = q4(entry["amount"] + contribution)

    balances = await derive_balances(entity_code, period_code)
    opening = q4(sum((balances[c].opening for c in cash_codes if c in balances), ZERO))
    closing = q4(sum((balances[c].closing for c in cash_codes if c in balances), ZERO))
    derived = q4(sum((v["amount"] for v in buckets.values()), ZERO))

    def bucket_rows(sign: int) -> List[Dict[str, str]]:
        rows = [
            {"fs_category": k, "account_type": v["account_type"], "amount": str(sign * v["amount"])}
            for k, v in buckets.items()
            if (v["amount"] > 0) == (sign > 0) and v["amount"] != 0
        ]
        return sorted(rows, key=lambda r: -Decimal(r["amount"]))

    inflows = bucket_rows(1)
    outflows = bucket_rows(-1)

    return {
        "entity_code": entity_code,
        "period": period_code,
        "currency": None,  # filled by the caller from the entity
        "opening": str(opening),
        "closing": str(closing),
        "movement": str(q4(closing - opening)),
        "derived_movement": str(derived),
        "inflows": inflows,
        "outflows": outflows,
        "ties": derived == q4(closing - opening),
        "period_start": period["start_date"],
        "period_end": period["end_date"],
    }
