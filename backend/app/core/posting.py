"""Validate, write ledger lines, and seal each approved voucher atomically."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from decimal import Decimal
from typing import Any

from sqlalchemy import select, text, update

from app.core.db import EntityModel, JournalEntryModel, JournalLineModel
from app.core.ledger import (
    LedgerError,
    assert_writable,
    get_chart,
    write_lines_for_entry,
    validate_posting_date,
)
from app.core.repository import repo
from app.core.sod_guard import DeterministicSoDGuard


class PostingError(Exception):
    """Raised when the ledger refuses the entry. Message is user-facing."""

    @property
    def is_conflict(self) -> bool:
        return str(self).startswith(("CANNOT_POST", "VOUCHER_SNAPSHOT_CHANGED", "VOUCHER_REVISION_CONFLICT", "REVERSAL_CONFLICT"))


ADJUSTMENT_LAYERS = {"AJE_MONTH_END", "RJE_RECLASS"}


def destination_columns(entry_layer: str | None) -> tuple[str, str]:
    if (entry_layer or "") in ADJUSTMENT_LAYERS:
        return ("adjustment_debit", "adjustment_credit")
    return ("period_op_debit", "period_op_credit")


# Reviewers may change review metadata, but not the submitted accounting snapshot.
SNAPSHOT_FIELDS = (
    "revision", "entity_code", "source_module", "accounting_date", "currency", "period",
    "total_debit", "total_credit", "created_by_principal_key",
    "created_by_principal_id", "lines", "entry_layer", "basis", "memo",
    "evidence_uris", "reversal_of_journal_id", "proposal_json",
    "ai_confidence_score", "ai_reasoning_summary", "voucher_no",
)


async def build_reversal_lines(original: dict[str, Any], *, reason: str = "") -> list[dict[str, Any]]:
    """Mirror ledger facts, never reconstruct functional amounts from voucher JSON."""
    async with repo.manager.session_factory() as session:
        rows = (await session.execute(select(JournalLineModel).where(
            JournalLineModel.journal_id == original["journal_id"]
        ).order_by(JournalLineModel.line_number))).scalars().all()
    if not rows:
        raise PostingError("REVERSAL_INVALID: original has no persisted ledger lines.")

    lines = []
    numbers = set()
    try:
        for row in rows:
            if (row.entity_code != original["entity_code"]
                    or not original.get("entry_layer")
                    or row.entry_layer != original["entry_layer"]
                    or not row.account_code or not row.account_id
                    or not row.tx_currency or not row.exchange_rate
                    or row.line_number is None or row.line_number in numbers):
                raise ValueError("missing or inconsistent persisted line metadata")
            numbers.add(row.line_number)
            amounts = [Decimal(value) for value in (
                row.tx_debit, row.tx_credit, row.func_debit, row.func_credit,
            )]
            if any(not value.is_finite() or value < 0
                   or value != value.quantize(Decimal("0.0001")) for value in amounts):
                raise ValueError("invalid persisted line amounts")
            rate = Decimal(row.exchange_rate)
            business_use = Decimal(row.business_use_pct)
            if (not rate.is_finite() or rate <= 0 or not business_use.is_finite()
                    or not 0 <= business_use <= 1):
                raise ValueError("invalid persisted exchange rate or business use")
            # No signed-tax reversal policy is defined. Do not silently retain,
            # drop, or negate a nonzero tax amount.
            if Decimal(row.func_tax_amount) != 0:
                raise ValueError("nonzero functional tax requires an explicit reversal policy")
            metadata = next((line for line in original.get("lines", [])
                             if line.get("line_number") == row.line_number
                             and line.get("account_code") == row.account_code), {})
            line = deepcopy(metadata)
            line.update(
                line_number=row.line_number, account_code=row.account_code,
                account_name=row.account_name, debit=row.tx_credit, credit=row.tx_debit,
                func_debit=row.func_credit, func_credit=row.func_debit,
                tx_currency=row.tx_currency, exchange_rate=row.exchange_rate,
                counterparty_id=row.counterparty_id, counterparty=row.counterparty_name,
                tax_code_id=row.tax_code_id, func_tax_amount=row.func_tax_amount,
                business_use_pct=row.business_use_pct, statement_ref=row.statement_ref,
                memo=f"沖銷 {original.get('voucher_no')}：{reason or row.memo or ''}".strip("："),
            )
            lines.append(line)
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise PostingError(f"REVERSAL_INVALID: {exc}.") from exc
    return lines


async def _reversal_original(current: dict[str, Any], session) -> dict[str, Any] | None:
    original_id = current.get("reversal_of_journal_id")
    if not original_id:
        if current.get("source_module") == "REVERSAL":
            raise PostingError("REVERSAL_INVALID: reversal must link an original voucher.")
        return None
    try:
        numbers = []
        for line in current.get("lines") or []:
            numbers.append(int(line["line_number"]))
            if not line["account_code"]:
                raise ValueError("missing account")
            for key in ("debit", "credit", "func_debit", "func_credit"):
                amount = Decimal(str(line.get(key) or 0))
                if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.0001")):
                    raise ValueError("invalid amount")
        if not numbers or len(set(numbers)) != len(numbers):
            raise ValueError("missing or duplicate lines")
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise PostingError("REVERSAL_INVALID: malformed reversal lines.") from exc
    # Check entity before taking the original row lock. Cross-entity links must
    # not acquire locks in the opposite order to another entity's posting.
    original_entity = await session.scalar(select(JournalEntryModel.entity_code).where(
        JournalEntryModel.journal_id == original_id
    ))
    if original_entity != current["entity_code"]:
        raise PostingError("REVERSAL_INVALID: original not found in this entity.")
    original = await repo.get_journal(original_id, session=session)
    if original.get("reversal_of_journal_id") or original.get("source_module") == "REVERSAL":
        raise PostingError("REVERSAL_INVALID: reversing a posted reversal is not supported.")
    if original.get("status") != "POSTED":
        raise PostingError("REVERSAL_CONFLICT: original must still be POSTED and not already reversed.")
    effective = await session.scalar(select(JournalEntryModel.journal_id).where(
        JournalEntryModel.reversal_of_journal_id == original_id,
        JournalEntryModel.status.in_(("POSTED", "REVERSED")),
    ).limit(1))
    if effective:
        raise PostingError("REVERSAL_CONFLICT: original already has a posted reversal.")
    if (current.get("currency") != original.get("currency")
            or Decimal(str(current["total_debit"])) != Decimal(str(original["total_credit"]))
            or Decimal(str(current["total_credit"])) != Decimal(str(original["total_debit"]))):
        raise PostingError("REVERSAL_INVALID: currency and totals must mirror the original.")
    return original


async def _validate_reversal_lines(current, original, session) -> None:
    rows = (await session.execute(select(JournalLineModel).where(
        JournalLineModel.journal_id.in_((current["journal_id"], original["journal_id"]))
    ))).scalars().all()

    def signature(row, mirror=False):
        amounts = [Decimal(v) for v in (row.tx_debit, row.tx_credit, row.func_debit, row.func_credit)]
        if any(not v.is_finite() or v < 0 for v in amounts):
            raise PostingError("REVERSAL_INVALID: invalid persisted line amounts.")
        if mirror:
            amounts = [amounts[1], amounts[0], amounts[3], amounts[2]]
        return (row.entity_code, row.account_code, row.entry_layer, row.tx_currency, *amounts)

    originals = [row for row in rows if row.journal_id == original["journal_id"]]
    reversals = [row for row in rows if row.journal_id == current["journal_id"]]
    if not originals or Counter(signature(row, True) for row in originals) != Counter(signature(row) for row in reversals):
        raise PostingError("REVERSAL_INVALID: lines must exactly mirror the original persisted ledger amounts, accounts, currencies and layers.")


async def _mark_original_reversed(original, session) -> None:
    result = await session.execute(update(JournalEntryModel).where(
        JournalEntryModel.journal_id == original["journal_id"],
        JournalEntryModel.entity_code == original["entity_code"],
        JournalEntryModel.status == "POSTED",
        JournalEntryModel.revision == original["revision"],
    ).values(status="REVERSED", revision=original["revision"] + 1).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise PostingError("REVERSAL_CONFLICT: original changed during approval. Reload before approval.")


async def post_voucher(
    journal: dict[str, Any],
    *,
    approver_principal_id: str,
    approver_principal_key: str,
) -> dict[str, Any]:
    """Post the persisted snapshot. Update the caller only after commit succeeds."""
    entity_code = journal.get("entity_code")
    if not entity_code:
        raise PostingError("POSTING_ERROR: voucher has no entity_code.")

    async with repo.manager.session_factory() as session:
        try:
            async with session.begin():
                # SQLite must reserve the writer before any reads. PostgreSQL
                # serializes postings per entity, including the first chain block.
                if repo.manager.is_sqlite:
                    await session.execute(text("BEGIN IMMEDIATE"))
                entity = (await session.execute(
                    select(EntityModel).where(EntityModel.entity_code == entity_code).with_for_update()
                )).scalar_one_or_none()
                if entity is None:
                    raise PostingError(f"ENTITY_NOT_FOUND: '{entity_code}'")

                current = await repo.get_journal(journal["journal_id"], session=session)
                if not current:
                    raise PostingError(f"VOUCHER_NOT_FOUND: '{journal['journal_id']}'")
                if current.get("status") not in ("PENDING_CHECKER", "AWAITING_CPA"):
                    raise PostingError(
                        f"CANNOT_POST: 憑證 {current.get('voucher_no')} 狀態為 {current.get('status')}，不在待過賬狀態。"
                    )
                changed = [field for field in SNAPSHOT_FIELDS if journal.get(field) != current.get(field)]
                if changed:
                    raise PostingError(f"VOUCHER_SNAPSHOT_CHANGED: {', '.join(changed)}. Reload before approval.")

                original = await _reversal_original(current, session)
                lines = current.get("lines") or []
                if not lines:
                    raise PostingError("POSTING_ERROR: voucher has no lines.")
                period_code = validate_posting_date(current.get("accounting_date"), current.get("period"))
                chart = {a["account_code"]: a for a in await get_chart(
                    entity_code, include_inactive=True, session=session
                )}
                missing = [line["account_code"] for line in lines if line["account_code"] not in chart]
                if missing:
                    raise PostingError(f"COA_MISSING_ACCOUNT: 科目 {', '.join(missing)} 不存在於科目表。")
                blocked = [line["account_code"] for line in lines
                           if chart[line["account_code"]]["is_control_account"]
                           and not chart[line["account_code"]]["allow_manual_je"]]
                if blocked:
                    raise PostingError(
                        f"CONTROL_ACCOUNT_ISOLATION_VIOLATION: 科目 {', '.join(sorted(set(blocked)))} 是子帳控制科目，"
                        "不可用一般分錄過賬；分錄必須來自維護該子帳的流程。"
                    )
                await assert_writable(entity_code, period_code, current["accounting_date"], session=session)
                current["entry_layer"] = current.get("entry_layer") or "OPERATIONAL"
                await write_lines_for_entry(current, session=session)
                if original:
                    await _validate_reversal_lines(current, original, session)

                prev_hash = await repo.get_latest_posted_hash(entity_code, session=session)
                block_index = await repo.get_next_block_index(entity_code, session=session)
                entry_hash = DeterministicSoDGuard.compute_entry_sha256_hash(
                    prev_entry_hash=prev_hash,
                    journal_id=str(current["journal_id"]),
                    entity_code=entity_code,
                    accounting_date=current["accounting_date"],
                    func_debit=Decimal(str(current["total_debit"])),
                    func_credit=Decimal(str(current["total_credit"])),
                    lines_sha256=DeterministicSoDGuard.compute_lines_sha256(lines),
                    created_by=str(current["created_by_principal_id"]),
                    approved_by=approver_principal_id,
                )
                await repo.mark_posted(
                    current["journal_id"], entry_hash=entry_hash, prev_entry_hash=prev_hash,
                    block_index=block_index, approved_by_principal_key=approver_principal_key,
                    approved_by_principal_id=approver_principal_id,
                    review_notes=journal.get("review_notes"), session=session,
                )
                if original:
                    await _mark_original_reversed(original, session)
                committed = await repo.get_journal(current["journal_id"], session=session)
        except (LedgerError, ValueError, ArithmeticError) as exc:
            raise PostingError(str(exc)) from exc

    journal.update(committed)
    dr_col, _ = destination_columns(current.get("entry_layer"))
    return {
        "entry_hash": entry_hash, "prev_entry_hash": prev_hash,
        "block_index": block_index, "columns": dr_col.replace("_debit", ""),
        "lines_written": len(lines),
    }


async def unpost_voucher(journal: dict[str, Any]) -> int:
    """Legacy cleanup helper. Atomic posting never uses compensating deletion."""
    from app.core.db import JournalLineModel, db_manager

    async with db_manager.session_factory() as session:
        rows = (await session.execute(select(JournalLineModel).where(
            JournalLineModel.journal_id == journal["journal_id"]
        ))).scalars().all()
        for row in rows:
            await session.delete(row)
        await session.commit()
        return len(rows)
