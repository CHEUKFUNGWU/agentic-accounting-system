package store

// Backup and restore of database plus evidence files lives behind the store
// adapters in P2: BL-23 (backups omit source files) is absorbed here — the
// SQLite adapter backs up the -wal state with the database file, and both
// adapters restore database and separately stored evidence attachments
// together, with verification. ADR-0002 §3 P2.
