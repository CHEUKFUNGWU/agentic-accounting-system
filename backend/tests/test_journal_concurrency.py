"""BL-02 interleavings use separate sessions against an isolated SQLite file.

No sleeps: each stale snapshot is captured before the competing commit. Client
review requests still identify only a voucher, not the revision displayed in the
UI. These guards detect server-side races, not a decision based on an old screen.
"""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from app import api_vouchers as api, mcp_roles, mcp_server
from app.core import posting
from app.core.repository import JournalConflict
from conftest import human_session, login_as
from test_atomic_posting import isolated_posting, voucher, approve, stored_lines


@pytest_asyncio.fixture
async def guarded_repo(isolated_posting, monkeypatch):
    repository = isolated_posting
    for module in (api, mcp_roles, mcp_server):
        monkeypatch.setattr(module, "repo", repository)
    monkeypatch.setattr(mcp_server, "JOURNAL_LEDGER", {})
    monkeypatch.setattr(mcp_server, "PACK_STATUS_STATE", {})
    return repository


async def draft(repository):
    entry = await voucher(repository)
    # Creating draft dictionaries without a revision remains supported.
    entry.pop("revision")
    entry["journal_id"] += "-draft"
    entry["status"] = "DRAFT"
    await repository.save_journal(entry)
    return await repository.get_journal(entry["journal_id"])


@pytest.mark.asyncio
async def test_stale_draft_cannot_overwrite_posting(guarded_repo):
    repository = guarded_repo
    stale = await draft(repository)
    current = deepcopy(stale)
    current["status"] = "PENDING_CHECKER"
    await repository.save_journal(current)
    await approve(current)
    sealed = await repository.get_journal(current["journal_id"])
    assert sealed["revision"] == stale["revision"] + 2
    stale["memo"] = "stale edit"
    with pytest.raises(JournalConflict, match="REVISION_CONFLICT"):
        await repository.save_journal(stale)
    assert await repository.get_journal(current["journal_id"]) == sealed
    assert len(await stored_lines(repository)) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["edit", "submit", "attach", "detach", "reject", "escalate"])
async def test_stale_writes_conflict_even_without_state_change(guarded_repo, operation):
    repository = guarded_repo
    first = await (voucher(repository) if operation in ("reject", "escalate") else draft(repository))
    stale = deepcopy(first)
    first["review_notes"] = "a competing update"
    await repository.save_journal(first)
    if operation == "edit":
        stale["memo"] = "another edit"
    elif operation == "submit":
        stale["status"] = "PENDING_CHECKER"
    elif operation in ("attach", "detach"):
        stale["evidence_uris"] = [{"name": operation}]
    else:
        stale["status"] = "REJECTED" if operation == "reject" else "AWAITING_CPA"
    before = deepcopy(stale)
    with pytest.raises(JournalConflict, match="REVISION_CONFLICT"):
        await repository.save_journal(stale)
    assert stale == before
    assert (await repository.get_journal(first["journal_id"]))["review_notes"] == "a competing update"


@pytest.mark.asyncio
async def test_missing_revision_is_not_an_unconditional_update(guarded_repo):
    entry = await draft(guarded_repo)
    entry.pop("revision")
    with pytest.raises(JournalConflict, match="REVISION_CONFLICT"):
        await guarded_repo.save_journal(entry)


@pytest.mark.asyncio
async def test_posting_detects_revision_but_allows_unsaved_approval_metadata(guarded_repo):
    current = await voucher(guarded_repo)
    stale = deepcopy(current)
    current["review_notes"] = "persisted competing review"
    await guarded_repo.save_journal(current)
    with pytest.raises(posting.PostingError, match="VOUCHER_SNAPSHOT_CHANGED: revision"):
        await approve(stale)
    current["review_notes"] = "final checklist"
    current["approved_by_principal_id"] = "checker-id"
    await approve(current)
    assert current["revision"] == 2
    assert current["review_notes"] == "final checklist"


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("total_debit", "200.0000"), ("total_credit", "200.0000"),
    ("lines", []), ("entity_code", "SG-OPC-01"), ("currency", "USD"),
    ("period", "2026-11"), ("accounting_date", "2026-11-01"),
    ("entry_hash", "changed"), ("prev_entry_hash", "changed"),
    ("block_index", 999), ("posted_at", None),
    ("created_by_principal_id", "changed"), ("approved_by_principal_id", "changed"),
    ("memo", "changed"), ("evidence_uris", ["changed"]),
    ("review_notes", "changed"), ("status", "REJECTED"),
])
async def test_finalized_fields_are_immutable_even_during_reversal(guarded_repo, field, value):
    entry = await voucher(guarded_repo)
    await approve(entry)
    before = deepcopy(entry)
    entry["status"] = "REVERSED"
    entry[field] = value
    with pytest.raises(JournalConflict, match="IMMUTABLE"):
        await guarded_repo.save_journal(entry)
    assert await guarded_repo.get_journal(entry["journal_id"]) == before
    assert len(await stored_lines(guarded_repo)) == 2


