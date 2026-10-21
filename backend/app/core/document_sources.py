"""Entity-scoped exact-byte source capture and conversion claims.

Only document-first workflows use this registry. Ordinary voucher attachments
remain reusable. Different bytes for the same invoice are not detected.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import json
import re

from sqlalchemy import func, select, text

from app.core.db import DocumentModel, DocumentSourceModel, EntityModel, JournalEntryModel
from app.core.repository import repo
from app.core import vouchers as vz


class SourceError(ValueError):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


def source_hash(value):
    value = (value or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise SourceError("DOCUMENT_HASH_REQUIRED: A full SHA256 is required.")
    return value


@asynccontextmanager
async def entity_transaction(entity_code):
    # Same lock order as posting: entity, then documents/journals/period.
    async with repo.manager.session_factory() as session, session.begin():
        if repo.manager.is_sqlite:
            await session.execute(text("BEGIN IMMEDIATE"))
        await _lock_entity(session, entity_code)
        yield session


async def _lock_entity(session, entity_code):
    entity = await session.scalar(select(EntityModel).where(
        EntityModel.entity_code == entity_code).with_for_update())
    if entity is None:
        raise SourceError(f"ENTITY_NOT_FOUND: '{entity_code}'", 404)


@asynccontextmanager
async def document_transaction(document_id):
    async with repo.manager.session_factory() as session, session.begin():
        if repo.manager.is_sqlite:
            await session.execute(text("BEGIN IMMEDIATE"))
        # PostgreSQL needs an unlocked locator read to find the entity. Do not
        # lock or trust document state until after acquiring the entity lock.
        entity_code = await session.scalar(select(DocumentModel.entity_code).where(
            DocumentModel.document_id == document_id))
        if entity_code is None:
            raise SourceError(f"DOCUMENT_NOT_FOUND: '{document_id}'", 404)
        await _lock_entity(session, entity_code)
        document = await session.get(DocumentModel, document_id)
        if document is None:
            raise SourceError(f"DOCUMENT_NOT_FOUND: '{document_id}'", 404)
        yield session, document


def verify_document(document, expected_content=None):
    if document is None:
        raise SourceError("DOCUMENT_HISTORY_CONFLICT: Canonical source is missing; manual review required.")
    digest = source_hash(document.sha256)
    path = vz.attachment_file(document.entity_code, document.stored_name)
    if path is None:
        raise SourceError("ATTACHMENT_NOT_FOUND: Source evidence is missing.")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != digest or (
        expected_content is not None and content != expected_content
    ):
        raise SourceError("DOCUMENT_HASH_MISMATCH: Stored evidence does not match source bytes.")


async def registry(session, entity_code, digest):
    """Adopt legacy identities without rewriting any financial history."""
    digest = source_hash(digest)
    source = await session.get(DocumentSourceModel, (entity_code, digest))
    siblings = list((await session.scalars(select(DocumentModel).where(
        DocumentModel.entity_code == entity_code,
        func.lower(DocumentModel.sha256) == digest,
    ).order_by(DocumentModel.created_at, DocumentModel.document_id))).all())
    journals = {d.journal_id for d in siblings if d.journal_id}
    if source and source.journal_id:
        journals.add(source.journal_id)
    # Supporting attachments intentionally do not count as source provenance.
    proposals = (await session.scalars(select(JournalEntryModel).where(
        JournalEntryModel.entity_code == entity_code,
        JournalEntryModel.proposal_json.is_not(None),
    ))).all()
    for journal in proposals:
        try:
            proposal = json.loads(journal.proposal_json)
        except (ValueError, TypeError):
            continue
        if isinstance(proposal, dict) and str(proposal.get("document_sha256", "")).lower() == digest:
            journals.add(journal.journal_id)
    if len(journals) > 1:
        raise SourceError("DOCUMENT_HISTORY_CONFLICT: Multiple historic journals; manual review required.")
    if any(d.status == "POSTED" and not d.journal_id for d in siblings):
        raise SourceError("DOCUMENT_HISTORY_CONFLICT: Linked source lacks a journal; manual review required.")
    if source is None:
        source = DocumentSourceModel(entity_code=entity_code, sha256=digest)
        session.add(source)
    if not source.document_id and siblings:
        source.document_id = siblings[0].document_id
    if journals:
        source.journal_id = next(iter(journals))
    await session.flush()
    return source


async def capture(record, content):
    digest = source_hash(record["sha256"])
    if hashlib.sha256(content).hexdigest() != digest:
        raise SourceError("DOCUMENT_HASH_MISMATCH")
    async with entity_transaction(record["entity_code"]) as session:
        source = await registry(session, record["entity_code"], digest)
        if source.document_id:
            document = await session.get(DocumentModel, source.document_id)
            verify_document(document, content)
        else:
            document = DocumentModel(**record)
            if source.journal_id:
                document.status = "POSTED"
                document.journal_id = source.journal_id
                document.posted_at = datetime.now(timezone.utc)
            verify_document(document, content)
            session.add(document)
            await session.flush()
            source.document_id = document.document_id
        await session.flush()
        await session.refresh(document)
        result = repo._document_dict(document)
    return result


async def require_unused(session, entity_code, digest):
    source = await registry(session, entity_code, digest)
    if source.journal_id:
        raise SourceError("DOCUMENT_ALREADY_USED: Exact source already has a journal.")
    if source.document_id:
        document = await session.get(DocumentModel, source.document_id)
        verify_document(document)
        if document.status != "NEW":
            raise SourceError("DOCUMENT_ALREADY_USED: Canonical document is not NEW.")
    return source


async def link_source(session, source, journal_id, document=None):
    source.journal_id = journal_id
    if document is None and source.document_id:
        document = await session.get(DocumentModel, source.document_id)
    if document is not None:
        document.status = "POSTED"
        document.journal_id = journal_id
        document.posted_at = datetime.now(timezone.utc)
    await session.flush()
