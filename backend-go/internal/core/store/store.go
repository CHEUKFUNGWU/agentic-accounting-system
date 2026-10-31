// Package store is the single storage seam for the accounting backend.
//
// Design (REQ-0035 design.md §store): one Store interface with exactly two
// adapters — pgx (PostgreSQL, RLS SET LOCAL, NUMERIC money) and sqlite
// (WAL, TEXT money, backup including the -wal file). Only store adapters
// own transactions: the accounting command transactions (journal status,
// lines, approvals, sealing, chain append commit or roll back together) and
// the durable outbox enlistment (BL-26) are opened and held here and nowhere
// else (design rule 5, ADR-0001 D1 single write path).
//
// P0 ships the skeleton only: adapter driver init and the dual-DB test
// harness wiring. The Store interface and its command/query types are shaped
// in P2 (ADR-0002 §3) when repository/db port, so no speculative types are
// frozen in early.
package store
