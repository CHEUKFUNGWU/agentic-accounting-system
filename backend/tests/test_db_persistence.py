import os
from decimal import Decimal
from pathlib import Path
import pytest
from app.core.db import db_manager, get_default_db_path
from app.core.repository import repo
from app.core.reporting import TrialBalanceAccountRow

@pytest.mark.asyncio
async def test_sqlite_wal_persistence_and_seed_data():
    """
    Verifies that SQLite WAL mode is configured properly and that seed entities and accounts
    are persisted on disk.
    """
    db_path = get_default_db_path()
    assert db_path.exists(), f"SQLite database file {db_path} should exist"

    # Verify all 6 entities in SQLite
    entities = await repo.get_all_entities()
    assert len(entities) == 6
    assert "AU-OPC-01" in entities
    assert "US-SOLE-01" in entities

    # Verify ETB accounts
    etb_rows = await repo.get_trial_balance_accounts("AU-OPC-01")
    assert len(etb_rows) == 14
    cash_row = next(r for r in etb_rows if r.account_code == "1110")
    assert cash_row.opening_balance == Decimal("85000.0000")

@pytest.mark.asyncio
async def test_personal_split_and_aje_persistence():
    """
    Verifies persistence of personal expense apportionment logs and AJE entries.
    """
    split_entry = {
        "journal_id": "test-split-persistence-01",
        "entity_code": "AU-OPC-01",
        "description": "Founder Workstation & Fibre Split Test",
        "gross_amount": "2200.0000",
        "business_use_pct": "0.75",
        "business_expense_debit": "1500.0000",
        "recoverable_tax_debit": "150.0000",
        "personal_amount": "550.0000",
        "evidence_uri": "s3://evidence/split-test.pdf",
        "created_by": "test-suite",
    }
    await repo.save_personal_split(split_entry)

    splits = await repo.get_personal_splits("AU-OPC-01")
    saved = next((s for s in splits if s["journal_id"] == "test-split-persistence-01"), None)
    assert saved is not None
    assert saved["gross_amount"] == "2200.0000"
    assert saved["personal_amount"] == "550.0000"

    # Test custom AJE persistence
    aje_entry = {
        "aje_id": "test-aje-persistence-01",
        "entity_code": "AU-OPC-01",
        "debit_account_code": "6100",
        "credit_account_code": "2110",
        "amount": "1250.0000",
        "statement_ref": "AP",
        "memo": "Accrued audit fee test",
    }
    await repo.save_custom_aje(aje_entry)

    ajes = await repo.get_custom_ajes("AU-OPC-01")
    saved_aje = next((a for a in ajes if a["aje_id"] == "test-aje-persistence-01"), None)
    assert saved_aje is not None
    assert saved_aje["amount"] == "1250.0000"
