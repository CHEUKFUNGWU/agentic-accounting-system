"""ADR-0001 O2-g: outside an auto-post policy, only a human may decide a review.

Agents may pre-review and advise. Every review entry point (role MCP, legacy
REST, voucher REST) must refuse an agent reviewer even when its position would
otherwise be senior enough, and must leave the ledger untouched.
"""
import pytest

from app import mcp_roles, mcp_server
from app.mcp_roles import ROLE_SERVERS
from conftest import agent_as, login_as
from test_atomic_posting import isolated_posting  # noqa: F401 -- fixture export
from test_journal_concurrency import guarded_repo  # noqa: F401 -- fixture export
from test_reviewer_authority import pending, session, snapshot


@pytest.mark.asyncio
async def test_agent_role_surfaces_expose_no_review_decision_tool():
    for position_id, server in ROLE_SERVERS.items():
        names = {tool.name for tool in await server.list_tools()}
        assert "review_voucher" not in names, position_id
    # Agents can still see the queue to pre-review it.
    gl_tools = {tool.name for tool in await ROLE_SERVERS["GL_ACCOUNTANT"].list_tools()}
    assert "get_pending_reviews" in gl_tools


@pytest.mark.asyncio
@pytest.mark.parametrize("agent", ["controller-checker-01", "finance-manager-01"])
@pytest.mark.parametrize("verdict", ["APPROVE", "REJECT", "ESCALATE"])
async def test_senior_agent_cannot_decide_review_via_mcp(guarded_repo, agent, verdict):
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    before = await snapshot(guarded_repo)
    display = "GL_ACCOUNTANT" if agent == "controller-checker-01" else "FINANCE_MANAGER"
    with pytest.raises(mcp_roles.ToolError, match="HUMAN_REVIEWER_REQUIRED"):
        await mcp_roles._review_voucher(await session(agent, display), entry["journal_id"],
                                        verdict, checked=["receipt"], reason="looks wrong")
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["APPROVE", "REJECT"])
async def test_senior_agent_cannot_decide_review_via_legacy_path(guarded_repo, action):
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    before = await snapshot(guarded_repo)
    result = await mcp_server.review_and_approve_proposal("controller-checker-01", entry["journal_id"], action,
                                                          "looks wrong")
    assert result["status_code"] == 403
    assert "HUMAN_REVIEWER_REQUIRED" in result["reason"]
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["journals", "vouchers"])
async def test_agent_bearer_cannot_decide_review_via_rest(guarded_repo, client, route):
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    before = await snapshot(guarded_repo)
    await agent_as(client, "controller-checker-01")
    url = (f"/api/v1/journals/{entry['journal_id']}/review" if route == "journals"
           else f"/api/v1/vouchers/{entry['journal_id']}/approve")
    body = {"action": "APPROVE"} if route == "journals" else {}
    response = await client.post(url, json=body)
    assert response.status_code == 403, response.text
    assert "HUMAN_REVIEWER_REQUIRED" in response.text
    assert await snapshot(guarded_repo) == before


@pytest.mark.asyncio
async def test_human_with_same_position_still_approves(guarded_repo, client):
    entry = await pending(guarded_repo, "bookkeeper-maker-01")
    await login_as(client, "test-gl-human")
    response = await client.post(f"/api/v1/vouchers/{entry['journal_id']}/approve", json={})
    assert response.status_code == 200, response.text
    assert (await guarded_repo.get_journal(entry["journal_id"]))["status"] == "POSTED"
