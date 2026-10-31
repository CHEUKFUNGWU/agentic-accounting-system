package store

// Backup and restore (BL-23): a consistent DB-and-evidence backup with
// restoration verification. The reference's defect (backend/app/main.py
// backup endpoint) snapshotted the SQLite database with VACUUM INTO but not
// the attachments directory next to it (vouchers.attachment_root lives
// beside the ledger file on purpose), so restored databases pointed at
// evidence that no longer existed.
//
// The sqlite adapter implements the round trip: VACUUM INTO a consistent
// snapshot (it excludes the -wal file by writing a fully materialized copy),
// a recursive copy of the evidence directory, and a Restore that verifies
// integrity_check on the backup and that every documents.stored_name exists
// in the restored evidence set. The pgx adapter reports
// ErrBackupUnsupported: the frozen reference has no PostgreSQL backup either
// (its PG branch copies a SQLite path), and PostgreSQL snapshots are the
// operator's pg_dump job.
//
// BackupReport/BackupRef/RestoreTarget/RestoreReport are the seam's value
// types; the adapters own the file mechanics.

// BackupReport describes one completed Backup.
type BackupReport struct {
	// DBFile is the consistent database snapshot file inside the target.
	DBFile string
	// EvidenceDir is the copied evidence tree inside the target.
	EvidenceDir string
	// EvidenceFiles counts the evidence files copied.
	EvidenceFiles int
}

// BackupRef locates one backup produced by Backup.
type BackupRef struct {
	// DBFile is the snapshot file (BackupReport.DBFile).
	DBFile string
	// EvidenceDir is the copied evidence tree (BackupReport.EvidenceDir).
	EvidenceDir string
}

// RestoreTarget says where a Restore materializes the backup.
type RestoreTarget struct {
	// DBFile is the restored database file path.
	DBFile string
	// EvidenceDir is the restored evidence tree root.
	EvidenceDir string
}

// RestoreReport is the restoration verification's evidence (the BL-23
// "restoration verification" half).
type RestoreReport struct {
	// DocumentsVerified counts the documents whose stored_name was found in
	// the restored evidence set.
	DocumentsVerified int
	// EvidenceFiles counts the evidence files restored.
	EvidenceFiles int
}
