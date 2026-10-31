package pgx

import (
	"context"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// Backup and Restore report ErrBackupUnsupported: the frozen reference has
// no PostgreSQL backup either (its PG branch copies a SQLite path — dead
// code), and a consistent PostgreSQL snapshot is the operator's pg_dump job.
// The evidence tree is filesystem state regardless of engine, so it is
// included in every backup the deployment takes; the sqlite adapter
// implements the full DB-and-evidence round trip with verification (BL-23).
func (s *Store) Backup(ctx context.Context, targetDir string) (store.BackupReport, error) {
	return store.BackupReport{}, store.ErrBackupUnsupported
}

func (s *Store) Restore(ctx context.Context, backup store.BackupRef, target store.RestoreTarget) (store.RestoreReport, error) {
	return store.RestoreReport{}, store.ErrBackupUnsupported
}
