#!/usr/bin/env python3
"""Generate golden fixtures for the backend-go posting module (REQ-0035 P1).

Coverage, with the reference for every expected value:

  - post_voucher's full decision sequence, driven for real over a seeded
    isolated SQLite database (the same harness the reference's own
    tests use — backend/tests/test_atomic_posting.py,
    test_duplicate_reversal.py, test_generated_reversal.py,
    test_journal_concurrency.py): postability, the submitted-snapshot guard,
    the reversal-original checks (including duplicate and nested reversals),
    chart and period validation (BL-04), the ledger row projection, the
    reversal mirror, the seal, and the chain allocation including sealed
    reversed heads (BL-25). The committed state, the projected journal_lines
    rows and post_voucher's result dict are the expected outputs.

  - repository.save_journal's persisted-state transition guards (BL-02),
    driven for real: revision-checked saves, stale-write detection, missing
    revisions, finalized-field immutability, the status-only POSTED→REVERSED
    transition, the only-posting-may-seal rule and the save transition map.

  - get_latest_posted_hash / get_next_block_index over seeded chain rows:
    the BL-25 head derivation (empty chain, posted head, reversed head
    included, unsealed rows ignored, max block index wins).

  - The review-metadata update of mcp_roles._review_voucher: the state and
    verdict guards (the state check is mcp_roles'; verdict validation drives
    reviewer.validate_verdict for real), the checklist/reason requirements,
    and the structured review_notes payload (json.dumps, ensure_ascii=False,
    the reference's default separators — the dict construction is copied
    verbatim from mcp_roles because it is inline there, like gen_vouchers'
    transition map).

  - posting.destination_columns (imported for real) over the entry layers.

EXCLUDED, with reasons:

  - ENTITY_NOT_FOUND / VOUCHER_NOT_FOUND: store existence lookups; the
    sequence receives the loaded row (documented in doc.go).
  - "voucher has no entity_code.": unreachable through the reference's save
    path (the column is NOT NULL); the Go guard is kept for the sequence's
    shape but has no honest fixture.
  - build_reversal_lines / _reversal_original / _validate_reversal_lines
    value-rule scenarios: already golden in fixtures/vouchers (gen_vouchers.py);
    the posting module wires them, it does not re-pin them. The reversal
    cases here exercise the posting sequence AROUND those rules.
  - Injected mid-transaction failures (test_atomic_posting's
    mark_posted/commit monkeypatches): the transaction is P2 store work. The
    pure-level consequence — a failed posting leaves the input state
    unchanged — is pinned by the Go unit tests (input values are never
    mutated by decision functions).

Determinism: the reference stamps datetime.now(UTC) at seal and generates
line uuids. The generator normalizes posted_at/created_at to fixed tokens
("<POSTED_AT>", "<CREATED_AT>") and line_id to positional tokens ("l-<n>");
the pure Go layer receives the timestamp as an argument and leaves line_id
to the store, so the tokens are passthroughs, not divergences.

Run (from the repository root):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_posting.py

Output: backend-go/fixtures/posting/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures"

# Isolated SQLite before any app import touches the default manager, like
# the reference's test fixtures (env -u DATABASE_URL is the documented run).
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(REPO / "backend"))

from sqlalchemy import select

from app.core import ledger, posting
from app.core.db import (
    DatabaseManager,
    FiscalPeriodModel,
    JournalEntryModel,
    JournalLineModel,
)
from app.core.posting import destination_columns
from app.core.repository import AccountingRepository, JournalConflict
from app.core.reviewer import validate_verdict

COUNTS: dict[str, int] = {}


def write(module: str, name: str, case_input: dict, output=None, error: str | None = None) -> None:
    """Write one fixture case file. output xor expected_error is present."""
    doc = {"module": module, "case": name, "input": case_input}
    if error is not None:
        doc["expected_error"] = error
    else:
        doc["output"] = output
    path = OUT / module / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    COUNTS[module] = COUNTS.get(module, 0) + 1


def posting_error_kind(exc: posting.PostingError) -> str:
    return str(exc).split(":", 1)[0]


POSTED_AT = "<POSTED_AT>"
CREATED_AT = "<CREATED_AT>"
APPROVER = {"principal_id": "checker-id", "principal_key": "checker"}
MAKER = {
    "created_by_principal_key": "bookkeeper-maker-01",
    "created_by_principal_id": "11111111-1111-1111-1111-111111111111",
}
ENTITY = "AU-OPC-01"

# The seeded chart: a plain expense and bank account (the reference's own
# posting tests), one sub-ledger control account for the isolation refusal
# and one payables account for FX reversals.
CHART_SEED = [
    ("1110", "ASSET", False),
    ("1210", "ASSET", True),
    ("2110", "LIABILITY", False),
    ("6100", "EXPENSE", False),
]


class World:
    """One isolated reference database per fixture case.

    Redirects posting.repo and ledger.db_manager at the case engine exactly
    like test_atomic_posting.isolated_posting does.
    """

    def __init__(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="gen-posting-")
        self.manager = DatabaseManager(f"sqlite+aiosqlite:///{self.tmp}/posting.db")
        self.repo = AccountingRepository(self.manager)
        posting.repo = self.repo
        ledger.db_manager = self.manager

    async def setup(self) -> None:
        await self.repo.init_seed_data_if_needed()
        for code, kind, control in CHART_SEED:
            await ledger.upsert_account(ENTITY, {
                "account_code": code, "account_type": kind, "account_name": code,
                "is_control_account": control,
            })

    async def dispose(self) -> None:
        await self.manager.engine.dispose()


def base_entry(journal_id: str = "j-1", **overrides) -> dict:
    """The pending voucher of the reference's posting tests, with fixed IDs."""
    entry = {
        "journal_id": journal_id,
        "entity_code": ENTITY,
        "status": "PENDING_CHECKER",
        "source_module": "MANUAL",
        "accounting_date": "2026-10-15",
        "period": "2026-10",
        "currency": "AUD",
        "total_debit": "100.0000",
        "total_credit": "100.0000",
        **MAKER,
        "entry_layer": "OPERATIONAL",
        "review_notes": "prior review",
        "lines": [
            {"line_number": 1, "account_code": "6100", "debit": "100.0000", "credit": "0.0000"},
            {"line_number": 2, "account_code": "1110", "debit": "0.0000", "credit": "100.0000"},
        ],
    }
    entry.update(overrides)
    return entry


