package pgx

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestPing runs the PostgreSQL half of the dual-DB matrix (ADR-0001 §6).
// Set AAS_TEST_PG_DSN (e.g. postgres://localhost/aas_req0035_test?sslmode=disable)
// to enable; the SQLite half runs unconditionally.
func TestPing(t *testing.T) {
	dsn := os.Getenv("AAS_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("AAS_TEST_PG_DSN not set; PostgreSQL half of the dual-DB matrix skipped")
	}
	db, err := Open(dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

// TestPgqPlaceholderConversion pins the shared-`?`-to-$n rewriting the PG
// adapter's queries rely on. The rewrite is purely mechanical — EVERY `?`
// becomes a placeholder — so no query string in this adapter may ever carry
// a `?` inside a string literal (there are none today; the adapters use no
// LIKE patterns). This test locks the conversion so a future call-site
// change cannot silently corrupt a literal.
func TestPgqPlaceholderConversion(t *testing.T) {
	cases := []struct{ in, want string }{
		{"SELECT 1", "SELECT 1"},
		{"SELECT * FROM t WHERE a = ?", "SELECT * FROM t WHERE a = $1"},
		{"UPDATE t SET a = ?, b = ? WHERE c = ?", "UPDATE t SET a = $1, b = $2 WHERE c = $3"},
		{"VALUES (?, ?, ?)", "VALUES ($1, $2, $3)"},
	}
	for _, tc := range cases {
		if got := pgq(tc.in); got != tc.want {
			t.Errorf("pgq(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
