"""BL-03: generated REST/MCP reversals must mirror persisted FX ledger facts."""
import json
from copy import deepcopy
from decimal import Decimal

import pytest
from conftest import agent_as, human_session, login_as
from sqlalchemy import delete, update
from test_atomic_posting import approve, stored_lines, voucher
from test_atomic_posting import isolated_posting as isolated_posting  # noqa: PLC0414 -- fixture export
from test_journal_concurrency import guarded_repo as guarded_repo  # noqa: PLC0414 -- fixture export

from app import mcp_roles, mcp_server
from app.core import ledger, vouchers
from app.core.db import JournalEntryModel, JournalLineModel
from app.core.positions import POSITIONS
from app.mcp_roles import PositionSession


def role_session(key, position):
    return PositionSession(
        principal_key=key, principal_id=str(mcp_server.PRINCIPALS[key].principal_id),
        position=POSITIONS[position], credential_id="test", token="test",
    )


async def generate(repo, client, path, entry):
    if path == "rest":
        await agent_as(client, "ap-clerk-01")
        response = await client.post(
            f"/api/v1/vouchers/{entry['journal_id']}/reverse", json={"reason": "correction"},
        )
        assert response.status_code == 200, response.text
        return response.json()["voucher"]["journal_id"]
    await mcp_roles._reverse_voucher(
        role_session("ap-clerk-01", "AP_CLERK"), entry["journal_id"], "correction",
    )
    return next(j["journal_id"] for j in await repo.get_journals()
                if j.get("reversal_of_journal_id") == entry["journal_id"])


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["rest", "mcp"])
@pytest.mark.parametrize("functional,layer", [("150.0000", "OPERATIONAL"),
                                             ("100.0000", "OPERATIONAL"),
                                             ("150.0000", "AJE_MONTH_END"),
                                             ("150.0000", "RJE_RECLASS")])
async def test_generated_reversal_posts_exact_mirror(guarded_repo, client, monkeypatch, path, functional, layer):
    repo = guarded_repo
    monkeypatch.setattr(vouchers, "repo", repo)
    entry = await voucher(repo)
    await ledger.upsert_account("AU-OPC-01", {
        "account_code": "2110", "account_name": "Payables", "account_type": "LIABILITY",
        "is_control_account": False,
    })
    entry["lines"][1]["account_code"] = "2110"
    currency = "AUD" if functional == "100.0000" else "USD"
    rate = "1.00000000" if currency == "AUD" else "1.50000000"
    entry.update(currency=currency, entry_layer=layer)
    for line in entry["lines"]:
        line.update(tx_currency=currency, exchange_rate=rate,
                    func_debit=functional if line["debit"] != "0.0000" else "0.0000",
                    func_credit=functional if line["credit"] != "0.0000" else "0.0000",
                    counterparty_id="supplier-1", counterparty="Supplier",
                    tax_code_id="tax-1", tax_code="GST_FREE", business_use_pct="0.7500",
                    statement_ref="PL-40", memo="original line")
    await repo.save_journal(entry)
    await approve(entry)
    # Legacy JSON may omit FX facts and have stale metadata. Only the persisted
    # ledger is authoritative, including when both amount pairs differ.
    legacy_lines = deepcopy(entry["lines"])
    for line in legacy_lines:
        for key in ("func_debit", "func_credit", "tx_currency", "exchange_rate"):
            line.pop(key)
        line.update(counterparty="stale name", counterparty_id="stale-id", tax_code_id="stale-tax")
    async with repo.manager.session_factory() as session:
        await session.execute(update(JournalEntryModel).where(
            JournalEntryModel.journal_id == entry["journal_id"]
        ).values(lines_json=json.dumps(legacy_lines)))
        await session.commit()
    history = deepcopy(await repo.get_journal(entry["journal_id"]))
    old_rows = {r.line_id: {c.name: getattr(r, c.name) for c in r.__table__.columns}
                for r in await stored_lines(repo)}
    journal_id = await generate(repo, client, path, entry)
    draft = await repo.get_journal(journal_id)
    assert draft["status"] == "DRAFT" and draft["entry_layer"] == layer
    if path == "rest":
        response = await client.post(f"/api/v1/vouchers/{journal_id}/submit", json={})
        assert response.status_code == 200, response.text
        await login_as(client, "test-cpa-human")
        response = await client.post(f"/api/v1/vouchers/{journal_id}/approve", json={})
        assert response.status_code == 200, response.text
        response = await client.post(f"/api/v1/vouchers/{journal_id}/approve", json={})
        assert response.status_code != 200
    else:
        await mcp_roles._submit_voucher(role_session("ap-clerk-01", "AP_CLERK"), journal_id)
        checker = human_session("test-gl-human", "GL_ACCOUNTANT")
        result = await mcp_roles._review_voucher(checker, journal_id, "APPROVE", checked=["mirror"])
        assert result["status"] == "POSTED"
        with pytest.raises(mcp_roles.ToolError, match="INVALID_STATE"):
            await mcp_roles._review_voucher(checker, journal_id, "APPROVE", checked=["mirror"])
    assert await repo.get_journal(entry["journal_id"]) == {
        **history, "status": "REVERSED", "revision": history["revision"] + 1,
    }
    rows = await stored_lines(repo)
    assert len(rows) == 4
    for row in rows:
        if row.journal_id == entry["journal_id"]:
            assert {c.name: getattr(row, c.name) for c in row.__table__.columns} == old_rows[row.line_id]
        else:
            original = next(r for r in rows if r.journal_id == entry["journal_id"]
                            and r.line_number == row.line_number)
            for field in ("account_code", "entry_layer", "tx_currency", "exchange_rate",
                          "counterparty_id", "counterparty_name", "tax_code_id", "func_tax_amount",
                          "business_use_pct", "statement_ref"):
                assert getattr(row, field) == getattr(original, field)
    for code in ("6100", "2110"):
        account_rows = [r for r in rows if r.account_code == code]
        for prefix in ("tx", "func"):
            assert sum(Decimal(getattr(r, prefix + "_debit")) - Decimal(getattr(r, prefix + "_credit"))
                       for r in account_rows) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["rest", "mcp"])
