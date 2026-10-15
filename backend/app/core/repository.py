"""
Repository layer providing transactional CRUD and synchronization between
Domain Dataclasses and the persistent DatabaseManager (SQLite WAL / PostgreSQL).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import delete, select, update

from app.core.db import (
    CustomAJELogModel,
    DatabaseManager,
    EntityModel,
    ETBAccountModel,
    JournalEntryModel,
    PersonalSplitLogModel,
    db_manager,
)
from app.core.localization import q4
from app.core.working_papers import ETBAccountRow, EntityLegalStructure


DEFAULT_ENTITIES_SEED: Dict[str, Dict[str, Any]] = {
    "AU-OPC-01": {
        "legal_name": "Spark AI Studio Pty Ltd (Single-Director OPC)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "AU",
        "currency": "AUD",
        "accounting_standard": "AASB_TIER2",
        "tax_id": "51824753556",
    },
    "CN-OPC-01": {
        "legal_name": "上海智算一人有限公司 (PRC One-Person Ltd)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "CN",
        "currency": "CNY",
        "accounting_standard": "PRC_SMALL",
        "tax_id": "91310000MA1FL8888X",
    },
    "HK-SME-01": {
        "legal_name": "Pacific Nexus Tech Limited (HK SME)",
        "entity_structure": EntityLegalStructure.SME_CORP.value,
        "jurisdiction": "HK",
        "currency": "HKD",
        "accounting_standard": "SME_FRS_HK",
        "tax_id": "38910291",
    },
    "SG-OPC-01": {
        "legal_name": "Merlion Autonomous Labs Pte. Ltd. (SG Exempt Private OPC)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "SG",
        "currency": "SGD",
        "accounting_standard": "SFRS_SMALL",
        "tax_id": "202612345K",
    },
    "US-SOLE-01": {
        "legal_name": "Griffin Analytics LLC (US Single-Member Disregarded LLC / Schedule C)",
        "entity_structure": EntityLegalStructure.SOLE_PROPRIETOR.value,
        "jurisdiction": "US",
        "currency": "USD",
        "accounting_standard": "US_GAAP",
        "tax_id": "84-2910482",
    },
    "EU-OPC-01": {
        "legal_name": "rheinAI Cloud UG / GmbH (EU Single-Member OPC)",
        "entity_structure": EntityLegalStructure.OPC_LIMITED.value,
        "jurisdiction": "EU",
        "currency": "EUR",
        "accounting_standard": "IFRS",
        "tax_id": "DE123456789",
    },
}

INITIAL_ETB_SEED_TEMPLATE: List[Dict[str, Any]] = [
    {"account_code": "1110", "account_name": "Cash at Bank - Operating Account (銀行存款)", "account_type": "ASSET", "fs_category": "CASH", "wp_ref": "W/P A", "cash_flow_activity": "CASH_EQUIV", "opening_balance": "85000.0000", "period_op_debit": "142000.0000", "period_op_credit": "64500.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "1210", "account_name": "Accounts Receivable Control (應收帳款)", "account_type": "ASSET", "fs_category": "AR", "wp_ref": "W/P B", "cash_flow_activity": "OPERATING_WC", "opening_balance": "18000.0000", "period_op_debit": "165000.0000", "period_op_credit": "142000.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "1420", "account_name": "Prepayments & Input VAT/GST Recoverable (預付費用及進項稅額)", "account_type": "ASSET", "fs_category": "PREPAY_TAX", "wp_ref": "W/P C", "cash_flow_activity": "OPERATING_WC", "opening_balance": "4000.0000", "period_op_debit": "6500.0000", "period_op_credit": "0.0000", "aje_debit": "0.0000", "aje_credit": "1500.0000"},
    {"account_code": "1610", "account_name": "Computer & AI Server Equipment - Cost (固定資產原值)", "account_type": "ASSET", "fs_category": "FIXED_ASSET", "wp_ref": "W/P F", "cash_flow_activity": "INVESTING", "opening_balance": "36000.0000", "period_op_debit": "12000.0000", "period_op_credit": "0.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "1650", "account_name": "Accumulated Depreciation (累計折舊)", "account_type": "ASSET", "fs_category": "CONTRA_ASSET", "wp_ref": "W/P F", "cash_flow_activity": "NON_CASH", "opening_balance": "-6000.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "aje_debit": "0.0000", "aje_credit": "2000.0000"},
    {"account_code": "2110", "account_name": "Accounts Payable & Accrued Expenses (應付帳款及應計費用)", "account_type": "LIABILITY", "fs_category": "AP_ACCRUAL", "wp_ref": "W/P AA", "cash_flow_activity": "OPERATING_WC", "opening_balance": "-12000.0000", "period_op_debit": "52500.0000", "period_op_credit": "58000.0000", "aje_debit": "0.0000", "aje_credit": "3500.0000"},
    {"account_code": "2190", "account_name": "Director's Loan / Owner's Current Account (股東/董事往來 / 業主往來)", "account_type": "LIABILITY", "fs_category": "DIRECTOR_LOAN", "wp_ref": "W/P DD", "cash_flow_activity": "FINANCING", "opening_balance": "-15000.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "2210", "account_name": "Statutory Taxes Payable - GST/VAT/CIT (應交稅費)", "account_type": "LIABILITY", "fs_category": "TAX_PAYABLE", "wp_ref": "W/P CC", "cash_flow_activity": "OPERATING_WC", "opening_balance": "-10000.0000", "period_op_debit": "0.0000", "period_op_credit": "15000.0000", "aje_debit": "0.0000", "aje_credit": "11200.0000"},
    {"account_code": "3100", "account_name": "Share Capital / Owner's Capital & Opening Surplus (實收資本及期初留存)", "account_type": "EQUITY", "fs_category": "EQUITY", "wp_ref": "W/P EQ", "cash_flow_activity": "FINANCING", "opening_balance": "-100000.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "4100", "account_name": "AI Consulting & SaaS Subscription Revenue (主營業務收入)", "account_type": "REVENUE", "fs_category": "REVENUE", "wp_ref": "W/P PL-10", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "0.0000", "period_op_credit": "150000.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "5100", "account_name": "Direct Cloud GPU & LLM API Token Cost (主營業務成本)", "account_type": "EXPENSE", "fs_category": "COGS", "wp_ref": "W/P PL-20", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "24000.0000", "period_op_credit": "0.0000", "aje_debit": "0.0000", "aje_credit": "0.0000"},
    {"account_code": "6100", "account_name": "Operating, Software, Rent & Professional Expenses (管理及營運費用)", "account_type": "EXPENSE", "fs_category": "OPEX", "wp_ref": "W/P PL-40", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "27500.0000", "period_op_credit": "0.0000", "aje_debit": "5000.0000", "aje_credit": "0.0000"},
    {"account_code": "6410", "account_name": "Depreciation Expense (折舊費用)", "account_type": "EXPENSE", "fs_category": "DEPRECIATION", "wp_ref": "W/P F", "cash_flow_activity": "NON_CASH", "opening_balance": "0.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "aje_debit": "2000.0000", "aje_credit": "0.0000"},
    {"account_code": "7500", "account_name": "Income Tax Expense (所得稅費用)", "account_type": "EXPENSE", "fs_category": "TAX_EXPENSE", "wp_ref": "W/P CC", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "aje_debit": "11200.0000", "aje_credit": "0.0000"},
]


class AccountingRepository:
    def __init__(self, manager: Optional[DatabaseManager] = None):
        self.manager = manager or db_manager

    async def init_seed_data_if_needed(self) -> None:
        """Initializes tables and populates default entities and initial ETB ledgers if empty."""
        await self.manager.init_db()
        async with self.manager.session_factory() as session:
            stmt = select(EntityModel).limit(1)
            result = await session.execute(stmt)
            if result.scalar_one_or_none() is not None:
                return  # Already seeded

            for code, meta in DEFAULT_ENTITIES_SEED.items():
                entity = EntityModel(
                    entity_code=code,
                    legal_name=meta["legal_name"],
                    entity_structure=meta["entity_structure"],
                    jurisdiction=meta["jurisdiction"],
                    currency=meta["currency"],
                    accounting_standard=meta["accounting_standard"],
                    tax_id=meta["tax_id"],
                    pack_status="READY_FOR_CPA",
                )
                session.add(entity)

                for item in INITIAL_ETB_SEED_TEMPLATE:
                    row = ETBAccountModel(
                        entity_code=code,
                        account_code=item["account_code"],
                        account_name=item["account_name"],
                        account_type=item["account_type"],
                        fs_category=item["fs_category"],
                        wp_ref=item["wp_ref"],
                        cash_flow_activity=item["cash_flow_activity"],
                        opening_balance=item["opening_balance"],
                        period_op_debit=item["period_op_debit"],
                        period_op_credit=item["period_op_credit"],
                        aje_debit=item["aje_debit"],
                        aje_credit=item["aje_credit"],
                    )
                    session.add(row)

            await session.commit()

    async def get_all_entities(self) -> Dict[str, Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(EntityModel)
            res = await session.execute(stmt)
            entities = res.scalars().all()
            return {
                e.entity_code: {
                    "legal_name": e.legal_name,
                    "entity_structure": e.entity_structure,
                    "jurisdiction": e.jurisdiction,
                    "currency": e.currency,
                    "accounting_standard": e.accounting_standard,
                    "tax_id": e.tax_id,
                    "pack_status": e.pack_status,
                }
                for e in entities
            }

    async def get_entity(self, entity_code: str) -> Optional[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(EntityModel).where(EntityModel.entity_code == entity_code)
            res = await session.execute(stmt)
            e = res.scalar_one_or_none()
            if not e:
                return None
            return {
                "entity_code": e.entity_code,
                "legal_name": e.legal_name,
                "entity_structure": e.entity_structure,
                "jurisdiction": e.jurisdiction,
                "currency": e.currency,
                "accounting_standard": e.accounting_standard,
                "tax_id": e.tax_id,
                "pack_status": e.pack_status,
            }

    async def set_pack_status(self, entity_code: str, status: str) -> None:
        async with self.manager.session_factory() as session:
            stmt = (
                update(EntityModel)
                .where(EntityModel.entity_code == entity_code)
                .values(pack_status=status)
            )
            await session.execute(stmt)
            await session.commit()

    async def get_etb_accounts(self, entity_code: str) -> List[ETBAccountRow]:
        async with self.manager.session_factory() as session:
            stmt = (
                select(ETBAccountModel)
                .where(ETBAccountModel.entity_code == entity_code)
                .order_by(ETBAccountModel.account_code)
            )
            res = await session.execute(stmt)
            rows = res.scalars().all()
            return [
                ETBAccountRow(
                    account_code=r.account_code,
                    account_name=r.account_name,
                    account_type=r.account_type,
                    fs_category=r.fs_category,
                    wp_ref=r.wp_ref,
                    cash_flow_activity=r.cash_flow_activity,
                    opening_balance=Decimal(r.opening_balance),
                    period_op_debit=Decimal(r.period_op_debit),
                    period_op_credit=Decimal(r.period_op_credit),
                    aje_debit=Decimal(r.aje_debit),
                    aje_credit=Decimal(r.aje_credit),
                )
                for r in rows
            ]

    async def save_etb_accounts(self, entity_code: str, accounts: List[ETBAccountRow]) -> None:
        async with self.manager.session_factory() as session:
            for acc in accounts:
                stmt = (
                    update(ETBAccountModel)
                    .where(
                        ETBAccountModel.entity_code == entity_code,
                        ETBAccountModel.account_code == acc.account_code,
                    )
                    .values(
                        period_op_debit=str(acc.period_op_debit),
                        period_op_credit=str(acc.period_op_credit),
                        aje_debit=str(acc.aje_debit),
                        aje_credit=str(acc.aje_credit),
                    )
                )
                await session.execute(stmt)
            await session.commit()

    async def save_personal_split(self, split: Dict[str, Any]) -> None:
        async with self.manager.session_factory() as session:
            model = PersonalSplitLogModel(
                journal_id=split["journal_id"],
                entity_code=split["entity_code"],
                description=split["description"],
                gross_amount=split["gross_amount"],
                business_use_pct=split["business_use_pct"],
                business_expense_debit=split["business_expense_debit"],
                recoverable_tax_debit=split["recoverable_tax_debit"],
                personal_amount=split["personal_amount"],
                evidence_uri=split["evidence_uri"],
                created_by=split["created_by"],
            )
            session.add(model)
            await session.commit()

    async def get_personal_splits(self, entity_code: str) -> List[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = (
                select(PersonalSplitLogModel)
                .where(PersonalSplitLogModel.entity_code == entity_code)
                .order_by(PersonalSplitLogModel.id.desc())
            )
            res = await session.execute(stmt)
            splits = res.scalars().all()
            return [
                {
                    "journal_id": s.journal_id,
                    "entity_code": s.entity_code,
                    "description": s.description,
                    "gross_amount": s.gross_amount,
                    "business_use_pct": s.business_use_pct,
                    "business_expense_debit": s.business_expense_debit,
                    "recoverable_tax_debit": s.recoverable_tax_debit,
                    "personal_amount": s.personal_amount,
                    "evidence_uri": s.evidence_uri,
                    "created_by": s.created_by,
                }
                for s in splits
            ]

    async def save_custom_aje(self, aje: Dict[str, Any]) -> None:
        async with self.manager.session_factory() as session:
            model = CustomAJELogModel(
                aje_id=aje["aje_id"],
                entity_code=aje["entity_code"],
                debit_account_code=aje["debit_account_code"],
                credit_account_code=aje["credit_account_code"],
                amount=aje["amount"],
                wp_ref=aje["wp_ref"],
                memo=aje["memo"],
                created_at=aje.get("created_at") or datetime.now(timezone.utc).isoformat(),
            )
            await session.merge(model)
            await session.commit()

    async def get_custom_ajes(self, entity_code: str) -> List[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = (
                select(CustomAJELogModel)
                .where(CustomAJELogModel.entity_code == entity_code)
                .order_by(CustomAJELogModel.created_at.desc())
            )
            res = await session.execute(stmt)
            ajes = res.scalars().all()
            return [
                {
                    "aje_id": a.aje_id,
                    "entity_code": a.entity_code,
                    "debit_account_code": a.debit_account_code,
                    "credit_account_code": a.credit_account_code,
                    "amount": a.amount,
                    "wp_ref": a.wp_ref,
                    "memo": a.memo,
                    "created_at": a.created_at,
                }
                for a in ajes
            ]

    async def save_journal(self, entry: Dict[str, Any]) -> None:
        async with self.manager.session_factory() as session:
            model = JournalEntryModel(
                journal_id=entry["journal_id"],
                entity_code=entry["entity_code"],
                source_module=entry.get("source_module", "MANUAL"),
                status=entry.get("status", "POSTED"),
                accounting_date=entry["accounting_date"],
                currency=entry["currency"],
                total_debit=str(entry["total_debit"]),
                total_credit=str(entry["total_credit"]),
                created_by_principal_key=entry["created_by_principal_key"],
                created_by_principal_id=str(entry["created_by_principal_id"]),
                approved_by_principal_key=entry.get("approved_by_principal_key"),
                approved_by_principal_id=str(entry.get("approved_by_principal_id")) if entry.get("approved_by_principal_id") else None,
                ai_confidence_score=str(entry.get("ai_confidence_score", "1.0000")),
                ai_reasoning_summary=entry.get("ai_reasoning_summary", ""),
                evidence_uris=json.dumps(entry.get("evidence_uris", [])),
                entry_hash=entry.get("entry_hash"),
                prev_entry_hash=entry.get("prev_entry_hash"),
                lines_json=json.dumps(entry.get("lines", [])),
            )
            await session.merge(model)
            await session.commit()

    async def get_journal(self, journal_id: str) -> Optional[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(JournalEntryModel).where(JournalEntryModel.journal_id == journal_id)
            res = await session.execute(stmt)
            m = res.scalar_one_or_none()
            if not m:
                return None
            return {
                "journal_id": m.journal_id,
                "entity_code": m.entity_code,
                "source_module": m.source_module,
                "status": m.status,
                "accounting_date": m.accounting_date,
                "currency": m.currency,
                "total_debit": m.total_debit,
                "total_credit": m.total_credit,
                "created_by_principal_key": m.created_by_principal_key,
                "created_by_principal_id": m.created_by_principal_id,
                "approved_by_principal_key": m.approved_by_principal_key,
                "approved_by_principal_id": m.approved_by_principal_id,
                "ai_confidence_score": m.ai_confidence_score,
                "ai_reasoning_summary": m.ai_reasoning_summary,
                "evidence_uris": json.loads(m.evidence_uris),
                "entry_hash": m.entry_hash,
                "prev_entry_hash": m.prev_entry_hash,
                "lines": json.loads(m.lines_json),
            }

    async def get_journals(
        self,
        entity_code: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(JournalEntryModel)
            if entity_code:
                stmt = stmt.where(JournalEntryModel.entity_code == entity_code)
            if status:
                stmt = stmt.where(JournalEntryModel.status == status)
            stmt = stmt.order_by(JournalEntryModel.created_at.desc())
            res = await session.execute(stmt)
            records = res.scalars().all()
            return [
                {
                    "journal_id": m.journal_id,
                    "entity_code": m.entity_code,
                    "source_module": m.source_module,
                    "status": m.status,
                    "accounting_date": m.accounting_date,
                    "currency": m.currency,
                    "total_debit": m.total_debit,
                    "total_credit": m.total_credit,
                    "created_by_principal_key": m.created_by_principal_key,
                    "created_by_principal_id": m.created_by_principal_id,
                    "approved_by_principal_key": m.approved_by_principal_key,
                    "approved_by_principal_id": m.approved_by_principal_id,
                    "ai_confidence_score": m.ai_confidence_score,
                    "ai_reasoning_summary": m.ai_reasoning_summary,
                    "evidence_uris": json.loads(m.evidence_uris),
                    "entry_hash": m.entry_hash,
                    "prev_entry_hash": m.prev_entry_hash,
                    "lines": json.loads(m.lines_json),
                }
                for m in records
            ]

    async def get_latest_posted_hash(self, entity_code: str) -> str:
        async with self.manager.session_factory() as session:
            stmt = (
                select(JournalEntryModel.entry_hash)
                .where(
                    JournalEntryModel.entity_code == entity_code,
                    JournalEntryModel.status == "POSTED",
                    JournalEntryModel.entry_hash.isnot(None),
                )
                .order_by(JournalEntryModel.created_at.desc())
                .limit(1)
            )
            res = await session.execute(stmt)
            h = res.scalar_one_or_none()
            return h or "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"


repo = AccountingRepository()
