"""BL05: independent SQLite connections, real evidence files, REST/MCP entry points."""
import asyncio
import base64
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from mcp.server.fastmcp.exceptions import ToolError
import pytest
import pytest_asyncio
from sqlalchemy import event, select

from app import api_documents as api, mcp_roles as mcp
from app.core import document_sources as sources, ledger, vouchers as vz
from app.core.auth import AuthPrincipal
from app.core.db import DatabaseManager, DocumentModel, DocumentSourceModel, FiscalPeriodModel
from app.core.positions import POSITIONS
from app.core.repository import AccountingRepository

ENTITY = "AU-OPC-01"
CONTENT = b"%PDF-1.4 exact source evidence\x00\xff"
DIGEST = hashlib.sha256(CONTENT).hexdigest()
PRINCIPAL = AuthPrincipal("bl05-maker", str(uuid4()), "BL05 maker", POSITIONS["FINANCE_MANAGER"], True, "", "session")
SESSION = mcp.PositionSession("", PRINCIPAL.position, PRINCIPAL.principal_key, PRINCIPAL.principal_id)
BODY = api.ToVoucherRequest(debit_account_code="6100", credit_account_code="1110")
LINES = [{"account_code": "6100", "debit": "10", "credit": "0"},
         {"account_code": "1110", "debit": "0", "credit": "10"}]


