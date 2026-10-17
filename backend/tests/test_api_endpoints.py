import pytest
from httpx import AsyncClient
from conftest import agent_as, login_as

@pytest.mark.asyncio
async def test_system_overview_endpoint(client: AsyncClient):
    resp = await client.get("/api/v1/system/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert "entities" in data
    assert "agent_principals" in data
    assert len(data["entities"]) == 6

@pytest.mark.asyncio
async def test_desktop_company_file_and_backup_endpoints(client: AsyncClient):
    # 1. Company file info
    resp = await client.get("/api/v1/desktop/company-file")
    assert resp.status_code == 200
    info = resp.json()
    assert "file_path" in info
    assert "storage_type" in info
    assert info["exists"] is True

    # 2. Company file backup snapshot
    await login_as(client, "test-admin-human")
    backup_resp = await client.post("/api/v1/desktop/backup")
    assert backup_resp.status_code == 200
    backup_data = backup_resp.json()
    assert backup_data["status"] == "BACKUP_CREATED"
    assert "backup_file" in backup_data

@pytest.mark.asyncio
async def test_reporting_and_aje_endpoints(client: AsyncClient):
    # 1. Fetch working paper pack
    resp = await client.get("/api/v1/reporting/AU-OPC-01/2026-10")
    assert resp.status_code == 200
    pack = resp.json()
    assert pack["entity_code"] == "AU-OPC-01"
    assert "balance_sheet" in pack
    assert "income_statement" in pack
    assert "cash_flow_statement" in pack

    # 2. Post Adjusting Journal Entry
    aje_payload = {
        "entity_code": "AU-OPC-01",
        "debit_account_code": "6100",
        "credit_account_code": "2110",
        "amount": "1500.0000",
        "memo": "Endpoint test accrued review fees",
        "statement_ref": "AP",
    }
    await agent_as(client, "ap-clerk-01")
    aje_resp = await client.post("/api/v1/reporting/aje", json=aje_payload)
    assert aje_resp.status_code == 200
    res_data = aje_resp.json()
    assert res_data["aje_result"]["status"] == "AJE_PENDING_REVIEW"
    journal_id = res_data["aje_result"]["journal_id"]
    from app.core.repository import repo
    from app.core.ledger import get_lines

    journal = await repo.get_journal(journal_id)
    assert journal["status"] == "PENDING_CHECKER"
    assert not any(line["journal_id"] == journal_id for line in await get_lines("AU-OPC-01"))
    assert res_data["reporting_pack"]["trial_balance_totals"] == pack["trial_balance_totals"]

@pytest.mark.asyncio
async def test_personal_split_and_review_workflow_endpoints(client: AsyncClient):
    # 1. Post personal expense split webhook
    split_payload = {
        "entity_code": "AU-OPC-01",
        "expense_description": "Founder Workstation Webhook Test",
        "gross_amount_paid": "1100.0000",
        "tax_rate": "0.10",
        "business_use_pct": "0.70",
        "evidence_uri": "s3://evidence/wh-test.pdf",
    }
    await agent_as(client, "bookkeeper-maker-01")
    wh_resp = await client.post("/api/v1/webhooks/personal-expense-split", json=split_payload)
    assert wh_resp.status_code == 200
    wh_data = wh_resp.json()
    journal_id = wh_data["maker_result"]["split_entry"]["journal_id"]

    # 2. Fetch pending journals
    await agent_as(client, "controller-checker-01")
    pending_resp = await client.get("/api/v1/journals/pending?entity_code=AU-OPC-01")
    assert pending_resp.status_code == 200
    pending_list = pending_resp.json()["journals"]
    assert any(j["journal_id"] == journal_id for j in pending_list)

    # 3. Review and approve journal via endpoint
    review_payload = {
        "action": "APPROVE",
    }
    review_resp = await client.post(f"/api/v1/journals/{journal_id}/review", json=review_payload)
    assert review_resp.status_code == 200
    review_data = review_resp.json()
    assert review_data["action"] == "APPROVED"
    assert "entry_hash" in review_data
