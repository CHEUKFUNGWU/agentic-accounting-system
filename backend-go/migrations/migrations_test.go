package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

// The fixture is the oracle: the schema a fresh Python create_all +
// _ensure_columns produces today (verified byte-identical to a fresh
// DatabaseManager.init_db run). It is committed with its -wal side files, so
// tests copy the trio and open the copy, letting SQLite recover the WAL
// without touching the original.
const (
	// finalVersion is the last migration that reproduces the Python fixture
	// schema: 0001..0006 mirror create_all + _ensure_columns exactly.
	finalVersion = 6
	// receiptsVersion (0007) adds command_receipts — BL-28 idempotency
	// receipts are NEW behaviour with no Python counterpart, so the table
	// sits deliberately outside the fixture-equality surface and is asserted
	// separately (assertReceiptsTable).
	receiptsVersion = 7
)

// newBehaviourTable is the one migration-set table with no Python
// counterpart; canonicalSchema excludes it from every fixture comparison.
const newBehaviourTable = "command_receipts"

func fixturePath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test file path")
	}
	dir := filepath.Dir(thisFile) // backend-go/migrations
	return filepath.Join(dir, "..", "fixtures", "chainparity", "python_ledger.db")
}

// copyFixture copies python_ledger.db plus any -wal/-shm side files into a
// temp dir and returns the copy's path. The original fixture is never opened
// read-write.
func copyFixture(t *testing.T) string {
	t.Helper()
	src := fixturePath(t)
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("fixture missing: %v (run the Python reference to regenerate it)", err)
	}
	dst := filepath.Join(t.TempDir(), "python_ledger.db")
	for _, suffix := range []string{"", "-wal", "-shm"} {
		in, err := os.Open(src + suffix)
		if err != nil {
			if os.IsNotExist(err) && suffix != "" {
				continue
			}
			t.Fatalf("open fixture%s: %v", suffix, err)
		}
		defer in.Close()
		out, err := os.Create(dst + suffix)
		if err != nil {
			t.Fatalf("create copy%s: %v", suffix, err)
		}
		defer out.Close()
		if _, err := io.Copy(out, in); err != nil {
			t.Fatalf("copy fixture%s: %v", suffix, err)
		}
	}
	return dst
}

func openSQLite(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open(%s): %v", path, err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func sqliteProvider(t *testing.T, db *sql.DB) *goose.Provider {
	t.Helper()
	sqlFS, err := SQLiteFS()
	if err != nil {
		t.Fatalf("SQLiteFS: %v", err)
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, db, sqlFS)
	if err != nil {
		t.Fatalf("goose.NewProvider(sqlite): %v", err)
	}
	return p
}

// --- schema canonicalization -------------------------------------------------
//
// The comparison must be insensitive to column order inside a table (the goose
// path appends the 0006 columns at the end, while create_all placed revision
// second) and to cosmetic whitespace. Each CREATE TABLE is reduced to its
// whitespace-free header plus the whitespace-free, top-level-comma-separated
// body items sorted; each index to its whitespace-free DDL. The sorted result
// is comparable byte-for-byte across the two databases.

