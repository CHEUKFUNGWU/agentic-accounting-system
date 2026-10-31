package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/migrations"
)

// TestMigrateRefusesB7D198CEraShape pins the b7d198c adoption wedge's fix:
// a database carrying the voucher fields (the 2026-10-17..21 wanted list)
// but not `revision` matches NO clean checkpoint, whichever older shape it
// also resembles — stamping it at any version ≤ 5 would make 0006's bare
// ADD COLUMN fail on the duplicate voucher_no, and the stamp would wedge
// every later open on that goose error. Migrate refuses with the README's
// message instead.
func TestMigrateRefusesB7D198CEraShape(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "b7d198c.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	sqlFS, err := migrations.SQLiteFS()
	if err != nil {
		t.Fatalf("SQLiteFS: %v", err)
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, db, sqlFS)
	if err != nil {
		t.Fatalf("goose provider: %v", err)
	}
	// Build the b7d198c shape: the renamed columns (0001..0005 applied),
	// then the era's voucher fields added by _ensure_columns — without
	// revision, which only arrived at abc6a16. The goose version table is
	// dropped afterwards: a real b7d198c ledger was created by Python and
	// has never seen goose.
	if _, err := p.UpTo(ctx, 5); err != nil {
		t.Fatalf("UpTo(5): %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE journal_entries ADD COLUMN voucher_no VARCHAR(64)`); err != nil {
		t.Fatalf("add voucher_no: %v", err)
	}
	if _, err := db.Exec(`DROP TABLE goose_db_version`); err != nil {
		t.Fatalf("drop version table: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	st, err := New(path, Options{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer st.Close()
	err = st.Migrate(ctx)
	if err == nil {
		t.Fatal("b7d198c-era shape adopted cleanly; want the README's no-checkpoint refusal")
	}
	if !strings.Contains(err.Error(), "shape matches no known checkpoint") {
		t.Fatalf("refusal = %v, want the README's shape-matches-no-checkpoint message", err)
	}
}
