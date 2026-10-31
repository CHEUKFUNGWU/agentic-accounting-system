package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// Backup produces the BL-23 DB-and-evidence backup: VACUUM INTO writes a
// consistent, fully materialized snapshot (no -wal side files to lose) while
// the database is in use, and the attachments directory next to the ledger
// file is copied beside it. The reference's defect (backend/app/main.py) was
// the missing evidence half.
func (s *Store) Backup(ctx context.Context, targetDir string) (store.BackupReport, error) {
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return store.BackupReport{}, fmt.Errorf("sqlite: backup target: %w", err)
	}
	dbFile := filepath.Join(targetDir, filepath.Base(s.path))
	if !strings.HasSuffix(dbFile, ".db") {
		dbFile += ".db"
	}
	_ = os.Remove(dbFile)
	// VACUUM INTO needs an autocommit connection outside any transaction.
	if _, err := s.db.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", strings.ReplaceAll(dbFile, "'", "''"))); err != nil {
		return store.BackupReport{}, fmt.Errorf("sqlite: VACUUM INTO: %w", err)
	}
	evidenceDir := filepath.Join(targetDir, "attachments")
	files, err := copyTree(s.evidenceDir, evidenceDir)
	if err != nil {
		return store.BackupReport{}, fmt.Errorf("sqlite: evidence copy: %w", err)
	}
	return store.BackupReport{DBFile: dbFile, EvidenceDir: evidenceDir, EvidenceFiles: files}, nil
}

// Restore materializes a backup and verifies it (the BL-23 restoration
// verification): integrity_check on the snapshot before anything is copied,
// then database and evidence together, then a check that every
// documents.stored_name in the restored database exists in the restored
// evidence set — a restored ledger without its evidence is refused, not
// silently accepted.
func (s *Store) Restore(ctx context.Context, backup store.BackupRef, target store.RestoreTarget) (store.RestoreReport, error) {
	// 1. The snapshot must be a healthy SQLite database before we copy it.
	integrity, err := sqliteIntegrityCheck(backup.DBFile)
	if err != nil {
		return store.RestoreReport{}, err
	}
	if integrity != "ok" {
		return store.RestoreReport{}, fmt.Errorf("sqlite: restore: backup integrity_check reported %q", integrity)
	}
	// 2. Database and evidence together.
	if err := os.MkdirAll(filepath.Dir(target.DBFile), 0o755); err != nil {
		return store.RestoreReport{}, fmt.Errorf("sqlite: restore target: %w", err)
	}
	if err := copyFile(backup.DBFile, target.DBFile); err != nil {
		return store.RestoreReport{}, fmt.Errorf("sqlite: restore db copy: %w", err)
	}
	files, err := copyTree(backup.EvidenceDir, target.EvidenceDir)
	if err != nil {
		return store.RestoreReport{}, fmt.Errorf("sqlite: restore evidence copy: %w", err)
	}
	report := store.RestoreReport{EvidenceFiles: files}
	// 3. The verification: every document's stored evidence must exist in
	// the restored set.
	restored, err := Open(target.DBFile)
	if err != nil {
		return report, fmt.Errorf("sqlite: restore verify open: %w", err)
	}
	defer restored.Close()
	rows, err := restored.QueryContext(ctx, `SELECT entity_code, stored_name FROM documents
		WHERE stored_name <> ''`)
	if err != nil {
		return report, fmt.Errorf("sqlite: restore verify: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var entityCode, storedName string
		if err := rows.Scan(&entityCode, &storedName); err != nil {
			return report, fmt.Errorf("sqlite: restore verify: %w", err)
		}
		if strings.ContainsAny(storedName, "/\\") || strings.HasPrefix(storedName, ".") {
			return report, fmt.Errorf("sqlite: restore verify: document evidence %q escapes the evidence root", storedName)
		}
		path := filepath.Join(target.EvidenceDir, entityCode, storedName)
		if _, err := os.Stat(path); err != nil {
			return report, fmt.Errorf("sqlite: restore verify: evidence missing for document %s: %s",
				entityCode, storedName)
		}
		report.DocumentsVerified++
	}
	if err := rows.Err(); err != nil {
		return report, fmt.Errorf("sqlite: restore verify: %w", err)
	}
	return report, nil
}

// sqliteIntegrityCheck runs PRAGMA integrity_check on a database file
// without disturbing it (read-only open).
func sqliteIntegrityCheck(path string) (string, error) {
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("sqlite: backup file missing: %w", err)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return "", fmt.Errorf("sqlite: backup open: %w", err)
	}
	defer db.Close()
	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		return "", fmt.Errorf("sqlite: backup integrity_check: %w", err)
	}
	return integrity, nil
}

// copyTree copies dir into dst recursively and returns the file count. An
// absent source directory copies as an empty one (a fresh ledger has no
// evidence yet).
func copyTree(src, dst string) (int, error) {
	entries, err := os.ReadDir(src)
	if err != nil {
		if os.IsNotExist(err) {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return 0, err
			}
			return 0, nil
		}
		return 0, err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return 0, err
	}
	count := 0
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			n, err := copyTree(s, d)
			if err != nil {
				return 0, err
			}
			count += n
			continue
		}
		if !e.Type().IsRegular() {
			continue
		}
		if err := copyFile(s, d); err != nil {
			return 0, err
		}
		count++
	}
	return count, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".restore-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, dst)
}
