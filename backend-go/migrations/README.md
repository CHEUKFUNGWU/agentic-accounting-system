# Migrations

goose SQL migration files, embedded into the binary with `go:embed`
(ADR-0002 D4, revising ADR-0001 D6 item 4). No SQL is read from disk at
runtime.

The migration history lines up with the frozen Python reference: an
old-schema database upgrades forward in place (P2 gate), and existing
ledger files open unchanged (D2). The authoritative end state is the shape
a fresh Python `create_all` + `_ensure_columns` produces today — dumped
byte-for-byte from `backend-go/fixtures/chainparity/python_ledger.db`, the
same file the chainparity tests use as oracle. `database/schema.sql` has
drifted from the implemented system and is NOT the oracle.

## Layout

One shared history per dialect, in goose's dialect-directory convention:

```
migrations/
  sqlite3/   0001..0007, dialected for modernc.org/sqlite
  postgres/  0001..0007, dialected for pgx/v5 (SERIAL, TIMESTAMP WITH TIME ZONE)
  embed.go   //go:embed sqlite3 postgres + SQLiteFS()/PostgresFS() root helpers
```

goose's `Provider` globs the root of the `fs.FS` it is given, so root it at
the dialect directory (`fs.Sub`) — do not pass `migrations.FS` directly:

```go
sqlFS, err := migrations.SQLiteFS() // or migrations.PostgresFS()
provider, err := goose.NewProvider(goose.DialectSQLite3, db, sqlFS)
```

## History

| Version | File | Mirrors (backend/app/core/db.py `_ensure_columns`) |
| --- | --- | --- |
| 0001 | `legacy_baseline` | The pre-rename schema: `etb_accounts` with `wp_ref`/`aje_debit`/`aje_credit`, `pack_status` on entities, `wp_ref` in `journal_lines`/`custom_aje_log`, `default_wp_ref` on `chart_of_accounts`, `journal_entries` without the voucher/revision columns. Derived by inverting the rename map against the model DDL. |
| 0002 | `rename_etb_accounts_table` | `etb_accounts` → `trial_balance_accounts` table rename. |
| 0003 | `rename_wp_ref_columns` | `wp_ref` → `statement_ref` (trial balance, journal lines, custom AJE log), `aje_debit`/`aje_credit` → `adjustment_debit`/`adjustment_credit`, `default_wp_ref` → `default_statement_ref`. |
| 0004 | `rename_pack_status_column` | `entities.pack_status` → `reporting_status`. |
| 0005 | `rewrite_reporting_status_values` | `CPA_SIGNED_LOCKED` → `REVIEWED_AND_LOCKED`, `READY_FOR_CPA` → `READY`. Down is a documented NO OP (lossy rewrite; reversing would fabricate pack history). |
| 0006 | `journal_entries_additive_columns` | The `wanted` additive list: `revision` (NOT NULL DEFAULT 0) then the voucher fields, plus the three indexes a fresh `create_all` declares on them. On PostgreSQL `revision` uses `ADD COLUMN IF NOT EXISTS`, mirroring the reference's only PG migration. |
| 0007 | `command_receipts` | **NEW behaviour** (BL-28 idempotency receipts): no Python schema holds it, so it sits outside the 0001..0006 fixture-equality surface and is asserted separately. `receipt_key` PRIMARY KEY carries the insert-if-absent contract; no FK (a receipt must outlive its principal) and no CHECK tying the key to its parts (SQLite's `INSERT OR IGNORE` would turn a CHECK violation into false idempotency). |

### Reconciliation decisions

0001..0006 end where a fresh Python database is, which the hand-written
`_ensure_columns` alone does not guarantee; 0007 then adds the one
new-behaviour table on top. Three deliberate differences within the parity
surface:

1. **Index names after the table rename.** The reference renames the table
   but leaves `ix_etb_accounts_*` behind (SQLite indexes follow the table but
   keep their names). 0002 recreates them as `ix_trial_balance_accounts_*`
   (PostgreSQL uses `ALTER INDEX ... RENAME TO`), so a legacy-upgraded
   database matches the fixture.
2. **Indexes on the additive columns.** The reference adds columns only;
   `voucher_no`, `period` and `entry_layer` carry `index=True` on the models,
   so a fresh `create_all` has these indexes but a legacy-upgraded database
   did not. 0006 creates them.
3. **Renames on PostgreSQL.** The reference's rename steps are SQLite-only
   (`_ensure_columns` returns after the PG `revision` backfill), so a legacy
   PG database could not be opened by current Python code at all. The goose
   set ports the same rename steps to PostgreSQL so both dialects share one
   history and legacy PG shapes upgrade in place.
4. **`prev_entry_hash` width on PostgreSQL: 80, not the model's 64.** The
   reference's genesis marker (`GENESIS_BLOCK_` + 58 zeros,
   `sod_guard.py:228` / `repository.py:780`) is 72 characters — 8 wider
   than `db.py`'s `String(64)`. Latent in the reference: SQLite enforces no
   column width and the reference never ran its posting path on PostgreSQL.
   The SQLite dialect keeps `VARCHAR(64)` byte-identical to the fixture
   (SQLite enforces nothing); the PostgreSQL dialect widens the column so
   the first block of an entity chain — the reference's own frozen chain
   bytes — fits (80 gives headroom over the exact 72). Owner ratification
   noted in the P2 evidence record. (An earlier draft of this note said 65;
   the measured constant is 72 in both codebases.)

