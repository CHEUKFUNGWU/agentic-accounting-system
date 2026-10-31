package sqlite

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store/storetest"
)

// TestSQLiteStoreSuite runs the shared behavioral suite against the SQLite
// adapter (ADR-0001 §6's dual-database matrix; the PG half runs in the pgx
// package behind AAS_TEST_PG_DSN).
func TestSQLiteStoreSuite(t *testing.T) {
	storetest.RunSuite(t, func(t *testing.T) store.Store {
		dir := t.TempDir()
		st, err := New(filepath.Join(dir, "ledger.db"), Options{})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		return st
	})
}

// TestChainParityOnPythonFixture opens a copy of the real Python-created
// ledger (backend-go/fixtures/chainparity/python_ledger.db: one POSTED
// voucher, block 1, prev GENESIS), adopts it per migrations/README.md, and
// verifies the hash chain with the pure positions rule. The exact report is
// the P2 chain-parity evidence.
func TestChainParityOnPythonFixture(t *testing.T) {
	s, err := New(fixtureCopy(t), Options{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()
	ctx := context.Background()
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("Migrate (adopt Python ledger): %v", err)
	}
	e, err := s.Entity(ctx, "AU-OPC-01")
	if err != nil {
		t.Fatalf("Entity: %v", err)
	}
	if e.Currency != "AUD" || e.ReportingStatus != "READY" {
		t.Fatalf("adopted entity = %+v", e)
	}
	rep, err := s.VerifyChain(ctx, "AU-OPC-01")
	if err != nil {
		t.Fatalf("VerifyChain: %v", err)
	}
	t.Logf("VerifyChain(python_ledger.db, AU-OPC-01) = {Valid: %v, VerifiedBlocksCount: %d, Error: %q}",
		rep.Valid, rep.VerifiedBlocksCount, rep.Error)
	if !rep.Valid || rep.VerifiedBlocksCount != 1 {
		t.Fatalf("chain report = %+v, want valid with 1 verified block", rep)
	}
	// The adopted voucher's seal fields are the fixture's facts.
	snap, err := s.Journal(ctx, "049685a2-d778-4bb7-9b9d-fed9df4a3993")
	if err != nil {
		t.Fatalf("Journal: %v", err)
	}
	if snap["entry_hash"] == nil || snap["prev_entry_hash"] == nil {
		t.Fatal("adopted voucher lost its seal fields")
	}
	// Tampered history fails verification; the tamper happens on the copy.
	if err := s.TamperChain(ctx); err != nil {
		t.Fatalf("tamper: %v", err)
	}
	rep, err = s.VerifyChain(ctx, "AU-OPC-01")
	if err != nil {
		t.Fatalf("VerifyChain after tamper: %v", err)
	}
	if rep.Valid {
		t.Fatal("tampered fixture chain verified ok")
	}
	t.Logf("tampered: {Valid: %v, Error: %q}", rep.Valid, rep.Error)
}

// fixtureCopy copies python_ledger.db (with its -wal/-shm side files, which
// the WAL was checkpointed into) into a temp dir and returns the copy's
// path. The original fixture is never opened read-write.
func fixtureCopy(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test file path")
	}
	src := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "fixtures", "chainparity", "python_ledger.db")
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("fixture missing: %v (run the Python reference to regenerate it)", err)
	}
	dst := filepath.Join(t.TempDir(), "python_ledger.db")
	for _, suffix := range []string{"", "-wal", "-shm"} {
		in, err := os.Open(src + suffix)
		if err != nil {
			if os.IsNotExist(err) && suffix != "" {
				continue
			}
			t.Fatalf("open fixture%s: %v", suffix, err)
		}
		out, err := os.Create(dst + suffix)
		if err != nil {
			t.Fatalf("create copy%s: %v", suffix, err)
		}
		if _, err := io.Copy(out, in); err != nil {
			t.Fatalf("copy fixture%s: %v", suffix, err)
		}
		in.Close()
		out.Close()
	}
	return dst
}
