"""BL-01 regressions use independent connections to a temporary SQLite file."""
import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core import ledger, posting
from app.core.db import (
    DatabaseManager,
    FiscalPeriodModel,
    JournalEntryModel,
    JournalLineModel,
)
from app.core.repository import AccountingRepository


@pytest_asyncio.fixture
async def isolated_posting(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    manager = DatabaseManager(f"sqlite+aiosqlite:///{tmp_path / 'posting.db'}")
    repository = AccountingRepository(manager)
    monkeypatch.setattr(posting, "repo", repository)
    monkeypatch.setattr(ledger, "db_manager", manager)
    await repository.init_seed_data_if_needed()
    for code, kind in (("1110", "ASSET"), ("6100", "EXPENSE")):
        await ledger.upsert_account("AU-OPC-01", {
            "account_code": code, "account_type": kind, "account_name": code,
            "is_control_account": False,
        })
    yield repository
    await manager.engine.dispose()


async def voucher(repository):
    from app.mcp_server import PRINCIPALS

    # Review-path tests must carry a real, matching maker identity, even though
    # low-level posting itself does not resolve authentication metadata.
    entry = {
        "journal_id": str(uuid4()), "entity_code": "AU-OPC-01",
        "status": "PENDING_CHECKER", "source_module": "MANUAL",
        "accounting_date": "2026-10-15", "period": "2026-10", "currency": "AUD",
        "total_debit": "100.0000", "total_credit": "100.0000",
        "created_by_principal_key": "bookkeeper-maker-01",
        "created_by_principal_id": str(PRINCIPALS["bookkeeper-maker-01"].principal_id),
        "entry_layer": "OPERATIONAL", "review_notes": "prior review",
        "lines": [
            {"line_number": 1, "account_code": "6100", "debit": "100.0000", "credit": "0.0000"},
            {"line_number": 2, "account_code": "1110", "debit": "0.0000", "credit": "100.0000"},
        ],
    }
    await repository.save_journal(entry)
    return await repository.get_journal(entry["journal_id"])


async def approve(entry):
    return await posting.post_voucher(
        entry, approver_principal_id="checker-id", approver_principal_key="checker",
    )


async def stored_lines(repository):
    async with repository.manager.session_factory() as session:
        return (await session.execute(select(JournalLineModel))).scalars().all()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_stage", ["after_lines", "after_seal", "commit"])
async def test_failure_rolls_back_everything(isolated_posting, monkeypatch, failure_stage):
    repository = isolated_posting
    entry = await voucher(repository)
    entry["review_notes"] = "new approval checklist"
    before = deepcopy(entry)
    original = repository.mark_posted

    async def fail_seal(*args, **kwargs):
        session = kwargs["session"]
        # Prove the lines have actually reached the database transaction.
        assert len((await session.execute(select(JournalLineModel))).scalars().all()) == 2
        if failure_stage == "after_seal":
            await original(*args, **kwargs)
        raise ValueError("injected seal failure")

    if failure_stage == "commit":
        from sqlalchemy import event

        def fail_commit(connection):
            raise ValueError("injected commit failure")

        event.listen(repository.manager.engine.sync_engine, "commit", fail_commit)
    else:
        monkeypatch.setattr(repository, "mark_posted", fail_seal)

    try:
        with pytest.raises(posting.PostingError, match="injected"):
            await approve(entry)
    finally:
        if failure_stage == "commit":
            event.remove(repository.manager.engine.sync_engine, "commit", fail_commit)

    assert entry == before
    assert await stored_lines(repository) == []
    stored = await repository.get_journal(entry["journal_id"])
    assert stored["status"] == "PENDING_CHECKER"
    assert stored["entry_hash"] is None
    assert stored["block_index"] == 0
    assert stored["approved_by_principal_id"] is None
    assert stored["review_notes"] == "prior review"
    async with repository.manager.session_factory() as session:
        assert await session.get(FiscalPeriodModel, "AU-OPC-01:2026-10") is None


@pytest.mark.asyncio
async def test_success_and_repeated_approval(isolated_posting):
    repository = isolated_posting
    entry = await voucher(repository)
    entry["review_notes"] = "checked invoice and period"
    result = await approve(entry)
    stored = await repository.get_journal(entry["journal_id"])
    assert entry == stored
    assert stored["status"] == "POSTED"
    assert stored["review_notes"] == "checked invoice and period"
    assert stored["approved_by_principal_id"] == "checker-id"
    assert stored["posted_at"]
    assert result["block_index"] == 1
    assert result["lines_written"] == 2
    assert len(await stored_lines(repository)) == 2
    assert (await ledger.derive_balances("AU-OPC-01", "2026-10"))["6100"].op_debit == 100
    with pytest.raises(posting.PostingError, match="CANNOT_POST"):
        await approve(entry)
    assert len(await stored_lines(repository)) == 2
    assert await repository.get_journal(entry["journal_id"]) == stored


@pytest.mark.asyncio
@pytest.mark.parametrize("changed_field", ["lines", "entity_code", "total_debit", "period", "created_by_principal_id"])
async def test_rejects_changed_submitted_snapshot(isolated_posting, changed_field):
    repository = isolated_posting
    entry = await voucher(repository)
    if changed_field == "lines":
        entry["lines"][0]["debit"] = "200.0000"
    else:
        entry[changed_field] = "SG-OPC-01" if changed_field == "entity_code" else "changed"
    before = deepcopy(entry)
    with pytest.raises(posting.PostingError, match="VOUCHER_SNAPSHOT_CHANGED"):
        await approve(entry)
    assert entry == before
    assert await stored_lines(repository) == []


@pytest.mark.asyncio
async def test_concurrent_same_voucher_posts_once(isolated_posting):
    repository = isolated_posting
    first = await voucher(repository)
    second = deepcopy(first)
    results = await asyncio.gather(approve(first), approve(second), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 1
    errors = [result for result in results if isinstance(result, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], posting.PostingError)
    assert "CANNOT_POST" in str(errors[0])
    assert len(await stored_lines(repository)) == 2


@pytest.mark.asyncio
async def test_concurrent_vouchers_extend_reversed_chain_head(isolated_posting):
    repository = isolated_posting
    head = await voucher(repository)
    await approve(head)
    async with repository.manager.session_factory() as session:
        row = await session.get(JournalEntryModel, head["journal_id"])
        row.status = "REVERSED"
        await session.commit()
    first, second = await voucher(repository), await voucher(repository)
    results = await asyncio.gather(approve(first), approve(second))
    ordered = sorted(results, key=lambda result: result["block_index"])
    assert [result["block_index"] for result in ordered] == [2, 3]
    assert ordered[0]["prev_entry_hash"] == head["entry_hash"]
    assert ordered[1]["prev_entry_hash"] == ordered[0]["entry_hash"]
    assert len(await stored_lines(repository)) == 6


@pytest.mark.asyncio
@pytest.mark.parametrize("refusal", ["locked_period", "missing_account", "control_account"])
async def test_validation_refuses_without_lines(isolated_posting, refusal):
    repository = isolated_posting
    entry = await voucher(repository)
    if refusal == "locked_period":
        await ledger.ensure_period("AU-OPC-01", "2026-10", status="LOCKED")
    elif refusal == "control_account":
        await ledger.upsert_account("AU-OPC-01", {
            "account_code": "6100", "is_control_account": True, "allow_manual_je": False,
        })
    else:
        from app.core.db import ChartOfAccountsModel
        async with repository.manager.session_factory() as session:
            await session.delete(await session.get(ChartOfAccountsModel, "AU-OPC-01:6100"))
            await session.commit()
    with pytest.raises(posting.PostingError):
        await approve(entry)
    assert await stored_lines(repository) == []
    assert (await repository.get_journal(entry["journal_id"]))["status"] == "PENDING_CHECKER"
