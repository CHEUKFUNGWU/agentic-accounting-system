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


class EntityModel(Base):
    __tablename__ = "entities"

    entity_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_structure: Mapped[str] = mapped_column(String(32), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(String(8), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    accounting_standard: Mapped[str] = mapped_column(String(32), nullable=False)
    tax_id: Mapped[str] = mapped_column(String(64), nullable=False)
    pack_status: Mapped[str] = mapped_column(String(32), default="READY_FOR_CPA")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ETBAccountModel(Base):
    __tablename__ = "etb_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_code: Mapped[str] = mapped_column(String(32), ForeignKey("entities.entity_code"), index=True)
    account_code: Mapped[str] = mapped_column(String(32), index=True)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[str] = mapped_column(String(32), nullable=False)
    fs_category: Mapped[str] = mapped_column(String(32), nullable=False)
    wp_ref: Mapped[str] = mapped_column(String(32), nullable=False)
    cash_flow_activity: Mapped[str] = mapped_column(String(32), nullable=False)
    opening_balance: Mapped[str] = mapped_column(String(32), default="0.0000")
    period_op_debit: Mapped[str] = mapped_column(String(32), default="0.0000")
    period_op_credit: Mapped[str] = mapped_column(String(32), default="0.0000")
    aje_debit: Mapped[str] = mapped_column(String(32), default="0.0000")
    aje_credit: Mapped[str] = mapped_column(String(32), default="0.0000")


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
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
    wp_ref: Mapped[str] = mapped_column(String(32))
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
        async with self.engine.begin() as conn:
            if self.is_sqlite:
                await conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
                await conn.exec_driver_sql("PRAGMA synchronous=NORMAL;")
            await conn.run_sync(Base.metadata.create_all)
        logger.info(f"Initialized database storage at {self.db_url}")

    async def close(self) -> None:
        await self.engine.dispose()


# Global default database instance
db_manager = DatabaseManager()
