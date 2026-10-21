"""BL06: real durable identities, isolated ledger, no authorization cache trust."""
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from app import mcp_roles, mcp_server
from app.core import ledger
from app.core.auth import PrincipalModel, provision_principal
from app.core.db import db_manager
from app.core.positions import POSITIONS, PRINCIPAL_POSITIONS
from app.mcp_roles import PositionSession
from conftest import agent_as, login_as
from test_atomic_posting import isolated_posting, voucher, stored_lines
from test_journal_concurrency import guarded_repo


async def identity(key):
    async with db_manager.session_factory() as db:
        return await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == key))


async def pending(repo, maker="finance-manager-01"):
    entry = await voucher(repo)
    row = await identity(maker)
    entry.update(created_by_principal_key=maker, created_by_principal_id=row.principal_id)
    await repo.save_journal(entry)
    return await repo.get_journal(entry["journal_id"])


async def session(key, display="CPA_ADVISOR"):
    row = await identity(key)
    return PositionSession(token="", position=POSITIONS[display], principal_key=key, principal_id=row.principal_id)


async def snapshot(repo):
    # Journals include status, approval metadata, revisions, hashes and blocks.
    return (deepcopy(await repo.get_journals()),
            [(r.line_id, r.journal_id, str(r.func_debit), str(r.func_credit)) for r in await stored_lines(repo)],
            await ledger.derive_balances("AU-OPC-01", "2026-10"),
            deepcopy(mcp_server.JOURNAL_LEDGER))


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["APPROVE", "REJECT"])
@pytest.mark.parametrize("route", ["journals", "vouchers"])
async def test_rest_lower_seniority_bypass_is_403_and_atomic(guarded_repo, client, action, route):
    entry = await pending(guarded_repo)
    before = await snapshot(guarded_repo)
    await agent_as(client, "controller-checker-01")
    url = (f"/api/v1/journals/{entry['journal_id']}/review" if route == "journals"
           else f"/api/v1/vouchers/{entry['journal_id']}/{action.lower()}")
    body = {"action": action, "rejection_reason": "incorrect"} if route == "journals" else {"reason": "incorrect"}
    response = await client.post(url, json=body)
    assert response.status_code == 403, response.text
    assert "SOD_POSITION_VIOLATION" in response.text
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("verdict", ["APPROVE", "REJECT", "ESCALATE"])
async def test_mcp_parity_ignores_inflated_position(guarded_repo, verdict):
    entry = await pending(guarded_repo)
    before = await snapshot(guarded_repo)
    with pytest.raises(mcp_roles.ToolError, match="SOD_POSITION_VIOLATION"):
        await mcp_roles._review_voucher(await session("controller-checker-01"), entry["journal_id"],
                                        verdict, checked=["receipt"], reason="reviewed")
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["rest", "mcp"])
async def test_dynamic_human_cpa_can_review_finance_manager(guarded_repo, client, transport):
    key = "bl06-cpa-" + uuid4().hex
    await provision_principal(key, "External reviewer", "CPA_ADVISOR", password="test-fixture-password-only")
    entry = await pending(guarded_repo, "test-finance-human")
    # Provisioning alone does not populate the old identity/position adapters.
    assert key not in PRINCIPAL_POSITIONS
    if transport == "rest":
        await login_as(client, key)
        response = await client.post(f"/api/v1/vouchers/{entry['journal_id']}/approve", json={})
        assert response.status_code == 200, response.text
    else:
        result = await mcp_roles._review_voucher(await session(key, "GL_ACCOUNTANT"), entry["journal_id"],
                                                "APPROVE", checked=["receipt"])
        assert result["reviewed_by_position"] == "CPA_ADVISOR"
    stored = await guarded_repo.get_journal(entry["journal_id"])
    assert stored["status"] == "POSTED" and stored["entry_hash"]
    assert len(await stored_lines(guarded_repo)) == 2


@pytest.mark.asyncio
async def test_gl_chief_routes_to_finance_manager_and_alias_is_supported(guarded_repo):
    entry = await pending(guarded_repo, "workpaper-close-01")
    denied = await mcp_server.review_and_approve_proposal("controller-checker-01", entry["journal_id"], "REJECT")
    assert denied["status_code"] == 403
    assert "FINANCE_MANAGER" in denied["reason"]
    result = await mcp_roles._review_voucher(await session("test-finance-human"), entry["journal_id"],
                                            "APPROVE", checked=["close"])
    assert result["status"] == "POSTED"
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    result = await mcp_server.review_and_approve_proposal("test-gl-human", entry["journal_id"])
    assert result["entry_status"] == "POSTED"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["self", "unknown_actor", "mismatched_actor", "unknown_maker", "missing_key",
                                      "missing_id", "mismatched_maker", "cashier", "admin", "auditor", "inactive"])
