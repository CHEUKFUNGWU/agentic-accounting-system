"""
Cross-Platform Embedded Persistence Engine (SQLite WAL & PostgreSQL Hybrid).
Designed for Desktop Apps (Windows & macOS) and Cloud/Docker deployments.

Auto-resolves application storage directory:
  - macOS: ~/Library/Application Support/AgenticAccounting/ledger.db
  - Windows: %APPDATA%/AgenticAccounting/ledger.db
  - Linux: ~/.local/share/AgenticAccounting/ledger.db
  - Dev/Test: ./data/ledger.db or in-memory sqlite
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    create_engine,
    event,
    func,
    select,
)
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

logger = logging.getLogger("agentic_accounting.db")


def get_default_db_path() -> Path:
    """Resolves OS-compliant application data directory for desktop execution."""
    custom_dir = os.environ.get("AGENTIC_ACCOUNTING_DATA_DIR")
    if custom_dir:
        base_dir = Path(custom_dir)
    elif sys.platform == "darwin":
        base_dir = Path.home() / "Library" / "Application Support" / "AgenticAccounting"
    elif sys.platform == "win32":
        app_data = os.environ.get("APPDATA")
        base_dir = Path(app_data) / "AgenticAccounting" if app_data else Path.home() / ".agentic_accounting"
    else:
        base_dir = Path.home() / ".local" / "share" / "AgenticAccounting"

    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / "ledger.db"


class Base(DeclarativeBase):
    pass


class MonolithWorkspaceModel(Base):
    """Canonical Monolith workspace, committed atomically with a revision guard.

    Legacy entities retain their existing normalized ledger. This separate
    workspace uses the supplied UI's chart and subledger vocabulary.
    """

    __tablename__ = "monolith_workspaces"

    workspace_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    payload_json: Mapped[str] = mapped_column(Text)
    receipts_json: Mapped[str] = mapped_column(Text, default="{}")


class EntityModel(Base):
    __tablename__ = "entities"

    entity_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_structure: Mapped[str] = mapped_column(String(32), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(String(8), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    accounting_standard: Mapped[str] = mapped_column(String(32), nullable=False)
    tax_id: Mapped[str] = mapped_column(String(64), nullable=False)
    reporting_status: Mapped[str] = mapped_column(String(32), default="READY")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TrialBalanceAccountModel(Base):
    __tablename__ = "trial_balance_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    account_code: Mapped[str] = mapped_column(String(32), index=True)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[str] = mapped_column(String(32), nullable=False)
    fs_category: Mapped[str] = mapped_column(String(32), nullable=False)
    statement_ref: Mapped[str] = mapped_column(String(32), nullable=False)
    cash_flow_activity: Mapped[str] = mapped_column(String(32), nullable=False)
    opening_balance: Mapped[str] = mapped_column(String(32), default="0.0000")
    period_op_debit: Mapped[str] = mapped_column(String(32), default="0.0000")
    period_op_credit: Mapped[str] = mapped_column(String(32), default="0.0000")
    adjustment_debit: Mapped[str] = mapped_column(String(32), default="0.0000")
    adjustment_credit: Mapped[str] = mapped_column(String(32), default="0.0000")


class JournalEntryModel(Base):
    __tablename__ = "journal_entries"

    journal_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    source_module: Mapped[str] = mapped_column(String(32), default="MANUAL")
    status: Mapped[str] = mapped_column(String(32), default="POSTED", index=True)
    accounting_date: Mapped[str] = mapped_column(String(16))
    currency: Mapped[str] = mapped_column(String(8))
    total_debit: Mapped[str] = mapped_column(String(32))
    total_credit: Mapped[str] = mapped_column(String(32))
    created_by_principal_key: Mapped[str] = mapped_column(String(64))
    created_by_principal_id: Mapped[str] = mapped_column(String(64))
    approved_by_principal_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    approved_by_principal_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    ai_confidence_score: Mapped[str] = mapped_column(String(16), default="1.0000")
    ai_reasoning_summary: Mapped[str] = mapped_column(Text, default="")
    evidence_uris: Mapped[str] = mapped_column(Text, default="[]")  # JSON encoded list
    entry_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prev_entry_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    block_index: Mapped[int] = mapped_column(Integer, default=0, index=True)
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    lines_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON encoded lines
    # --- voucher (記賬憑證) fields -------------------------------------------
    # A journal entry is not an abstract transaction: it is a voucher with a
    # sequential number, a period, a summary, and a signature strip.
    voucher_no: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    period: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reject_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reversal_of_journal_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # 判定基礎 — how the entry was derived. Determines whether a machine may act
    # without a human: TEMPLATE / RECURRING / MATCHED are verifiable, EXTRACTED
    # and JUDGEMENT are not.
    basis: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    # Which layer the entry belongs to. Decides whether it reports as period
    # activity or as an adjustment, so it has to live on the entry, not on a
    # caller's dictionary.
    entry_layer: Mapped[Optional[str]] = mapped_column(String(24), nullable=True, index=True)
    # What the reviewer actually verified (JSON). A review with no checklist is
    # a rubber stamp, so the verdict carries its justification.
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Structured provenance of an agent-proposed entry: which document (by hash),
    # what the model extracted from it, which rule it applied, what it was unsure
    # about. A reviewer cannot meaningfully check a proposal without it.
    proposal_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DocumentModel(Base):
    """
    單據 (source document): an invoice, receipt, bank slip or contract that has
    been captured but has not become an entry yet.

    This is the missing half of the Transaction page. Attachments already live as
    JSON on a voucher, but a document that has no voucher yet had nowhere to sit,
    so every entry had to be invented rather than derived.
    """

    __tablename__ = "documents"

    document_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    doc_type: Mapped[str] = mapped_column(String(24), default="OTHER", index=True)
    doc_date: Mapped[str] = mapped_column(String(16), default="")
    counterparty_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    counterparty_name: Mapped[str] = mapped_column(String(255), default="")
    amount: Mapped[str] = mapped_column(String(32), default="0.0000")
    currency: Mapped[str] = mapped_column(String(8), default="")
    status: Mapped[str] = mapped_column(String(16), default="NEW", index=True)  # NEW | POSTED | VOID
    journal_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(255), default="")
    stored_name: Mapped[str] = mapped_column(String(255), default="")
    mime: Mapped[str] = mapped_column(String(96), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    uploaded_by: Mapped[str] = mapped_column(String(64), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class MCPAuditLogModel(Base):
    """
    Every tool call made by an agent, with identity, parameters and outcome.

    This is what makes the auditor's question answerable: "which posted entries
    were produced and approved by agents, with no human ever looking?" Without
    it, agent activity is invisible — the vouchers carry the maker and reviewer
    keys, but nothing records what the agent actually asked for or was refused.
    """

    __tablename__ = "mcp_audit_logs"

    log_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    position: Mapped[str] = mapped_column(String(32), index=True)
    principal_key: Mapped[str] = mapped_column(String(64), index=True)
    tool: Mapped[str] = mapped_column(String(64), index=True)
    outcome: Mapped[str] = mapped_column(String(16), index=True)  # OK | REFUSED | DENIED
    error_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    entity_code: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    journal_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    params_json: Mapped[str] = mapped_column(Text, default="{}")  # redacted
    document_sha256s: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )


class ExceptionModel(Base):
    """The human queue. A bot that cannot decide must file an exception rather
    than guess — escalation is triggered by capability, scope or evidence, not
    by amount."""

    __tablename__ = "exceptions_log"

    exception_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_code: Mapped[str] = mapped_column(String(32), index=True)
    journal_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    subject: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text, default="")
    raised_by_principal_key: Mapped[str] = mapped_column(String(64))
    raised_by_position: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(16), default="OPEN", index=True)
    resolved_by_principal_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


# =============================================================================
# GENERAL LEDGER CORE
#
# Until now "the ledger" was `trial_balance_accounts`: fourteen rows per entity holding the
# account identity *and* its balances, read directly by the statements. That made
# a report into the source of truth, which is why every layer above it needed a
# heuristic (chart inferred from report rows, normal balance derived, control
# accounts guessed) and why the system could not do a second month.
#
# The core is these five tables:
#
#   chart_of_accounts  what an account IS (nature, hierarchy, sub-ledger flag)
#   fiscal_periods     time as state (open / soft closed / locked) + who closed it
#   counterparties     the dimensions entries are tagged with
#   tax_codes          tax treatment per line
#   journal_lines      the ledger itself — one row per debit or credit
#
# Balances are NOT stored. Closing balance = opening + sum(lines), so the
# statements become a projection of the ledger instead of a cached copy of it.
# Money is held as TEXT and parsed to Decimal: SQLite has no exact decimal type,
# and a ledger that rounds is worse than one that is slow.
# =============================================================================


class ChartOfAccountsModel(Base):
    __tablename__ = "chart_of_accounts"

    account_id: Mapped[str] = mapped_column(String(96), primary_key=True)  # entity:code
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    parent_account_id: Mapped[Optional[str]] = mapped_column(String(96), nullable=True)
    account_code: Mapped[str] = mapped_column(String(32), index=True)
    account_name: Mapped[str] = mapped_column(String(255))
    account_type: Mapped[str] = mapped_column(String(32))          # ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE
    normal_balance: Mapped[str] = mapped_column(String(8))         # DEBIT | CREDIT (contra accounts differ from their class)
    fs_category: Mapped[str] = mapped_column(String(32))
    default_statement_ref: Mapped[str] = mapped_column(String(32), default="TB")
    cash_flow_activity: Mapped[str] = mapped_column(String(32), default="OPERATING_WC")
    is_control_account: Mapped[bool] = mapped_column(Boolean, default=False)   # has a sub-ledger
    allow_manual_je: Mapped[bool] = mapped_column(Boolean, default=True)
    tax_code_default: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    effective_from: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    effective_to: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class FiscalPeriodModel(Base):
    """Time as state. A period is not a string in a dropdown — it can be closed,
    and only someone with authority can close it."""

    __tablename__ = "fiscal_periods"

    period_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # entity:period
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    period_code: Mapped[str] = mapped_column(String(16), index=True)      # 2026-10
    fiscal_year: Mapped[int] = mapped_column(Integer)
    period_number: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[str] = mapped_column(String(16))
    end_date: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="OPEN", index=True)  # FUTURE/OPEN/SOFT_CLOSE/HARD_CLOSE/LOCKED
    closed_by_principal_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class CounterpartyModel(Base):
    """The dimension a line is tagged with: customer, vendor, the owner, the tax
    office. The AR/AP sub-ledgers are projections of journal_lines by this column,
    not separate books — two books that must agree eventually disagree."""

    __tablename__ = "counterparties"

    counterparty_id: Mapped[str] = mapped_column(String(128), primary_key=True)  # entity:slug
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    counterparty_type: Mapped[str] = mapped_column(String(24), index=True)  # CUSTOMER/VENDOR/OWNER_DIRECTOR/TAX_AUTHORITY/EMPLOYEE
    legal_name: Mapped[str] = mapped_column(String(255), index=True)
    country_code: Mapped[str] = mapped_column(String(2), default="")
    tax_id_number: Mapped[str] = mapped_column(String(64), default="")
    withholding_rule: Mapped[str] = mapped_column(String(32), default="NONE")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TaxCodeModel(Base):
    __tablename__ = "tax_codes"

    tax_code_id: Mapped[str] = mapped_column(String(96), primary_key=True)  # entity:code
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(8))
    tax_code: Mapped[str] = mapped_column(String(32), index=True)
    description: Mapped[str] = mapped_column(String(255))
    tax_mechanism: Mapped[str] = mapped_column(String(32))
    rate: Mapped[str] = mapped_column(String(16), default="0.000000")
    recoverable_pct: Mapped[str] = mapped_column(String(16), default="1.0000")
    statutory_return_box: Mapped[str] = mapped_column(String(32), default="")
    tax_account_code: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class JournalLineModel(Base):
    """
    The ledger. One row per debit or credit.

    period_code / entry_layer / accounting_date / account_code are denormalised
    from the parent entry on purpose: an entry is immutable once posted, so these
    can never drift, and their absence would force a join on every balance query
    in a desktop-scale SQLite database.

    tx_* is the amount in the transaction currency, func_* in the entity's
    functional currency. They are equal when the rate is 1; keeping both from day
    one is what makes multi-currency an addition rather than a migration.
    """

    __tablename__ = "journal_lines"

    line_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    journal_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("journal_entries.journal_id"), index=True
    )
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    line_number: Mapped[int] = mapped_column(Integer)
    account_id: Mapped[str] = mapped_column(String(96), ForeignKey("chart_of_accounts.account_id"), index=True)
    account_code: Mapped[str] = mapped_column(String(32), index=True)
    account_name: Mapped[str] = mapped_column(String(255), default="")

    period_code: Mapped[str] = mapped_column(String(16), index=True)
    entry_layer: Mapped[str] = mapped_column(String(24), index=True)  # OPENING/OPERATIONAL/AJE_MONTH_END/RJE_RECLASS/REVERSAL
    accounting_date: Mapped[str] = mapped_column(String(16), index=True)

    tx_currency: Mapped[str] = mapped_column(String(8), default="")
    exchange_rate: Mapped[str] = mapped_column(String(24), default="1.00000000")
    tx_debit: Mapped[str] = mapped_column(String(32), default="0.0000")
    tx_credit: Mapped[str] = mapped_column(String(32), default="0.0000")
    func_debit: Mapped[str] = mapped_column(String(32), default="0.0000")
    func_credit: Mapped[str] = mapped_column(String(32), default="0.0000")

    counterparty_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    counterparty_name: Mapped[str] = mapped_column(String(255), default="")
    tax_code_id: Mapped[Optional[str]] = mapped_column(String(96), nullable=True, index=True)
    func_tax_amount: Mapped[str] = mapped_column(String(32), default="0.0000")
    business_use_pct: Mapped[str] = mapped_column(String(16), default="1.0000")

    statement_ref: Mapped[str] = mapped_column(String(32), default="")
    memo: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        # A line is a debit or a credit, never both, never neither. Enforced by
        # the database because this is the one invariant everything else rests on.
        CheckConstraint(
            "(CAST(tx_debit AS REAL) > 0 AND CAST(tx_credit AS REAL) = 0) OR "
            "(CAST(tx_credit AS REAL) > 0 AND CAST(tx_debit AS REAL) = 0)",
            name="ck_journal_line_debit_xor_credit",
        ),
        Index("ix_journal_lines_account_period", "entity_code", "account_code", "period_code"),
        Index("ix_journal_lines_counterparty", "entity_code", "counterparty_id"),
    )


class PersonalSplitLogModel(Base):
    __tablename__ = "personal_splits_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    journal_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    entity_code: Mapped[str] = mapped_column(String(32), index=True)
    description: Mapped[str] = mapped_column(String(255))
    gross_amount: Mapped[str] = mapped_column(String(32))
    business_use_pct: Mapped[str] = mapped_column(String(16))
    business_expense_debit: Mapped[str] = mapped_column(String(32))
    recoverable_tax_debit: Mapped[str] = mapped_column(String(32))
    personal_amount: Mapped[str] = mapped_column(String(32))
    evidence_uri: Mapped[str] = mapped_column(String(512))
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class CustomAJELogModel(Base):
    __tablename__ = "custom_aje_log"

    aje_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_code: Mapped[str] = mapped_column(String(32), index=True)
    debit_account_code: Mapped[str] = mapped_column(String(32))
    credit_account_code: Mapped[str] = mapped_column(String(32))
    amount: Mapped[str] = mapped_column(String(32))
    statement_ref: Mapped[str] = mapped_column(String(32))
    memo: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(64))


class DatabaseManager:
    """Manages SQLite WAL / PostgreSQL asynchronous database connections and lifecycle."""

    def __init__(self, db_url: Optional[str] = None):
        if not db_url:
            db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            db_path = get_default_db_path()
            db_url = f"sqlite+aiosqlite:///{db_path}"
        elif db_url.startswith("postgresql://") or db_url.startswith("postgres://"):
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1).replace("postgres://", "postgresql+asyncpg://", 1)

        self.db_url = db_url
        self.is_sqlite = db_url.startswith("sqlite")
        self.is_postgres = "postgres" in db_url
        engine_kwargs: Dict[str, Any] = {"echo": False, "future": True}
        if not self.is_sqlite:
            engine_kwargs.update({"pool_size": 10, "max_overflow": 20, "pool_pre_ping": True})
        self.engine: AsyncEngine = create_async_engine(
            self.db_url,
            **engine_kwargs,
        )
        self.session_factory = async_sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    async def init_db(self) -> None:
        """Creates tables and enables WAL mode on SQLite."""
        # Rename legacy tables before create_all can create an empty replacement.
        await self._ensure_columns()
        async with self.engine.begin() as conn:
            if self.is_sqlite:
                await conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
                await conn.exec_driver_sql("PRAGMA synchronous=NORMAL;")
            await conn.run_sync(Base.metadata.create_all)
        await self._ensure_columns()
        logger.info(f"Initialized database storage at {self.db_url}")

    async def _ensure_columns(self) -> None:
        """
        `create_all()` creates missing tables but never ALTERs existing ones, so
        additive columns must be applied explicitly. SQLite only — a Postgres
        deployment should use a real migration tool.
        """
        if not self.is_sqlite:
            return
        # Columns that carry audit vocabulary were renamed once. SQLite has
        # supported RENAME COLUMN since 3.25; anything older needs a rebuild,
        # which is not worth doing for a table that is a migration source.
        renames: Dict[str, Dict[str, str]] = {
            "trial_balance_accounts": {
                "statement_ref": "wp_ref",
                "adjustment_debit": "aje_debit",
                "adjustment_credit": "aje_credit",
            },
            "journal_lines": {"statement_ref": "wp_ref"},
            "custom_aje_log": {"statement_ref": "wp_ref"},
            "chart_of_accounts": {"default_statement_ref": "default_wp_ref"},
            "entities": {"reporting_status": "pack_status"},
        }

        wanted: Dict[str, Dict[str, str]] = {
            "journal_entries": {
                "voucher_no": "VARCHAR(64)",
                "period": "VARCHAR(16)",
                "memo": "TEXT",
                "reject_reason": "TEXT",
                "submitted_at": "DATETIME",
                "reversal_of_journal_id": "VARCHAR(64)",
                "basis": "VARCHAR(24)",
                "review_notes": "TEXT",
                "entry_layer": "VARCHAR(24)",
                "proposal_json": "TEXT",
            }
        }
        async with self.engine.begin() as conn:
            # The retired table was named after the old extended-trial-balance
            # design; balances are derived now, so it is just the trial balance.
            for old_table, new_table in (("etb_accounts", "trial_balance_accounts"),):
                rows = await conn.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)",
                    (old_table, new_table),
                )
                present = {r[0] for r in rows.fetchall()}
                if old_table in present and new_table not in present:
                    await conn.exec_driver_sql(f"ALTER TABLE {old_table} RENAME TO {new_table}")
                    logger.info(f"Migration: renamed table {old_table} -> {new_table}")

            for table, pairs in renames.items():
                result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
                existing = {row[1] for row in result.fetchall()}
                if not existing:
                    continue
                for new_name, old_name in pairs.items():
                    if new_name in existing or old_name not in existing:
                        continue
                    await conn.exec_driver_sql(f"ALTER TABLE {table} RENAME COLUMN {old_name} TO {new_name}")
                    logger.info(f"Migration: renamed {table}.{old_name} -> {new_name}")
                    existing.add(new_name)

            entity_columns = await conn.exec_driver_sql("PRAGMA table_info(entities)")
            if "reporting_status" in {row[1] for row in entity_columns.fetchall()}:
                await conn.exec_driver_sql(
                    "UPDATE entities SET reporting_status = CASE reporting_status "
                    "WHEN 'CPA_SIGNED_LOCKED' THEN 'REVIEWED_AND_LOCKED' "
                    "WHEN 'READY_FOR_CPA' THEN 'READY' ELSE reporting_status END "
                    "WHERE reporting_status IN ('CPA_SIGNED_LOCKED', 'READY_FOR_CPA')"
                )

            for table, columns in wanted.items():
                result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
                existing = {row[1] for row in result.fetchall()}
                if not existing:
                    continue  # table not created yet
                for name, ddl in columns.items():
                    if name not in existing:
                        await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                        logger.info(f"Migration: added column {table}.{name}")

    async def close(self) -> None:
        await self.engine.dispose()


# Global default database instance
db_manager = DatabaseManager()
