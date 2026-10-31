// Package migrations embeds the goose SQL migration set for the ledger
// database (ADR-0002 D4, revising ADR-0001 D6 item 4). No SQL is read from
// disk at runtime: the binary carries both dialect directories, so a desktop
// build and a container build migrate the same way.
//
// Layout is goose's dialect-directory convention: sqlite3/ and postgres/ hold
// one shared, version-by-version history (0001..0006). Build a goose.Provider
// with the directory matching the open database:
//
//	sqlFS, err := migrations.SQLiteFS() // or migrations.PostgresFS()
//	provider, err := goose.NewProvider(goose.DialectSQLite3, db, sqlFS)
//
// The store layer owns opening the database and running the provider; this
// package only embeds and roots the files.
package migrations

import (
	"embed"
	"io/fs"
)

// FS embeds both dialect directories. goose's Provider globs the root of the
// fs.FS it is given, so callers must root it with SQLiteFS/PostgresFS (fs.Sub)
// rather than passing FS directly.
//
//go:embed sqlite3 postgres
var FS embed.FS

// SQLiteFS returns the migration files rooted at the sqlite3 dialect
// directory, ready for goose.NewProvider(goose.DialectSQLite3, db, fsys).
func SQLiteFS() (fs.FS, error) {
	return fs.Sub(FS, "sqlite3")
}

// PostgresFS returns the migration files rooted at the postgres dialect
// directory, ready for goose.NewProvider(goose.DialectPostgres, db, fsys).
func PostgresFS() (fs.FS, error) {
	return fs.Sub(FS, "postgres")
}
