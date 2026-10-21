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

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.transactions import transaction_session

from app.core.db import (
    CustomAJELogModel,
    DocumentModel,
    MCPAuditLogModel,
    DatabaseManager,
    EntityModel,
    TrialBalanceAccountModel,
    ExceptionModel,
    JournalEntryModel,
    PersonalSplitLogModel,
    db_manager,
)
from app.core.localization import q4
from app.core.reporting import TrialBalanceAccountRow, EntityLegalStructure


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

LEGACY_TRIAL_BALANCE_SEED: List[Dict[str, Any]] = [
    {"account_code": "1110", "account_name": "Cash at Bank - Operating Account (銀行存款)", "account_type": "ASSET", "fs_category": "CASH", "statement_ref": "CASH", "cash_flow_activity": "CASH_EQUIV", "opening_balance": "85000.0000", "period_op_debit": "142000.0000", "period_op_credit": "64500.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "1210", "account_name": "Accounts Receivable Control (應收賬款)", "account_type": "ASSET", "fs_category": "AR", "statement_ref": "AR", "cash_flow_activity": "OPERATING_WC", "opening_balance": "18000.0000", "period_op_debit": "165000.0000", "period_op_credit": "142000.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "1420", "account_name": "Prepayments & Input VAT/GST Recoverable (預付費用及進項稅額)", "account_type": "ASSET", "fs_category": "PREPAY_TAX", "statement_ref": "PREPAY", "cash_flow_activity": "OPERATING_WC", "opening_balance": "4000.0000", "period_op_debit": "6500.0000", "period_op_credit": "0.0000", "adjustment_debit": "0.0000", "adjustment_credit": "1500.0000"},
    {"account_code": "1610", "account_name": "Computer & AI Server Equipment - Cost (固定資產原值)", "account_type": "ASSET", "fs_category": "FIXED_ASSET", "statement_ref": "FA", "cash_flow_activity": "INVESTING", "opening_balance": "36000.0000", "period_op_debit": "12000.0000", "period_op_credit": "0.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "1650", "account_name": "Accumulated Depreciation (累計折舊)", "account_type": "ASSET", "fs_category": "CONTRA_ASSET", "statement_ref": "FA", "cash_flow_activity": "NON_CASH", "opening_balance": "-6000.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "adjustment_debit": "0.0000", "adjustment_credit": "2000.0000"},
    {"account_code": "2110", "account_name": "Accounts Payable & Accrued Expenses (應付賬款及應計費用)", "account_type": "LIABILITY", "fs_category": "AP_ACCRUAL", "statement_ref": "AP", "cash_flow_activity": "OPERATING_WC", "opening_balance": "-12000.0000", "period_op_debit": "52500.0000", "period_op_credit": "58000.0000", "adjustment_debit": "0.0000", "adjustment_credit": "3500.0000"},
    {"account_code": "2190", "account_name": "Director's Loan / Owner's Current Account (股東/董事往來 / 業主往來)", "account_type": "LIABILITY", "fs_category": "DIRECTOR_LOAN", "statement_ref": "DIRECTOR", "cash_flow_activity": "FINANCING", "opening_balance": "-15000.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "2210", "account_name": "Statutory Taxes Payable - GST/VAT/CIT (應交稅費)", "account_type": "LIABILITY", "fs_category": "TAX_PAYABLE", "statement_ref": "TAX", "cash_flow_activity": "OPERATING_WC", "opening_balance": "-10000.0000", "period_op_debit": "0.0000", "period_op_credit": "15000.0000", "adjustment_debit": "0.0000", "adjustment_credit": "11200.0000"},
    {"account_code": "3100", "account_name": "Share Capital / Owner's Capital & Opening Surplus (實收資本及期初留存)", "account_type": "EQUITY", "fs_category": "EQUITY", "statement_ref": "EQ", "cash_flow_activity": "FINANCING", "opening_balance": "-100000.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "4100", "account_name": "AI Consulting & SaaS Subscription Revenue (主營業務收入)", "account_type": "REVENUE", "fs_category": "REVENUE", "statement_ref": "PL-10", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "0.0000", "period_op_credit": "150000.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "5100", "account_name": "Direct Cloud GPU & LLM API Token Cost (主營業務成本)", "account_type": "EXPENSE", "fs_category": "COGS", "statement_ref": "PL-20", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "24000.0000", "period_op_credit": "0.0000", "adjustment_debit": "0.0000", "adjustment_credit": "0.0000"},
    {"account_code": "6100", "account_name": "Operating, Software, Rent & Professional Expenses (管理及營運費用)", "account_type": "EXPENSE", "fs_category": "OPEX", "statement_ref": "PL-40", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "27500.0000", "period_op_credit": "0.0000", "adjustment_debit": "5000.0000", "adjustment_credit": "0.0000"},
    {"account_code": "6410", "account_name": "Depreciation Expense (折舊費用)", "account_type": "EXPENSE", "fs_category": "DEPRECIATION", "statement_ref": "FA", "cash_flow_activity": "NON_CASH", "opening_balance": "0.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "adjustment_debit": "2000.0000", "adjustment_credit": "0.0000"},
    {"account_code": "7500", "account_name": "Income Tax Expense (所得稅費用)", "account_type": "EXPENSE", "fs_category": "TAX_EXPENSE", "statement_ref": "TAX", "cash_flow_activity": "OPERATING_WC", "opening_balance": "0.0000", "period_op_debit": "0.0000", "period_op_credit": "0.0000", "adjustment_debit": "11200.0000", "adjustment_credit": "0.0000"},
]


def journal_to_dict(m: "JournalEntryModel") -> Dict[str, Any]:
    """Single place that turns a stored voucher row into the API shape."""
    return {
        "journal_id": m.journal_id,
        "revision": m.revision,
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
        "evidence_uris": json.loads(m.evidence_uris or "[]"),
        "entry_hash": m.entry_hash,
        "prev_entry_hash": m.prev_entry_hash,
        "block_index": m.block_index,
        "posted_at": m.posted_at.isoformat() if m.posted_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "voucher_no": m.voucher_no,
        "period": m.period,
        "memo": m.memo,
        "reject_reason": m.reject_reason,
        "submitted_at": m.submitted_at.isoformat() if m.submitted_at else None,
        "reversal_of_journal_id": m.reversal_of_journal_id,
        "basis": m.basis,
        "entry_layer": m.entry_layer,
        "review_notes": m.review_notes,
        "proposal_json": m.proposal_json,
        "lines": json.loads(m.lines_json or "[]"),
    }


class JournalConflict(ValueError):
    """The persisted voucher changed, or the requested write is not allowed."""


def _journal_datetime(value):
    # get_journal returns ISO strings, while SQLAlchemy DateTime needs datetime.
    return datetime.fromisoformat(value) if isinstance(value, str) else value


class AccountingRepository:
    def __init__(self, manager: Optional[DatabaseManager] = None):
        self.manager = manager or db_manager

    async def init_seed_data_if_needed(self) -> None:
        """Initializes tables and populates default entities and the opening trial balance if empty."""
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
                    reporting_status="READY",
                )
                session.add(entity)

                for item in LEGACY_TRIAL_BALANCE_SEED:
                    row = TrialBalanceAccountModel(
                        entity_code=code,
                        account_code=item["account_code"],
                        account_name=item["account_name"],
                        account_type=item["account_type"],
                        fs_category=item["fs_category"],
                        statement_ref=item["statement_ref"],
                        cash_flow_activity=item["cash_flow_activity"],
                        opening_balance=item["opening_balance"],
                        period_op_debit=item["period_op_debit"],
                        period_op_credit=item["period_op_credit"],
                        adjustment_debit=item["adjustment_debit"],
                        adjustment_credit=item["adjustment_credit"],
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
                    "reporting_status": e.reporting_status,
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
                "reporting_status": e.reporting_status,
            }

    async def set_reporting_status(self, entity_code: str, status: str) -> None:
        async with self.manager.session_factory() as session:
            stmt = (
                update(EntityModel)
                .where(EntityModel.entity_code == entity_code)
                .values(reporting_status=status)
            )
            await session.execute(stmt)
            await session.commit()

    async def get_trial_balance_accounts(self, entity_code: str) -> List[TrialBalanceAccountRow]:
        async with self.manager.session_factory() as session:
            stmt = (
                select(TrialBalanceAccountModel)
                .where(TrialBalanceAccountModel.entity_code == entity_code)
                .order_by(TrialBalanceAccountModel.account_code)
            )
            res = await session.execute(stmt)
            rows = res.scalars().all()
            return [
                TrialBalanceAccountRow(
                    account_code=r.account_code,
                    account_name=r.account_name,
                    account_type=r.account_type,
                    fs_category=r.fs_category,
                    statement_ref=r.statement_ref,
                    cash_flow_activity=r.cash_flow_activity,
                    opening_balance=Decimal(r.opening_balance),
                    period_op_debit=Decimal(r.period_op_debit),
                    period_op_credit=Decimal(r.period_op_credit),
                    adjustment_debit=Decimal(r.adjustment_debit),
                    adjustment_credit=Decimal(r.adjustment_credit),
                )
                for r in rows
            ]

    async def save_trial_balance_accounts(self, entity_code: str, accounts: List[TrialBalanceAccountRow]) -> None:
        async with self.manager.session_factory() as session:
            for acc in accounts:
                stmt = (
                    update(TrialBalanceAccountModel)
                    .where(
                        TrialBalanceAccountModel.entity_code == entity_code,
                        TrialBalanceAccountModel.account_code == acc.account_code,
                    )
                    .values(
                        period_op_debit=str(acc.period_op_debit),
                        period_op_credit=str(acc.period_op_credit),
                        adjustment_debit=str(acc.adjustment_debit),
                        adjustment_credit=str(acc.adjustment_credit),
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
                statement_ref=aje["statement_ref"],
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
                    "statement_ref": a.statement_ref,
                    "memo": a.memo,
                    "created_at": a.created_at,
                }
                for a in ajes
            ]

    async def save_journal(self, entry: Dict[str, Any]) -> None:
        """Create from a dict, or replace the revision read by this caller.

        Existing rows require a revision, including zero for migrated rows.
        Never infer one at save time: that would make stale dicts unconditional
        overwrites again. Only update the caller's revision after commit.
        """
        try:
            async with self.manager.session_factory() as session, session.begin():
                if self.manager.is_sqlite:
                    await session.execute(text("BEGIN IMMEDIATE"))
                current = (await session.execute(
                    select(JournalEntryModel).where(
                        JournalEntryModel.journal_id == entry["journal_id"]
                    ).with_for_update()
                )).scalar_one_or_none()
                if current is not None and entry.get("revision") != current.revision:
                    raise JournalConflict("VOUCHER_REVISION_CONFLICT: Reload before saving.")
                if current is None and "revision" in entry:
                    raise JournalConflict("VOUCHER_REVISION_CONFLICT: Voucher no longer exists.")
                model = self._journal_model(entry)
                values = {key: value for key, value in vars(model).items() if not key.startswith("_")}
                if current is None:
                    session.add(model)
                    revision = 0
                else:
                    revision = current.revision + 1
                    if current.status in ("POSTED", "REVERSED", "VOID"):
                        # The only finalized transition is a status-only reversal.
                        changed = [key for key, value in values.items()
                                   if key != "status" and value != getattr(current, key)]
                        if changed or not (model.status == current.status or
                                           current.status == "POSTED" and model.status == "REVERSED"):
                            raise JournalConflict("VOUCHER_IMMUTABLE: Finalized fields cannot change.")
                        values = {"status": model.status}
                    else:
                        transitions = {
                            "DRAFT": {"DRAFT", "PENDING_CHECKER", "VOID"},
                            "REJECTED": {"REJECTED", "DRAFT", "PENDING_CHECKER", "VOID"},
                            "PENDING_CHECKER": {"PENDING_CHECKER", "AWAITING_CPA", "REJECTED"},
                            "AWAITING_CPA": {"AWAITING_CPA", "REJECTED"},
                        }
                        if model.status not in transitions.get(current.status, set()):
                            raise JournalConflict("VOUCHER_STATE_CONFLICT: Use the posting engine to finalize.")
                        for key in ("entry_hash", "prev_entry_hash", "block_index", "posted_at"):
                            if key in values and values[key] != getattr(current, key):
                                raise JournalConflict("VOUCHER_IMMUTABLE: Only posting may seal a voucher.")
                    result = await session.execute(update(JournalEntryModel).where(
                        JournalEntryModel.journal_id == current.journal_id,
                        JournalEntryModel.revision == current.revision,
                        JournalEntryModel.status == current.status,
                    ).values(**values, revision=revision).execution_options(synchronize_session=False))
                    if result.rowcount != 1:
                        raise JournalConflict("VOUCHER_REVISION_CONFLICT: Reload before saving.")
        except IntegrityError as exc:
            raise JournalConflict("VOUCHER_CREATE_CONFLICT: Journal ID already exists or is invalid.") from exc
        entry["revision"] = revision

    async def insert_draft(self, entry: Dict[str, Any], *, session: AsyncSession) -> None:
        """Insert only, in a caller transaction. Never mutate the caller's dict.

        Updates must still go through save_journal's revision/state guards.
        """
        if entry.get("status") != "DRAFT" or "revision" in entry:
            raise JournalConflict("VOUCHER_CREATE_CONFLICT: Expected a new draft.")
        if any(entry.get(key) for key in ("entry_hash", "prev_entry_hash", "block_index", "posted_at")):
            raise JournalConflict("VOUCHER_IMMUTABLE: Draft cannot be sealed.")
        session.add(self._journal_model(entry))
        await session.flush()

    @staticmethod
    def _journal_model(entry: Dict[str, Any]) -> JournalEntryModel:
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
            approved_by_principal_id=str(entry["approved_by_principal_id"]) if entry.get("approved_by_principal_id") else None,
            ai_confidence_score=str(entry.get("ai_confidence_score", "1.0000")),
            ai_reasoning_summary=entry.get("ai_reasoning_summary", ""),
            evidence_uris=json.dumps(entry.get("evidence_uris", [])),
            entry_hash=entry.get("entry_hash"),
            prev_entry_hash=entry.get("prev_entry_hash"),
            lines_json=json.dumps(entry.get("lines", [])),
            voucher_no=entry.get("voucher_no"),
            period=entry.get("period"),
            memo=entry.get("memo"),
            reject_reason=entry.get("reject_reason"),
            submitted_at=_journal_datetime(entry.get("submitted_at")),
            reversal_of_journal_id=entry.get("reversal_of_journal_id"),
            basis=entry.get("basis"),
            entry_layer=entry.get("entry_layer"),
            review_notes=entry.get("review_notes"),
            proposal_json=entry.get("proposal_json"),
        )
        for key in ("block_index", "posted_at", "created_at"):
            if key in entry:
                value = entry[key]
                setattr(model, key, _journal_datetime(value) if key.endswith("_at") else value)
        return model

    async def get_journal(self, journal_id: str, *, session: AsyncSession | None = None) -> Optional[Dict[str, Any]]:
        async with transaction_session(self.manager, session) as session:
            stmt = select(JournalEntryModel).where(JournalEntryModel.journal_id == journal_id).with_for_update()
            res = await session.execute(stmt)
            m = res.scalar_one_or_none()
            if not m:
                return None
            return journal_to_dict(m)

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
            return [journal_to_dict(m) for m in records]

    # --------------------------------------------------------------- documents
    async def save_document(self, record: Dict[str, Any]) -> None:
        async with self.manager.session_factory() as session:
            await session.merge(
                DocumentModel(
                    document_id=record["document_id"],
                    entity_code=record["entity_code"],
                    doc_type=record.get("doc_type", "OTHER"),
                    doc_date=record.get("doc_date", ""),
                    counterparty_id=record.get("counterparty_id"),
                    counterparty_name=record.get("counterparty_name", ""),
                    amount=record.get("amount", "0.0000"),
                    currency=record.get("currency", ""),
                    status=record.get("status", "NEW"),
                    journal_id=record.get("journal_id"),
                    filename=record.get("filename", ""),
                    stored_name=record.get("stored_name", ""),
                    mime=record.get("mime", ""),
                    size=record.get("size", 0),
                    sha256=record.get("sha256", ""),
                    uploaded_by=record.get("uploaded_by", ""),
                    note=record.get("note", ""),
                    posted_at=record.get("posted_at"),
                )
            )
            await session.commit()

    @staticmethod
    def _document_dict(m: "DocumentModel") -> Dict[str, Any]:
        return {
            "document_id": m.document_id,
            "entity_code": m.entity_code,
            "doc_type": m.doc_type,
            "doc_date": m.doc_date,
            "counterparty_id": m.counterparty_id,
            "counterparty_name": m.counterparty_name,
            "amount": m.amount,
            "currency": m.currency,
            "status": m.status,
            "journal_id": m.journal_id,
            "filename": m.filename,
            "stored_name": m.stored_name,
            "mime": m.mime,
            "size": m.size,
            "sha256": m.sha256,
            "uploaded_by": m.uploaded_by,
            "note": m.note,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "posted_at": m.posted_at.isoformat() if m.posted_at else None,
        }

    async def get_documents(
        self, entity_code: Optional[str] = None, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(DocumentModel)
            if entity_code:
                stmt = stmt.where(DocumentModel.entity_code == entity_code)
            if status:
                stmt = stmt.where(DocumentModel.status == status)
            stmt = stmt.order_by(DocumentModel.doc_date.desc(), DocumentModel.created_at.desc())
            return [self._document_dict(m) for m in (await session.execute(stmt)).scalars().all()]

    async def get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            m = await session.get(DocumentModel, document_id)
            return self._document_dict(m) if m else None

    async def link_document_to_journal(self, document_id: str, journal_id: str) -> None:
        async with self.manager.session_factory() as session:
            m = await session.get(DocumentModel, document_id)
            if not m:
                return
            m.status = "POSTED"
            m.journal_id = journal_id
            m.posted_at = datetime.now(timezone.utc)
            await session.commit()

    async def set_document_status(self, document_id: str, status: str, note: str = "") -> None:
        async with self.manager.session_factory() as session:
            m = await session.get(DocumentModel, document_id)
            if not m:
                return
            m.status = status
            if note:
                m.note = note
            await session.commit()

    # ------------------------------------------------------------------- audit
    async def save_audit_log(self, record: Dict[str, Any]) -> None:
        async with self.manager.session_factory() as session:
            session.add(
                MCPAuditLogModel(
                    log_id=record["log_id"],
                    position=record.get("position", ""),
                    principal_key=record.get("principal_key", ""),
                    tool=record.get("tool", ""),
                    outcome=record.get("outcome", "OK"),
                    error_code=record.get("error_code"),
                    error_message=record.get("error_message"),
                    entity_code=record.get("entity_code"),
                    journal_id=record.get("journal_id"),
                    params_json=record.get("params_json", "{}"),
                    document_sha256s=record.get("document_sha256s", "[]"),
                    duration_ms=record.get("duration_ms"),
                    created_at=record.get("created_at") or datetime.now(timezone.utc),
                )
            )
            await session.commit()

    async def get_audit_logs(
        self,
        entity_code: Optional[str] = None,
        tool: Optional[str] = None,
        principal_key: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(MCPAuditLogModel)
            if entity_code:
                stmt = stmt.where(MCPAuditLogModel.entity_code == entity_code)
            if tool:
                stmt = stmt.where(MCPAuditLogModel.tool == tool)
            if principal_key:
                stmt = stmt.where(MCPAuditLogModel.principal_key == principal_key)
            stmt = stmt.order_by(MCPAuditLogModel.created_at.desc()).limit(limit)
            res = await session.execute(stmt)
            return [
                {
                    "log_id": m.log_id,
                    "position": m.position,
                    "principal_key": m.principal_key,
                    "tool": m.tool,
                    "outcome": m.outcome,
                    "error_code": m.error_code,
                    "error_message": m.error_message,
                    "entity_code": m.entity_code,
                    "journal_id": m.journal_id,
                    "params": json.loads(m.params_json or "{}"),
                    "document_sha256s": json.loads(m.document_sha256s or "[]"),
                    "duration_ms": m.duration_ms,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in res.scalars().all()
            ]

    # ---------------------------------------------------------------- exceptions
    async def save_exception(self, record: Dict[str, Any]) -> None:
        async with self.manager.session_factory() as session:
            await session.merge(
                ExceptionModel(
                    exception_id=record["exception_id"],
                    entity_code=record["entity_code"],
                    journal_id=record.get("journal_id"),
                    subject=record["subject"],
                    detail=record.get("detail", ""),
                    raised_by_principal_key=record["raised_by_principal_key"],
                    raised_by_position=record["raised_by_position"],
                    status=record.get("status", "OPEN"),
                    resolved_by_principal_key=record.get("resolved_by_principal_key"),
                    resolution_note=record.get("resolution_note"),
                    created_at=record.get("created_at") or datetime.now(timezone.utc),
                    resolved_at=record.get("resolved_at"),
                )
            )
            await session.commit()

    async def get_exceptions(
        self, entity_code: Optional[str] = None, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        async with self.manager.session_factory() as session:
            stmt = select(ExceptionModel)
            if entity_code:
                stmt = stmt.where(ExceptionModel.entity_code == entity_code)
            if status:
                stmt = stmt.where(ExceptionModel.status == status)
            stmt = stmt.order_by(ExceptionModel.created_at.desc())
            res = await session.execute(stmt)
            return [
                {
                    "exception_id": m.exception_id,
                    "entity_code": m.entity_code,
                    "journal_id": m.journal_id,
                    "subject": m.subject,
                    "detail": m.detail,
                    "raised_by_principal_key": m.raised_by_principal_key,
                    "raised_by_position": m.raised_by_position,
                    "status": m.status,
                    "resolved_by_principal_key": m.resolved_by_principal_key,
                    "resolution_note": m.resolution_note,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "resolved_at": m.resolved_at.isoformat() if m.resolved_at else None,
                }
                for m in res.scalars().all()
            ]

    async def resolve_exception(self, exception_id: str, principal_key: str, note: str) -> bool:
        async with self.manager.session_factory() as session:
            stmt = select(ExceptionModel).where(ExceptionModel.exception_id == exception_id)
            m = (await session.execute(stmt)).scalar_one_or_none()
            if not m:
                return False
            m.status = "RESOLVED"
            m.resolved_by_principal_key = principal_key
            m.resolution_note = note
            m.resolved_at = datetime.now(timezone.utc)
            await session.commit()
            return True

    async def mark_posted(
        self,
        journal_id: str,
        *,
        entry_hash: str,
        prev_entry_hash: str,
        block_index: int,
        approved_by_principal_key: str,
        approved_by_principal_id: Optional[str],
        review_notes: Optional[str] = None,
        session: AsyncSession | None = None,
    ) -> None:
        """
        Guarded transition to POSTED. Refuses unless the voucher is awaiting a
        decision, which is also the double-approval guard.

        This replaced `post_journal_and_update_etb`: posting no longer writes
        balances anywhere, because balances are derived from journal_lines.
        """
        if session is None:
            async with self.manager.session_factory() as owned, owned.begin():
                if self.manager.is_sqlite:
                    await owned.execute(text("BEGIN IMMEDIATE"))
                await self.mark_posted(
                    journal_id, entry_hash=entry_hash, prev_entry_hash=prev_entry_hash,
                    block_index=block_index, approved_by_principal_key=approved_by_principal_key,
                    approved_by_principal_id=approved_by_principal_id,
                    review_notes=review_notes, session=owned,
                )
            return
        async with transaction_session(self.manager, session) as session:
            stmt = (
                select(JournalEntryModel)
                .where(JournalEntryModel.journal_id == journal_id)
                .with_for_update()
            )
            model = (await session.execute(stmt)).scalar_one_or_none()
            if not model:
                raise ValueError(f"Journal '{journal_id}' not found in database.")
            if model.status not in ("PENDING_CHECKER", "AWAITING_CPA"):
                raise ValueError(
                    f"CANNOT_POST_FINALIZED_JOURNAL: 憑證 '{journal_id}' 目前狀態為 '{model.status}'，"
                    "不可重複過賬或過賬已結案的分錄。"
                )
            model.status = "POSTED"
            model.revision += 1
            model.entry_hash = entry_hash
            model.prev_entry_hash = prev_entry_hash
            model.block_index = block_index
            model.posted_at = datetime.now(timezone.utc)
            model.approved_by_principal_key = approved_by_principal_key
            model.approved_by_principal_id = approved_by_principal_id
            if review_notes is not None:
                model.review_notes = review_notes
            await session.flush()

    async def get_latest_posted_hash(self, entity_code: str, *, session: AsyncSession | None = None) -> str:
        async with transaction_session(self.manager, session) as session:
            stmt = (
                select(JournalEntryModel.entry_hash)
                .where(
                    JournalEntryModel.entity_code == entity_code,
                    JournalEntryModel.status.in_(("POSTED", "REVERSED")),
                    JournalEntryModel.entry_hash.isnot(None),
                )
                .order_by(JournalEntryModel.block_index.desc(), JournalEntryModel.posted_at.desc(), JournalEntryModel.created_at.desc())
                .limit(1)
            )
            res = await session.execute(stmt)
            h = res.scalar_one_or_none()
            return h or "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"

    async def get_next_block_index(self, entity_code: str, *, session: AsyncSession | None = None) -> int:
        async with transaction_session(self.manager, session) as session:
            stmt = (
                select(func.max(JournalEntryModel.block_index))
                .where(
                    JournalEntryModel.entity_code == entity_code,
                    JournalEntryModel.status.in_(("POSTED", "REVERSED")),
                    JournalEntryModel.entry_hash.isnot(None),
                )
            )
            res = await session.execute(stmt)
            cur_max = res.scalar_one_or_none() or 0
            return int(cur_max) + 1

    async def post_journal_and_update_etb(
        self,
        entity_code: str,
        journal: Dict[str, Any],
        trial_balance_accounts: List[TrialBalanceAccountRow],
    ) -> None:
        """
        Atomically transitions journal status to POSTED, stamps block index & posted timestamp,
        and applies debits/credits to the trial balance in a single database transaction.
        Guarantees that double-approval or concurrent posting fails immediately.
        """
        async with self.manager.session_factory() as session:
            async with session.begin():
                if self.manager.is_sqlite:
                    await session.execute(text("BEGIN IMMEDIATE"))
                stmt = select(JournalEntryModel).where(JournalEntryModel.journal_id == journal["journal_id"]).with_for_update()
                res = await session.execute(stmt)
                m = res.scalar_one_or_none()
                if not m:
                    raise ValueError(f"Journal '{journal['journal_id']}' not found in database.")
                if journal.get("revision") != m.revision:
                    raise JournalConflict("VOUCHER_REVISION_CONFLICT: Reload before posting.")
                if m.status not in ("PENDING_CHECKER", "AWAITING_CPA"):
                    raise ValueError(
                        f"CANNOT_REVIEW_FINALIZED_JOURNAL: Journal '{journal['journal_id']}' is already in status '{m.status}'. "
                        "Cannot approve multiple times or approve a finalized entry."
                    )

                m.status = "POSTED"
                m.revision += 1
                m.approved_by_principal_key = journal.get("approved_by_principal_key")
                m.approved_by_principal_id = journal.get("approved_by_principal_id")
                m.entry_hash = journal.get("entry_hash")
                m.prev_entry_hash = journal.get("prev_entry_hash")
                m.block_index = journal.get("block_index", 0)
                m.posted_at = datetime.now(timezone.utc)
                m.ai_reasoning_summary = journal.get("ai_reasoning_summary", "")

                for acc in trial_balance_accounts:
                    up_stmt = (
                        update(TrialBalanceAccountModel)
                        .where(
                            TrialBalanceAccountModel.entity_code == entity_code,
                            TrialBalanceAccountModel.account_code == acc.account_code,
                        )
                        .values(
                            period_op_debit=str(acc.period_op_debit),
                            period_op_credit=str(acc.period_op_credit),
                            adjustment_debit=str(acc.adjustment_debit),
                            adjustment_credit=str(acc.adjustment_credit),
                        )
                    )
                    await session.execute(up_stmt)


repo = AccountingRepository()

