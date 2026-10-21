"""BL-03: separate SQLite connections, no production database or timing sleeps."""
import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event

from app import mcp_roles
from app.core import ledger, posting
from conftest import human_session, login_as
from test_atomic_posting import isolated_posting, voucher, approve, stored_lines
from test_journal_concurrency import guarded_repo


async def original(repository):
    entry = await voucher(repository)
    await approve(entry)
    return entry


async def reversal(repository, entry):
    draft = deepcopy(entry)
    for key in ("revision", "entry_hash", "prev_entry_hash", "posted_at", "block_index",
                "approved_by_principal_key", "approved_by_principal_id"):
        draft.pop(key, None)
    draft.update(journal_id=str(uuid4()), status="PENDING_CHECKER", source_module="REVERSAL",
                 reversal_of_journal_id=entry["journal_id"],
                 total_debit=entry["total_credit"], total_credit=entry["total_debit"],
                 created_by_principal_key="bookkeeper-maker-01")
    for line in draft["lines"]:
        line["debit"], line["credit"] = line["credit"], line["debit"]
    await repository.save_journal(draft)
    return await repository.get_journal(draft["journal_id"])


@pytest.mark.asyncio
@pytest.mark.parametrize("concurrent", [False, True])
async def test_only_one_reversal_can_post(isolated_posting, concurrent):
    repo = isolated_posting
    entry = await original(repo)
    history = deepcopy(entry)
    old_lines = [(r.line_id, r.tx_debit, r.tx_credit) for r in await stored_lines(repo)]
    first, second = await reversal(repo, entry), await reversal(repo, entry)
    if concurrent:
        results = await asyncio.gather(approve(first), approve(second), return_exceptions=True)
        assert sum(isinstance(r, dict) for r in results) == 1
        assert any(isinstance(r, posting.PostingError) and r.is_conflict for r in results)
    else:
        await approve(first)
        with pytest.raises(posting.PostingError, match="REVERSAL_CONFLICT"):
            await approve(second)
    assert await repo.get_journal(entry["journal_id"]) == {
        **history, "status": "REVERSED", "revision": history["revision"] + 1,
    }
    rows = await stored_lines(repo)
    assert len(rows) == 4
    assert [(r.line_id, r.tx_debit, r.tx_credit) for r in rows if r.journal_id == entry["journal_id"]] == old_lines
    balance = (await ledger.derive_balances("AU-OPC-01", "2026-10"))["6100"]
    assert balance.op_debit - balance.op_credit == 0
    journals = await repo.get_journals("AU-OPC-01")
    posted = [j for j in journals if j["status"] == "POSTED"]
    assert len(posted) == 1 and posted[0]["block_index"] == 2
    assert posted[0]["prev_entry_hash"] == history["entry_hash"]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["REJECTED", "VOID"])
async def test_abandoned_drafts_do_not_reserve_original(isolated_posting, state):
    repo = isolated_posting
    entry = await original(repo)
    abandoned = await reversal(repo, entry)
    abandoned["status"] = "REJECTED"
    await repo.save_journal(abandoned)
    if state == "VOID":
        abandoned["status"] = "VOID"
        await repo.save_journal(abandoned)
    await approve(await reversal(repo, entry))
    assert (await repo.get_journal(entry["journal_id"]))["status"] == "REVERSED"


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["original_guard", "after_original", "commit"])
async def test_original_failure_rolls_back_seal_lines_and_hash(isolated_posting, monkeypatch, stage):
    repo = isolated_posting
    entry = await original(repo)
    draft = await reversal(repo, entry)
    before = deepcopy(draft)
    mark = posting._mark_original_reversed

    async def fail(original_entry, session):
        sealed = await repo.get_journal(draft["journal_id"], session=session)
        assert sealed["entry_hash"] and sealed["status"] == "POSTED"
        if stage == "after_original":
            await mark(original_entry, session)
            assert (await repo.get_journal(entry["journal_id"], session=session))["status"] == "REVERSED"
            raise ValueError("injected original failure")
        # Exercise the actual revision predicate, not just an injected exception.
        await mark({**original_entry, "revision": -1}, session)

    def fail_commit(connection):
        raise ValueError("injected commit failure")

    if stage == "commit":
        event.listen(repo.manager.engine.sync_engine, "commit", fail_commit)
    else:
        monkeypatch.setattr(posting, "_mark_original_reversed", fail)
    try:
        with pytest.raises(posting.PostingError):
            await approve(draft)
    finally:
        if stage == "commit":
            event.remove(repo.manager.engine.sync_engine, "commit", fail_commit)
    assert draft == before
    assert await repo.get_journal(draft["journal_id"]) == before
    assert await repo.get_journal(entry["journal_id"]) == entry
    assert len(await stored_lines(repo)) == 2
    following = await voucher(repo)
    result = await approve(following)
    assert result["block_index"] == 2 and result["prev_entry_hash"] == entry["entry_hash"]


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["missing", "cross_entity", "not_posted", "nested", "no_link",
                                        "amount", "account", "duplicate_line", "functional", "currency", "totals", "layer",
                                        "nan", "precision", "missing_account", "persisted_mismatch"])