@pytest_asyncio.fixture
async def isolated(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    manager = DatabaseManager(f"sqlite+aiosqlite:///{tmp_path / 'sources.db'}")
    repository = AccountingRepository(manager)
    for module in (api, mcp, sources, vz):
        monkeypatch.setattr(module, "repo", repository)
    monkeypatch.setattr(ledger, "db_manager", manager)
    monkeypatch.setattr(vz, "attachment_root", lambda: tmp_path / "attachments")
    await repository.init_seed_data_if_needed()
    for entity in (ENTITY, "HK-SME-01"):
        for code, kind in (("1110", "ASSET"), ("6100", "EXPENSE")):
            await ledger.upsert_account(entity, {"account_code": code, "account_type": kind,
                "account_name": code, "is_control_account": False})
    yield repository
    await manager.engine.dispose()


async def upload(name="source.pdf", entity=ENTITY, **changes):
    args = dict(file=UploadFile(filename=name, file=BytesIO(CONTENT)), entity_code=entity,
                doc_type="INVOICE", doc_date="2026-10-15", counterparty_name="",
                amount="10", currency="AUD", note="original", principal=PRINCIPAL)
    args.update(changes)
    return (await api.create_document(**args))["document"]


async def convert(document):
    return await api.document_to_voucher(document["document_id"], BODY, PRINCIPAL)


async def propose(**changes):
    args = dict(session=SESSION, entity_code=ENTITY, accounting_date="2026-10-15", memo="proposal",
                document={"filename": "mcp.pdf", "content_base64": base64.b64encode(CONTENT).decode()},
                document_kind="invoice", extracted_fields={"amount": "10"}, declared_sha256=DIGEST,
                proposed_lines=LINES)
    args.update(changes)
    return await mcp._propose_entry_from_document(**args)


async def rows(repository, model):
    async with repository.manager.session_factory() as session:
        return list((await session.scalars(select(model))).all())


async def sibling(repository, document, **changes):
    record = {k: v for k, v in document.items() if k not in ("created_at", "posted_at")}
    record.update(document_id=str(uuid4()), **changes)
    await repository.save_document(record)
    return record


@pytest.mark.asyncio
@pytest.mark.parametrize("names", [("same.pdf", "same.pdf"), ("first.pdf", "renamed.pdf")])
@pytest.mark.parametrize("concurrent", [False, True])
async def test_duplicate_upload_keeps_canonical_metadata_and_bytes(isolated, names, concurrent):
    if concurrent:
        first, second = await asyncio.gather(upload(names[0]), upload(names[1], amount="999", note="changed"))
        assert first == second
    else:
        first = await upload(names[0])
        second = await upload(names[1], amount="999", note="changed", doc_date="2025-01-01")
        assert first == second
        assert first["filename"] == names[0]
        assert first["note"] == "original"
        assert first["amount"] == "10.0000"
    assert len(await rows(isolated, DocumentModel)) == 1
    assert len(await rows(isolated, DocumentSourceModel)) == 1
    assert vz.attachment_file(ENTITY, first["stored_name"]).read_bytes() == CONTENT
    assert (await api.download_document(first["document_id"])).filename == first["filename"]


@pytest.mark.asyncio
async def test_entity_separation_and_serialized_numbers(isolated):
    one, two = await asyncio.gather(upload(), upload(entity="HK-SME-01"))
    assert one["document_id"] != two["document_id"]
    await asyncio.gather(convert(one), convert(two))
    other = await upload("other.pdf", file=UploadFile(filename="other.pdf", file=BytesIO(b"other source")))
    result = await convert(other)
    assert result["voucher_no"].endswith("0002")
    assert len(await isolated.get_journals()) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy", [False, True])
async def test_concurrent_same_document_or_legacy_siblings(isolated, legacy):
    one = await upload()
    two = await sibling(isolated, one) if legacy else one
    results = await asyncio.gather(convert(one), convert(two), return_exceptions=True)
    assert sum(isinstance(r, dict) for r in results) == 1
    error = next(r for r in results if isinstance(r, Exception))
    assert isinstance(error, HTTPException) and "DOCUMENT_ALREADY_USED" in error.detail
    journals = await isolated.get_journals()
    assert len(journals) == 1
    claim = (await rows(isolated, DocumentSourceModel))[0]
    assert claim.journal_id == journals[0]["journal_id"]
    assert sum(d.journal_id == claim.journal_id for d in await rows(isolated, DocumentModel)) == 1
    assert journals[0]["created_by_principal_id"] == PRINCIPAL.principal_id


@pytest.mark.asyncio
async def test_void_conversion_race(isolated):
    document = await upload()
    results = await asyncio.gather(convert(document), api.void_document(document["document_id"], {"reason": "cancel"}), return_exceptions=True)
    assert sum(isinstance(r, dict) for r in results) == 1
    stored = await isolated.get_document(document["document_id"])
    journals = await isolated.get_journals()
    if journals:
        assert stored["status"] == "POSTED" and stored["journal_id"] == journals[0]["journal_id"]
        with pytest.raises(HTTPException, match="DOCUMENT_LINKED"):
            await api.void_document(document["document_id"], {"reason": "late"})
    else:
        assert stored["status"] == "VOID" and stored["journal_id"] is None
        with pytest.raises(HTTPException, match="DOCUMENT_ALREADY_USED"):
            await convert(document)
    assert vz.attachment_file(ENTITY, stored["stored_name"]).read_bytes() == CONTENT


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["rest", "mcp"])
@pytest.mark.parametrize("stage", ["insert", "link", "commit"])
async def test_failure_rolls_back_draft_claim_link_and_period(isolated, monkeypatch, path, stage):
    document = await upload()
    before = await isolated.get_document(document["document_id"])
    original = isolated.insert_draft

    async def fail_insert(*args, **kwargs):
        await original(*args, **kwargs)
        raise ValueError("injected insertion failure")

    original_link = sources.link_source

    async def fail_link(*args, **kwargs):
        await original_link(*args, **kwargs)
        raise ValueError("injected linking failure")

    def fail_commit(connection):
        raise ValueError("injected commit failure")

    if stage == "insert":
        monkeypatch.setattr(isolated, "insert_draft", fail_insert)
    elif stage == "link":
        monkeypatch.setattr(sources, "link_source", fail_link)
    else:
        event.listen(isolated.manager.engine.sync_engine, "commit", fail_commit)
    try:
        with pytest.raises(ValueError, match="injected"):
            await (convert(document) if path == "rest" else propose())
    finally:
        if stage == "commit":
            event.remove(isolated.manager.engine.sync_engine, "commit", fail_commit)
    assert await isolated.get_journals() == []
    assert await isolated.get_document(document["document_id"]) == before
    assert (await rows(isolated, DocumentSourceModel))[0].journal_id is None
    assert await rows(isolated, FiscalPeriodModel) == []
    assert vz.attachment_file(ENTITY, document["stored_name"]).read_bytes() == CONTENT


