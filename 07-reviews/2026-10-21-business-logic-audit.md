# Business logic audit and remediation record

Date: 2026-10-21. Engineering review, not a statutory audit opinion or production approval.

## Sources and baseline

- SRC-0015: [Owner's audit and sequential remediation instructions](../01-inputs/2026-10-21-business-logic-audit-request.md).
- SRC-0016: this dated inspection and verification record.
- [Source register](../01-inputs/source-register.md).
- [Draft accounting-control matrix](../03-planning/accounting-control-matrix.md), originating from SRC-0005, SRC-0006, and SRC-0007. Proposed controls are not approved production specifications.
- Baseline: commit `6914136402862342fe5ddae0ff9e58602204c765`, including pre-existing uncommitted changes. Source line numbers below refer to that pre-remediation baseline and will move as repairs are made.

The original audit was read-only. Remediation was subsequently authorized by SRC-0015. This document records engineering outcomes only; formal requirement status remains in the requirement pool. No release transition is recorded here.

## Assessment

Observed: the default Monolith workspace and regional relational ledger share authentication but maintain separate accounting records. Both were reviewed, including REST/MCP controls, documents, subledgers, reconciliation, assets, tax, reporting, and recovery.

Inferred engineering recommendation: do not use the current implementation for production accounting or statutory reporting until the blocking findings are resolved and acceptance evidence is approved. Balanced journals and reconciled net cash do not establish correct economic treatment.

## Original validation evidence

- Full backend suite: `cd backend && env -u DATABASE_URL uv run --offline --no-sync pytest tests -q`, **52 passed**.
- Frontend: `cd frontend && npm run test:monolith`, **21 passed**.
- TypeScript and production build: `cd frontend && npm run build:web`, passed with a chunk-size warning.
- Isolated SQLite fault, concurrency, API, and calculation probes reproduced the findings below. Temporary reproduction scripts were `/tmp/regional_ledger_audit.py` and `/tmp/aas_business_control_audit.py`; these are ephemeral, not durable repository deliverables. Repairs must add checked-in regression tests.
- Database probes unset `DATABASE_URL` and used temporary storage. No production database was examined.

Passing existing tests did not cover the reproduced failures. PostgreSQL, live browser workflows, deployed integrations, full disaster recovery, and jurisdiction-specific legal compliance were not validated.

## Findings and sequential remediation checklist

Every row is an Observed defect unless its qualification says otherwise. An unchecked box means remediation has not been verified. Findings are grouped for readability; implementation begins with posting integrity. Related fixes may share a transaction boundary, but must retain separate evidence.

### Posting and accounting integrity

- [x] **BL-01, high: failed posting changes balances.** `backend/app/core/posting.py:111–139` and `backend/app/core/ledger.py:446` committed lines before sealing. Injected finalization failure left a pending voucher with two reportable lines and expense debit 137. Required: one transaction for journal status, approval, lines, and sealing. Durable event publication is separately tracked as BL-26.
- [x] **BL-02, high: posted vouchers can be overwritten.** `backend/app/api_vouchers.py:280–314`, `backend/app/core/repository.py:386–387`, `backend/app/mcp_server.py:781–812`. A stale edit left a DRAFT voucher for 99 against posted ledger amount 31; stale REST rejection cleared the hash of an MCP-posted voucher but retained its lines. Required: guarded persisted-state transitions and stale-write detection, never cache-authorized writes.
- [x] **BL-03, high: duplicate reversal.** `backend/app/api_vouchers.py:373–378,439–500`. Two reversal drafts both posted; original debit 100 became net credit 100. Required: atomic reversal relationship and uniqueness enforcement.
- [x] **BL-04, high: date/period cutoff bypass.** `backend/app/core/posting.py:74–95`, `backend/app/core/ledger.py:555–562`. September 15 dated transaction labeled November posted with September locked and changed October opening by 73. Required: consistent accounting-date/period validation and reporting cutoffs.
- [ ] **BL-05, high: duplicate document accounting.** `backend/app/api_documents.py:100–113,140–143,228–229`. Identical uploads produced posted movements of 178 for one 89 invoice. Concurrent conversion of one NEW document created two vouchers but retained only one link. Required: atomic document claims plus duplicate economic-event detection; file hashes alone are insufficient.

### Authority and evidence

- [ ] **BL-06, high: inconsistent reviewer authority.** `backend/app/mcp_server.py:770–838`, `backend/app/core/positions.py:240–271`. REST permitted chief-accountant controller approval of a finance-manager voucher, contrary to MCP's required CPA review. Required: one reviewer authorization policy across entrances.
- [ ] **BL-07, high: account-scoped data leakage.** `backend/app/mcp_roles.py:360–380`, `backend/app/main.py:238–241`. AP clerk read bank/equity voucher details and obtained a full reporting pack through an expense mutation despite reporting GET denial. Required: scoped projections on every response.
- [ ] **BL-08, high: evidence ownership and active-evidence checks fail.** `backend/app/mcp_roles.py:630–652`, `backend/app/api_vouchers.py:556`, `backend/app/core/sod_guard.py:110`. AP clerk appended evidence to another preparer's bank/equity voucher. Detaching the only attachment left a truthy tombstone that allowed submission and posting. Required: ownership/scope checks and validation of active evidence at posting.

### Monolith accounting workflows

- [x] **BL-09, high: bank exception duplicates settlement.** `backend/app/core/monolith.py:221–232`. Paying a 4,200 bill then applying `bank.exception` produced 8,400 cash credits; the exception created another expense instead of matching. Required: separate matching from posting, classify explicitly, resolve existing candidates.
- [x] **BL-10, high: control-account journals bypass subledgers.** `backend/app/core/monolith.py:85–98,188–195,347–368`. Reviewed manual receipt left the invoice collectible; collection of the same 100 invoice then increased cash by 200. Required: validated subledger allocations or rejection of ordinary control-account postings.
- [x] **BL-11, high: depreciation without acquisition.** `backend/app/core/monolith.py:262–292`. Registering a 1,200 asset did not capitalize it, but a 12-month life allowed depreciation 100. Required: validated capitalization linkage and asset-register/GL reconciliation.

### Reports and cash flow

- [x] **BL-12, high: noncash acquisitions create cash flows.** `backend/app/core/reporting.py:309–318`. Credit equipment purchase 5,000 reported operating inflow 5,000 and investing outflow -5,000, with consistency checks passing. Required: distinguish cash settlements and noncash movements.
- [x] **BL-13, high: unmapped categories disappear.** `backend/app/core/reporting.py:169–173,213–221`, `backend/app/core/ledger.py:247`. Inventory debit 500 against loan credit 500 reported zero assets and liabilities and passed checks. Required: validated/versioned mappings and blocking on unmapped balances.
- [x] **BL-14, high: inconsistent reporting periods and fiscal carry-forward.** `backend/app/core/reporting.py:175–190,302–307`, `backend/app/core/ledger.py:562–569`. Opening revenue 100 plus November revenue 20 yielded P&L profit 120 versus cash-flow starting profit 20. Revenue from December 2025 remained in January 2027 opening revenue. Required: explicit monthly/YTD definitions and fiscal close/open rules. Owner confirmation of intended period semantics remains necessary.
- [ ] **BL-15, high: Monolith cash reconciliation offsets two errors.** `frontend/src/monolith/utils/accountingLogic.ts:1008–1023,1086–1106`. With no journal entries, operating cash generation was 466,200. Actual opening cash was 2,319,700, while hardcoded beginning cash 1,853,500 made reconciliation pass. Required: period activity and actual opening balances.
- [ ] **BL-16, high: investing/financing cash classifications incomplete.** `frontend/src/monolith/utils/accountingLogic.ts:1089–1103`. Cash equipment purchase 5,000 yielded zero investing flow; noncash retained-earnings-to-capital transfer 100 yielded financing flow 100. Required: cash-linked transaction classifications.
- [x] **BL-17, high: MCP account ledger drops reversed originals.** `backend/app/core/vouchers.py:262–264`, `backend/app/mcp_roles.py:348–354,895–900`. Original cash debit 100 plus reversal credit 100 reported -100 instead of zero. Required: preserve original and reversing amounts in their respective periods.
- [x] **BL-18, high: compound entries overstate gross cash.** `backend/app/core/ledger.py:1055–1067`. Cash debit 100 and equipment debit 500 against loan credit 600 yielded cash inflow 600 and outflow 500, while tying net cash. Required: allocate only actual cash legs.
- [ ] **BL-19, medium: static financial diagram.** `frontend/src/monolith/components/FinancialStatementsModule.tsx:28–35`. Seeded Q4 diagram remains unchanged by posted transactions. Required: derive from live reporting data or label it explicitly as an illustration.

### Tax

- [x] **BL-20, high: unsupported filing calculations.** `backend/app/core/reporting.py:368–430`. A 1,000 prepayment with no GST yielded Australian GST credit 600; other regional input credits use similar fixed percentages. Unknown jurisdictions fall back to AU. Required: transaction-derived tax, effective-dated eligibility, and fail-closed unsupported regimes. Existing output is not filing-ready.
- [x] **BL-21, medium: provision inputs remain editable.** `backend/app/core/monolith.py:235–253`. After provision 210, editing inputs calculated 420 while the journal remained 210 and reposting was blocked. Required: freeze inputs or linked adjustment workflow.
- [ ] **BL-22, medium, exposure unconfirmed: document length masquerades as tax verification.** `backend/app/core/localization.py:127–128`. Twenty arbitrary characters granted recoverable VAT 130 on a 1,000 purchase. No active evaluator caller was found. Required: verified eligibility, not string-length checks.

### Recovery and technical accounting controls

- [ ] **BL-23, high: backups omit source files.** `backend/app/main.py:366`, `backend/app/core/vouchers.py:53`. Database snapshot preserved references but not separately stored attachments. Required: consistent DB-and-evidence backup and restoration verification.
- [ ] **BL-24, high: failed delivery marked dispatched.** `backend/app/orchestrator/event_bus.py:178–183`. Simulated HTTP 500 became DISPATCHED without retry. Required: response validation and persistent per-subscriber retry state.
- [x] **BL-25, medium: concurrent hash-chain fork.** `backend/app/core/posting.py:116–117`, `backend/app/core/repository.py:679–690`. Two approved vouchers received index 1 and the same parent. Required: serialized entity chain allocation, including sealed reversed entries. Hash chains are not external immutability guarantees.
- [ ] **BL-26, high production gap: no durable transactional outbox.** `backend/app/orchestrator/event_bus.py`. Queue and recent-event history are process-local; a fresh orchestrator has no retained events. Required: durable events committed with the accounting command and replay-safe consumers. This is a confirmed limitation, not breach of an approved feature specification.
- [x] **BL-27, medium: monetary precision lost on persistence.** `backend/app/core/monolith.py:33–43,96,183–186`. Accepted `999999999999.9997` became `999999999999.9998` after conversion to float. Required: decimal strings or scaled integers end to end.
- [ ] **BL-28, high production gap: regional ingress lacks idempotency.** Repeated regional expense webhook payload and identical `Idempotency-Key` created different independently postable journals. Required: principal/entity/payload-bound command receipts and business duplicate controls. This capability was deferred, not an approved production guarantee.
- [x] **BL-29, medium: submitted timestamp cannot round-trip.** `backend/app/core/repository.py:128,379`. Rejecting a submitted voucher returned HTTP 500 and left it pending because an ISO string reached SQLAlchemy DateTime. Required: normalize at persistence boundaries and test transitions.

## Other capability boundaries

Observed deferred scope, not additional implementation defects:

- Entity-bound credentials and complete operational maker-checker workflows.
- Approved automatic-posting policies.
- Partial settlements and multi-period rollover.
- Authenticated close/signing operations currently fail closed with MFA_REQUIRED.
- No unified accounting record across Monolith and the regional ledger.

To confirm: deployment model, jurisdiction-specific treatment, fiscal calendar, accepted tax golden cases, entity isolation policy, and priorities for deferred capabilities. Not covered: independent evidence of real economic events, statutory compliance opinion, production load behavior, PostgreSQL lock verification, and full disaster-recovery acceptance.

## Remediation evidence

Repairs below are engineering work, not release approval. Record the exact tests and remaining boundaries before checking off a finding. Historical observations above remain unchanged after repair.

### BL-01 and BL-25: atomic regional posting and chain allocation

Observed repaired and verified on isolated SQLite. The PostgreSQL locking implementation is present but has not been tested against a live server.

- `backend/app/core/posting.py` now owns one transaction for the persisted voucher snapshot, chart/period validation, ledger writes, review metadata, and sealing. It updates the caller dictionary only after successful commit.
- `backend/app/core/transactions.py` allows helpers to join the caller's session without independent commits. `ledger.py` and `repository.py` use that shared session during posting.
- SQLite reserves the writer with `BEGIN IMMEDIATE` before reads. PostgreSQL serializes posting through an entity row lock. Chain queries run inside that transaction and include sealed reversed vouchers.
- Checked-in regressions: `backend/tests/test_atomic_posting.py`, 14 cases. They cover failure after line flush, after seal, and at commit; absence of ledger effects after failure; unchanged caller/review state; success; repeat approval; changed submitted snapshots; concurrent same/different vouchers; reversed chain heads; and validation refusals.
- Verification after the first repair: `cd backend && env -u DATABASE_URL .venv/bin/python -m pytest tests/test_atomic_posting.py -q`, **14 passed**. Full suite at that point: **66 passed**.
- BL-26 durable event publication remains open. This fix does not atomically persist outbox events and does not repair existing corrupt data or claim production acceptance.

### BL-02 and BL-29: stale writes, final-state protection, and timestamp round-tripping

Observed repaired and verified on isolated SQLite. Independent read-only review found no concrete remaining issue within this repair scope and independently reran the full suite successfully.

- `backend/app/core/db.py` adds persisted journal `revision`, default zero, with an additive migration for SQLite and PostgreSQL.
- `backend/app/core/repository.py` requires a matching revision for existing records, locks before checking/writing, conditionally updates revision and status, and forbids changes to finalized financial/hash fields. The legitimate status-only POSTED-to-REVERSED transition remains supported. Successful posting increments revision.
- `backend/app/mcp_server.py` loads review state from the database rather than the cache, and publishes changed cache state only after persistence succeeds.
- REST rejection writes status and reason once. Conflicting REST mutations return HTTP 409. Voucher responses expose revision without requiring existing clients to change.
- Datetime normalization at the repository boundary repairs BL-29, which otherwise prevented submitted-voucher rejection from completing.
- Checked-in regressions: `backend/tests/test_journal_concurrency.py`, 37 cases. They cover stale draft edits after posting, competing writes across edit/submit/evidence/review, missing revisions, final-field immutability, status-only reversal, stale MCP cache rejection, review interleavings, single-write submitted-voucher rejection, REST conflict responses, concurrent edits, and migration.
- Final focused command: `cd backend && env -u DATABASE_URL .venv/bin/python -m pytest tests/test_atomic_posting.py tests/test_journal_concurrency.py -q`, **51 passed**.
- Final full command: `cd backend && env -u DATABASE_URL .venv/bin/python -m pytest -q`, **103 passed**.
- `git diff --check` passed. Audit/request relative links and 29 unique finding IDs were checked.

Remaining boundaries: existing clients do not send the revision displayed to a reviewer, so an approval based on an old UI screen is not detected if the request starts after the newer version was committed. Server-side read-to-write races are guarded. PostgreSQL migration and locking need live validation; startup requires permission to add `revision INTEGER NOT NULL DEFAULT 0`. Existing corrupt records require a separate reconciliation/correction exercise, not automatic deletion or rewriting.

### BL-03: one effective reversal, committed with its original

Observed repaired and verified on isolated SQLite. No live PostgreSQL validation was performed.

- `backend/app/core/posting.py` validates the linked persisted original inside the shared posting transaction. It must be POSTED, in the same entity, not itself a reversal, and without another effective posted reversal.
- Reversal lines must mirror the original persisted ledger's transaction and functional amounts, account codes, currencies, and entry layers. The original's status and revision change atomically with reversal lines, approval, hash and status. Failed original updates or commit failures roll everything back.
- REST and role-scoped MCP no longer separately mark the original after posting. Duplicate approval produces a REST 409 conflict or an MCP error without a second accounting effect. Multiple drafts are allowed, but only one can post; rejected/void drafts do not reserve the original.
- Independent review caught a generated-FX-reversal regression before completion: the builders dropped functional amounts and line currencies. Both now use `build_reversal_lines()` over persisted ledger rows, preserve FX rates and metadata, and apply maker account scope to those authoritative accounts rather than potentially incomplete voucher JSON.
- Checked-in tests: `backend/tests/test_duplicate_reversal.py`, **25 cases**, and `backend/tests/test_generated_reversal.py`, **24 cases**. They cover sequential/concurrent duplicates, abandoned drafts, atomic rollback, immutable history, invalid/cross-entity references, malformed mirrors, REST/MCP errors, and generated REST/MCP FX and same-currency reversals through submission and approval. FX tests assert that both transaction and functional amounts net to zero and original ledger rows remain unchanged.
- First repair focused verification: `cd backend && env -u DATABASE_URL .venv/bin/python -m pytest tests/test_duplicate_reversal.py -q`, **25 passed**. Full suite at that point: **128 passed**. Final combined evidence is recorded below.

Explicit limitations: reversing a posted reversal is unsupported and rejected rather than silently reopening an original. Generated reversals with nonzero persisted functional tax amounts fail closed until a signed tax-reversal policy is approved. No existing duplicate or corrupted postings were rewritten. BL-17's separate MCP ledger projection remains open; this repair preserves the original ledger facts but does not fix that projection.

### BL-04: accounting-date cutoff and overlapping period labels

Observed repaired and verified on isolated SQLite. The original September-date/November-period reproduction is rejected before financial effects.

- `backend/app/core/ledger.py` provides canonical real `YYYY-MM-DD` validation against inclusive monthly `YYYY-MM` and quarterly `YYYY-Qn` bounds. An absent period derives from the validated date's month; an explicitly empty, malformed, annual, or mismatched period is rejected. Annual periods remain unsupported.
- Shared posting, ledger writing, migration preparation, and relevant REST/MCP/document/AJE ingress use these checks. No path in this repair silently changes an explicit date or rewrites historical records to make them fit.
- REST/MCP reversals use today's actual accounting date and its month rather than combining today's date with the original's old period. A locked original period permits a correction in an open target period. A locked target rejects the correction.
- Write checks now reject every non-writable period containing the actual date, regardless of monthly or quarterly label. September cannot be posted through an open Q3 when September is locked; a month inside a locked quarter also rejects. An open October date remains writable if only November is locked, even when the posting label is Q4. Undated period-level checks conservatively reject any overlapping lock.
- Date-bounded ledger queries, derived balances, account movements, trial-balance checks, cash-flow period queries and pending-close checks consistently include valid monthly/quarterly postings by actual date, without double counting. Fiscal P&L and year-end carry-forward behavior were not changed; BL-14 remains open.
- Reporting derivation refuses malformed legacy date/period records without repairing or silently omitting them.
- Checked-in tests: `backend/tests/test_period_cutoff.py`, **36 cases**, and `backend/tests/test_period_overlap.py`, **20 cases**. They cover invalid dates/periods, leap days and quarter boundaries, absent-period compatibility, the original cutoff attack, authenticated ingress/approval, helpers, legacy corruption, locked-history/current-period reversals, overlapping locks, and mixed monthly/quarterly projections.

Explicit remaining control gap: period closing and posting are not yet fully serialized. A close or a newly inserted overlapping lock concurrent with posting still requires a separate transaction-protocol repair and regression evidence before production acceptance. This completion records date/period validation and already-persisted lock enforcement, not a guarantee about concurrent period closure. Existing malformed history requires an authorized correction exercise. PostgreSQL runtime locking remains unverified.

### Final verification for this continuation

- `cd backend && env -u DATABASE_URL .venv/bin/python -m pytest tests/test_duplicate_reversal.py tests/test_period_cutoff.py tests/test_period_overlap.py tests/test_generated_reversal.py -q`: **105 passed**.
- `cd backend && env -u DATABASE_URL .venv/bin/python -m pytest -q`: **208 passed**.
- `git diff --check`: passed.
- Independent read-only review found the FX builder issue described above; it was corrected and its transport-level regressions passed before completion. The reviewer found no other concrete BL-03/BL-04 issue within the reviewed scope. PostgreSQL was not exercised.
- No production database, deployment, formal requirement status, or unrelated frontend work was changed by this continuation.

### Next sequential repair

BL-05 duplicate document accounting remains open and is next in priority order. Six of the 29 findings now have verified repairs in the stated SQLite scope; 23 remain unchecked. Residual control gaps and product limitations above are not release approval. All other unchecked findings remain unresolved. No release or formal requirement transition has been approved.

## REQ-0035 P1: findings absorbed by the Go migration (2026-10-31)

Per [ADR-0002 §3.1](../03-planning/adr-0002-backend-golang-migration.md) and the [REQ-0035 work order](../05-requirements/req-0035-backend-go-migration/work-order.md), the findings above were fixed test-first in the Go backend (`backend-go/`, branch `req-0035/p0-scaffold`), not in the frozen Python reference. Each fix reproduces the audit scenario and asserts the corrected behaviour; phase evidence: [2026-10-31-req-0035-p1-phase-evidence.md](2026-10-31-req-0035-p1-phase-evidence.md).

| Finding | Go fix (package) | Regression test | Commit |
| --- | --- | --- | --- |
| BL-09 | bank exceptions classify first and resolve existing candidates (workflow) | `TestBL09_bank_exception_matches_instead_of_doubling` | 778e226 |
| BL-10 | control-account postings allocate or reject (workflow) | `TestBL10_control_account_postings_allocate_or_reject` | 778e226 |
| BL-11 | depreciation requires a POSTED capitalization entry reconciling to cost (workflow) | `TestBL11_depreciation_requires_capitalization` | 778e226 |
| BL-12 | cash flows classify only actual cash legs (reporting) | `TestBL12_noncash_acquisition_creates_no_cash_flow` | 778e226 |
| BL-13 | versioned FS-category mapping; unmapped categories block every statement (reporting) | `TestBL13_unmapped_categories_block_reporting` | 778e226 |
| BL-14 | owner-decided period semantics: financial reports anchored to fiscal_periods (monthly/quarterly/semi-annual/annual, annually = entity fiscal year), management custom periods read-only (ledger, reporting) | `TestBL14_*` (10 tests across ledger + reporting) | 3b6dac1, 778e226 |
| BL-17 | account-ledger projection preserves original and reversing amounts in their periods (reporting) | `TestBL17_reversal_preserves_both_amounts` | 778e226 |
| BL-18 | compound entries allocate only actual cash legs (reporting) | `TestBL18_compound_entry_allocates_actual_cash_legs` | 778e226 |
| BL-20 | fail-closed jurisdictions: no AU fallback, no fabricated credits, output boxes carry the not-filing-ready disclosure (reporting) | `TestBL20_unsupported_jurisdictions_rejected`, `TestBL20_no_fabricated_input_credits` | 778e226, 6aedec8 |
| BL-21 | provision inputs freeze after posting (workflow) | `TestBL21_provision_inputs_freeze_after_posting` | 778e226 |
| BL-27 | exact decimal end to end; no float conversion exists (workflow, money) | `TestBL27_exact_decimal_round_trip` | 778e226 |

Scope notes: BL-14 implemented per SRC-0027 (owner, confirmed 2026-10-30); BL-20 is the interim fail-closed rule until REQ-0014. Historical observations above are unchanged.

## Required acceptance direction

First repair transaction integrity, conditional transitions, reversal uniqueness and cutoff checks. Then unify authority, scope, evidence, document claims and command receipts. Repair accounting projections and tax derivation before representing outputs as reliable financial statements or returns. Finally demonstrate durable delivery and restored accounting/evidence/idempotency consistency.

Every confirmed reproduction needs a checked-in regression. Concurrency and failure tests must assert financial effects and persisted state, not merely successful HTTP responses. Accounting owners must approve recognition, tax, and period golden cases; engineering tests alone cannot approve their economic substance.