func canonicalSchema(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT type, name, sql FROM sqlite_master
		WHERE name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name <> 'goose_db_version'
		ORDER BY name`)
	if err != nil {
		t.Fatalf("query sqlite_master: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var kind, name string
		var sqlText sql.NullString
		if err := rows.Scan(&kind, &name, &sqlText); err != nil {
			t.Fatalf("scan sqlite_master row: %v", err)
		}
		if !sqlText.Valid {
			continue // auto indexes (sqlite_autoindex_*) already filtered by name
		}
		switch kind {
		case "table":
			if name == newBehaviourTable {
				continue // 0007's NEW-behaviour table: asserted separately
			}
			out = append(out, canonicalTable(sqlText.String))
		case "index":
			out = append(out, compactWhitespace(sqlText.String))
		default:
			t.Fatalf("unexpected sqlite_master type %q (%s)", kind, name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate sqlite_master: %v", err)
	}
	sort.Strings(out)
	return out
}

// canonicalTable normalizes one CREATE TABLE statement.
func canonicalTable(sqlText string) string {
	open := strings.Index(sqlText, "(")
	end := strings.LastIndex(sqlText, ")")
	if open < 0 || end < open {
		return compactWhitespace(sqlText)
	}
	head := compactWhitespace(sqlText[:open])
	var items []string
	for _, item := range splitTopLevel(sqlText[open+1 : end]) {
		items = append(items, compactWhitespace(item))
	}
	sort.Strings(items)
	return head + "(" + strings.Join(items, ",") + ")"
}

// splitTopLevel splits on commas at parenthesis depth 0.
func splitTopLevel(body string) []string {
	var items []string
	depth, start := 0, 0
	for i, r := range body {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				items = append(items, body[start:i])
				start = i + 1
			}
		}
	}
	if rest := body[start:]; strings.TrimSpace(rest) != "" {
		items = append(items, rest)
	}
	return items
}

func compactWhitespace(s string) string {
	var b strings.Builder
	for _, r := range s {
		// Double quotes are stripped because SQLite's ALTER TABLE RENAME
		// rewrites the stored CREATE statement with the new table name
		// quoted ("trial_balance_accounts"), while create_all stores it
		// unquoted. No string literal in this schema contains a quote.
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '"' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func assertFinalSchemaMatchesFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	fixtureCopy := openSQLite(t, copyFixture(t))
	want := canonicalSchema(t, fixtureCopy)
	got := canonicalSchema(t, db)

	wantSet := map[string]bool{}
	for _, w := range want {
		wantSet[w] = true
	}
	missing := 0
	for _, g := range got {
		if !wantSet[g] {
			missing++
			if missing <= 5 {
				t.Errorf("schema has an object the fixture does not:\n  %s", g)
			}
		}
	}
	gotSet := map[string]bool{}
	for _, g := range got {
		gotSet[g] = true
	}
	extra := 0
	for _, w := range want {
		if !gotSet[w] {
			extra++
			if extra <= 5 {
				t.Errorf("fixture has an object the migrated schema does not:\n  %s", w)
			}
		}
	}
	if missing != 0 || extra != 0 {
		t.Fatalf("schema mismatch: %d objects only in migrated schema, %d only in fixture (%d vs %d objects)",
			missing, extra, len(got), len(want))
	}
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, name).Scan(&n); err != nil {
		t.Fatalf("tableExists(%s): %v", name, err)
	}
	return n > 0
}

func columnExists(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		t.Fatalf("PRAGMA table_info(%s): %v", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan table_info(%s): %v", table, err)
		}
		if name == column {
			return true
		}
	}
	return false
}

// assertReceiptsTable checks the 0007 table's shape: the seven columns the
// adapters read (store.ReceiptColumns plus the composed receipt_key) and the
// receipt_key primary key their insert-if-absent semantics rely on.
func assertReceiptsTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if !tableExists(t, db, "command_receipts") {
		t.Fatal("command_receipts missing after 0007")
	}
	for _, col := range []string{"receipt_key", "principal_key", "entity_code",
		"payload_hash", "command_id", "outcome_json", "created_at"} {
		if !columnExists(t, db, "command_receipts", col) {
			t.Errorf("command_receipts.%s missing", col)
		}
	}
	// PK uniqueness: a second insert under the same composed key must fail,
	// so the adapters' INSERT OR IGNORE / ON CONFLICT DO NOTHING resolve a
	// retry as "already existed" instead of double-storing the outcome.
	seed := `INSERT INTO command_receipts (receipt_key, principal_key, entity_code,
		payload_hash, command_id, outcome_json, created_at)
		VALUES ('k', 'aas:human:owner', 'AU-OPC-01', 'h1', 'c1', '{}', '2026-01-01 00:00:00')`
	if _, err := db.Exec(seed); err != nil {
		t.Fatalf("seed receipt row: %v", err)
	}
	dup := `INSERT INTO command_receipts (receipt_key, principal_key, entity_code,
		payload_hash, command_id, outcome_json, created_at)
		VALUES ('k', 'aas:human:owner', 'AU-OPC-01', 'h1', 'c2', '{}', '2026-01-01 00:00:00')`
	if _, err := db.Exec(dup); err == nil {
		t.Error("duplicate receipt_key accepted; the insert-if-absent contract needs the PK")
	}
}

// seedLegacyRows inserts 0001-shaped rows using the pre-rename vocabulary.
func seedLegacyRows(t *testing.T, db *sql.DB) {
	t.Helper()
	legacy := []string{
		// Two entities with the legacy status values that 0005 rewrites.
		`INSERT INTO entities (entity_code, legal_name, entity_structure, jurisdiction, currency,
			accounting_standard, tax_id, pack_status, created_at)
			VALUES ('AU-OPC-01', 'Test OPC Pty Ltd', 'COMPANY', 'AU', 'AUD', 'ACCRUAL', '12-345-678',
			'CPA_SIGNED_LOCKED', '2026-01-01 00:00:00')`,
		`INSERT INTO entities (entity_code, legal_name, entity_structure, jurisdiction, currency,
			accounting_standard, tax_id, pack_status, created_at)
			VALUES ('AU-OPC-02', 'Second Entity Ltd', 'COMPANY', 'AU', 'AUD', 'ACCRUAL', '99-888-777',
			'READY_FOR_CPA', '2026-01-02 00:00:00')`,
		// A trial balance row in the etb/wp_ref vocabulary.
		`INSERT INTO etb_accounts (entity_code, account_code, account_name, account_type, fs_category,
			wp_ref, cash_flow_activity, opening_balance, period_op_debit, period_op_credit,
			aje_debit, aje_credit)
			VALUES ('AU-OPC-01', '1000', 'Cash at bank', 'ASSET', 'ASSET', 'BS', 'OPERATING_WC',
			'100.0000', '250.0000', '150.0000', '12.5000', '0.0000')`,
		// A journal WITHOUT the additive columns (no revision, no voucher_no...).
		`INSERT INTO journal_entries (journal_id, entity_code, source_module, status, accounting_date,
			currency, total_debit, total_credit, created_by_principal_key, created_by_principal_id,
			ai_confidence_score, ai_reasoning_summary, evidence_uris, entry_hash, prev_entry_hash,
			block_index, posted_at, lines_json, created_at)
			VALUES ('AU-OPC-01:JV-0001', 'AU-OPC-01', 'MANUAL', 'POSTED', '2026-01-01', 'AUD',
			'100.0000', '100.0000', 'aas:human:owner', 'human:owner', '1.0000', 'seeded legacy entry',
			'[]', 'aa5108e7bd9d4b4a0c2f6c3f1e8d7b6a5f4e3d2c1b0a99887766554433221100', '', 1,
			'2026-01-01 00:00:00', '[]', '2026-01-01 00:00:00')`,
		// Chart row in default_wp_ref vocabulary.
		`INSERT INTO chart_of_accounts (account_id, entity_code, parent_account_id, account_code,
			account_name, account_type, normal_balance, fs_category, default_wp_ref,
			cash_flow_activity, is_control_account, allow_manual_je, tax_code_default, is_active,
			effective_from, effective_to, created_at)
			VALUES ('AU-OPC-01:1000', 'AU-OPC-01', NULL, '1000', 'Cash at bank', 'ASSET', 'DEBIT',
			'ASSET', 'BS', 'OPERATING_WC', 0, 1, NULL, 1, NULL, NULL, '2026-01-01 00:00:00')`,
		// A journal line in wp_ref vocabulary (balanced: debit xor credit).
		`INSERT INTO journal_lines (line_id, journal_id, entity_code, line_number, account_id,
			account_code, account_name, period_code, entry_layer, accounting_date, tx_currency,
			exchange_rate, tx_debit, tx_credit, func_debit, func_credit, counterparty_id,
			counterparty_name, tax_code_id, func_tax_amount, business_use_pct, wp_ref, memo, created_at)
			VALUES ('AU-OPC-01:JV-0001:1', 'AU-OPC-01:JV-0001', 'AU-OPC-01', 1, 'AU-OPC-01:1000',
			'1000', 'Cash at bank', '2026-01', 'OPERATIONAL', '2026-01-01', 'AUD', '1.00000000',
			'100.0000', '0.0000', '100.0000', '0.0000', NULL, '', NULL, '0.0000', '1.0000', 'BS',
			'seeded line', '2026-01-01 00:00:00')`,
		// Custom AJE log row in wp_ref vocabulary.
		`INSERT INTO custom_aje_log (aje_id, entity_code, debit_account_code, credit_account_code,
			amount, wp_ref, memo, created_at)
			VALUES ('AU-OPC-01:AJE-0001', 'AU-OPC-01', '1000', '4000', '50.0000', 'TB',
			'seeded aje', '2026-01-01 00:00:00')`,
	}
	for _, stmt := range legacy {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("seed legacy row: %v\nstmt: %s", err, stmt)
		}
	}
}

// --- tests -------------------------------------------------------------------

// TestFreshMigrationsMatchFixture: apply 0001..0006 to an empty database and
// require the result to equal the Python-created fixture (P2 fresh path).
// 0007 (command_receipts) is deliberately NOT applied here — the parity
// surface must equal the fixture at finalVersion; TestCommandReceiptsMigration
// covers what 0007 adds on top.
func TestFreshMigrationsMatchFixture(t *testing.T) {
	ctx := context.Background()
	db := openSQLite(t, filepath.Join(t.TempDir(), "fresh.db"))
	p := sqliteProvider(t, db)

	results, err := p.UpTo(ctx, finalVersion)
	if err != nil {
		t.Fatalf("Up: %v", err)
	}
	if len(results) != finalVersion {
		t.Fatalf("applied %d migrations, want %d", len(results), finalVersion)
	}
	version, err := p.GetDBVersion(ctx)
	if err != nil {
		t.Fatalf("GetDBVersion: %v", err)
	}
	if version != finalVersion {
		t.Fatalf("goose at version %d, want %d", version, finalVersion)
	}
	status, err := p.Status(ctx)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	for _, s := range status {
		// 0007 is deliberately not applied in this test; only the parity
		// surface 0001..0006 must read as applied.
		if s.Source.Version <= finalVersion && s.State != goose.StateApplied {
			t.Errorf("migration version %d state = %q, want applied", s.Source.Version, s.State)
		}
	}
	assertFinalSchemaMatchesFixture(t, db)
	if tableExists(t, db, newBehaviourTable) {
		t.Error("command_receipts exists at finalVersion; 0007 must not be part of the fixture-equality surface")
	}
}

// TestCommandReceiptsMigration: 0007 sits on top of the Python-parity surface.
// A full Up ends at receiptsVersion with the fixture schema intact underneath
// and the receipts table (the BL-28 NEW behaviour) present and unique-keyed;
// stepping back to finalVersion removes exactly that table again.
func TestCommandReceiptsMigration(t *testing.T) {
	ctx := context.Background()
	db := openSQLite(t, filepath.Join(t.TempDir(), "receipts.db"))
	p := sqliteProvider(t, db)

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("Up: %v", err)
	}
	version, err := p.GetDBVersion(ctx)
	if err != nil {
		t.Fatalf("GetDBVersion: %v", err)
	}
	if version != receiptsVersion {
		t.Fatalf("goose at version %d, want %d", version, receiptsVersion)
	}
	assertFinalSchemaMatchesFixture(t, db)
	assertReceiptsTable(t, db)

	if _, err := p.DownTo(ctx, finalVersion); err != nil {
		t.Fatalf("DownTo(%d): %v", finalVersion, err)
	}
	if tableExists(t, db, newBehaviourTable) {
		t.Error("command_receipts still exists after downgrading to finalVersion")
	}
	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("re-Up: %v", err)
	}
	assertReceiptsTable(t, db)
}

// TestLegacyUpgradePath: the P2 gate. A 0001-shaped (pre-rename) database with
// legacy-vocabulary rows upgrades in place: rows survive untouched, new
// columns default (revision 0), the status rewrite applies, and the final
// schema equals the fixture.
func TestLegacyUpgradePath(t *testing.T) {
	ctx := context.Background()
	db := openSQLite(t, filepath.Join(t.TempDir(), "legacy.db"))
	p := sqliteProvider(t, db)

	if _, err := p.UpTo(ctx, 1); err != nil {
		t.Fatalf("UpTo(1): %v", err)
	}
	if !tableExists(t, db, "etb_accounts") {
		t.Fatal("0001 did not create etb_accounts")
	}
	seedLegacyRows(t, db)

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("Up (remaining migrations): %v", err)
	}
	version, err := p.GetDBVersion(ctx)
	if err != nil {
		t.Fatalf("GetDBVersion: %v", err)
	}
	if version != receiptsVersion {
		t.Fatalf("goose at version %d, want %d", version, receiptsVersion)
	}
	assertFinalSchemaMatchesFixture(t, db)
	// The upgraded legacy database also gains the receipts table (0007).
	assertReceiptsTable(t, db)

	// The legacy table is gone under its old name.
	if tableExists(t, db, "etb_accounts") {
		t.Error("etb_accounts still exists after 0002")
	}

	// The journal survived with its new columns defaulted (revision 0).
	var revision int
	var totalDebit string
	err = db.QueryRow(`SELECT revision, total_debit FROM journal_entries WHERE journal_id = 'AU-OPC-01:JV-0001'`).
		Scan(&revision, &totalDebit)
	if err != nil {
		t.Fatalf("legacy journal row lost: %v", err)
	}
	if revision != 0 {
		t.Errorf("legacy journal revision = %d, want 0", revision)
	}
	if totalDebit != "100.0000" {
		t.Errorf("legacy journal total_debit = %q, want exact decimal string \"100.0000\"", totalDebit)
	}

	// The status rewrite applied where applicable, others pass through.
	var status01, status02 string
	if err := db.QueryRow(`SELECT reporting_status FROM entities WHERE entity_code = 'AU-OPC-01'`).Scan(&status01); err != nil {
		t.Fatalf("entity row lost: %v", err)
	}
	if status01 != "REVIEWED_AND_LOCKED" {
		t.Errorf("AU-OPC-01 reporting_status = %q, want REVIEWED_AND_LOCKED (rewritten from CPA_SIGNED_LOCKED)", status01)
	}
	if err := db.QueryRow(`SELECT reporting_status FROM entities WHERE entity_code = 'AU-OPC-02'`).Scan(&status02); err != nil {
		t.Fatalf("entity row lost: %v", err)
	}
	if status02 != "READY" {
		t.Errorf("AU-OPC-02 reporting_status = %q, want READY (rewritten from READY_FOR_CPA)", status02)
	}
	if columnExists(t, db, "entities", "pack_status") {
		t.Error("entities.pack_status still exists after 0004")
	}

	// Renamed columns kept their exact decimal strings (no float round-trip).
	var statementRef, ajeDebit string
	if err := db.QueryRow(`SELECT statement_ref, adjustment_debit FROM trial_balance_accounts
		WHERE entity_code = 'AU-OPC-01' AND account_code = '1000'`).Scan(&statementRef, &ajeDebit); err != nil {
		t.Fatalf("trial balance row lost: %v", err)
	}
	if statementRef != "BS" || ajeDebit != "12.5000" {
		t.Errorf("trial balance row = (statement_ref %q, adjustment_debit %q), want (\"BS\", \"12.5000\")",
			statementRef, ajeDebit)
	}

	var lineRef string
	if err := db.QueryRow(`SELECT statement_ref FROM journal_lines WHERE line_id = 'AU-OPC-01:JV-0001:1'`).Scan(&lineRef); err != nil {
		t.Fatalf("journal line row lost: %v", err)
	}
	if lineRef != "BS" {
		t.Errorf("journal line statement_ref = %q, want \"BS\"", lineRef)
	}

	var ajeRef string
	if err := db.QueryRow(`SELECT statement_ref FROM custom_aje_log WHERE aje_id = 'AU-OPC-01:AJE-0001'`).Scan(&ajeRef); err != nil {
		t.Fatalf("custom aje row lost: %v", err)
	}
	if ajeRef != "TB" {
		t.Errorf("custom aje statement_ref = %q, want \"TB\"", ajeRef)
	}

	var chartRef string
	if err := db.QueryRow(`SELECT default_statement_ref FROM chart_of_accounts WHERE account_id = 'AU-OPC-01:1000'`).Scan(&chartRef); err != nil {
		t.Fatalf("chart row lost: %v", err)
	}
	if chartRef != "BS" {
		t.Errorf("chart default_statement_ref = %q, want \"BS\"", chartRef)
	}

	// The debit-xor-credit control must survive the whole chain: an unbalanced
	// line is still rejected by the database (accounting invariant).
	if _, err := db.Exec(`INSERT INTO journal_lines (line_id, journal_id, entity_code, line_number,
		account_id, account_code, account_name, period_code, entry_layer, accounting_date,
		tx_currency, exchange_rate, tx_debit, tx_credit, func_debit, func_credit,
		counterparty_name, func_tax_amount, business_use_pct, statement_ref, memo, created_at)
		VALUES ('AU-OPC-01:JV-BAD', 'AU-OPC-01:JV-0001', 'AU-OPC-01', 2, 'AU-OPC-01:1000', '1000',
		'Cash at bank', '2026-01', 'OPERATIONAL', '2026-01-01', 'AUD', '1.00000000',
		'0.0000', '0.0000', '0.0000', '0.0000', '', '0.0000', '1.0000', 'BS', 'unbalanced', '2026-01-01 00:00:00')`); err == nil {
		t.Error("unbalanced journal line accepted; ck_journal_line_debit_xor_credit did not survive the migration chain")
	}
}

// TestDownAndReUp: direction sanity. One step down then re-up; then a full
// down to zero and re-up. 0005's down is a documented NO OP and 0001's down
// drops its tables, so a full cycle must still reproduce the fixture schema.
func TestDownAndReUp(t *testing.T) {
	ctx := context.Background()
	db := openSQLite(t, filepath.Join(t.TempDir(), "direction.db"))
	p := sqliteProvider(t, db)

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("Up: %v", err)
	}

	// Down one step from receiptsVersion: undo 0007 and 0006.
	if _, err := p.DownTo(ctx, finalVersion-1); err != nil {
		t.Fatalf("DownTo(%d): %v", finalVersion-1, err)
	}
	if tableExists(t, db, newBehaviourTable) {
		t.Error("command_receipts still present after downgrading past 0007")
	}
	if columnExists(t, db, "journal_entries", "revision") {
		t.Error("journal_entries.revision still present after downgrading past 0006")
	}
	if columnExists(t, db, "journal_entries", "voucher_no") {
		t.Error("journal_entries.voucher_no still present after downgrading past 0006")
	}

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("re-Up after one-step down: %v", err)
	}
	assertFinalSchemaMatchesFixture(t, db)

	// Full down: every Down must run (0005 is a NO OP by design).
	if _, err := p.DownTo(ctx, 0); err != nil {
		t.Fatalf("DownTo(0): %v", err)
	}
	var objects int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master
		WHERE name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name <> 'goose_db_version'`).Scan(&objects); err != nil {
		t.Fatalf("count remaining objects: %v", err)
	}
	if objects != 0 {
		t.Errorf("%d schema objects remain after DownTo(0), want 0", objects)
	}

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("re-Up after full down: %v", err)
	}
	assertFinalSchemaMatchesFixture(t, db)
}

