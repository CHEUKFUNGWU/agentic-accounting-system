"""
會計崗位 (accounting positions).

In an accounting department authority is assigned by **position and account
scope**, not by amount. The cashier never reviews, the AR clerk only records
receivables and revenue, the chief accountant reviews everything but may only
prepare general-ledger entries, and the finance manager reviews the chief
accountant's own work.

This module is deliberately the single source of truth for that matrix. The MCP
role servers expose tools from it (see app/mcp_roles.py), so "who may do what"
is decided once, here, and enforced by which tools a position can even see.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, List, Optional

# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Position:
    position_id: str
    title_en: str
    title_zh: str
    #: Bot identity that holds this position (see mcp_server.PRINCIPALS).
    principal_key: str
    #: Chart-of-accounts codes this position may PREPARE entries for.
    account_scope: FrozenSet[str]
    #: Everything in `account_scope` plus value-bearing accounts it never
    #: touches (used to bound which vouchers it can reverse).
    can_prepare: bool
    can_review: bool
    #: 出納 — has custody of cash and therefore may never review anything.
    cash_custody: bool
    #: 1 = clerk, 2 = chief accountant, 3 = finance manager, 4 = external CPA
    review_level: int
    #: May read every account in the ledger, not just its own scope.
    read_all_accounts: bool
    #: Human-facing note, surfaced by the whoami tool.
    mandate_en: str
    mandate_zh: str
    #: True only for principals that are people. The audit question "was a human
    #: in the loop" is unanswerable without this flag.
    is_human: bool = False


# Account codes come from the seeded chart of accounts:
#   1110 銀行存款 1210 應收帳款 1420 預付款項及進項稅額 1610 固定資產原值
#   1650 累計折舊 2110 應付帳款及應計費用 2190 股東/業主往來 2210 應交稅費
#   3100 實收資本及期初留存 4100 主營業務收入 5100 主營業務成本
#   6100 管理及營運費用 6410 折舊費用 7500 所得稅費用

POSITIONS: Dict[str, Position] = {
    "CASHIER": Position(
        position_id="CASHIER",
        title_en="Cashier",
        title_zh="出納",
        principal_key="cashier-01",
        account_scope=frozenset({"1110"}),
        can_prepare=True,
        can_review=False,
        cash_custody=True,
        review_level=1,
        read_all_accounts=False,
        mandate_en="Bank and cash movements only. Cannot record revenue, expenses, receivables or payables, "
        "and may never review a voucher (segregation of custody from record-keeping).",
        mandate_zh="只登記現金與銀行收付。不得登記收入、費用、債權債務，且永遠不可複核憑證（錢帳分管）。",
    ),
    "AR_CLERK": Position(
        position_id="AR_CLERK",
        title_en="Receivables accountant",
        title_zh="應收會計",
        principal_key="ar-clerk-01",
        account_scope=frozenset({"1210", "4100"}),
        can_prepare=True,
        can_review=False,
        cash_custody=False,
        review_level=1,
        read_all_accounts=False,
        mandate_en="Receivables and revenue only.",
        mandate_zh="只負責應收帳款與收入。",
    ),
    "AP_CLERK": Position(
        position_id="AP_CLERK",
        title_en="Payables accountant",
        title_zh="應付會計",
        principal_key="ap-clerk-01",
        # 5100 (COGS) sits with payables when there is no separate cost accountant.
        account_scope=frozenset({"2110", "6100", "1420", "5100"}),
        can_prepare=True,
        can_review=False,
        cash_custody=False,
        review_level=1,
        read_all_accounts=False,
        mandate_en="Payables, operating expenses, prepayments and cost of sales.",
        mandate_zh="負責應付帳款、管理費用、預付款項與營業成本。",
    ),
    "FA_CLERK": Position(
        position_id="FA_CLERK",
        title_en="Fixed asset accountant",
        title_zh="固定資產會計",
        principal_key="fa-clerk-01",
        account_scope=frozenset({"1610", "1650", "6410"}),
        can_prepare=True,
        can_review=False,
        cash_custody=False,
        review_level=1,
        read_all_accounts=False,
        mandate_en="Fixed asset register, accumulated depreciation and the depreciation run.",
        mandate_zh="負責固定資產登記簿、累計折舊與折舊跑批。",
    ),
    "TAX_CLERK": Position(
        position_id="TAX_CLERK",
        title_en="Tax accountant",
        title_zh="稅務會計",
        principal_key="tax-clerk-01",
        account_scope=frozenset({"2210", "7500"}),
        can_prepare=True,
        can_review=False,
        cash_custody=False,
        review_level=1,
        read_all_accounts=False,
        mandate_en="Statutory taxes payable and income tax expense.",
        mandate_zh="負責應交稅費與所得稅費用。",
    ),
    "GL_ACCOUNTANT": Position(
        position_id="GL_ACCOUNTANT",
        title_en="Chief accountant / General ledger",
        title_zh="會計主任／總帳會計",
        principal_key="gl-chief-01",
        # General-ledger nature entries only: equity, opening balances, owner
        # current account. Operational account entries belong to the clerks —
        # if the chief accountant prepared them too, nobody below could review.
        account_scope=frozenset({"3100", "2190"}),
        can_prepare=True,
        can_review=True,
        cash_custody=False,
        review_level=2,
        read_all_accounts=True,
        mandate_en="Reviews every voucher in every account. May only PREPARE general-ledger entries "
        "(equity, opening balances, owner current account, period close).",
        mandate_zh="可複核全部科目的憑證；但只能編制總帳性質的分錄（權益、期初、股東往來、月末結轉）。",
    ),
    "FINANCE_MANAGER": Position(
        position_id="FINANCE_MANAGER",
        title_en="Finance manager",
        title_zh="財務經理",
        principal_key="finance-manager-01",
        account_scope=frozenset({"*"}),
        can_prepare=True,
        can_review=True,
        cash_custody=False,
        review_level=3,
        read_all_accounts=True,
        mandate_en="Reviews the chief accountant's own entries, approves the period close and the pack.",
        mandate_zh="複核會計主任自己編制的分錄，核准結帳與報表。",
    ),
    "CPA_ADVISOR": Position(
        position_id="CPA_ADVISOR",
        title_en="External CPA (bookkeeping oversight)",
        title_zh="外部會計師（帳務督導）",
        principal_key="cpa-griffin",
        account_scope=frozenset(),
        can_prepare=False,
        can_review=True,
        cash_custody=False,
        review_level=4,
        read_all_accounts=True,
        mandate_en="For one-person companies there is no internal chief accountant, so review lands here. "
        "Reviewing a voucher is a different act from signing the annual accounts.",
        mandate_zh="一人公司沒有內部會計主任，複核落在這裡。複核憑證與簽核年度報表是兩件事。",
    ),
    "FOUNDER_DIRECTOR": Position(
        position_id="FOUNDER_DIRECTOR",
        title_en="Founder / Director (human)",
        title_zh="創辦人／董事（人）",
        principal_key="founder-director-01",
        account_scope=frozenset(),
        can_prepare=False,
        can_review=False,
        cash_custody=False,
        review_level=5,
        read_all_accounts=True,
        mandate_en="Signs the financial statements, approves payments and resolves the exception queue. "
        "Does not review vouchers — that is the accounting department's job.",
        mandate_zh="簽核財務報表、批准付款、處理例外佇列。不複核憑證——那是會計部門的事。",
        is_human=True,
    ),
    "AUDITOR_READONLY": Position(
        position_id="AUDITOR_READONLY",
        title_en="Auditor (read-only)",
        title_zh="審計（唯讀）",
        principal_key="auditor-readonly-01",
        account_scope=frozenset(),
        can_prepare=False,
        can_review=False,
        cash_custody=False,
        review_level=0,
        read_all_accounts=True,
        mandate_en="Read-only. No write tool exists on this surface.",
        mandate_zh="唯讀。這個表面上不存在任何寫入工具。",
    ),
}

POSITION_IDS: List[str] = list(POSITIONS.keys())


# ---------------------------------------------------------------------------
# Scope helpers
# ---------------------------------------------------------------------------

def in_scope(position: Position, account_code: str) -> bool:
    return "*" in position.account_scope or account_code in position.account_scope


def out_of_scope(position: Position, account_codes: Iterable[str]) -> List[str]:
    return [code for code in account_codes if not in_scope(position, code)]


def visible_accounts(position: Position, all_codes: Iterable[str]) -> List[str]:
    if position.read_all_accounts:
        return list(all_codes)
    return [code for code in all_codes if in_scope(position, code)]


# ---------------------------------------------------------------------------
# Reviewer assignment — by position and account ownership, never by amount
# ---------------------------------------------------------------------------

def required_reviewer(preparer: Position) -> Position:
    """
    Who must review this position's vouchers.

    The three rules, in accounting terms:
      1. 出納 cannot review anything (custody vs record-keeping) and clerks are
         reviewed by the chief accountant.
      2. The chief accountant's own entries go up to the finance manager —
         nobody underneath can review the person above them.
      3. The finance manager's own entries fall to the external CPA, because in
         an SME there is no one left inside the company.
    """
    if preparer.cash_custody or preparer.review_level == 1:
        return POSITIONS["GL_ACCOUNTANT"]
    if preparer.position_id == "GL_ACCOUNTANT":
        return POSITIONS["FINANCE_MANAGER"]
    if preparer.position_id == "FINANCE_MANAGER":
        return POSITIONS["CPA_ADVISOR"]
    return POSITIONS["GL_ACCOUNTANT"]


def may_review(reviewer: Position, preparer: Position) -> bool:
    """
    A reviewer is allowed if they hold the required position, or sit above it.

    Sitting above it (finance manager covering for an absent chief accountant) is
    normal in a small finance team; sitting *below* it never is.
    """
    if not reviewer.can_review or reviewer.cash_custody:
        return False
    return reviewer.review_level >= required_reviewer(preparer).review_level


def position_for_accounts(account_codes: Iterable[str]) -> Optional[Position]:
    """
    Which position owns an entry that touches these accounts.

    A month-end adjustment is not "the chief accountant's entry": the tax
    provision belongs to the tax accountant and the depreciation run to the fixed
    asset accountant. The owner is whoever's scope covers every account in the
    entry, preferring the narrowest scope so the entry lands with the clerk who
    has to defend it. Falls back to the chief accountant when no single clerk's
    scope covers everything.
    """
    codes = {c for c in account_codes if c}
    if not codes:
        return None
    candidates = [
        p
        for p in POSITIONS.values()
        if p.can_prepare and "*" not in p.account_scope and codes <= p.account_scope
    ]
    if candidates:
        return min(candidates, key=lambda p: (len(p.account_scope), p.review_level))
    return POSITIONS.get("GL_ACCOUNTANT")


#: Earlier bot identities that predate the position model. They are the same
#: jobs under different key names, so they map onto positions rather than being
#: left outside the authority model — otherwise the REST surface and the MCP
#: surface would enforce two different sets of rules for the same actor.
PRINCIPAL_ALIASES: Dict[str, str] = {
    "bookkeeper-maker-01": "AP_CLERK",        # expense splits and payables entries
    "workpaper-close-01": "GL_ACCOUNTANT",    # month-end closing work
    "controller-checker-01": "GL_ACCOUNTANT",  # reviewer of record
}


def position_for_principal(principal_key: str) -> Optional[Position]:
    for p in POSITIONS.values():
        if p.principal_key == principal_key:
            return p
    alias = PRINCIPAL_ALIASES.get(principal_key or "")
    return POSITIONS.get(alias) if alias else None
