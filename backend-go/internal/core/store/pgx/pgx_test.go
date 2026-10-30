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
	if err := Ping(ctx, db); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