// TestAdoptExistingPythonLedger: a Python-created ledger has no
// goose_db_version. The documented adoption procedure (README, step 3)
// stamps the Python history (0001..0006) as applied; Up must then apply
// exactly 0007 — the command_receipts table the Go backend adds for BL-28 —
// and leave the Python schema otherwise byte-for-byte untouched.
func TestAdoptExistingPythonLedger(t *testing.T) {
	ctx := context.Background()
	db := openSQLite(t, copyFixture(t))

	if tableExists(t, db, "goose_db_version") {
		t.Fatal("fixture unexpectedly contains a goose version table")
	}
	before := canonicalSchema(t, db)

	stamp := `CREATE TABLE goose_db_version (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version_id INTEGER NOT NULL,
		is_applied INTEGER NOT NULL,
		tstamp TIMESTAMP DEFAULT (datetime('now'))
	);`
	if _, err := db.Exec(stamp); err != nil {
		t.Fatalf("stamp: create version table: %v", err)
	}
	values := make([]string, 0, finalVersion+1)
	// Version 0 is goose's own baseline marker: when goose creates the version
	// table it inserts (0, 1), and the SQLite dialect's table-existence
	// fallback probes exactly that row, so a stamp without it is invisible.
	values = append(values, "(0, 1)")
	for v := 1; v <= finalVersion; v++ {
		values = append(values, fmt.Sprintf("(%d, 1)", v))
	}
	if _, err := db.Exec(`INSERT INTO goose_db_version (version_id, is_applied) VALUES ` + strings.Join(values, ", ")); err != nil {
		t.Fatalf("stamp: insert versions: %v", err)
	}

	p := sqliteProvider(t, db)
	results, err := p.Up(ctx)
	if err != nil {
		t.Fatalf("Up after stamping: %v", err)
	}
	if len(results) != 1 {
		t.Errorf("adoption applied %d migrations on a stamped-at-%d database, want 1 (0007 command_receipts)", len(results), finalVersion)
	}
	version, err := p.GetDBVersion(ctx)
	if err != nil {
		t.Fatalf("GetDBVersion: %v", err)
	}
	if version != receiptsVersion {
		t.Errorf("goose at version %d after adoption, want %d", version, receiptsVersion)
	}
	assertReceiptsTable(t, db)

	// canonicalSchema excludes command_receipts, so this comparison is the
	// Python surface: adoption must not have touched anything else.
	after := canonicalSchema(t, db)
	if strings.Join(after, "\n") != strings.Join(before, "\n") {
		t.Errorf("adoption changed the ledger schema beyond adding command_receipts")
	}
	assertFinalSchemaMatchesFixture(t, db)
}