### Fresh-path note

0001 creates `journal_entries` without the additive columns; 0006 appends
them at the end of the column list. Column ORDER inside `journal_entries`
therefore differs from the fixture (where `create_all` placed `revision`
second). Names, types and constraints match; schema comparison is
order-insensitive by design.

## Adoption of an existing Python ledger

A Python-created ledger has no `goose_db_version` table. Recommended
procedure for the store layer on first open:

1. If the database has NO `entities` table, it is a fresh file — just run
   `provider.Up` (applies 0001..0007).
2. If `entities` exists but `goose_db_version` does not, the file predates
   goose. Determine its shape from the same checks `_ensure_columns` uses,
   then **stamp the matching version N as applied (per step 3) and run `Up`**
   — running `UpTo(N)` instead would re-run 0001's bare `CREATE TABLE`s over
   the existing tables, which fails. The store adapters implement exactly
   this (internal/core/store/*/migrate.go):
   - `journal_entries.voucher_no` present but `revision` absent → no clean
     checkpoint matches (the b7d198c era, 2026-10-17..21): refuse with the
     "shape matches no known checkpoint" message; this shape must be brought
     forward by the frozen Python backend first, per the note below.
   - `etb_accounts` present (and `trial_balance_accounts` absent) → stamp 1.
   - `trial_balance_accounts.wp_ref` present → stamp 2.
   - `entities.pack_status` present → stamp 3.
   - `journal_entries.revision` missing → stamp 5.
   - none of the above (already at the current Python shape) → stamp 6.
3. **Stamping**: create the version table exactly as goose does and insert
   version 0 (goose's own baseline marker — it inserts `(0, 1)` when it
   creates the table, and the SQLite dialect's table-existence fallback
   probes that row) plus the six Python-parity versions as applied, then
   `Up` — which applies exactly 0007, giving the adopted ledger the
   command_receipts table the Go backend needs for BL-28 while leaving the
   Python schema otherwise untouched:

   ```sql
   CREATE TABLE goose_db_version (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       version_id INTEGER NOT NULL,
       is_applied INTEGER NOT NULL,
       tstamp TIMESTAMP DEFAULT (datetime('now'))
   );
   INSERT INTO goose_db_version (version_id, is_applied) VALUES
       (0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1);
   ```

   (PostgreSQL: `id SERIAL PRIMARY KEY`, `is_applied BOOLEAN NOT NULL`,
   `tstamp TIMESTAMP NOT NULL DEFAULT now()`.)

   Do NOT stamp through 0007: a Python-created ledger has no receipts
   table, so stamping it as applied would silently break receipt
   idempotency. Stamp to 0006 and let `Up` create the table.

   The tests demonstrate this on a copy of the real Python fixture: after
   stamping, `Up` applies exactly 0007 and the Python surface of the schema
   is untouched.

A database whose shape matches none of the checkpoints above cleanly (for
example the very first 3901e59-era install without `block_index`/`posted_at`
on `journal_entries`) should be opened once with the frozen Python backend so
`init_db` brings it to the current shape, then stamped as in (3).

## Tests

`migrations_test.go` (SQLite, unconditional): fresh path applies 0001..0006
and must equal the fixture schema (tables, columns, types, defaults, PK/FK,
CHECK, indexes — order-insensitive); 0007 is covered by its own test (full Up
ends at version 7 with the fixture surface intact and the receipts table
present and unique-keyed); legacy path applies 0001 only, inserts
pre-rename rows, then upgrades and asserts data survival, `revision = 0`, the
status rewrite, the receipts table and final schema equality; direction
sanity walks `DownTo(5)`→`Up` and a full `DownTo(0)`→`Up`; adoption stamps a
fixture copy at version 6 and asserts `Up` applies exactly 0007.
`pg_test.go` mirrors the legacy upgrade on PostgreSQL, gated on
`AAS_TEST_PG_DSN` like `internal/core/store/pgx/pgx_test.go` (skipped when
unset; runs inside a dedicated temp schema and drops it afterwards).
