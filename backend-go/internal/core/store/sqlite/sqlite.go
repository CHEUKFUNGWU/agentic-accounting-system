// Package sqlite is the SQLite store adapter (modernc.org/sqlite, pure Go,
// no cgo — required for cross-compiled desktop binaries, ADR-0002 D4).
//
// The adapter ports the SQLite discipline of the frozen reference
// (backend/app/core/db.py, repository.py, posting.py, document_sources.py):
//
//   - money stored as TEXT and crossed byte-identical, parsed as exact
//     decimal only at the domain boundary, never float;
//   - WAL mode with busy_timeout on every connection via DSN parameters,
//     synchronous NORMAL, PRAGMA integrity_check on open;
//   - every write transaction opened with BEGIN IMMEDIATE before any read
//     (the reference's writer-reservation discipline — SQLite must serialize
//     postings per entity, including the first chain block);
//   - timestamps stored in SQLAlchemy's SQLite DATETIME text form and
//     rendered as ISO strings at the wire boundary;
//   - hand-written SQL, no ORM.
//
// Evidence files (documents.stored_name) live in an attachments directory
// next to the database file, exactly as vouchers.attachment_root places them,
// so the BL-23 backup covers both together.
package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
	_ "modernc.org/sqlite"
)

// busyTimeoutMs keeps concurrent writers waiting instead of failing fast,
// matching the reference discipline. It rides in the DSN so every pooled
// connection gets it: pragmas set with Exec reach only the one connection
// that ran them.
const busyTimeoutMs = 5000

// Options configures one adapter instance.
type Options struct {
	// EvidenceDir is the attachments root. Empty defaults to an
	// "attachments" directory next to the database file (the reference's
	// attachment_root placement).
	EvidenceDir string
}

// Store implements store.Store on one SQLite database file.
type Store struct {
	db          *sql.DB
	path        string
	evidenceDir string
}

// compile-time check that the adapter satisfies the seam.
var _ store.Store = (*Store)(nil)

// Open opens the database file and applies the reference pragmas on every
// connection via DSN parameters (busy_timeout, WAL journal mode), then runs
// integrity_check on open.
func Open(path string) (*sql.DB, error) {
	// _pragma parameters are a modernc driver feature applied per connection.
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(%d)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)", path, busyTimeoutMs)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sqlite: open %s: %w", path, err)
	}
	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		db.Close()
		return nil, fmt.Errorf("sqlite: integrity_check: %w", err)
	}
	if integrity != "ok" {
		db.Close()
		return nil, fmt.Errorf("sqlite: integrity_check reported %q", integrity)
	}
	return db, nil
}

// New opens the database file and returns the store adapter. Migrate must
// run before the first command (see migrations/README.md for the adoption
// rules New's Migrate implements).
func New(path string, opts Options) (*Store, error) {
	db, err := Open(path)
	if err != nil {
		return nil, err
	}
	evidence := opts.EvidenceDir
	if evidence == "" {
		evidence = filepath.Join(filepath.Dir(path), "attachments")
	}
	// The reference's attachment_root creates the directory on first use;
	// creating it at open keeps the evidence root observable for backup.
	if err := os.MkdirAll(evidence, 0o755); err != nil {
		db.Close()
		return nil, fmt.Errorf("sqlite: evidence dir: %w", err)
	}
	return &Store{db: db, path: path, evidenceDir: evidence}, nil
}

// Close disposes the pool.
func (s *Store) Close() error { return s.db.Close() }

// ---------------------------------------------------------------------------
// Write transactions: BEGIN IMMEDIATE before any read
// ---------------------------------------------------------------------------

// writeTx is one BEGIN IMMEDIATE transaction held on a single pooled
// connection. SQLite must reserve the writer BEFORE any read inside the
// transaction, or two postings could read the same chain head (BL-25).
type writeTx struct {
	ctx  context.Context
	conn *sql.Conn
}

// beginWrite opens the transaction. busy_timeout (DSN) makes a second writer
// wait for the first instead of failing fast, which is what serializes
// concurrent postings on one entity.
func (s *Store) beginWrite(ctx context.Context) (*writeTx, error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("sqlite: conn: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("sqlite: BEGIN IMMEDIATE: %w", err)
	}
	return &writeTx{ctx: ctx, conn: conn}, nil
}

// withWrite runs fn inside one BEGIN IMMEDIATE transaction. An error from fn
// rolls the transaction back and is returned unchanged; the commit error
// surfaces only when fn succeeded.
func withWrite(ctx context.Context, s *Store, fn func(tx *writeTx) error) error {
	tx, err := s.beginWrite(ctx)
	if err != nil {
		return err
	}
	// The transaction-control statements run under a cancellation-proof
	// context: when fn fails BECAUSE ctx was canceled (the BL-28 timeout
	// scenario), a ctx-bound ROLLBACK fails before reaching the driver and
	// the pooled connection would return to the pool still holding the
	// BEGIN IMMEDIATE write lock.
	rbCtx := context.WithoutCancel(ctx)
	if err := fn(tx); err != nil {
		_, _ = tx.conn.ExecContext(rbCtx, "ROLLBACK")
		_ = tx.conn.Close()
		return err
	}
	if _, err := tx.conn.ExecContext(ctx, "COMMIT"); err != nil {
		_, _ = tx.conn.ExecContext(rbCtx, "ROLLBACK")
		_ = tx.conn.Close()
		return fmt.Errorf("sqlite: COMMIT: %w", err)
	}
	return tx.conn.Close()
}

func (t *writeTx) queryRow(query string, args ...any) *sql.Row {
	return t.conn.QueryRowContext(t.ctx, query, args...)
}

func (t *writeTx) exec(query string, args ...any) (sql.Result, error) {
	return t.conn.ExecContext(t.ctx, query, args...)
}

// constraintErr reports whether err is a SQLite constraint violation, which
// the reference maps onto VOUCHER_CREATE_CONFLICT on the insert path.
func constraintErr(err error) bool {
	if err == nil {
		return false
	}
	// modernc.org/sqlite surfaces constraint violations with this suffix.
	return strings.Contains(err.Error(), "constraint failed")
}