async def make_voucher(w: World, **overrides) -> dict:
    entry = base_entry(**overrides)
    await w.repo.save_journal(entry)
    return await w.repo.get_journal(entry["journal_id"])


async def approve(w: World, entry: dict) -> dict:
    """post_voucher for real; returns the committed dict (it updates the
    caller's dict only after commit)."""
    to_post = deepcopy(entry)
    await posting.post_voucher(
        to_post, approver_principal_id=APPROVER["principal_id"],
        approver_principal_key=APPROVER["principal_key"],
    )
    return to_post


async def force_status(w: World, journal_id: str, status: str) -> None:
    """Direct persisted-state change, as the reference's own chain test does
    (session-level setup, not golden behaviour)."""
    async with w.manager.session_factory() as session, session.begin():
        row = await session.get(JournalEntryModel, journal_id)
        row.status = status


def normalize_journal(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc = deepcopy(doc)
    if doc.get("created_at") is not None:
        doc["created_at"] = CREATED_AT
    if doc.get("posted_at") is not None:
        doc["posted_at"] = POSTED_AT
    return doc


async def chart_rows(w: World, entity: str = ENTITY) -> list:
    return await ledger.get_chart(entity, include_inactive=True)


def period_dict(m: FiscalPeriodModel) -> dict:
    return {
        "period_id": m.period_id,
        "entity_code": m.entity_code,
        "period_code": m.period_code,
        "fiscal_year": m.fiscal_year,
        "period_number": m.period_number,
        "start_date": m.start_date,
        "end_date": m.end_date,
        "status": m.status,
        "closed_by_principal_key": m.closed_by_principal_key,
        "closed_at": m.closed_at.isoformat() if m.closed_at else None,
    }


async def period_rows(w: World, entity: str = ENTITY) -> list:
    async with w.manager.session_factory() as session:
        rows = (await session.execute(
            select(FiscalPeriodModel).where(FiscalPeriodModel.entity_code == entity)
        )).scalars().all()
    return [period_dict(m) for m in rows]


async def effective_reversals(w: World) -> list[str]:
    """The answer of _reversal_original's existence query, for every
    original: journal IDs with a POSTED or REVERSED reversal."""
    async with w.manager.session_factory() as session:
        rows = (await session.execute(
            select(JournalEntryModel.reversal_of_journal_id).where(
                JournalEntryModel.reversal_of_journal_id.isnot(None),
                JournalEntryModel.status.in_(("POSTED", "REVERSED")),
            )
        )).scalars().all()
    return sorted({r for r in rows if r})


async def ledger_rows(w: World, journal_id: str) -> list[dict]:
    """The persisted journal_lines rows in line-number order. line_id and
    created_at are store-assigned (uuid4 / datetime.now); the pure layer
    leaves both to the store, so they are dropped here rather than
    normalized — the fixture pins the row content the decision computes."""
    async with w.manager.session_factory() as session:
        rows = (await session.execute(
            select(JournalLineModel).where(JournalLineModel.journal_id == journal_id)
            .order_by(JournalLineModel.line_number)
        )).scalars().all()
    out = []
    for r in rows:
        doc = {c.name: getattr(r, c.name) for c in JournalLineModel.__table__.columns}
        del doc["created_at"]
        del doc["line_id"]
        out.append(doc)
    return out


async def chain_entries(w: World, entity: str = ENTITY) -> list[dict]:
    """Every journal row of the entity as the head derivation's input: any
    status, any hash — the Go filter reproduces the reference's WHERE. The
    timestamps are passthrough tie-break inputs; they normalize to fixed
    tokens (the reference's ORDER BY only separates duplicate block indexes,
    which the fixtures do not produce)."""
    async with w.manager.session_factory() as session:
        rows = (await session.execute(
            select(JournalEntryModel).where(JournalEntryModel.entity_code == entity)
        )).scalars().all()
    return [
        {
            "journal_id": r.journal_id,
            "status": r.status,
            "entry_hash": r.entry_hash,
            "block_index": r.block_index,
            "posted_at": POSTED_AT if r.posted_at else None,
            "created_at": CREATED_AT if r.created_at else None,
        }
        for r in rows
    ]


def seal_of(submitted: dict, committed: dict) -> dict:
    """mark_posted's write, read off the committed row. review_notes is
    written only when the submitted snapshot carries one."""
    return {
        "status": committed["status"],
        "revision": committed["revision"],
        "entry_hash": committed["entry_hash"],
        "prev_entry_hash": committed["prev_entry_hash"],
        "block_index": committed["block_index"],
        "posted_at": POSTED_AT,
        "approved_by_principal_key": committed["approved_by_principal_key"],
        "approved_by_principal_id": committed["approved_by_principal_id"],
        "review_notes": committed["review_notes"]
        if submitted.get("review_notes") is not None else None,
    }


async def capture_post(w: World, name: str, submitted: dict, *,
                       original_id: str | None = None) -> None:
    """Runs post_voucher over the prepared world and records the case: the
    sequence inputs, then the committed state, projected rows and result —
    or the classified refusal."""
    entity = submitted.get("entity_code") or ENTITY
    current = await w.repo.get_journal(submitted["journal_id"])
    original = None
    original_rows: list[dict] = []
    if original_id:
        loaded = await w.repo.get_journal(original_id)
        original = normalize_journal(loaded)
        if loaded is not None:
            original_rows = await ledger_rows(w, original_id)
    case_input = {
        "op": "post_voucher",
        "submitted": normalize_journal(submitted),
        "current": normalize_journal(current),
        "chart": await chart_rows(w, entity),
        "periods": await period_rows(w, entity),
        "effective_reversal_of": await effective_reversals(w),
        "original": original,
        "original_rows": original_rows,
        "chain": await chain_entries(w, entity),
        "approver": APPROVER,
        "posted_at": POSTED_AT,
    }
    to_post = deepcopy(submitted)
    try:
        await posting.post_voucher(
            to_post, approver_principal_id=APPROVER["principal_id"],
            approver_principal_key=APPROVER["principal_key"],
        )
    except posting.PostingError as exc:
        write("posting", name, case_input, error=posting_error_kind(exc))
        return
    committed = to_post
    rows = await ledger_rows(w, submitted["journal_id"])
    entry_layer = committed["entry_layer"] or "OPERATIONAL"
    dr_col, _ = destination_columns(entry_layer)
    original_seal = None
    if original_id:
        stored = await w.repo.get_journal(original_id)
        if stored is not None:
            original_seal = {"status": stored["status"], "revision": stored["revision"]}
    write("posting", name, case_input, output={
        "period_code": rows[0]["period_code"],
        "entry_layer": rows[0]["entry_layer"],
        "voucher": seal_of(submitted, committed),
        "original": original_seal,
        "rows": rows,
        "result": {
            "entry_hash": committed["entry_hash"],
            "prev_entry_hash": committed["prev_entry_hash"],
            "block_index": committed["block_index"],
            "columns": dr_col.replace("_debit", ""),
            "lines_written": len(rows),
        },
    })


async def run_post(name: str, build) -> None:
    w = World()
    try:
        await w.setup()
        await build(w)
    finally:
        await w.dispose()


# ---------------------------------------------------------------------------
# Posting sequence cases
# ---------------------------------------------------------------------------


async def gen_post_ok() -> None:
    async def basic(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        await capture_post(w, "post_ok_basic", entry)

    async def awaiting_cpa(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", status="AWAITING_CPA")
        await capture_post(w, "post_ok_awaiting_cpa", entry)

    async def review_notes_new(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        # Review metadata may drift from the stored row; the seal writes the
        # submitted notes (mark_posted's review_notes argument).
        submitted["review_notes"] = "final checklist"
        await capture_post(w, "post_ok_review_notes_new", submitted)

    async def review_notes_absent(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        entry.pop("review_notes")
        await w.repo.save_journal(deepcopy(entry))
        submitted = await w.repo.get_journal("j-1")
        await capture_post(w, "post_ok_review_notes_absent", submitted)

    async def aje_layer(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", entry_layer="AJE_MONTH_END")
        await capture_post(w, "post_ok_aje_layer", entry)

    await run_post("post_ok_basic", basic)
    await run_post("post_ok_awaiting_cpa", awaiting_cpa)
    await run_post("post_ok_review_notes_new", review_notes_new)
    await run_post("post_ok_review_notes_absent", review_notes_absent)
    await run_post("post_ok_aje_layer", aje_layer)


async def gen_post_refusals() -> None:
    async def draft(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", status="DRAFT")
        await capture_post(w, "post_cannot_post_draft", entry)

    async def posted_twice(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        await approve(w, entry)
        stored = await w.repo.get_journal("j-1")
        # Repeat approval is a no-op conflict: no second seal, no state move.
        await capture_post(w, "post_cannot_post_posted", stored)

    async def reversed(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        await approve(w, entry)
        await force_status(w, "j-1", "REVERSED")
        stored = await w.repo.get_journal("j-1")
        await capture_post(w, "post_cannot_post_reversed", stored)

    async def snapshot_lines(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        submitted["lines"][0]["debit"] = "200.0000"
        await capture_post(w, "post_snapshot_changed_lines", submitted)

    async def snapshot_revision(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        # A stale revision is a snapshot change: the reviewer held an older
        # copy of a voucher that moved (test_posting_detects_revision...).
        submitted["revision"] = 99
        await capture_post(w, "post_snapshot_changed_revision", submitted)

    async def no_lines(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", lines=[])
        await capture_post(w, "post_no_lines", entry)

    async def missing_account(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", lines=[
            {"line_number": 1, "account_code": "9999", "debit": "100.0000", "credit": "0.0000"},
            {"line_number": 2, "account_code": "1110", "debit": "0.0000", "credit": "100.0000"},
        ])
        await capture_post(w, "post_missing_account", entry)

    async def control_account(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", lines=[
            {"line_number": 1, "account_code": "6100", "debit": "100.0000", "credit": "0.0000"},
            {"line_number": 2, "account_code": "1210", "debit": "0.0000", "credit": "100.0000"},
        ])
        await capture_post(w, "post_control_account", entry)

    async def locked_period(w: World) -> None:
        await ledger.ensure_period(ENTITY, "2026-10", status="LOCKED")
        entry = await make_voucher(w, journal_id="j-1")
        await capture_post(w, "post_period_locked", entry)

    async def period_mismatch(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", accounting_date="2026-09-15")
        await capture_post(w, "post_period_date_mismatch", entry)

    async def invalid_date(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", accounting_date="2026-02-30")
        await capture_post(w, "post_invalid_accounting_date", entry)

    async def invalid_period(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", period="2026-13")
        await capture_post(w, "post_invalid_period", entry)

    await run_post("post_cannot_post_draft", draft)
    await run_post("post_cannot_post_posted", posted_twice)
    await run_post("post_cannot_post_reversed", reversed)
    await run_post("post_snapshot_changed_lines", snapshot_lines)
    await run_post("post_snapshot_changed_revision", snapshot_revision)
    await run_post("post_no_lines", no_lines)
    await run_post("post_missing_account", missing_account)
    await run_post("post_control_account", control_account)
    await run_post("post_period_locked", locked_period)
    await run_post("post_period_date_mismatch", period_mismatch)
    await run_post("post_invalid_accounting_date", invalid_date)
    await run_post("post_invalid_period", invalid_period)


# ---------------------------------------------------------------------------
# Reversal cases (BL-03): the sequence around voucher.ValidateReversal
# ---------------------------------------------------------------------------


def reversal_draft_from(original: dict, journal_id: str = "j-rev") -> dict:
    """The reversal draft of test_duplicate_reversal.reversal: the posted
    snapshot with the seal fields stripped, sides swapped, linked."""
    draft = deepcopy(original)
    for key in ("revision", "entry_hash", "prev_entry_hash", "posted_at", "block_index",
                "approved_by_principal_key", "approved_by_principal_id"):
        draft.pop(key, None)
    draft.update(journal_id=journal_id, status="PENDING_CHECKER", source_module="REVERSAL",
                 reversal_of_journal_id=original["journal_id"],
                 total_debit=original["total_credit"], total_credit=original["total_debit"])
    for line in draft["lines"]:
        line["debit"], line["credit"] = line["credit"], line["debit"]
    return draft


async def posted_original(w: World, journal_id: str = "j-orig", **overrides) -> dict:
    entry = await make_voucher(w, journal_id=journal_id, **overrides)
    await approve(w, entry)
    return await w.repo.get_journal(journal_id)


async def gen_post_reversals() -> None:
    async def ok(w: World) -> None:
        original = await posted_original(w)
        draft = reversal_draft_from(original)
        await w.repo.save_journal(draft)
        loaded = await w.repo.get_journal("j-rev")
        await capture_post(w, "post_reversal_ok", loaded, original_id="j-orig")

    async def duplicate(w: World) -> None:
        original = await posted_original(w)
        first = reversal_draft_from(original, "j-rev-1")
        second = reversal_draft_from(original, "j-rev-2")
        await w.repo.save_journal(first)
        await w.repo.save_journal(second)
        # Only one reversal can post; the original leaves POSTED with the
        # first seal, so the second draft meets a REVERSED original.
        await approve(w, await w.repo.get_journal("j-rev-1"))
        loaded = await w.repo.get_journal("j-rev-2")
        await capture_post(w, "post_reversal_duplicate", loaded, original_id="j-orig")

    async def of_reversal(w: World) -> None:
        original = await posted_original(w)
        draft = reversal_draft_from(original)
        await w.repo.save_journal(draft)
        await approve(w, await w.repo.get_journal("j-rev"))
        nested = reversal_draft_from(await w.repo.get_journal("j-rev"), "j-rev-2")
        await w.repo.save_journal(nested)
        loaded = await w.repo.get_journal("j-rev-2")
        # Reversing a posted reversal is refused, not silently reopened.
        await capture_post(w, "post_reversal_of_reversal", loaded, original_id="j-rev")

    async def totals_mismatch(w: World) -> None:
        original = await posted_original(w)
        draft = reversal_draft_from(original)
        draft["total_debit"] = "99.0000"
        await w.repo.save_journal(draft)
        loaded = await w.repo.get_journal("j-rev")
        await capture_post(w, "post_reversal_totals_mismatch", loaded, original_id="j-orig")

    async def nan_line(w: World) -> None:
        original = await posted_original(w)
        draft = reversal_draft_from(original)
        draft["lines"][0]["credit"] = "NaN"
        await w.repo.save_journal(draft)
        loaded = await w.repo.get_journal("j-rev")
        await capture_post(w, "post_reversal_nan_line", loaded, original_id="j-orig")

    async def original_missing(w: World) -> None:
        original = await posted_original(w)
        draft = reversal_draft_from(original)
        draft["reversal_of_journal_id"] = "j-vanished"
        await w.repo.save_journal(draft)
        loaded = await w.repo.get_journal("j-rev")
        await capture_post(w, "post_reversal_original_missing", loaded, original_id="j-vanished")

    async def cross_entity(w: World) -> None:
        original = await posted_original(w)
        draft = reversal_draft_from(original)
        draft["entity_code"] = "SG-OPC-01"
        await w.repo.save_journal(draft)
        loaded = await w.repo.get_journal("j-rev")
        await capture_post(w, "post_reversal_cross_entity", loaded, original_id="j-orig")

    async def fx(w: World) -> None:
        fx_line = {
            "tx_currency": "USD", "exchange_rate": "1.50000000",
            "counterparty_id": "supplier-1", "counterparty": "Supplier",
            "tax_code_id": "tax-1", "tax_code": "GST_FREE",
            "business_use_pct": "0.7500", "statement_ref": "PL-40",
            "memo": "original line",
        }
        original = await posted_original(w, journal_id="j-orig", currency="USD", lines=[
            {"line_number": 1, "account_code": "6100", "debit": "100.0000",
             "credit": "0.0000", "func_debit": "150.0000", "func_credit": "0.0000", **fx_line},
            {"line_number": 2, "account_code": "2110", "debit": "0.0000",
             "credit": "100.0000", "func_debit": "0.0000", "func_credit": "150.0000", **fx_line},
        ])
        # The generated reversal is built from the persisted ledger rows (the
        # reference's build_reversal_lines — BL-03's mirror semantics).
        lines = await posting.build_reversal_lines(original, reason="correction")
        draft = {
            "journal_id": "j-rev",
            "entity_code": ENTITY,
            "status": "PENDING_CHECKER",
            "source_module": "REVERSAL",
            "accounting_date": "2026-10-15",
            "period": "2026-10",
            "currency": original["currency"],
            "total_debit": original["total_credit"],
            "total_credit": original["total_debit"],
            **MAKER,
            "entry_layer": original["entry_layer"],
            "reversal_of_journal_id": "j-orig",
            "lines": lines,
        }
        await w.repo.save_journal(draft)
        loaded = await w.repo.get_journal("j-rev")
        await capture_post(w, "post_reversal_fx", loaded, original_id="j-orig")

    await run_post("post_reversal_ok", ok)
    await run_post("post_reversal_duplicate", duplicate)
    await run_post("post_reversal_of_reversal", of_reversal)
    await run_post("post_reversal_totals_mismatch", totals_mismatch)
    await run_post("post_reversal_nan_line", nan_line)
    await run_post("post_reversal_original_missing", original_missing)
    await run_post("post_reversal_cross_entity", cross_entity)
    await run_post("post_reversal_fx", fx)


async def gen_post_chain() -> None:
    async def after_reversed(w: World) -> None:
        # BL-25: the head includes sealed reversed vouchers, so the next
        # posting extends the chain instead of forking it.
        head = await make_voucher(w, journal_id="j-head")
        await approve(w, head)
        await force_status(w, "j-head", "REVERSED")
        following = await make_voucher(w, journal_id="j-2")
        await capture_post(w, "post_chain_after_reversed", following)

    await run_post("post_chain_after_reversed", after_reversed)


# ---------------------------------------------------------------------------
# Save-path transition guards (BL-02)
# ---------------------------------------------------------------------------


async def capture_save(w: World, name: str, current_id: str | None,
                       submitted: dict) -> None:
    current = await w.repo.get_journal(current_id) if current_id else None
    finalized = current is not None and current["status"] in ("POSTED", "REVERSED", "VOID")
    case_input = {
        "op": "save",
        "current": normalize_journal(current),
        "submitted": normalize_journal(submitted),
    }
    to_save = deepcopy(submitted)
    try:
        await w.repo.save_journal(to_save)
    except JournalConflict as exc:
        write("posting", name, case_input, error=str(exc).split(":", 1)[0])
        return
    stored = await w.repo.get_journal(submitted["journal_id"])
    write("posting", name, case_input, output={
        "insert": current is None,
        "next_revision": to_save.get("revision"),
        # status_only is the reference's finalized branch (the store writes
        # the status column only); read off the branch condition.
        "status_only": finalized,
        "status": stored["status"] if stored else submitted.get("status"),
    })


async def run_save(name: str, build) -> None:
    w = World()
    try:
        await w.setup()
        await build(w)
    finally:
        await w.dispose()


async def gen_save_cases() -> None:
    async def edit(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        submitted["memo"] = "edited"
        await capture_save(w, "save_ok_edit", "j-1", submitted)

    async def submit(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        submitted["status"] = "PENDING_CHECKER"
        await capture_save(w, "save_ok_submit", "j-1", submitted)

    async def stale(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        stale = deepcopy(entry)
        current = deepcopy(entry)
        current["memo"] = "a competing update"
        await w.repo.save_journal(current)
        # The stale copy's revision no longer matches, even with no state
        # change to make.
        await capture_save(w, "save_stale_revision", "j-1", stale)

    async def missing_revision(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        submitted.pop("revision")
        await capture_save(w, "save_missing_revision", "j-1", submitted)

    async def insert_ok(w: World) -> None:
        submitted = base_entry("j-new", status="DRAFT")
        submitted.pop("revision", None)
        await capture_save(w, "save_insert_ok", None, submitted)

    async def insert_with_revision(w: World) -> None:
        submitted = base_entry("j-new", status="DRAFT", revision=0)
        await capture_save(w, "save_insert_with_revision", None, submitted)

    async def finalized_reversal(w: World) -> None:
        entry = base_entry("j-posted", status="POSTED")
        entry.pop("revision", None)
        await w.repo.save_journal(entry)
        stored = await w.repo.get_journal("j-posted")
        submitted = deepcopy(stored)
        submitted["status"] = "REVERSED"
        # The one legitimate finalized transition: status only, seal kept.
        await capture_save(w, "save_finalized_status_only_reversal", "j-posted", submitted)

    async def finalized_stays(w: World) -> None:
        entry = base_entry("j-posted", status="POSTED")
        entry.pop("revision", None)
        await w.repo.save_journal(entry)
        stored = await w.repo.get_journal("j-posted")
        await capture_save(w, "save_finalized_stays", "j-posted", deepcopy(stored))

    async def finalized_edited(w: World) -> None:
        entry = base_entry("j-posted", status="POSTED")
        entry.pop("revision", None)
        await w.repo.save_journal(entry)
        stored = await w.repo.get_journal("j-posted")
        submitted = deepcopy(stored)
        submitted["memo"] = "cannot edit posted"
        await capture_save(w, "save_finalized_content_changed", "j-posted", submitted)

    async def finalized_to_draft(w: World) -> None:
        entry = base_entry("j-posted", status="POSTED")
        entry.pop("revision", None)
        await w.repo.save_journal(entry)
        stored = await w.repo.get_journal("j-posted")
        submitted = deepcopy(stored)
        submitted["status"] = "DRAFT"
        await capture_save(w, "save_finalized_to_draft", "j-posted", submitted)

    async def reversed_edited(w: World) -> None:
        entry = base_entry("j-posted", status="POSTED")
        entry.pop("revision", None)
        await w.repo.save_journal(entry)
        stored = await w.repo.get_journal("j-posted")
        stored = deepcopy(stored)
        stored["status"] = "REVERSED"
        await w.repo.save_journal(stored)
        stored = await w.repo.get_journal("j-posted")
        submitted = deepcopy(stored)
        submitted["memo"] = "cannot edit reversed either"
        await capture_save(w, "save_reversed_content_changed", "j-posted", submitted)

    async def seal_fields(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        submitted["entry_hash"] = "fake"
        await capture_save(w, "save_seal_fields_blocked", "j-1", submitted)

    async def state_conflict(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", status="DRAFT")
        submitted = deepcopy(entry)
        submitted["status"] = "POSTED"
        await capture_save(w, "save_state_conflict_draft_to_posted", "j-1", submitted)

    async def pending_to_draft(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1")
        submitted = deepcopy(entry)
        submitted["status"] = "DRAFT"
        await capture_save(w, "save_state_conflict_pending_to_draft", "j-1", submitted)

    async def rejected_to_draft(w: World) -> None:
        entry = await make_voucher(w, journal_id="j-1", status="REJECTED")
        submitted = deepcopy(entry)
        submitted["status"] = "DRAFT"
        await capture_save(w, "save_ok_rejected_to_draft", "j-1", submitted)

    await run_save("save_ok_edit", edit)
    await run_save("save_ok_submit", submit)
    await run_save("save_stale_revision", stale)
    await run_save("save_missing_revision", missing_revision)
    await run_save("save_insert_ok", insert_ok)
    await run_save("save_insert_with_revision", insert_with_revision)
    await run_save("save_finalized_status_only_reversal", finalized_reversal)
    await run_save("save_finalized_stays", finalized_stays)
    await run_save("save_finalized_content_changed", finalized_edited)
    await run_save("save_finalized_to_draft", finalized_to_draft)
    await run_save("save_reversed_content_changed", reversed_edited)
    await run_save("save_seal_fields_blocked", seal_fields)
    await run_save("save_state_conflict_draft_to_posted", state_conflict)
    await run_save("save_state_conflict_pending_to_draft", pending_to_draft)
    await run_save("save_ok_rejected_to_draft", rejected_to_draft)


# ---------------------------------------------------------------------------
# Chain head derivation (BL-25)
# ---------------------------------------------------------------------------


def chain_seed(journal_id: str, *, status: str, entry_hash: str | None = None,
               block_index: int = 0) -> dict:
    return {
        "journal_id": journal_id,
        "entity_code": ENTITY,
        "source_module": "MANUAL",
        "status": status,
        "accounting_date": "2026-10-15",
        "currency": "AUD",
        "total_debit": "100.0000",
        "total_credit": "100.0000",
        **MAKER,
        "entry_hash": entry_hash,
        "block_index": block_index,
        "posted_at": datetime(2026, 10, 31, 0, 0, 0, tzinfo=UTC),
        "created_at": datetime(2026, 10, 1, 9, 0, 0),
    }


async def seed_rows(w: World, rows: list[dict]) -> None:
    async with w.manager.session_factory() as session, session.begin():
        for row in rows:
            session.add(JournalEntryModel(**row))


async def capture_chain(w: World, name: str) -> None:
    prev = await w.repo.get_latest_posted_hash(ENTITY)
    nxt = await w.repo.get_next_block_index(ENTITY)
    write("posting", name, {"op": "chain_head", "entries": await chain_entries(w)},
          output={"prev_entry_hash": prev, "next_block_index": nxt})


async def gen_chain_cases() -> None:
    async def empty(w: World) -> None:
        await capture_chain(w, "chain_empty")

    async def posted_head(w: World) -> None:
        await seed_rows(w, [chain_seed("j-1", status="POSTED", entry_hash="a" * 64,
                                       block_index=1)])
        await capture_chain(w, "chain_posted_head")

    async def includes_reversed(w: World) -> None:
        # BL-25: the reversed block stays in the chain and is the head.
        await seed_rows(w, [
            chain_seed("j-1", status="REVERSED", entry_hash="a" * 64, block_index=1),
            chain_seed("j-2", status="POSTED", entry_hash="b" * 64, block_index=2),
        ])
        await capture_chain(w, "chain_includes_reversed")

    async def ignores_unsealed(w: World) -> None:
        await seed_rows(w, [
            chain_seed("j-1", status="POSTED", entry_hash="a" * 64, block_index=1),
            chain_seed("j-2", status="PENDING_CHECKER"),
            chain_seed("j-3", status="REJECTED"),
        ])
        await capture_chain(w, "chain_ignores_unsealed")

    async def ignores_pending_with_hash(w: World) -> None:
        await seed_rows(w, [
            chain_seed("j-1", status="POSTED", entry_hash="a" * 64, block_index=1),
            chain_seed("j-2", status="PENDING_CHECKER", entry_hash="f" * 64,
                       block_index=5),
        ])
        await capture_chain(w, "chain_ignores_pending_with_hash")

    async def max_block_wins(w: World) -> None:
        await seed_rows(w, [
            chain_seed("j-2", status="POSTED", entry_hash="b" * 64, block_index=2),
            chain_seed("j-1", status="REVERSED", entry_hash="a" * 64, block_index=1),
        ])
        await capture_chain(w, "chain_max_block_wins")

    for build in (empty, posted_head, includes_reversed, ignores_unsealed,
                  ignores_pending_with_hash, max_block_wins):
        w = World()
        try:
            await w.setup()
            await build(w)
        finally:
            await w.dispose()


# ---------------------------------------------------------------------------
# Review metadata update (mcp_roles._review_voucher's decision core)
# ---------------------------------------------------------------------------


def run_review(name: str, *, status: str = "PENDING_CHECKER", voucher_no: str | None = None,
               verdict: str, checked: list[str] | None = None, reason: str = "",
               reviewer_position: str = "GL_ACCOUNTANT",
               reviewer_principal_key: str = "controller-checker-01",
               reviewed_at: str = "2026-10-31T00:00:00+00:00") -> None:
    case_input = {
        "op": "review_verdict",
        "status": status,
        "voucher_no": voucher_no,
        "verdict": verdict,
        "reviewer_position": reviewer_position,
        "reviewer_principal_key": reviewer_principal_key,
        "checked": checked or [],
        "reason": reason,
        "reviewed_at": reviewed_at,
    }
    # State guard first (mcp_roles._review_voucher), then validate_verdict
    # (reviewer.py, driven for real), then the content rules, then the
    # metadata write. Authority resolution and the approval's posting are
    # other seams.
    if status not in ("PENDING_CHECKER", "AWAITING_CPA"):
        write("posting", name, case_input, error="INVALID_STATE")
        return
    try:
        verdict = validate_verdict(verdict)
    except ValueError as exc:
        write("posting", name, case_input, error=str(exc).split(":", 1)[0])
        return
    if verdict == "APPROVE" and not (checked or []):
        write("posting", name, case_input, error="REVIEW_CHECKLIST_REQUIRED")
        return
    if verdict in ("REJECT", "ESCALATE") and not reason.strip():
        write("posting", name, case_input, error="REASON_REQUIRED")
        return
    review_notes = json.dumps(
        {
            "verdict": verdict,
            "reviewer_position": reviewer_position,
            "reviewer_principal_key": reviewer_principal_key,
            "checked": checked or [],
            "reason": reason,
            "reviewed_at": reviewed_at,
        },
        ensure_ascii=False,
    )
    if verdict == "REJECT":
        write("posting", name, case_input, output={
            "review_notes": review_notes,
            "status": "REJECTED",
            "reject_reason": reason.strip(),
            "proceed_to_post": False,
        })
        return
    if verdict == "ESCALATE":
        write("posting", name, case_input, output={
            "review_notes": review_notes,
            "status": "AWAITING_CPA",
            "reject_reason": None,
            "proceed_to_post": False,
        })
        return
    write("posting", name, case_input, output={
        "review_notes": review_notes,
        "status": status,
        "reject_reason": None,
        "proceed_to_post": True,
    })


def gen_review_cases() -> None:
    run_review("review_approve", verdict="APPROVE",
               checked=["金額與發票相符", "科目性質正確"])
    run_review("review_approve_lowercase", verdict="approve",
               checked=["金額與發票相符"])
    run_review("review_approve_no_checklist", verdict="APPROVE")
    run_review("review_reject", verdict="REJECT", reason="receipt unclear")
    run_review("review_reject_reason_padded", verdict="REJECT",
               reason="  收據不清楚  ")
    run_review("review_reject_blank", verdict="REJECT", reason="   ")
    run_review("review_escalate", verdict="ESCALATE", reason="scope不足",
               reviewer_position="FINANCE_MANAGER",
               reviewer_principal_key="finance-manager-01")
    run_review("review_invalid_verdict", verdict="MAYBE", checked=["x"])
    run_review("review_invalid_state_posted", status="POSTED", verdict="APPROVE",
               checked=["x"])
    run_review("review_invalid_state_voucher_no", status="REJECTED",
               voucher_no="記-2026-10-0001", verdict="REJECT", reason="late")


# ---------------------------------------------------------------------------
# destination_columns
# ---------------------------------------------------------------------------


def gen_destination_cases() -> None:
    for name, layer in [
        ("destination_columns_none", None),
        ("destination_columns_empty", ""),
        ("destination_columns_operational", "OPERATIONAL"),
        ("destination_columns_aje", "AJE_MONTH_END"),
        ("destination_columns_rje", "RJE_RECLASS"),
        ("destination_columns_opening", "OPENING"),
    ]:
        dr_col, _ = destination_columns(layer)
        write("posting", name, {"op": "destination_columns", "entry_layer": layer},
              output=dr_col.replace("_debit", ""))


async def main() -> None:
    await gen_post_ok()
    await gen_post_refusals()
    await gen_post_reversals()
    await gen_post_chain()
    await gen_save_cases()
    await gen_chain_cases()
    gen_review_cases()
    gen_destination_cases()
    for module, count in sorted(COUNTS.items()):
        print(f"{module}: {count} cases")


if __name__ == "__main__":
    asyncio.run(main())
