// Package pgx is the PostgreSQL store adapter (pgx/v5 through database/sql,
// ADR-0002 D4: hand-written SQL, no ORM).
//
// P0 proves driver init and connectivity. The Store implementation arrives
// in P2, including the RLS discipline: every scoped transaction sets
// `SET LOCAL app.tenant_id` so row-level security applies to the whole
// transaction, as the frozen reference does.
package pgx

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open connects with the pgx stdlib driver. P0 scope only.
func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("pgx: open: %w", err)
	}
	return db, nil
}
