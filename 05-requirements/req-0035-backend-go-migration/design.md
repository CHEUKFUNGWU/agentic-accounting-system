# REQ-0035 codebase design: backend-go

Written with the codebase-design skill. Vocabulary: **module** (interface + implementation), **interface** (everything a caller must know), **seam** (where an interface lives), **adapter** (concrete thing satisfying an interface at a seam), **depth** (behaviour per unit of interface). Directory layout was fixed by [ADR-0002 D5](../../03-planning/adr-0002-backend-golang-migration.md); this document designs the interfaces inside it.

## Design rules for this codebase

1. **The frozen contracts are the external seams.** REST, MCP, schema, chain format (ADR-0002 D2). We add no new external seams; we inherit four.
2. **Two adapters or no seam.** The only storage seam is real because two databases are mandated (ADR-0001 §6). Nowhere else do we speculate a second adapter.
3. **Pure domain, deep store.** Accounting rules are pure functions (maximum leverage for the golden harness); everything with I/O hides behind the store interface.
4. **The composition root knows everything; packages know their neighbours.** Wiring lives in one command; no package reaches across layers.

## Module map

```
backend-go/
├── cmd/aasd/            composition root: config, wiring, lifespan
├── internal/
│   ├── money/           exact-decimal value type + serialization parity
│   ├── chain/           hash-chain canonicalization, append, verify
│   ├── domain/          pure accounting rules, no I/O
│   │   ├── voucher/     voucher state machine + validation (BL-08, 36)
│   │   ├── posting/     posting transition + invariants (BL-01..04 already fixed in Python; ported)
│   │   ├── ledger/      chart, fiscal periods, carry-forward (BL-14, 30)
│   │   ├── positions/   positions, SoD, solo mode (SRC-0028)
│   │   ├── workflow/    Monolith money workflows: bills, bank, assets, provisions (BL-09,10,11,21,32,33,34,35)
│   │   ├── reporting/   three statements, period anchoring, cash classification (BL-12,13,17,18,20)
│   │   └── taxid/       identifier validation (BL-22)
│   ├── store/           Store seam
│   │   ├── store.go     the interface (below)
│   │   ├── pgx/         PostgreSQL adapter (RLS SET LOCAL, NUMERIC)
│   │   ├── sqlite/      SQLite adapter (WAL, TEXT money)
│   │   └── migrations/  goose SQL, embedded
│   ├── mcpserver/       role servers, tool registry, per-call audit (BL-06,07,31)
│   ├── api/             REST/SSE adapters over domain+store
│   ├── events/          orchestrator, durable outbox, per-subscriber retry (BL-24,26,28)
│   └── fixture/         golden harness + expected-divergence registry
└── migrations are embedded; no runtime SQL files on disk
```

## Interfaces

### money — the deepest module in the system

```go
type Money struct{ /* wrapped shopspring/decimal; zero floating-point paths */ }
func Parse(s string) (Money, error)        // accepts Python Decimal str forms only
func (m Money) String() string             // byte-identical to Python str(Decimal)
func (m Money) Add(o Money) Money
func (m Money) Round(places int32, mode RoundingMode) Money  // mode always explicit
```

The interface is five methods; the implementation carries every parity rule (Python `Decimal.__str__` compatibility, SQLite TEXT round-trip, JSON serialization, rounding-mode mapping). **Deletion test**: remove it and float drift plus format mismatches reappear at every one of the 345 decimal touchpoints — the deepest leverage in the codebase. Callers never import shopspring directly; a lint rule enforces it.

### chain

```go
func Append(st Store, entry ChainEntry) (Sealed, error)  // canonical bytes → SHA-256 → parent link
func Verify(st Store, from Index) (ChainReport, error)
```

Canonical serialization and hashing live entirely inside; the byte format is frozen to whatever the Python implementation emits (ADR-0002 D2). If the Python format ever surprises us, we stop and reconcile — never recompute history.

### domain — pure functions

Interface = exported functions over value types (`Voucher`, `Period`, `Chart`, `PostedEntry`…). No stores, no clocks, no randomness passed implicitly; time and sequencing arrive as arguments. This is what makes the golden harness one seam: fixtures are `(input values) → (output values)`. Each finding fix lands here as a failing fixture first (ADR-0002 D3), so the harness doubles as the findings checklist.

### store — one real seam, two adapters