@pytest.mark.asyncio
async def test_status_only_reversal_preserves_seal_and_financial_fields(guarded_repo):
    entry = await voucher(guarded_repo)
    await approve(entry)
    before = deepcopy(entry)
    entry["status"] = "REVERSED"
    await guarded_repo.save_journal(entry)
    stored = await guarded_repo.get_journal(entry["journal_id"])
    assert stored == {**before, "status": "REVERSED", "revision": before["revision"] + 1}
    stored["memo"] = "cannot edit reversed either"
    with pytest.raises(JournalConflict, match="IMMUTABLE"):
        await guarded_repo.save_journal(stored)


@pytest.mark.asyncio
async def test_general_save_cannot_post_or_seal(guarded_repo):
    entry = await voucher(guarded_repo)
    entry["entry_hash"] = "fake"
    with pytest.raises(JournalConflict, match="IMMUTABLE"):
        await guarded_repo.save_journal(entry)
    entry["status"] = "POSTED"
    with pytest.raises(JournalConflict, match="STATE_CONFLICT"):
        await guarded_repo.save_journal(entry)


@pytest.mark.asyncio
async def test_stale_cache_rejection_after_role_mcp_posting(guarded_repo):
    entry = await voucher(guarded_repo)
    entry["created_by_principal_key"] = "bookkeeper-maker-01"
    await guarded_repo.save_journal(entry)
    mcp_server.JOURNAL_LEDGER[entry["journal_id"]] = deepcopy(entry)
    # The role-scoped MCP reviewer does not update the legacy cache.
    session = human_session("test-gl-human", "GL_ACCOUNTANT")
    result = await mcp_roles._review_voucher(session, entry["journal_id"], "APPROVE", checked=["invoice"])
    assert result["status"] == "POSTED"
    sealed = await guarded_repo.get_journal(entry["journal_id"])
    stale_cache = deepcopy(mcp_server.JOURNAL_LEDGER)
    result = await mcp_server.review_and_approve_proposal(
        "test-gl-human", entry["journal_id"], "REJECT", "stale review",
    )
    assert result["status"] == "ERROR" and result["conflict"]
    assert await guarded_repo.get_journal(entry["journal_id"]) == sealed
    assert mcp_server.JOURNAL_LEDGER == stale_cache


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["REJECT", "APPROVE"])
async def test_review_race_leaves_cache_unchanged(guarded_repo, monkeypatch, action):
    entry = await voucher(guarded_repo)
    if action == "APPROVE":
        entry["ai_confidence_score"] = "0.1000"  # escalation, not posting
        await guarded_repo.save_journal(entry)
    mcp_server.JOURNAL_LEDGER[entry["journal_id"]] = deepcopy(entry)
    cache_before = deepcopy(mcp_server.JOURNAL_LEDGER)
    original_save = guarded_repo.save_journal

    async def competing_save(stale):
        current = await guarded_repo.get_journal(stale["journal_id"])
        await approve(current)
        await original_save(stale)

    monkeypatch.setattr(guarded_repo, "save_journal", competing_save)
    result = await mcp_server.review_and_approve_proposal(
        "test-gl-human", entry["journal_id"], action, "stale review",
    )
    assert result["status"] == "ERROR" and result["conflict"]
    assert mcp_server.JOURNAL_LEDGER == cache_before
    assert (await guarded_repo.get_journal(entry["journal_id"]))["status"] == "POSTED"


