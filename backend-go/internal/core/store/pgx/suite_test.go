package pgx

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store/storetest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

// TestPGXStoreSuite runs the shared behavioral suite against the PostgreSQL
// adapter. Gated on AAS_TEST_PG_DSN (skipped when unset), like the
// migrations package's PG tests: the DSN points at a disposable database,
// and every subtest isolates itself in a dedicated temp schema — the
// fresh, disposable storage RunSuite's contract requires (the SQLite
// adapter's equivalent is a per-subtest file) — dropped afterwards.
func TestPGXStoreSuite(t *testing.T) {
	dsn := os.Getenv("AAS_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("AAS_TEST_PG_DSN not set; PostgreSQL half of the dual-DB matrix skipped")
	}

	// One bootstrap pool on the default search_path creates and drops the
	// temp schemas; it outlives every subtest.
	bootstrap, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open bootstrap pool: %v", err)
	}
	t.Cleanup(func() {
		if err := bootstrap.Close(); err != nil {
			t.Errorf("close bootstrap pool: %v", err)
		}
	})

	storetest.RunSuite(t, func(t *testing.T) store.Store {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		schema := fmt.Sprintf("store_p2_test_%d_%d", time.Now().UnixNano(), atomic.AddUint64(&suiteSchemaSeq, 1))
		if _, err := bootstrap.ExecContext(ctx, fmt.Sprintf("CREATE SCHEMA %s", schema)); err != nil {
			t.Fatalf("CREATE SCHEMA: %v", err)
		}
		// Drop the temp schema while the bootstrap pool is still open; the
		// subtest's own pool closes after (cleanups run LIFO), so no
		// committed state of ours outlives the test.
		t.Cleanup(func() {
			cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cleanupCancel()
			if _, err := bootstrap.ExecContext(cleanupCtx, fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)); err != nil {
				t.Errorf("DROP SCHEMA %s: %v", schema, err)
			}
		})

		// A dedicated pool whose connections all route into the subtest's
		// schema via the registered config's search_path.
		cfg, err := pgx.ParseConfig(dsn)
		if err != nil {
			t.Fatalf("pgx.ParseConfig: %v", err)
		}
		cfg.RuntimeParams["search_path"] = schema
		connCfg := stdlib.RegisterConnConfig(cfg)
		dir := t.TempDir()
		st, err := New(connCfg, Options{EvidenceDir: dir + "/attachments"})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		return st
	})
}

// suiteSchemaSeq disambiguates same-nanosecond schema names across subtests.
var suiteSchemaSeq uint64
