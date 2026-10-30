package sqlite

import (
	"path/filepath"
	"testing"
)

// TestOpenAppliesReferencePragmas pins the P0 driver skeleton: the WAL
// discipline of the frozen reference applies on open (backend/app/core/db.py).
func TestOpenAppliesReferencePragmas(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	var mode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}

	var timeout int
	if err := db.QueryRow("PRAGMA busy_timeout").Scan(&timeout); err != nil {
		t.Fatalf("busy_timeout: %v", err)
	}
	if timeout != busyTimeoutMs {
		t.Fatalf("busy_timeout = %d, want %d", timeout, busyTimeoutMs)
	}

	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		t.Fatalf("integrity_check: %v", err)
	}
	if integrity != "ok" {
		t.Fatalf("integrity_check = %q, want ok", integrity)
	}
}
