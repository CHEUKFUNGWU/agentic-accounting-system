// Package pgx is the PostgreSQL store adapter (pgx/v5 through database/sql,
// ADR-0002 D4: hand-written SQL, no ORM).
//
// The adapter mirrors the reference's PostgreSQL discipline
// (backend/app/core/posting.py, document_sources.py): normal transactions
// serialize per entity through SELECT ... FOR UPDATE on the entity row, so
// concurrent postings — including the first chain block of an entity — wait
// instead of forking the chain (BL-25). Money is VARCHAR at the effective
// schema (backend/app/core/db.py models): money strings cross byte-identical
// and are parsed only at the domain boundary.
//
// # The SET LOCAL hook (RLS, ADR-0002 forward-looking)
//
// The frozen reference has no row-level security policies yet. The preserved
// mechanism is a context-carried tenant scope (store.WithTenant): when a
// scope is present, every transaction this adapter opens starts with
// `SET LOCAL app.tenant_id = <tenant>`, so RLS policies attach to the whole
// transaction the day they are written. Without a scope nothing is set —
// exactly the reference's current behaviour.
package pgx

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Store implements store.Store on one PostgreSQL database.
type Store struct {
	db          *sql.DB
	evidenceDir string
}

// Options configures one adapter instance.
type Options struct {
	// EvidenceDir is the attachments root (the reference stores evidence on
	// the local filesystem regardless of the database engine). Required for
	// the document flows' evidence verification.
	EvidenceDir string
}

// compile-time check that the adapter satisfies the seam.
var _ store.Store = (*Store)(nil)

// Open connects with the pgx stdlib driver.
func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("pgx: open: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("pgx: ping: %w", err)
	}
	return db, nil
}

// New opens the database and returns the store adapter. Migrate must run
// before the first command.
func New(dsn string, opts Options) (*Store, error) {
	db, err := Open(dsn)
	if err != nil {
		return nil, err
	}
	if opts.EvidenceDir == "" {
		db.Close()
		return nil, fmt.Errorf("pgx: evidence dir required (the document flows verify stored evidence bytes)")
	}
	return &Store{db: db, evidenceDir: opts.EvidenceDir}, nil
}

// Close disposes the pool.
func (s *Store) Close() error { return s.db.Close() }

// pgq converts the shared `?` placeholder form to PostgreSQL's $n.
func pgq(query string) string {
	var b strings.Builder
	n := 0
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		} else {
			b.WriteByte(query[i])
		}
	}
	return b.String()
}

// writeTx is one PostgreSQL transaction. Unlike SQLite there is no
// BEGIN IMMEDIATE: the reference's PG path relies on row locks
// (SELECT ... FOR UPDATE) taken before the reads that matter.
type writeTx struct {
	ctx  context.Context
	tx   *sql.Tx
	conn *sql.Conn
}

// withWrite runs fn inside one transaction, applying the preserved SET LOCAL
// tenant hook first when the context carries a scope.
//
// Rollbacks MUST go through tx.Rollback(), never a raw ROLLBACK statement:
// on Go 1.27's database/sql, Conn.Close waits (closingMutex) for the open Tx
// to finish, and a raw ROLLBACK string executes server-side without ever
// finishing the *sql.Tx — the next conn.Close deadlocks with the PG session
// sitting idle (reproduced by the shared suite's guard tests on PG).
func withWrite(ctx context.Context, s *Store, fn func(tx *writeTx) error) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("pgx: conn: %w", err)
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("pgx: BEGIN: %w", err)
	}
	w := &writeTx{ctx: ctx, tx: tx, conn: conn}
	if tenant := store.TenantFromContext(ctx); tenant != "" {
		if _, err := tx.ExecContext(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenant); err != nil {
			_ = tx.Rollback()
			_ = conn.Close()
			return fmt.Errorf("pgx: SET LOCAL app.tenant_id: %w", err)
		}
	}
	if err := fn(w); err != nil {
		_ = tx.Rollback()
		_ = conn.Close()
		return err
	}
	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()
		_ = conn.Close()
		return fmt.Errorf("pgx: COMMIT: %w", err)
	}
	return conn.Close()
}

func (t *writeTx) queryRow(query string, args ...any) *sql.Row {
	return t.tx.QueryRowContext(t.ctx, pgq(query), args...)
}

func (t *writeTx) exec(query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(t.ctx, pgq(query), args...)
}

// constraintErr reports a PostgreSQL constraint violation. The insert path
// maps it onto VOUCHER_CREATE_CONFLICT, as the reference maps IntegrityError.
func constraintErr(err error) bool {
	if err == nil {
		return false
	}
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		switch pgErr.SQLState() {
		case "23505", "23502", "23503", "23514": // unique, not_null, foreign_key, check
			return true
		}
	}
	return false
}
