package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/migrations"
	"github.com/pressly/goose/v3"
)

// Migrate applies the embedded goose set, adopting an existing Python-created
// ledger exactly as backend-go/migrations/README.md documents:
//
//  1. No entities table → a fresh file: apply 0001..0006.
//  2. goose_db_version already present → provider.Up (the normal goose path).
//  3. entities present without goose_db_version → the file predates goose.
//     Shape detection with the checks _ensure_columns uses, oldest shape
//     first; the detected version N is STAMPED as applied (the version table
//     is created with goose's exact DDL, the baseline (0, 1) row included)
//     and Up applies N+1..0006.
//  4. No clean checkpoint match → error telling the operator to bring the
//     file to the current shape with the frozen Python backend first.
//
// One deviation from the README's phrasing, same end state: for the
// intermediate shapes the README says "run UpTo(N) then Up", but 0001 carries
// no IF NOT EXISTS, so re-applying 0001 over an existing legacy table set
// fails. Stamping N as applied then running Up is the working equivalent —
// the migrations are idempotent renames/additions from N forward, and the
// stamp DDL is byte-identical to the README's.
func (s *Store) Migrate(ctx context.Context) error {
	sqlFS, err := migrations.SQLiteFS()
	if err != nil {
		return fmt.Errorf("sqlite: migration FS: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, s.db, sqlFS)
	if err != nil {
		return fmt.Errorf("sqlite: goose provider: %w", err)
	}

	hasEntities, err := s.tableExists("entities")
	if err != nil {
		return err
	}
	hasGoose, err := s.tableExists("goose_db_version")
	if err != nil {
		return err
	}

	switch {
	case !hasEntities:
		// Fresh file: the whole history applies.
		if _, err := provider.Up(ctx); err != nil {
			return fmt.Errorf("sqlite: migrate: %w", err)
		}
		return nil
	case hasGoose:
		// A goose-managed database (the store's own prior run).
		if _, err := provider.Up(ctx); err != nil {
			return fmt.Errorf("sqlite: migrate: %w", err)
		}
		return nil
	}

	// A Python-created ledger: detect its shape, stamp, move forward.
	version, ok, err := s.detectShape()
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("sqlite: database shape matches no known checkpoint; " +
			"open it once with the frozen Python backend (init_db) so it reaches " +
			"the current shape, then let the store adopt it")
	}
	if err := s.stamp(ctx, version); err != nil {
		return err
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("sqlite: migrate after adoption: %w", err)
	}
	return nil
}

// detectShape maps the database's shape to the goose version it is at, per
// the README's checkpoints (oldest shape first). ok is false when no
// checkpoint matches.
func (s *Store) detectShape() (version int, ok bool, err error) {
	hasETB, err := s.tableExists("etb_accounts")
	if err != nil {
		return 0, false, err
	}
	hasTB, err := s.tableExists("trial_balance_accounts")
	if err != nil {
		return 0, false, err
	}
	if hasETB && !hasTB {
		return 1, true, nil
	}
	if hasTB {
		hasWPRef, err := s.columnExists("trial_balance_accounts", "wp_ref")
		if err != nil {
			return 0, false, err
		}
		if hasWPRef {
			return 2, true, nil
		}
	}
	hasPackStatus, err := s.columnExists("entities", "pack_status")
	if err != nil {
		return 0, false, err
	}
	if hasPackStatus {
		return 3, true, nil
	}
	hasRevision, err := s.columnExists("journal_entries", "revision")
	if err != nil {
		return 0, false, err
	}
	if !hasRevision {
		return 5, true, nil
	}
	return 6, true, nil
}

// stamp creates goose_db_version with the README's DDL and records versions
// 0..version as applied — goose's own baseline marker (0, 1) included, which
// the SQLite dialect's table-existence fallback probes.
func (s *Store) stamp(ctx context.Context, version int) error {
	create := `CREATE TABLE goose_db_version (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version_id INTEGER NOT NULL,
		is_applied INTEGER NOT NULL,
		tstamp TIMESTAMP DEFAULT (datetime('now'))
	);`
	values := make([]string, 0, version+1)
	values = append(values, "(0, 1)")
	for v := 1; v <= version; v++ {
		values = append(values, fmt.Sprintf("(%d, 1)", v))
	}
	insert := `INSERT INTO goose_db_version (version_id, is_applied) VALUES ` + strings.Join(values, ", ")
	if _, err := s.db.ExecContext(ctx, create); err != nil {
		return fmt.Errorf("sqlite: stamp version table: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, insert); err != nil {
		return fmt.Errorf("sqlite: stamp versions: %w", err)
	}
	return nil
}

func (s *Store) tableExists(name string) (bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, name).Scan(&n); err != nil {
		return false, fmt.Errorf("sqlite: tableExists(%s): %w", name, err)
	}
	return n > 0, nil
}

func (s *Store) columnExists(table, column string) (bool, error) {
	rows, err := s.db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, fmt.Errorf("sqlite: table_info(%s): %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return false, fmt.Errorf("sqlite: scan table_info(%s): %w", table, err)
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
