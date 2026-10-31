# backend-go

Go reimplementation of the Python backend under `backend/` (REQ-0035,
[ADR-0002](../03-planning/adr-0002-backend-golang-migration.md)). The Python
backend stays the frozen golden reference until P6; external contracts are
frozen (REST `/api/v1`, MCP `/mcp/<role>`, database schema, hash-chain
format). Directory layout follows the ADR-0002 D5 mirror; interfaces are
specified in the [work package design](../05-requirements/req-0035-backend-go-migration/design.md).

## Commands

| Purpose | Command (from `backend-go/`) |
| --- | --- |
| Build | `go build ./...` |
| Vet | `go vet ./...` |
| Test (SQLite half always runs) | `go test ./...` |
| Test both databases | `AAS_TEST_PG_DSN=postgres://localhost/aas_req0035_test?sslmode=disable go test ./...` |
| Formatting check | `gofmt -l .` (must print nothing) |
| Regenerate golden fixtures | `cd ../backend && uv run python ../backend-go/tools/gen_fixtures.py` |

Standards: gofmt-clean, `go vet` clean, no new dependencies without a
recorded reason. `shopspring/decimal` may be imported only inside
`internal/core/money` (enforced by a test).

## Layout

```
cmd/aasd/             composition root (config, wiring, lifespan)
migrations/           goose SQL migrations, embedded (P2)
fixtures/             golden fixtures + divergences.yaml (expected-divergence registry)
internal/
  core/money/         exact-decimal value type; Python Decimal parity rules
  core/chain/         hash chain: canonicalization, append, verify (P2)
  core/domain/        pure accounting rules, no I/O (P1)
    voucher/ posting/ ledger/ positions/ workflow/ reporting/ localization/
  core/store/         the Store seam: interface + pgx and sqlite adapters (P2)
  mcpserver/          MCP tool implementations (P4)
  mcproles/           per-position servers, credential wall, audit (P4)
  api/                REST/SSE adapters (P5)
  orchestrator/       durable outbox + dispatcher (P5)
  fixture/            golden-fixture harness + divergence registry
```

## Golden fixtures

The frozen Python reference generates fixtures; Go tests replay them and must
match the recorded outputs exactly (`internal/fixture`). Comparison runs over
one canonical JSON form on both sides (sorted keys, number tokens preserved,
no HTML escaping), so any value difference fails — `1.500` and `1.5` are
different strings and neither is ever parsed as a float. Known defects from
SRC-0026 are never fixtures: they are expected divergences registered in
`fixtures/divergences.yaml` — one entry per finding, scoped to that finding's
reproduction scenario, each naming a Go regression test, all mechanically
validated. Accounting invariants and control-matrix counterexamples are never
exempt.

## Dual-database matrix

The same suite runs against SQLite and PostgreSQL (ADR-0001 §6). SQLite runs
everywhere; PostgreSQL needs `AAS_TEST_PG_DSN` pointing at a disposable
database. Money is TEXT/VARCHAR on BOTH databases — the effective schema
(`backend/app/core/db.py`) stores exact decimal strings, so they cross the
store byte-identical and parse only at the domain boundary; floats never
appear in a money path.
