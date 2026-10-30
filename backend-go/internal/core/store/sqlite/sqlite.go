// Package sqlite is the SQLite store adapter (modernc.org/sqlite, pure Go,
// no cgo — required for cross-compiled desktop binaries, ADR-0002 D4).
//
// P0 proves driver init and the WAL discipline pragmas. The Store
// implementation arrives in P2, porting the SQLite discipline of the frozen
// reference (backend/app/core/db.py): money stored as TEXT and parsed as
// exact decimal, never float; WAL mode with busy_timeout; writes serialized
// through the command service; PRAGMA integrity_check on open; backup tools
// checkpoint or copy the -wal file alongside the database (BL-23).
package sqlite

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// busyTimeoutMs keeps concurrent writers waiting instead of failing fast,
// matching the reference discipline. It rides in the DSN so every pooled
// connection gets it: pragmas set with Exec reach only the one connection
// that ran them.
const busyTimeoutMs = 5000

// Open opens the database file and applies the reference pragmas on every
// connection via DSN parameters (busy_timeout, WAL journal mode), then runs
// integrity_check on open. P0 scope only — migrations and the Store
// behaviour arrive in P2.
func Open(path string) (*sql.DB, error) {
	// _pragma parameters are a modernc driver feature applied per connection.
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(%d)&_pragma=journal_mode(WAL)", path, busyTimeoutMs)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sqlite: open %s: %w", path, err)
	}
	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		db.Close()
		return nil, fmt.Errorf("sqlite: integrity_check: %w", err)
	}
	if integrity != "ok" {
		db.Close()
		return nil, fmt.Errorf("sqlite: integrity_check reported %q", integrity)
	}
	return db, nil
}
