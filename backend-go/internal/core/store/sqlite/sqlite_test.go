package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// TestOpenAppliesReferencePragmas pins the P0 driver skeleton: the WAL
// discipline of the frozen reference applies on open (backend/app/core/db.py)
// and holds on every pooled connection, not just the first.
func TestOpenAppliesReferencePragmas(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(2)

	// Force two separate pooled connections and assert the pragmas on both:
	// busy_timeout is per-connection, and the first draft only set it on one
	// (review P2-2).
	for i := 0; i < 2; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		conn, err := db.Conn(ctx)
		if err != nil {
			t.Fatalf("connection %d: %v", i, err)
		}
		var mode, integrity string
		var timeout int
		if err := conn.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil {
			t.Fatalf("connection %d journal_mode: %v", i, err)
		}
		if mode != "wal" {
			t.Fatalf("connection %d journal_mode = %q, want wal", i, mode)
		}
		if err := conn.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&timeout); err != nil {
			t.Fatalf("connection %d busy_timeout: %v", i, err)
		}
		if timeout != busyTimeoutMs {
			t.Fatalf("connection %d busy_timeout = %d, want %d", i, timeout, busyTimeoutMs)
		}
		if err := conn.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
			t.Fatalf("connection %d integrity_check: %v", i, err)
		}
		if integrity != "ok" {
			t.Fatalf("connection %d integrity_check = %q, want ok", i, integrity)
		}
		conn.Close()
		cancel()
	}
}
