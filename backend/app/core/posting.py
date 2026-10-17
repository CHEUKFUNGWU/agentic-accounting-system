"""
Posting a voucher — one implementation, called by every approval path.

Posting means four things, in this order:

  1. **The chart is checked, not a report.** Every line's account must exist in
     `chart_of_accounts`, and a sub-ledger control account may not be posted to by
     hand — its entries have to come from whatever maintains that sub-ledger.
  2. **The period must be writable.** A locked period refuses, by name.
  3. **The ledger is written.** One `journal_lines` row per debit and credit, tagged
     with the counterparty and tax code the entry was given. This is the only
     place a balance ever moves; there is no balance column anywhere.
  4. **The entry is sealed.** prev hash -> this hash, with a monotonic block
     index, and a guarded transition to POSTED that refuses a second approval.

What this module deliberately no longer does: touch `trial_balance_accounts`. The extended
trial balance and the three statements are projections of the ledger now, which
is why `refresh_trial_balance_cache` and its two-sources-of-truth problem disappeared.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List

from app.core.ledger import (
    LedgerError,
    assert_writable,
    get_chart,
    write_lines_for_entry,
)
from app.core.localization import q4
from app.core.repository import repo
from app.core.sod_guard import DeterministicSoDGuard


class PostingError(Exception):
    """Raised when the ledger refuses the entry. Message is user-facing."""


#: Which trial balance column pair an entry layer belongs to. The split between "what
#: happened" and "what we adjusted" is the reason the trial balance has two column pairs.
ADJUSTMENT_LAYERS = {"AJE_MONTH_END", "RJE_RECLASS"}


def destination_columns(entry_layer: str | None) -> tuple[str, str]:
    """(debit_column, credit_column) this layer reports under in the trial balance."""
    if (entry_layer or "") in ADJUSTMENT_LAYERS:
        return ("adjustment_debit", "adjustment_credit")
    return ("period_op_debit", "period_op_credit")


async def post_voucher(
    journal: Dict[str, Any],
    *,
    approver_principal_id: str,
    approver_principal_key: str,
) -> Dict[str, Any]:
    """
    Apply an approved voucher to the ledger and seal it.

    Mutates `journal` in place (status, hash, block index, approver) and returns
    the sealing details. Raises PostingError if the ledger refuses.
    """
    entity_code = journal.get("entity_code")
    if not entity_code:
        raise PostingError("POSTING_ERROR: voucher has no entity_code.")

    lines: List[Dict[str, Any]] = journal.get("lines") or []
    if not lines:
        raise PostingError("POSTING_ERROR: voucher has no lines.")

    period_code = journal.get("period") or str(journal.get("accounting_date"))[:7]

    # 1) the chart is the authority on what an account is
    chart = {a["account_code"]: a for a in await get_chart(entity_code, include_inactive=True)}
    missing = [l["account_code"] for l in lines if l["account_code"] not in chart]
    if missing:
        raise PostingError(f"COA_MISSING_ACCOUNT: 科目 {', '.join(missing)} 不存在於科目表。")

    manual_blocked = [
        l["account_code"]
        for l in lines
        if chart[l["account_code"]]["is_control_account"] and not chart[l["account_code"]]["allow_manual_je"]
    ]
    if manual_blocked:
        raise PostingError(
            f"CONTROL_ACCOUNT_ISOLATION_VIOLATION: 科目 {', '.join(sorted(set(manual_blocked)))} 是子帳控制科目，"
            "不可用一般分錄過賬；分錄必須來自維護該子帳的流程。"
        )

    # 2) the period has to be open
    try:
        await assert_writable(entity_code, period_code)
    except LedgerError as e:
        raise PostingError(str(e))

    # 3) guarded before writing, so a double approval cannot reach the ledger
    current = await repo.get_journal(journal["journal_id"])
    if not current:
        raise PostingError(f"VOUCHER_NOT_FOUND: '{journal['journal_id']}'")
    if current.get("status") not in ("PENDING_CHECKER", "AWAITING_CPA"):
        raise PostingError(
            f"CANNOT_POST: 憑證 {current.get('voucher_no')} 狀態為 {current.get('status')}，不在待過賬狀態。"
        )

    # 4) write the ledger (idempotent: replaces any lines already written)
    journal.setdefault("entry_layer", "OPERATIONAL")
    try:
        await write_lines_for_entry(journal)
    except LedgerError as e:
        raise PostingError(str(e))

    # 5) seal the chain
    prev_hash = await repo.get_latest_posted_hash(entity_code)
    block_index = await repo.get_next_block_index(entity_code)
    lines_hash = DeterministicSoDGuard.compute_lines_sha256(lines)
    entry_hash = DeterministicSoDGuard.compute_entry_sha256_hash(
        prev_entry_hash=prev_hash,
        journal_id=str(journal["journal_id"]),
        entity_code=entity_code,
        accounting_date=journal.get("accounting_date") or date.today().isoformat(),
        func_debit=Decimal(str(journal["total_debit"])),
        func_credit=Decimal(str(journal["total_credit"])),
        lines_sha256=lines_hash,
        created_by=str(journal["created_by_principal_id"]),
        approved_by=approver_principal_id,
    )

    journal["prev_entry_hash"] = prev_hash
    journal["entry_hash"] = entry_hash
    journal["block_index"] = block_index
    journal["approved_by_principal_key"] = approver_principal_key
    journal["approved_by_principal_id"] = approver_principal_id
    journal["status"] = "POSTED"

    try:
        await repo.mark_posted(
            journal["journal_id"],
            entry_hash=entry_hash,
            prev_entry_hash=prev_hash,
            block_index=block_index,
            approved_by_principal_key=approver_principal_key,
            approved_by_principal_id=approver_principal_id,
        )
    except ValueError as e:
        raise PostingError(str(e))

    dr_col, _ = destination_columns(journal.get("entry_layer"))
    return {
        "entry_hash": entry_hash,
        "prev_entry_hash": prev_hash,
        "block_index": block_index,
        "columns": dr_col.replace("_debit", ""),
        "lines_written": len(lines),
    }


async def unpost_voucher(journal: Dict[str, Any]) -> int:
    """
    Remove a voucher's lines from the ledger. Only used to undo a posting that
    failed halfway; a normal correction is a reversing voucher, never a deletion.
    """
    from sqlalchemy import delete, select

    from app.core.db import JournalLineModel, db_manager

    async with db_manager.session_factory() as session:
        rows = (
            await session.execute(select(JournalLineModel).where(JournalLineModel.journal_id == journal["journal_id"]))
        ).scalars().all()
        for row in rows:
            await session.delete(row)
        await session.commit()
        return len(rows)
