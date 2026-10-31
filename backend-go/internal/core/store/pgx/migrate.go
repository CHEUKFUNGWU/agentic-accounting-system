package pgx

import (
	"context"
	"fmt"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/migrations"
	"github.com/pressly/goose/v3"
)

// Migrate applies the embedded goose set, adopting an existing Python-created
// database exactly as backend-go/migrations/README.md documents (shape
// detection + version stamping; see the sqlite adapter's Migrate for the
// documented stamp-vs-UpTo deviation, same end state).
func (s *Store) Migrate(ctx context.Context) error {
	pgFS, err := migrations.PostgresFS()
	if err != nil {
		return fmt.Errorf("pgx: migration FS: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, s.db, pgFS)
	if err != nil {
		return fmt.Errorf("pgx: goose provider: %w", err)
	}

	hasEntities, err := s.tableExists(ctx, "entities")
	if err != nil {
		return err
	}
	hasGoose, err := s.tableExists(ctx, "goose_db_version")
	if err != nil {
		return err
	}

	switch {
	case !hasEntities:
		if _, err := provider.Up(ctx); err != nil {
			return fmt.Errorf("pgx: migrate: %w", err)
		}
		return nil
	case hasGoose:
		if _, err := provider.Up(ctx); err != nil {
			return fmt.Errorf("pgx: migrate: %w", err)
		}
		return nil
	}

	version, ok, err := s.detectShape(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("pgx: database shape matches no known checkpoint; " +
			"open it once with the frozen Python backend (init_db) so it reaches " +
			"the current shape, then let the store adopt it")
	}
	if err := s.stamp(ctx, version); err != nil {
		return err
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("pgx: migrate after adoption: %w", err)
	}
	return nil
}

// detectShape maps the database's shape to the goose version it is at, per
// the README's checkpoints (oldest shape first).
func (s *Store) detectShape(ctx context.Context) (version int, ok bool, err error) {
	hasETB, err := s.tableExists(ctx, "etb_accounts")
	if err != nil {
		return 0, false, err
	}
	hasTB, err := s.tableExists(ctx, "trial_balance_accounts")
	if err != nil {
		return 0, false, err
	}
	if hasETB && !hasTB {
		return 1, true, nil
	}
	if hasTB {
		hasWPRef, err := s.columnExists(ctx, "trial_balance_accounts", "wp_ref")
		if err != nil {
			return 0, false, err
		}
		if hasWPRef {
			return 2, true, nil
		}
	}
	hasPackStatus, err := s.columnExists(ctx, "entities", "pack_status")
	if err != nil {
		return 0, false, err
	}
	if hasPackStatus {
		return 3, true, nil
	}
	hasRevision, err := s.columnExists(ctx, "journal_entries", "revision")
	if err != nil {
		return 0, false, err
	}
	if !hasRevision {
		return 5, true, nil
	}
	return 6, true, nil
}

// stamp creates goose_db_version with the README's PostgreSQL DDL and records
// versions 0..version as applied.
func (s *Store) stamp(ctx context.Context, version int) error {
	create := `CREATE TABLE goose_db_version (
		id SERIAL PRIMARY KEY,
		version_id INTEGER NOT NULL,
		is_applied BOOLEAN NOT NULL,
		tstamp TIMESTAMP NOT NULL DEFAULT now()
	)`
	values := make([]string, 0, version+1)
	values = append(values, "(0, true)")
	for v := 1; v <= version; v++ {
		values = append(values, fmt.Sprintf("(%d, true)", v))
	}
	insert := `INSERT INTO goose_db_version (version_id, is_applied) VALUES ` + strings.Join(values, ", ")
	if _, err := s.db.ExecContext(ctx, create); err != nil {
		return fmt.Errorf("pgx: stamp version table: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, insert); err != nil {
		return fmt.Errorf("pgx: stamp versions: %w", err)
	}
	return nil
}

func (s *Store) tableExists(ctx context.Context, name string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = current_schema() AND table_name = $1`, name).Scan(&n); err != nil {
		return false, fmt.Errorf("pgx: tableExists(%s): %w", name, err)
	}
	return n > 0, nil
}

func (s *Store) columnExists(ctx context.Context, table, column string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
		table, column).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("pgx: columnExists(%s.%s): %w", table, column, err)
	}
	return n > 0, nil
}
