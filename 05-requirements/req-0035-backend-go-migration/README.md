# REQ-0035: Backend Go migration with golden-file parity

- Requirement: REQ-0035 ([pool entry](../../04-requirement-pool/requirement-pool.md))
- Status: work package drafted 2026-10-30; development authorized by the [work order](work-order.md) (owner), pool status `developing` per its authorization clause. Phase progress: [P0 complete 2026-10-31](../../07-reviews/2026-10-31-req-0035-p0-phase-evidence.md) (PR #1, branch `req-0035/p0`), [P1 complete 2026-10-31](../../07-reviews/2026-10-31-req-0035-p1-phase-evidence.md) (PR #2, branch `req-0035/p1`) — gates green, reviews done, findings fixed, review-record checkboxes ticked.
- Sources: [SRC-0024](../../01-inputs/2026-10-24-backend-golang-migration-decision.md) (decision), [SRC-0026](../../01-inputs/2026-10-24-open-findings-fold-into-golang-migration.md) (findings fold-in), [SRC-0027](../../01-inputs/2026-10-24-bl14-bl31-bl36-decisions.md), [SRC-0028](../../01-inputs/2026-10-24-solo-mode-relaxation.md) (prerequisite decisions)
- Plan of record: [ADR-0002](../../03-planning/adr-0002-backend-golang-migration.md); architecture constraints: [ADR-0001](../../03-planning/adr-0001-agent-first-mcp-architecture.md) D1–D6
- Design: [design.md](design.md) (codebase design, written with the codebase-design skill)

## Problem Statement

A one-person-company boss who wants the desktop app must first install Python 3.11+ and uv, then keep a Python daemon running beside the Go desktop shell. Self-hosters ship a large container with a Python runtime the workload does not need. Maintainers work across two languages and two toolchains for one product, and 27 known audit findings sit unremediated in a backend that is scheduled for replacement — fixing them twice would waste the first pass.

## Solution

The backend is reimplemented in Go behind frozen external contracts: identical REST and MCP surfaces, identical database schema, identical hash-chain format. Existing ledger files open unchanged and verify. The rewrite absorbs the 27 open backend audit findings at their modules instead of patching the frozen Python implementation. Desktop becomes one static binary; self-host becomes a small image. Parity is proven continuously by a golden-fixture harness that replays Python-reference outputs against the Go implementation, with known defects registered as expected divergences and fixed test-first in Go.

## User Stories

Adoption and distribution

1. As a one-person-company boss, I want to install the desktop app as a single file, so that I can start bookkeeping in minutes without installing Python or any runtime.
2. As a desktop user, I want the backend to run without any installed runtime and with a small memory footprint, so that the app works comfortably on modest hardware.
3. As a desktop user, I want my existing ledger file to open in the Go version with the hash chain verifying, so that I trust the migration did not touch my books.
4. As a self-hoster, I want a small single-binary container against standard PostgreSQL, so that hosting costs and attack surface stay low.
5. As a self-hoster upgrading from a released version, I want schema migrations to run forward from my old database, so that upgrades never require rebuilding books.

Compatibility for everyone already using the system

6. As a Monolith frontend user, I want every `/api/v1` route and response shape unchanged, so that the frontend works without modification.
7. As an external MCP agent, I want the same `/mcp/<role>` endpoints, tool names and input schemas, so that my integrations keep working.
8. As an MCP client user, I want connect, propose, query and revoke-after-reject flows to behave identically, so that I cannot tell the backend was replaced.
9. As an auditor, I want the audit trail and hash chain to continue byte-identically across the cutover, so that pre-migration history still verifies as one chain.

Controls preserved, findings fixed

10. As the product owner, I want every accounting invariant (balance, period locks, maker-checker, agent-never-approves) reimplemented and pinned by tests, so that the rewrite weakens nothing.
11. As an agent, I want human-only tools to reject my credentials, so that the boundary the audit verified stays closed (O2-g).
12. As the second human user of a company, I want maker-checker to return automatically the moment I become active, with bill recording, approval and payment segregated for every non-solo company (BL-31), so that solo-mode self-approval cannot outlive its justification.
13. As a boss in solo mode (一人公司模式), I want my self-approvals recorded and flagged, so that my year-end audit pack still explains them.
14. As an accountant, I want management reports on custom periods (read-only projections that never bypass period locks) and financial reports on monthly/quarterly/semi-annual/annual periods anchored to fiscal periods, with "annual" meaning the entity's fiscal year, so that statements reconcile with filings (BL-14).
15. As an accountant, I want unmapped statement categories to block reporting instead of silently disappearing (BL-13), cash flows to classify only cash legs (BL-12, BL-18), and reversals to preserve both periods (BL-17).
16. As an accountant, I want the voucher lifecycle to reject duplicate bills (BL-32), support voiding (BL-33), accept document dates (BL-34), recalculate AR aging (BL-35), guarantee unique voucher numbers with gap reporting (BL-36), and stop implicit counterparty creation (BL-30).
17. As an accountant, I want bank exception handling to match instead of double-settle (BL-09), control-account postings to respect subledgers (BL-10), depreciation to require acquisition (BL-11), provision inputs to freeze after posting (BL-21), and tax-identifier checks to mean more than string length (BL-22).
18. As an accountant in an unsupported jurisdiction, I want tax calculation to fail closed, so that no fabricated credit is ever reported (BL-20 interim rule until REQ-0014).
19. As a bookkeeper, I want duplicate document uploads to be detected as one economic event, so that nothing double-posts (BL-05).
20. As an AP clerk, I want role-scoped responses on every projection, so that I cannot read bank or equity details outside my position (BL-07).
21. As a preparer, I want evidence ownership and active-evidence checks enforced, so that nobody can attach to or submit my voucher with a detached attachment (BL-08).
22. As a reviewer, I want one reviewer-authorization policy across REST and MCP, so that no entrance is looser than another (BL-06).
23. As a user entering amounts, I want exact decimal end to end, so that no stored value ever differs from what I typed (BL-27).
24. As a user relying on backups, I want database and evidence files backed up together and restorable (BL-23), and the desktop backup to include the SQLite WAL state.
25. As an integration sending regional ingress, I want idempotency receipts per principal/entity/payload, so that a timeout retried with the same key never posts twice (BL-28).
26. As an operator, I want durable events committed with accounting commands and retried per subscriber, so that delivery failures never masquerade as dispatched (BL-24, BL-26).

Maintainer and process

27. As a contributor, I want one language, `go build/test/vet` and embedded migrations, so that setup is a single toolchain install.
28. As CI, I want the same test suite to run against SQLite and PostgreSQL, so that adapter drift is caught before merge.
29. As the product owner, I want phase gates with recorded evidence and the ability to stop at any phase, so that a stalled migration never degrades the running system.
30. As the desktop shell, I want to health-check (and eventually embed) one Go binary, so that the daemon sidecar disappears.

## Implementation Decisions

Plan and process (from ADR-0002, accepted):

- Phases P0–P6 with hard gates; the Python backend is frozen (security fixes only) and remains the golden-reference generator until P6 removal. P6 removal is destructive and needs owner confirmation at cutover.
- External contracts are frozen: REST paths and response shapes, MCP endpoints/tools/schemas, database schema, hash-chain canonicalization. Golden parity is the safety net; the 27 open findings are expected divergences excluded from the golden baseline and fixed test-first in Go at their phase (ADR-0002 §3.1).
- Prerequisite decisions applied: BL-14 period semantics (SRC-0027, confirmed 2026-10-30), solo mode by human-principal count with UI name 一人公司模式 — jurisdiction packs may only tighten its qualification, never relax it (SRC-0028, confirmed 2026-10-30), BL-36 neutral numbering default until jurisdiction packs.

Technology (ADR-0002 D4):

- Technology choices are recorded in [ADR-0002 D4](../../03-planning/adr-0002-backend-golang-migration.md). The spec's promises rest on three of them: exact decimals with an explicit rounding mode at every rounding site, no ORM (hand-written SQL per adapter, so transaction boundaries stay visible), and a pure-Go SQLite driver so the desktop binary cross-compiles without cgo.

Structure (ADR-0002 D5; details in [design.md](design.md)):

- The Go tree mirrors the Python modules: pure domain rules (no I/O) behind a store seam with two adapters (pgx, sqlite), an MCP server layer per position, a REST/SSE layer, an events layer (outbox), and the golden-fixture harness. Composition lives in one command; behaviour lives in packages.
- Money is TEXT on SQLite and NUMERIC on PostgreSQL, parsed to exact decimals at the store boundary; floats never appear in a money path.
- The store adapter owns transactional posting (journal status, lines, approvals, sealing, chain append in one transaction), Postgres RLS `SET LOCAL` scoping, and SQLite WAL/busy-timeout discipline.

Absorbed findings:

- Each open finding maps to exactly one phase (ADR-0002 §3.1); its fix is verified by a Go regression test linked from the review checklist. BL-20 gets a fail-closed interim rule; the real tax engine stays with REQ-0014. Frontend findings BL-15/16/19 are explicitly outside this requirement.
- Legacy pinned as-is: the principal-attached auto-approve depth thresholds and confidence gating in the current SoD guard survive the migration unchanged, with fixtures labelling them legacy pending REQ-0007 (which moves them to versioned policies per ADR-0001 D4). Golden parity is not control endorsement.

## Testing Decisions

Good tests assert only observable behaviour at a seam: outputs callers can see (HTTP responses, MCP tool results, stored-and-reloaded state, chain verification), never internal structure. Expected values come from the Python reference (golden files) or worked accounting examples, not from re-reading the Go implementation.

Seams (the review point this spec most needs confirmed):

1. **Golden-fixture harness** — the primary seam. The Python reference emits input/output fixtures per domain module; Go tests replay inputs and must match outputs byte-for-byte, except registered expected divergences — which map one-to-one to SRC-0026 finding IDs, each scoped to that finding's reproduction scenario; invariant and counterexample tests are never exempt. One seam covers all pure-domain parity.
2. **HTTP surface** — contract tests drive real REST/SSE handlers with real credentials; MCP tests use a go-sdk client against real mounted role servers, cross-checked against the Python server where feasible. The frozen contract is the seam, so no new seam is invented.
3. **Store seam** — one repository interface with two adapters (pgx, sqlite); the identical suite runs against both. The dual-adapter mandate (ADR-0001 §6) is what makes this seam real rather than hypothetical.
4. **Whole-app parity** — seeded scenarios run through both implementations; report packs and chain heads must match. Used at phase gates and P6 acceptance.

Prior art: the Python suite (300 tests, verified 2026-10-30) is the behavioural baseline to port; the Monolith `node --test` suite shows the harness style; the control matrix counterexamples (split amounts, replay, privilege escalation, hidden instructions) are reused as invariant tests.

## Accounting Controls Affected

All invariants in [engineering-workflow §3](../../00-rules/engineering-workflow.md#3-accounting-invariants) are reimplemented, not relaxed: balance in exact decimals, immutability of posted entries, period locks with document/accounting date separation, maker-checker with the solo-mode exception, agents never approve, idempotent commands, hash chain and audit trail continuity, agents reach only domain MCP tools. Control matrix controls affected: C04 periods and dates (BL-14), C05 control accounts and subledgers (BL-10), C06 idempotency (BL-28), C07 atomicity including outbox (BL-24, BL-26), C08 authorization and human-only approval (BL-06, BL-31, solo mode), C09 evidence (BL-05, BL-08), C10 corrections (BL-17), C11 settlement (BL-09). The counterexample suites in [accounting-control-matrix.md](../../03-planning/accounting-control-matrix.md) rerun on the Go implementation at each phase gate.

## Out of Scope

- OAuth 2.1 for MCP (ADR-0001 D2, REQ-0003) — not yet implemented anywhere; unaffected by the migration.
- Multi-tenant RLS rollout (ADR-0001 D3, REQ-0023) beyond preserving the `SET LOCAL` mechanism.
- The moejs plugin system (REQ-0036), jurisdiction rule packs (REQ-0014 onward), marketplace distribution (REQ-0034).
- Frontend findings BL-15, BL-16, BL-19.
- Any new product feature; this requirement changes implementation language, not behaviour (except where a finding demands a fix).
- The `backend-go/` → `backend/` rename decision at P6 cutover. The AGENTS.md and docs command switch itself is P6 migration work (ADR-0002 §3), not deferred.

## Open Questions

None blocking. All prerequisite owner decisions were settled 2026-10-24..30 (SRC-0027, SRC-0028). Remaining owner touches are process gates: approve this spec, then per-phase evidence review, then P6 cutover confirmation.