@pytest.mark.asyncio
@pytest.mark.parametrize("history", ["link", "proposal", "conflict", "unresolved_link"])
async def test_legacy_history_blocks_without_rewriting(isolated, history):
    document = await upload()
    result = await convert(document)
    original = await isolated.get_journal(result["journal_id"])
    duplicate = await sibling(isolated, document)
    async with isolated.manager.session_factory() as session, session.begin():
        claim = await session.get(DocumentSourceModel, (ENTITY, DIGEST))
        await session.delete(claim)
        model = await session.get(DocumentModel, document["document_id"])
        if history in ("proposal", "conflict"):
            model.status, model.journal_id = "NEW", None
        if history == "unresolved_link":
            model.journal_id = None
    if history in ("proposal", "conflict"):
        original["proposal_json"] = json.dumps({"document_sha256": DIGEST.upper()})
        await isolated.save_journal(original)
        if history == "conflict":
            other = deepcopy(original)
            other.pop("revision")
            other["journal_id"] = str(uuid4())
            await isolated.save_journal(other)
    before = await isolated.get_journals()
    with pytest.raises(HTTPException, match="DOCUMENT_HISTORY_CONFLICT" if history in ("conflict", "unresolved_link") else "DOCUMENT_ALREADY_USED"):
        await convert(duplicate)
    with pytest.raises(ToolError, match="DOCUMENT_HISTORY_CONFLICT" if history in ("conflict", "unresolved_link") else "DOCUMENT_ALREADY_USED"):
        await propose()
    assert await isolated.get_journals() == before
    assert (await isolated.get_document(duplicate["document_id"]))["status"] == "NEW"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["race", "rest_first", "mcp_first", "mcp_race"])
async def test_rest_mcp_share_source_claim_and_atomic_provenance(isolated, mode):
    document = await upload()
    if mode in ("race", "mcp_race"):
        calls = (convert(document), propose()) if mode == "race" else (propose(), propose())
        results = await asyncio.gather(*calls, return_exceptions=True)
        assert sum(isinstance(r, dict) for r in results) == 1
    elif mode == "rest_first":
        await convert(document)
        with pytest.raises(ToolError, match="DOCUMENT_ALREADY_USED"):
            await propose()
    else:
        await propose()
        with pytest.raises(HTTPException, match="DOCUMENT_ALREADY_USED"):
            await convert(document)
    journals = await isolated.get_journals()
    assert len(journals) == 1
    journal = journals[0]
    assert journal["created_by_principal_id"] == PRINCIPAL.principal_id
    assert (await isolated.get_document(document["document_id"]))["journal_id"] == journal["journal_id"]
    assert (await rows(isolated, DocumentSourceModel))[0].journal_id == journal["journal_id"]
    if journal["proposal_json"]:
        assert json.loads(journal["proposal_json"])["document_sha256"] == DIGEST
        assert json.loads(journal["proposal_json"])["extracted_fields"] == {"amount": "10"}
        assert journal["revision"] == 0


@pytest.mark.asyncio
async def test_mcp_then_upload_returns_linked_canonical(isolated):
    result = await propose()
    document = await upload()
    assert document["journal_id"] == result["journal_id"] and document["status"] == "POSTED"
    assert (await upload("rename.pdf")) == document
    with pytest.raises(HTTPException, match="DOCUMENT_ALREADY_USED"):
        await convert(document)


@pytest.mark.asyncio
async def test_supporting_attachments_remain_reusable(isolated):
    attachment = {"filename": "support.pdf", "content_base64": base64.b64encode(CONTENT).decode()}
    for _ in range(2):
        await mcp._create_voucher(SESSION, ENTITY, "2026-10-15", "support", "MANUAL", LINES, attachments=[attachment])
    assert await rows(isolated, DocumentSourceModel) == []
    document = await upload()
    await convert(document)
    # Reuse remains allowed even after the source is claimed.
    await mcp._create_voucher(SESSION, ENTITY, "2026-10-15", "support again", "MANUAL", LINES, attachments=[attachment])
    assert len(await isolated.get_journals()) == 4


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["empty_hash", "mismatch", "missing", "date", "locked", "account", "scope"])
async def test_conversion_revalidates_and_preserves_evidence(isolated, bad):
    document = await upload()
    path = vz.attachment_file(ENTITY, document["stored_name"])
    principal = PRINCIPAL
    body = BODY
    async with isolated.manager.session_factory() as session, session.begin():
        model = await session.get(DocumentModel, document["document_id"])
        if bad == "empty_hash":
            model.sha256 = ""
        elif bad == "date":
            model.doc_date = "not-a-date"
        elif bad == "locked":
            session.add(FiscalPeriodModel(period_id=f"{ENTITY}:2026-10", entity_code=ENTITY,
                period_code="2026-10", fiscal_year=2026, period_number=10,
                start_date="2026-10-01", end_date="2026-10-31", status="LOCKED"))
    if bad == "mismatch":
        path.write_bytes(b"tampered evidence")
    elif bad == "missing":
        path.unlink()
    elif bad == "account":
        body = api.ToVoucherRequest(debit_account_code="absent", credit_account_code="1110")
    elif bad == "scope":
        principal = AuthPrincipal("restricted", str(uuid4()), "restricted", POSITIONS["AP_CLERK"], False, "", "key")
    before_bytes = path.read_bytes() if path.exists() else None
    with pytest.raises(HTTPException) as error:
        await api.document_to_voucher(document["document_id"], body, principal)
    assert error.value.status_code == (403 if bad == "scope" else 400)
    assert await isolated.get_journals() == []
    assert (await isolated.get_document(document["document_id"]))["status"] == "NEW"
    assert (path.read_bytes() if path.exists() else None) == before_bytes