@pytest.mark.parametrize("invalid", ["no_rows", "currency", "rate", "layer", "tax", "amount", "business_use"])
async def test_generated_reversal_fails_closed(guarded_repo, client, monkeypatch, path, invalid):
    repo = guarded_repo
    monkeypatch.setattr(vouchers, "repo", repo)
    entry = await voucher(repo)
    await approve(entry)
    async with repo.manager.session_factory() as session:
        predicate = JournalLineModel.journal_id == entry["journal_id"]
        if invalid == "no_rows":
            await session.execute(delete(JournalLineModel).where(predicate))
        else:
            field, value = {"currency": ("tx_currency", ""), "rate": ("exchange_rate", ""),
                            "layer": ("entry_layer", ""), "tax": ("func_tax_amount", "10.0000"),
                            "amount": ("func_debit", ""), "business_use": ("business_use_pct", "")}[invalid]
            await session.execute(update(JournalLineModel).where(predicate).values(**{field: value}))
        await session.commit()
    before = await repo.get_journals()
    if path == "rest":
        await agent_as(client, "bookkeeper-maker-01")
        response = await client.post(f"/api/v1/vouchers/{entry['journal_id']}/reverse", json={"reason": "correction"})
        assert response.status_code == 400 and "REVERSAL_INVALID" in response.text
    else:
        with pytest.raises(mcp_roles.ToolError, match="REVERSAL_INVALID"):
            await generate(repo, client, path, entry)
    assert await repo.get_journals() == before


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["rest", "mcp"])
async def test_generated_reversal_scope_uses_ledger_accounts(guarded_repo, client, path):
    repo = guarded_repo
    entry = await voucher(repo)
    await approve(entry)
    # JSON suggests payables scope, but the actual credit is cash at bank.
    legacy_lines = deepcopy(entry["lines"])
    legacy_lines[1]["account_code"] = "2110"
    async with repo.manager.session_factory() as session:
        await session.execute(update(JournalEntryModel).where(
            JournalEntryModel.journal_id == entry["journal_id"]
        ).values(lines_json=json.dumps(legacy_lines)))
        await session.commit()
    before = await repo.get_journals()
    if path == "rest":
        await agent_as(client, "ap-clerk-01")
        response = await client.post(f"/api/v1/vouchers/{entry['journal_id']}/reverse", json={"reason": "correction"})
        assert response.status_code == 403 and "ACCOUNT_OUT_OF_SCOPE" in response.text
    else:
        with pytest.raises(mcp_roles.ToolError, match="ACCOUNT_OUT_OF_SCOPE"):
            await generate(repo, client, path, entry)
    assert await repo.get_journals() == before