@pytest.mark.parametrize("transport", ["rest", "mcp"])
async def test_bad_identity_and_forbidden_positions_fail_closed(guarded_repo, case, transport):
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    key = "controller-checker-01"
    actor_id = (await identity(key)).principal_id
    if case == "self":
        key = "bookkeeper-maker-01"
        actor_id = entry["created_by_principal_id"]
    elif case == "unknown_actor":
        key = "no-such-reviewer"
    elif case == "mismatched_actor":
        actor_id = str(uuid4())
    elif case == "unknown_maker":
        entry["created_by_principal_key"] = "no-such-maker"
    elif case == "missing_key":
        entry["created_by_principal_key"] = ""
    elif case == "missing_id":
        entry["created_by_principal_id"] = None
    elif case == "mismatched_maker":
        entry["created_by_principal_id"] = str(uuid4())
    elif case in {"cashier", "admin", "auditor"}:
        key = {"cashier": "cashier-01", "admin": "test-admin-human", "auditor": "auditor-readonly-01"}[case]
        actor_id = (await identity(key)).principal_id
    elif case == "inactive":
        key = "bl06-disabled-" + uuid4().hex
        actor_id = await provision_principal(key, "Disabled reviewer", "GL_ACCOUNTANT")
        async with db_manager.session_factory() as db:
            await db.execute(update(PrincipalModel).where(PrincipalModel.principal_key == key).values(status="DISABLED"))
            await db.commit()
    await guarded_repo.save_journal(entry)
    before = await snapshot(guarded_repo)
    if transport == "rest":
        result = await mcp_server.review_and_approve_proposal(key, entry["journal_id"], "REJECT",
                                                             authenticated_principal_id=actor_id)
        assert result["status_code"] == 403, result
    else:
        actor = PositionSession(token="", position=POSITIONS["CPA_ADVISOR"], principal_key=key, principal_id=actor_id)
        with pytest.raises(mcp_roles.ToolError):
            await mcp_roles._review_voucher(actor, entry["journal_id"], "REJECT", reason="incorrect")
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("verdict", ["", "APROVE", "ESCALATE", "delete"])
async def test_rest_invalid_action_never_approves(guarded_repo, client, verdict):
    entry = await pending(guarded_repo)
    before = await snapshot(guarded_repo)
    await login_as(client, "test-cpa-human")
    response = await client.post(f"/api/v1/journals/{entry['journal_id']}/review", json={"action": verdict})
    assert response.status_code == 400 and "INVALID_VERDICT" in response.text
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
async def test_dynamic_human_maker_resolves_without_cache(guarded_repo):
    key = "bl06-maker-" + uuid4().hex
    await provision_principal(key, "Chief accountant", "GL_ACCOUNTANT", password="test-fixture-password-only")
    assert key not in PRINCIPAL_POSITIONS
    entry = await pending(guarded_repo, key)
    result = await mcp_roles._review_voucher(await session("test-finance-human"), entry["journal_id"],
                                            "APPROVE", checked=["close"])
    assert result["status"] == "POSTED"


@pytest.mark.asyncio
async def test_durable_demotion_overrides_session_and_identity_cache(guarded_repo):
    key = "bl06-demoted-" + uuid4().hex
    await provision_principal(key, "Former manager", "FINANCE_MANAGER")
    entry = await pending(guarded_repo, "gl-chief-01")
    stale = await session(key, "FINANCE_MANAGER")
    PRINCIPAL_POSITIONS[key] = POSITIONS["CPA_ADVISOR"]
    try:
        async with db_manager.session_factory() as db:
            await db.execute(update(PrincipalModel).where(PrincipalModel.principal_key == key).values(position_id="GL_ACCOUNTANT"))
            await db.commit()
        before = await snapshot(guarded_repo)
        with pytest.raises(mcp_roles.ToolError, match="SOD_POSITION_VIOLATION"):
            await mcp_roles._review_voucher(stale, entry["journal_id"], "ESCALATE", reason="needs review")
        result = await mcp_server.review_and_approve_proposal(key, entry["journal_id"])
        assert result["status_code"] == 403
        assert await snapshot(guarded_repo) == before
    finally:
        PRINCIPAL_POSITIONS.pop(key, None)


@pytest.mark.asyncio
async def test_legacy_amount_escalation_remains_separate(guarded_repo):
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    row = await identity("test-gl-human")
    amount = str(row.max_auto_approve_func_amount + 1)
    entry["total_debit"] = entry["total_credit"] = amount
    entry["lines"][0]["debit"] = entry["lines"][1]["credit"] = amount
    await guarded_repo.save_journal(entry)
    result = await mcp_server.review_and_approve_proposal("test-gl-human", entry["journal_id"])
    assert result["entry_status"] == "AWAITING_CPA"
    assert not await stored_lines(guarded_repo)
    # MCP deliberately retains its existing checklist/position workflow rather
    # than acquiring the legacy REST amount threshold in this defect fix.
    result = await mcp_roles._review_voucher(await session("test-gl-human"), entry["journal_id"],
                                            "APPROVE", checked=["receipt"])
    assert result["status"] == "POSTED"


@pytest.mark.asyncio
async def test_mcp_invalid_verdict_is_atomic(guarded_repo):
    entry = await pending(guarded_repo)
    before = await snapshot(guarded_repo)
    with pytest.raises(mcp_roles.ToolError, match="INVALID_VERDICT"):
        await mcp_roles._review_voucher(await session("test-cpa-human"), entry["journal_id"], "APROVE", checked=["receipt"])
    assert await snapshot(guarded_repo) == before