@pytest.mark.asyncio
async def test_declared_mcp_hash_mismatch_no_writes(isolated):
    with pytest.raises(ToolError, match="DOCUMENT_HASH_MISMATCH"):
        await propose(declared_sha256="0" * 64)
    assert await isolated.get_journals() == []
    assert await rows(isolated, DocumentSourceModel) == []


@pytest.mark.asyncio
async def test_existing_evidence_never_overwritten(isolated):
    document = await upload()
    path = vz.attachment_file(ENTITY, document["stored_name"])
    path.write_bytes(b"historic differing bytes")
    with pytest.raises(HTTPException, match="DOCUMENT_HASH_MISMATCH"):
        await upload()
    assert path.read_bytes() == b"historic differing bytes"
    assert len(await rows(isolated, DocumentModel)) == 1


@pytest.mark.asyncio
async def test_different_sources_allocate_distinct_numbers_concurrently(isolated):
    one = await upload()
    two = await upload(file=UploadFile(filename="second.pdf", file=BytesIO(b"second source")))
    results = await asyncio.gather(convert(one), convert(two))
    assert {r["voucher_no"] for r in results} == {"記-2026-10-0001", "記-2026-10-0002"}
    assert len(await isolated.get_journals()) == 2


@pytest.mark.asyncio
async def test_source_identity_has_database_uniqueness(isolated):
    from sqlalchemy.exc import IntegrityError

    await upload()
    with pytest.raises(IntegrityError):
        async with isolated.manager.session_factory() as session, session.begin():
            session.add(DocumentSourceModel(entity_code=ENTITY, sha256=DIGEST))
    assert len(await rows(isolated, DocumentSourceModel)) == 1


@pytest.mark.asyncio
async def test_http_contract_duplicate_and_conversion_with_principal(isolated):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from app.core.auth import get_current_principal

    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://bl05") as client:
        data = {"entity_code": ENTITY, "amount": "10", "doc_date": "2026-10-15"}
        first = await client.post("/api/v1/documents", data=data, files={"file": ("first.pdf", CONTENT)})
        second = await client.post("/api/v1/documents", data={**data, "note": "changed"}, files={"file": ("renamed.pdf", CONTENT)})
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()
        doc_id = first.json()["document"]["document_id"]
        url = f"/api/v1/documents/{doc_id}/to-voucher"
        forged = await client.post(url, json={**BODY.model_dump(), "maker_key": "someone-else"})
        assert forged.status_code == 422
        results = await asyncio.gather(client.post(url, json=BODY.model_dump()), client.post(url, json=BODY.model_dump()))
        assert sorted(r.status_code for r in results) == [200, 400]
        downloaded = await client.get(f"/api/v1/documents/{doc_id}/file")
        assert downloaded.content == CONTENT
    journal = (await isolated.get_journals())[0]
    assert journal["created_by_principal_id"] == PRINCIPAL.principal_id
    assert journal["created_by_principal_key"] == PRINCIPAL.principal_key


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["date", "locked", "account", "scope"])
async def test_mcp_revalidation_rolls_back_claim(isolated, bad):
    changes = {}
    if bad == "date":
        changes["accounting_date"] = "2026-02-30"
    elif bad == "locked":
        await ledger.ensure_period(ENTITY, "2026-10", status="LOCKED")
    elif bad == "account":
        changes["proposed_lines"] = [{**LINES[0], "account_code": "absent"}, LINES[1]]
    else:
        changes["session"] = mcp.PositionSession("", POSITIONS["AP_CLERK"], "restricted", str(uuid4()))
    with pytest.raises(ToolError):
        await propose(**changes)
    assert await isolated.get_journals() == []
    assert await rows(isolated, DocumentSourceModel) == []
