# Migrations

goose SQL migration files land here in P2, embedded into the binary with
`go:embed` (ADR-0002 D4, revising ADR-0001 D6 item 4). No SQL is read from
disk at runtime.

The migration history must line up with `database/schema.sql` and the
existing hand-written migrations of the frozen Python reference: an
old-schema database upgrades forward in place (P2 gate), and existing
ledger files open unchanged (D2).