async def test_invalid_original_or_lines_refused(isolated_posting, invalid):
    repo = isolated_posting
    entry = await (voucher(repo) if invalid == "not_posted" else original(repo))
    if invalid == "nested":
        posted_reversal = await reversal(repo, entry)
        await approve(posted_reversal)
        entry = posted_reversal
    draft = await reversal(repo, entry)
    if invalid == "missing":
        draft["reversal_of_journal_id"] = str(uuid4())
    elif invalid == "cross_entity":
        draft["entity_code"] = "SG-OPC-01"
    elif invalid == "no_link":
        draft["reversal_of_journal_id"] = None
    elif invalid == "amount":
        draft["lines"][0]["credit"] = "99"
    elif invalid == "account":
        draft["lines"][0]["account_code"] = "1110"
    elif invalid == "duplicate_line":
        draft["lines"].append(deepcopy(draft["lines"][0]))
    elif invalid == "functional":
        draft["lines"][0]["func_credit"] = "99"
    elif invalid == "currency":
        draft["currency"] = "USD"
    elif invalid == "totals":
        draft["total_debit"] = "99"
    elif invalid == "layer":
        draft["entry_layer"] = "AJE_MONTH_END"
    elif invalid == "nan":
        draft["lines"][0]["credit"] = "NaN"
    elif invalid == "precision":
        draft["lines"][0]["credit"] = "99.99999"
    elif invalid == "missing_account":
        draft["lines"][0].pop("account_code")
    elif invalid == "persisted_mismatch":
        # The immutable voucher JSON is not a substitute for the ledger facts.
        from app.core.db import JournalLineModel
        from sqlalchemy import update
        async with repo.manager.session_factory() as session:
            await session.execute(update(JournalLineModel).where(
                JournalLineModel.journal_id == entry["journal_id"],
                JournalLineModel.account_code == "6100",
            ).values(func_debit="101.0000"))
            await session.commit()
    await repo.save_journal(draft)
    history = await repo.get_journals()
    count = len(await stored_lines(repo))
    with pytest.raises(posting.PostingError, match="REVERSAL_"):
        await approve(draft)
    assert await repo.get_journals() == history
    assert len(await stored_lines(repo)) == count


@pytest.mark.asyncio
async def test_rest_then_role_mcp_duplicate_and_nested_reversal(guarded_repo, client):
    repo = guarded_repo
    entry = await original(repo)
    first, second = await reversal(repo, entry), await reversal(repo, entry)
    await login_as(client, "test-cpa-human")
    response = await client.post(f"/api/v1/vouchers/{first['journal_id']}/approve", json={})
    assert response.status_code == 200, response.text
    response = await client.post(f"/api/v1/vouchers/{second['journal_id']}/approve", json={})
    assert response.status_code == 409 and "REVERSAL_CONFLICT" in response.text
    session = human_session("test-gl-human", "GL_ACCOUNTANT")
    with pytest.raises(mcp_roles.ToolError, match="REVERSAL_CONFLICT"):
        await mcp_roles._review_voucher(session, second["journal_id"], "APPROVE", checked=["mirror"])
    with pytest.raises(mcp_roles.ToolError, match="reversing a posted reversal"):
        await mcp_roles._reverse_voucher(session, first["journal_id"], "undo")
    await login_as(client, "test-finance-human")
    response = await client.post(f"/api/v1/vouchers/{first['journal_id']}/reverse", json={"reason": "undo"})
    assert response.status_code == 400 and "reversing a posted reversal" in response.text
    assert len(await stored_lines(repo)) == 4


@pytest.mark.asyncio
async def test_role_mcp_success_uses_atomic_original_update(guarded_repo, monkeypatch):
    repo = guarded_repo
    entry = await original(repo)
    draft = await reversal(repo, entry)
    session = human_session("test-gl-human", "GL_ACCOUNTANT")

    async def no_separate_save(*args, **kwargs):
        pytest.fail("approval must not save original outside posting transaction")

    monkeypatch.setattr(repo, "save_journal", no_separate_save)
    result = await mcp_roles._review_voucher(session, draft["journal_id"], "APPROVE", checked=["mirror"])
    assert result["status"] == "POSTED"
    assert (await repo.get_journal(entry["journal_id"]))["status"] == "REVERSED"
