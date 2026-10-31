# REQ-0035 codebase design: backend-go

Written with the codebase-design skill. Vocabulary: **module** (interface + implementation), **interface** (everything a caller must know), **seam** (where an interface lives), **adapter** (concrete thing satisfying an interface at a seam), **depth** (behaviour per unit of interface). The directory skeleton conforms to [ADR-0002 D5](../../03-planning/adr-0002-backend-golang-migration.md)'s mirror layout (`internal/core`, `internal/mcpserver`, `internal/mcproles`, `internal/api`, `internal/orchestrator`, top-level `migrations/`); `internal/fixture` and `cmd/aasd` are additions with no Python mirror (harness tooling and the binary entry). This document designs the interfaces inside that skeleton. Finding-fix phases cited per module are the §3.1 mapping of record.

## Design rules for this codebase

1. **The frozen contracts are the external seams.** REST, MCP, schema, chain format (ADR-0002 D2). We add no new external seams; we inherit four.
2. **Two adapters or no seam.** The only storage seam is real because two databases are mandated (ADR-0001 §6). Nowhere else do we speculate a second adapter.
3. **Pure domain, deep store.** Accounting rules are pure functions (maximum leverage for the golden harness); everything with I/O hides behind the store seam.
4. **The composition root knows everything; packages know their neighbours.** Wiring lives in one command; no package reaches across layers.
5. **Only store adapters own transactions.** No layer outside `core/store` opens or holds a transaction; the outbox row is enlisted by the adapter inside the command transaction (single write path, ADR-0001 D1).

## Module map

```
backend-go/
├── cmd/aasd/             composition root: config, wiring, lifespan
├── migrations/           goose SQL migrations, embedded into the binary
├── fixtures/             golden fixtures + divergences.yaml (harness data)
├── tools/                gen_fixtures.py and other backend-go tooling
└── internal/
    ├── core/             mirrors backend/app/core/
    │   ├── money/        exact-decimal value type + serialization parity
    │   ├── chain/        hash-chain canonicalization, append, verify
    │   ├── domain/       pure accounting rules, no I/O
    │   │   ├── voucher/     voucher state machine + numbering (BL-36; P1)
    │   │   ├── posting/     posting transition + invariants
    │   │   │               (BL-01..04, 25 already fixed in Python; ported; P1)
    │   │   ├── ledger/      chart, fiscal periods, carry-forward (BL-14, 30; P1)
    │   │   ├── positions/   positions, SoD, solo mode (SRC-0028; P1 rules)
    │   │   ├── workflow/    Monolith money workflows: bills, bank, assets,
    │   │   │               provisions (BL-09,10,11,21,32,33,34,35; P1)
    │   │   ├── reporting/   three statements, period anchoring, cash
    │   │   │               classification, fail-closed tax (BL-12,13,17,18,20; P1)
    │   │   └── localization/ locale + tax-identifier validation (BL-22; P1)
    │   └── store/        the Store seam
    │       ├── store.go  the interface (below)
    │       ├── pgx/      PostgreSQL adapter (RLS SET LOCAL, NUMERIC)
    │       ├── sqlite/   SQLite adapter (WAL, TEXT money, backup incl. -wal)
    │       └── backup.go DB-and-evidence backup/restore (BL-23; P2)
    ├── mcpserver/        tool implementations, mirrors mcp_server.py
    ├── mcproles/         per-position servers, visibility, credentials,
    │                     per-call audit (BL-06,07,08,31; P4)
    ├── api/              REST/SSE adapters over core+store
    ├── orchestrator/     durable outbox, dispatch, per-subscriber retry
    │                     (BL-24,26; P5)
    └── fixture/          golden harness + expected-divergence registry
```