```go
type Store interface {
    // Accounting commands — one transaction each: status, lines,
    // approvals, sealing, chain append commit or roll back together.
    PostVoucher(ctx context.Context, cmd PostVoucher) (Posted, error)
    ReverseVoucher(ctx context.Context, cmd ReverseVoucher) (Voucher, error)
    Review(ctx context.Context, cmd Review) (ReviewOutcome, error)  // BL-06 policy lives behind this

    // Evidence — atomic claim + duplicate economic-event detection (BL-05)
    ClaimDocument(ctx context.Context, cmd ClaimDocument) (Claim, error)

    // Queries — projections only; every response is position-scoped (BL-07)
    VoucherView(ctx context.Context, q VoucherQuery) (VoucherView, error)
    LedgerView(ctx context.Context, q LedgerQuery) (LedgerView, error)

    // Chain & audit
    chain.ChainStore  // embedded: append/verify persistence
    Audit
}
```

Small on purpose: commands mirror the domain command service (ADR-0001 D1's single write path), so the interface the MCP and REST layers learn is the interface the invariants protect. The adapters own: transaction boundaries, Postgres `SET LOCAL app.tenant_id` + RLS role, SQLite WAL/busy-timeout/integrity pragmas, NUMERIC↔TEXT money encoding, migration application. **Internal seam**: SQL construction stays private per adapter; no query builder leaks into callers.

### mcpserver — per-position servers

```go
func Mount(mux *chi.Mux, deps Dependencies)  // one streamable-HTTP server per position at /mcp/<role>
```

Everything an agent can touch hides behind this mount: tool visibility per position, `aas1.` credential resolution, the human-only tool wall (O2-g), audit write on every `tools/call`, structured error codes with next steps. The go-sdk handler is an adapter at the transport seam; the tool registry and policies are the implementation.

### api — thin adapters, deliberately

REST/SSE handlers translate HTTP ↔ domain+store and add nothing: no policy, no computation. Shallow is correct here — the depth belongs to the modules beneath. Contract tests at this seam keep the translation honest.

### events — outbox first

```go
type Outbox interface {
    Enqueue(ctx context.Context, within store.Tx, e Event) error  // committed with the command (BL-26)
    Dispatch(ctx context.Context)                                 // per-subscriber retry state (BL-24)
}
```

Durable-then-dispatch; the in-process orchestrator becomes a dispatcher over the outbox rather than the source of truth.

### fixture — the parity seam

```go
func Run(t *testing.T, module string)  // loads fixtures/<module>/*.json, replays, compares
```

Owns the expected-divergence registry (`divergences.yaml`: finding ID → excluded case → tracking). A fixture that diverges without a registration fails; a registration without a passing Go regression test fails CI. This makes "fixed in Go, never double-fixed in Python" mechanical.

## Seam table

| Seam | Interface lives at | Adapters | Real because |
| --- | --- | --- | --- |
| HTTP/MCP transport | `api` handlers, `mcpserver.Mount` | chi router, go-sdk streamable handler | Frozen external contract (D2); exercised by real clients and contract tests |
| Storage | `store.Store` | pgx, sqlite | Two databases mandated (ADR-0001 §6) |
| Parity | `fixture.Run` | Python reference vs Go | The safety net ADR-0002 D3 requires |
| Domain functions | exported pure functions | (none — no seam needed) | Purity is the point; the harness is their test surface |

## What we rejected

- **One god interface** (`System.Interface{}`) — shallow, everything visible, invariants unenforceable.
- **An ORM** — hides transaction boundaries and the NUMERIC/TEXT discipline; hand-written SQL per adapter instead (ADR-0002 D4).
- **Per-layer interfaces everywhere** (repository-per-entity, service-per-verb) — the Python tree already shows that drift; the store interface above is the whole persistence surface.
- **Wrapping the go-sdk or chi behind custom abstractions** — one adapter each; a wrapper would be a pass-through failing the deletion test.

## Depth checklist (review against this)

- `money`: 5 methods, 345 touchpoints of leverage. Deepest.
- `store.Store`: ~10 methods carrying all persistence semantics. Deep.
- `chain`: 2 methods, frozen-format complexity hidden. Deep.
- `domain`: pure functions; leverage comes from testability, not hiding.
- `api`: intentionally shallow adapters. Correct shallow.