@pytest.mark.asyncio
async def test_bl29_submitted_datetime_roundtrip_and_single_rest_rejection(guarded_repo, client, monkeypatch):
    entry = await draft(guarded_repo)
    entry["status"] = "PENDING_CHECKER"
    entry["submitted_at"] = datetime.now(timezone.utc)
    await guarded_repo.save_journal(entry)
    loaded = await guarded_repo.get_journal(entry["journal_id"])
    assert isinstance(loaded["submitted_at"], str)
    saves = []
    original_save = guarded_repo.save_journal

    async def count_save(value):
        saves.append(deepcopy(value))
        await original_save(value)

    monkeypatch.setattr(guarded_repo, "save_journal", count_save)
    await login_as(client, "test-cpa-human")
    response = await client.post(f"/api/v1/vouchers/{entry['journal_id']}/reject", json={"reason": "receipt unclear"})
    assert response.status_code == 200, response.text
    assert len(saves) == 1
    stored = await guarded_repo.get_journal(entry["journal_id"])
    assert stored["status"] == "REJECTED"
    assert stored["reject_reason"] == "receipt unclear"
    assert stored["submitted_at"] == loaded["submitted_at"]
    assert stored["revision"] == loaded["revision"] + 1
    # Editing a rejected voucher exercises the same string-to-DateTime boundary.
    stored["status"] = "DRAFT"
    stored["memo"] = "corrected"
    await guarded_repo.save_journal(stored)


@pytest.mark.asyncio
async def test_api_edit_race_returns_409(guarded_repo, client, monkeypatch):
    entry = await draft(guarded_repo)
    entry["created_by_principal_key"] = "test-finance-human"
    await guarded_repo.save_journal(entry)
    original_load = api._load_voucher

    async def interleaved_load(journal_id):
        stale = await original_load(journal_id)
        other = deepcopy(stale)
        other["status"] = "PENDING_CHECKER"
        await guarded_repo.save_journal(other)
        await approve(other)
        return stale

    monkeypatch.setattr(api, "_load_voucher", interleaved_load)
    response = await client.put(f"/api/v1/vouchers/{entry['journal_id']}", json={"memo": "late edit"})
    assert response.status_code == 409, response.text
    assert (await guarded_repo.get_journal(entry["journal_id"]))["status"] == "POSTED"


@pytest.mark.asyncio
async def test_concurrent_edits_have_one_winner(guarded_repo):
    first = await draft(guarded_repo)
    second = deepcopy(first)
    first["memo"], second["memo"] = "first", "second"
    results = await asyncio.gather(
        guarded_repo.save_journal(first), guarded_repo.save_journal(second),
        return_exceptions=True,
    )
    assert sum(result is None for result in results) == 1
    assert sum(isinstance(result, JournalConflict) for result in results) == 1
    stored = await guarded_repo.get_journal(first["journal_id"])
    assert stored["revision"] == 1
    assert stored["memo"] in ("first", "second")


@pytest.mark.asyncio
async def test_rest_review_race_returns_409(guarded_repo, client, monkeypatch):
    entry = await voucher(guarded_repo)
    original_save = guarded_repo.save_journal

    async def post_before_reject(stale):
        current = await guarded_repo.get_journal(stale["journal_id"])
        await approve(current)
        await original_save(stale)

    monkeypatch.setattr(guarded_repo, "save_journal", post_before_reject)
    await login_as(client, "test-cpa-human")
    response = await client.post(
        f"/api/v1/vouchers/{entry['journal_id']}/reject", json={"reason": "late review"},
    )
    assert response.status_code == 409, response.text
    stored = await guarded_repo.get_journal(entry["journal_id"])
    assert stored["status"] == "POSTED" and stored["reject_reason"] is None


@pytest.mark.asyncio
async def test_failed_commit_does_not_advance_callers_revision(guarded_repo):
    from sqlalchemy import event

    entry = await draft(guarded_repo)
    before = await guarded_repo.get_journal(entry["journal_id"])
    entry["memo"] = "not committed"
    snapshot = deepcopy(entry)

    def fail_commit(connection):
        raise ValueError("injected commit failure")

    engine = guarded_repo.manager.engine.sync_engine
    event.listen(engine, "commit", fail_commit)
    try:
        with pytest.raises(ValueError, match="injected"):
            await guarded_repo.save_journal(entry)
    finally:
        event.remove(engine, "commit", fail_commit)
    assert entry == snapshot
    assert await guarded_repo.get_journal(entry["journal_id"]) == before


@pytest.mark.asyncio
async def test_sqlite_revision_migration_backfills_and_is_idempotent(guarded_repo):
    entry = await draft(guarded_repo)
    async with guarded_repo.manager.engine.begin() as conn:
        await conn.exec_driver_sql("ALTER TABLE journal_entries DROP COLUMN revision")
    await guarded_repo.manager.init_db()
    await guarded_repo.manager.init_db()
    loaded = await guarded_repo.get_journal(entry["journal_id"])
    assert loaded["revision"] == 0
    loaded["memo"] = "after upgrade"
    await guarded_repo.save_journal(loaded)
    assert (await guarded_repo.get_journal(entry["journal_id"]))["revision"] == 1
