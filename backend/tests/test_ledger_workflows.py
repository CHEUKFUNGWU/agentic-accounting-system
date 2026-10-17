"""Regression coverage for company-file upgrades and the document recording path."""

import pytest
from sqlalchemy import select

from app.core.db import DatabaseManager, EntityModel, TrialBalanceAccountModel
from app.core.ledger import get_lines
from app.core.repository import repo


@pytest.mark.asyncio
async def test_legacy_company_file_preserves_balances_and_lock(tmp_path):
    manager = DatabaseManager(f"sqlite+aiosqlite:///{tmp_path / 'legacy.sqlite3'}")
    try:
        await manager.init_db()
        async with manager.session_factory() as session:
            session.add(EntityModel(
                entity_code="LEGACY", legal_name="Legacy company", entity_structure="OPC_LIMITED",
                jurisdiction="AU", currency="AUD", accounting_standard="AASB_TIER2",
                tax_id="demo", reporting_status="CPA_SIGNED_LOCKED",
            ))
            session.add(TrialBalanceAccountModel(
                entity_code="LEGACY", account_code="1110", account_name="Cash",
                account_type="ASSET", fs_category="CASH", statement_ref="W/P A",
                cash_flow_activity="CASH_EQUIV", opening_balance="12345.6789",
                adjustment_debit="19.0000", adjustment_credit="3.0000",
            ))
            await session.commit()

        # Recreate the previous release's table and column names on disk.
        async with manager.engine.begin() as conn:
            await conn.exec_driver_sql("ALTER TABLE entities RENAME COLUMN reporting_status TO pack_status")
            await conn.exec_driver_sql("ALTER TABLE trial_balance_accounts RENAME COLUMN statement_ref TO wp_ref")
            await conn.exec_driver_sql("ALTER TABLE trial_balance_accounts RENAME COLUMN adjustment_debit TO aje_debit")
            await conn.exec_driver_sql("ALTER TABLE trial_balance_accounts RENAME COLUMN adjustment_credit TO aje_credit")
            await conn.exec_driver_sql("ALTER TABLE trial_balance_accounts RENAME TO etb_accounts")

        # Startup must rename before creating tables, and be safe to repeat.
        await manager.init_db()
        await manager.init_db()
        async with manager.session_factory() as session:
            entity = await session.get(EntityModel, "LEGACY")
            rows = (await session.execute(select(TrialBalanceAccountModel))).scalars().all()
            assert entity.reporting_status == "REVIEWED_AND_LOCKED"
            assert len(rows) == 1
            assert rows[0].opening_balance == "12345.6789"
            assert rows[0].adjustment_debit == "19.0000"
            assert rows[0].adjustment_credit == "3.0000"
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_document_to_voucher_requires_review_and_posts_once(client):
    response = await client.post(
        "/api/v1/documents",
        data={"entity_code": "HK-SME-01", "doc_type": "RECEIPT", "doc_date": "2026-10-17",
              "counterparty_name": "Demo expense reclassification", "amount": "110.0000"},
        files={"file": ("invoice.txt", b"Synthetic invoice for workflow test", "text/plain")},
    )
    assert response.status_code == 200, response.text
    document = response.json()["document"]
    downloaded = await client.get(f"/api/v1/documents/{document['document_id']}/file")
    assert downloaded.content == b"Synthetic invoice for workflow test"

    converted = await client.post(
        f"/api/v1/documents/{document['document_id']}/to-voucher",
        json={"principal_key": "ap-clerk-01", "debit_account_code": "6100", "credit_account_code": "5100"},
    )
    assert converted.status_code == 200, converted.text
    journal_id = converted.json()["journal_id"]
    assert (await repo.get_journal(journal_id))["status"] == "DRAFT"
    assert not any(line["journal_id"] == journal_id for line in await get_lines("HK-SME-01"))

    submitted = await client.post(f"/api/v1/vouchers/{journal_id}/submit", json={"principal_key": "ap-clerk-01"})
    assert submitted.status_code == 200, submitted.text
    self_review = await client.post(f"/api/v1/vouchers/{journal_id}/approve", json={"principal_key": "ap-clerk-01"})
    assert self_review.status_code == 400
    approved = await client.post(f"/api/v1/vouchers/{journal_id}/approve", json={"principal_key": "cpa-griffin"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["entry_status"] == "POSTED"
    lines = [line for line in await get_lines("HK-SME-01") if line["journal_id"] == journal_id]
    assert len(lines) == 2
    repeated = await client.post(f"/api/v1/vouchers/{journal_id}/approve", json={"principal_key": "cpa-griffin"})
    assert repeated.status_code == 400
    assert [line for line in await get_lines("HK-SME-01") if line["journal_id"] == journal_id] == lines