Migrations are embedded; no SQL files are read from disk at runtime. (`fixtures/` and `tools/` were added to this map during P0 review: the work order's deliverable 2 — golden fixtures and divergences.yaml — needs a recorded home, and the generator with it.)

## Interfaces

### money — the deepest module in the system

```go
type Money struct{ /* wrapped shopspring/decimal; zero floating-point paths */ }
func Parse(s string) (Money, error)        // accepts Python Decimal str forms only
func (m Money) String() string             // byte-identical to Python str(Decimal)
func (m Money) Add(o Money) Money
func (m Money) Round(places int32, mode RoundingMode) (Money, error)
                                           // mode always explicit; the error mirrors
                                           // decimal.InvalidOperation from quantize
```

The core is four methods (plus the value-type necessities the parity rules force: `Sub`, `Neg`, comparisons, JSON marshal/unmarshal as string or `json.Number`, never `float64`); the implementation carries every parity rule (Python `Decimal.__str__` compatibility, SQLite TEXT round-trip, JSON serialization, rounding-mode mapping). `Round` returns an error because Python's quantize raises `InvalidOperation` when the result exceeds context precision — a silent default would hide money corruption. **Deletion test**: remove it and float drift plus format mismatches reappear at every one of the 345 decimal touchpoints — the deepest leverage in the codebase. Callers never import shopspring directly; a lint rule enforces it.

### chain

```go
func Append(st Store, entry ChainEntry) (Sealed, error)  // canonical bytes → SHA-256 → parent link
func Verify(st Store, from Index) (ChainReport, error)
```

Canonical serialization and hashing live entirely inside; the byte format is frozen to whatever the Python implementation emits (ADR-0002 D2). If the Python format ever surprises us, we stop and reconcile — never recompute history.

### domain — pure functions

Interface = exported functions over value types (`Voucher`, `Period`, `Chart`, `PostedEntry`…). No stores, no clocks, no randomness passed implicitly; time and sequencing arrive as arguments. This is what makes the golden harness one seam: fixtures are `(input values) → (output values)`. Each finding fix lands here (or at its enforcement layer, per the §3.1 phase) as a failing fixture first (ADR-0002 D3), so the harness doubles as the findings checklist.

### store — one real seam, two adapters

Delivered at P2 (commit 636bb2a); this section is the record of the as-built
interface, reshaped from the P0 sketch below with reasons.

```go
type Store interface {
    Migrate(ctx context.Context) error            // goose set + adoption
    Close() error

    Entity(ctx, code) (Entity, error)             // with the RLS tenant hook
    Chart(ctx, entityCode) ([]ledger.Account, error)
    Periods(ctx, entityCode) ([]ledger.Period, error)

    SaveJournal(ctx, SaveJournalCommand) (SaveJournalResult, error)  // revision-guarded upsert
    PostVoucher(ctx, PostVoucherCommand) (PostResult, error)         // the 15-step sequence in one tx
    Journal(ctx, journalID) (voucher.Snapshot, error)
    Journals(ctx, JournalsQuery) ([]voucher.Snapshot, error)
    LedgerLines(ctx, LedgerLinesQuery) ([]voucher.LedgerLine, error)

    ClaimDocument(ctx, ClaimDocumentCommand) (Document, error)       // BL-05 atomic
    ClaimDocumentForVoucher(ctx, ClaimDocumentForVoucherCommand) (Document, error)  // BL-05: claim+draft+link in one tx
    Documents(ctx, DocumentsQuery) ([]Document, error)
    Document(ctx, documentID) (Document, error)
    VoidDocument(ctx, VoidDocumentCommand) error

    PutReceipt(ctx, PutReceiptCommand) (Receipt, bool, error)        // BL-28 insert-if-absent
    Receipt(ctx, ReceiptKey) (Receipt, error)

    AppendAudit(ctx, AuditRecord) error            // append-only trail
    AuditLogs(ctx, AuditQuery) ([]AuditRecord, error)
    VerifyChain(ctx, entityCode) (positions.ChainReport, error)      // read-only recompute
    Backup(ctx, targetDir) (BackupReport, error)  // BL-23 (sqlite; PG = operator pg_dump)
    Restore(ctx, BackupRef, RestoreTarget) (RestoreReport, error)
}
```

Why it moved from the sketch (recorded here because design.md is the
interface authority, per the work order):

- **Reversal and review are not store commands.** Both are the pure posting
  sequence's outputs (a reversal posting builds reversal lines and marks the
  original via `plan.Original`; review states are plain SaveJournal
  transitions the reference's save_journal already performs). Inventing
  ReverseVoucher/Review commands would have duplicated the domain's decision
  logic inside the adapters — the opposite of rule 3.
- **VoucherView/LedgerView became the wire forms.** The MCP/REST layers need
  the reference's journal-dict and ledger-line shapes, not projections of
  them; `voucher.Snapshot` and `voucher.LedgerLine` ARE the frozen wire
  forms, so queries return those and no second shape exists to keep in sync.
- **chain.ChainStore dissolved into VerifyChain.** The chain is never
  appended by a separate command — the seal writes the hash fields inside
  the posting transaction — so the embedded sub-interface had one real
  method left, verification, which reads the persisted bytes and recomputes.

Small on purpose still holds: every command is one transaction, so the
interface the MCP and REST layers learn is the interface the invariants
protect. The adapters own: transaction boundaries (and only they open
transactions), Postgres `SELECT ... FOR UPDATE` entity locks + the
`set_config('app.tenant_id', ..., true)` RLS hook, SQLite
WAL/busy-timeout/integrity pragmas + BEGIN IMMEDIATE, TEXT/VARCHAR money
crossing byte-identical (the effective schema stores decimal strings on both
dialects), migration application and adoption, and backup/restore with
evidence files (BL-23). **Internal seam**: SQL construction stays private
per adapter; no query builder leaks into callers.

### mcpserver + mcproles — tools and their per-position wall

```go
// mcpserver: one implementation per tool, shared by all positions.
// mcproles:
func Mount(mux *chi.Mux, deps Dependencies)  // one streamable-HTTP server per position at /mcp/<role>
```

Everything an agent can touch hides behind this mount: tool visibility per position, `aas1.` credential resolution, the human-only tool wall (O2-g), audit write on every `tools/call`, structured error codes with next steps. The unified reviewer-authorization policy (BL-06), scoped projections (BL-07), evidence ownership checks (BL-08) and non-solo segregation (BL-31) land here in P4. The go-sdk handler is an adapter at the transport seam; the tool registry and policies are the implementation.

### api — thin adapters, deliberately

REST/SSE handlers translate HTTP ↔ domain+store and add nothing: no policy, no computation. Shallow is correct here — the depth belongs to the modules beneath. Contract tests at this seam keep the translation honest.

### orchestrator — outbox first

```go
type Outbox interface {
    Enqueue(cmdID CommandID, e Event) error  // enlisted by the store adapter inside the command transaction (BL-26)
    Dispatch(ctx context.Context)            // per-subscriber retry state (BL-24)
}
```

Durable-then-dispatch; the in-process orchestrator becomes a dispatcher over the outbox rather than the source of truth. Transaction ownership stays with the store adapters (design rule 5).

### fixture — the parity seam

```go
func Run(t *testing.T, module string)  // loads fixtures/<module>/*.json, replays, compares
```

Owns the expected-divergence registry (`divergences.yaml`). The registry is bounded: entries map one-to-one to SRC-0026 finding IDs, and each entry excludes only that finding's registered reproduction scenario — never a module, never a control. Engineering-workflow §3 invariant tests and control-matrix counterexamples are never divergence-eligible. A fixture that diverges without a registration fails; a registration without a passing Go regression test fails CI. This makes "fixed in Go, never double-fixed in Python" mechanical.

## Seam table

| Seam | Interface lives at | Adapters | Real because |
| --- | --- | --- | --- |
| HTTP/MCP transport | `api` handlers, `mcproles.Mount` | chi router, go-sdk streamable handler | Frozen external contract (D2); exercised by real clients and contract tests |
| Storage | `core/store.Store` | pgx, sqlite | Two databases mandated (ADR-0001 §6) |
| Parity | `fixture.Run` | Python reference vs Go | The safety net ADR-0002 D3 requires |
| Domain functions | exported pure functions | (none — no seam needed) | Purity is the point; the harness is their test surface |

## What we rejected

- **One god interface** (`System.Interface{}`) — shallow, everything visible, invariants unenforceable.
- **An ORM** — hides transaction boundaries and the NUMERIC/TEXT discipline; hand-written SQL per adapter instead (ADR-0002 D4).
- **Per-layer interfaces everywhere** (repository-per-entity, service-per-verb) — the Python tree already shows that drift; the store interface above is the whole persistence surface.
- **Wrapping the go-sdk or chi behind custom abstractions** — one adapter each; a wrapper would be a pass-through failing the deletion test.
- **A directory layout of our own invention** — rejected in review: the first draft split `core/` into top-level `money/chain/domain/store` packages and renamed `mcproles`/`orchestrator`; it contradicted ADR-0002 D5's decided mirror. The design above conforms; the deep-module boundaries live as packages under `core/`.

## Depth checklist (review against this)

- `money`: 4 methods, 345 touchpoints of leverage. Deepest.
- `store.Store`: ~11 methods carrying all persistence semantics. Deep.
- `chain`: 2 methods, frozen-format complexity hidden. Deep.
- `domain`: pure functions; leverage comes from testability, not hiding.
- `api`: intentionally shallow adapters. Correct shallow.
