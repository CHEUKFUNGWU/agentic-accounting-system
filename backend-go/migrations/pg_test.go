package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// openPGTestSchema gives one test its own disposable PostgreSQL playground:
// a temp schema routed via search_path (everything, including
// goose_db_version, lives inside it) that is dropped on cleanup, plus a
// goose provider over the embedded PG dialect. Gated on AAS_TEST_PG_DSN
// like the store's PG tests; skipped when unset.
func openPGTestSchema(t *testing.T) (*sql.DB, context.Context, string, *goose.Provider) {
	t.Helper()
	dsn := os.Getenv("AAS_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("AAS_TEST_PG_DSN not set; PostgreSQL half of the dual-DB matrix skipped")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)

	// Isolation: everything (including goose_db_version) lives in a temp
	// schema routed via search_path, dropped on cleanup.
	schema := fmt.Sprintf("goose_p2_test_%d_%d", time.Now().UnixNano(), atomic.AddUint64(&pgTestSchemaSeq, 1))
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("pgx.ParseConfig: %v", err)
	}
	cfg.RuntimeParams["search_path"] = schema

	db, err := sql.Open("pgx", stdlib.RegisterConnConfig(cfg))
	if err != nil {
		t.Fatalf("sql.Open(pgx): %v", err)
	}

	if _, err := db.ExecContext(ctx, fmt.Sprintf("CREATE SCHEMA %s", schema)); err != nil {
		t.Fatalf("CREATE SCHEMA: %v", err)
	}
	t.Cleanup(func() {
		// Drop the temp schema while the pool is still open; closing happens
		// after, so no committed state of ours outlives the test.
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := db.ExecContext(cleanupCtx, fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)); err != nil {
			t.Errorf("DROP SCHEMA %s: %v", schema, err)
		}
		db.Close()
	})

	pgFS, err := PostgresFS()
	if err != nil {
		t.Fatalf("PostgresFS: %v", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, db, pgFS)
	if err != nil {
		t.Fatalf("goose.NewProvider(postgres): %v", err)
	}
	return db, ctx, schema, p
}

// pgTestSchemaSeq disambiguates same-nanosecond schema names across tests.
var pgTestSchemaSeq uint64

// TestPostgresMigrationsLegacyUpgrade mirrors the SQLite legacy upgrade on
// PostgreSQL (the other half of the dual-DB matrix, ADR-0001 §6). All
// objects are created inside a dedicated temp schema and dropped afterwards,
// so the target database itself is never touched.
func TestPostgresMigrationsLegacyUpgrade(t *testing.T) {
	db, ctx, schema, p := openPGTestSchema(t)

	// Legacy shape, then legacy-vocabulary rows, then forward.
	if _, err := p.UpTo(ctx, 1); err != nil {
		t.Fatalf("UpTo(1): %v", err)
	}
	seedLegacyRowsPG(t, db)
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

	assertPGFinalShape(t, db, schema)

	// Row survival across the renames and the additive backfill.
	var revision int
	var totalDebit string
	if err := db.QueryRowContext(ctx, `SELECT revision, total_debit FROM journal_entries
		WHERE journal_id = 'AU-OPC-01:JV-0001'`).Scan(&revision, &totalDebit); err != nil {
		t.Fatalf("legacy journal row lost: %v", err)
	}
	if revision != 0 {
		t.Errorf("legacy journal revision = %d, want 0", revision)
	}
	if totalDebit != "100.0000" {
		t.Errorf("legacy journal total_debit = %q, want \"100.0000\"", totalDebit)
	}

	var status01 string
	if err := db.QueryRowContext(ctx, `SELECT reporting_status FROM entities WHERE entity_code = 'AU-OPC-01'`).
		Scan(&status01); err != nil {
		t.Fatalf("entity row lost: %v", err)
	}
	if status01 != "REVIEWED_AND_LOCKED" {
		t.Errorf("AU-OPC-01 reporting_status = %q, want REVIEWED_AND_LOCKED", status01)
	}

	var statementRef, ajeDebit string
	if err := db.QueryRowContext(ctx, `SELECT statement_ref, adjustment_debit FROM trial_balance_accounts
		WHERE entity_code = 'AU-OPC-01' AND account_code = '1000'`).Scan(&statementRef, &ajeDebit); err != nil {
		t.Fatalf("trial balance row lost: %v", err)
	}
	if statementRef != "BS" || ajeDebit != "12.5000" {
		t.Errorf("trial balance row = (%q, %q), want (\"BS\", \"12.5000\")", statementRef, ajeDebit)
	}

	// Direction sanity: stepping down from receiptsVersion removes 0007 and
	// 0006; re-up restores both.
	if _, err := p.DownTo(ctx, finalVersion-1); err != nil {
		t.Fatalf("DownTo(%d): %v", finalVersion-1, err)
	}
	if tableExistsPG(t, db, schema, "command_receipts") {
		t.Error("command_receipts still present after downgrading past 0007")
	}
	if columnExistsPG(t, db, "journal_entries", "revision") {
		t.Error("journal_entries.revision still present after downgrading past 0006")
	}
	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("re-Up: %v", err)
	}
	assertPGFinalShape(t, db, schema)

	// The debit-xor-credit CHECK must FIRE, not merely exist: an unbalanced
	// line is refused by the database (the behavioral mirror of the SQLite
	// test's insert, against the seeded legacy journal and chart row).
	if _, err := db.ExecContext(ctx, `INSERT INTO journal_lines (line_id, journal_id, entity_code,
		line_number, account_id, account_code, account_name, period_code, entry_layer,
		accounting_date, tx_currency, exchange_rate, tx_debit, tx_credit, func_debit, func_credit,
		counterparty_name, func_tax_amount, business_use_pct, statement_ref, memo, created_at)
		VALUES ('AU-OPC-01:JV-BAD', 'AU-OPC-01:JV-0001', 'AU-OPC-01', 2, 'AU-OPC-01:1000', '1000',
		'Cash at bank', '2026-01', 'OPERATIONAL', '2026-01-01', 'AUD', '1.00000000',
		'0.0000', '0.0000', '0.0000', '0.0000', '', '0.0000', '1.0000', 'BS', 'unbalanced',
		'2026-01-01T00:00:00Z')`); err == nil {
		t.Error("unbalanced journal line accepted on PG; ck_journal_line_debit_xor_credit did not survive the migration chain")
	}
}

// TestPostgresMigrationsDownAndReUp mirrors the SQLite direction sanity on
// PostgreSQL: a full down to zero leaves no schema objects behind, and the
// re-up reproduces the final shape. The PG Down sections of 0001..0004 were
// never exercised by any other test.
func TestPostgresMigrationsDownAndReUp(t *testing.T) {
	db, ctx, schema, p := openPGTestSchema(t)

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("Up: %v", err)
	}
	if _, err := p.DownTo(ctx, 0); err != nil {
		t.Fatalf("DownTo(0): %v", err)
	}
	var objects int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name <> 'goose_db_version'`, schema).Scan(&objects); err != nil {
		t.Fatalf("count remaining objects: %v", err)
	}
	if objects != 0 {
		t.Errorf("%d schema objects remain after DownTo(0), want 0", objects)
	}
	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("re-Up after full down: %v", err)
	}
	assertPGFinalShape(t, db, schema)
}

func seedLegacyRowsPG(t *testing.T, db *sql.DB) {
	t.Helper()
	legacy := []string{
		`INSERT INTO entities (entity_code, legal_name, entity_structure, jurisdiction, currency,
			accounting_standard, tax_id, pack_status, created_at)
			VALUES ('AU-OPC-01', 'Test OPC Pty Ltd', 'COMPANY', 'AU', 'AUD', 'ACCRUAL', '12-345-678',
			'CPA_SIGNED_LOCKED', '2026-01-01T00:00:00Z')`,
		`INSERT INTO etb_accounts (entity_code, account_code, account_name, account_type, fs_category,
			wp_ref, cash_flow_activity, opening_balance, period_op_debit, period_op_credit,
			aje_debit, aje_credit)
			VALUES ('AU-OPC-01', '1000', 'Cash at bank', 'ASSET', 'ASSET', 'BS', 'OPERATING_WC',
			'100.0000', '250.0000', '150.0000', '12.5000', '0.0000')`,
		`INSERT INTO journal_entries (journal_id, entity_code, source_module, status, accounting_date,
			currency, total_debit, total_credit, created_by_principal_key, created_by_principal_id,
			ai_confidence_score, ai_reasoning_summary, evidence_uris, entry_hash, prev_entry_hash,
			block_index, posted_at, lines_json, created_at)
			VALUES ('AU-OPC-01:JV-0001', 'AU-OPC-01', 'MANUAL', 'POSTED', '2026-01-01', 'AUD',
			'100.0000', '100.0000', 'aas:human:owner', 'human:owner', '1.0000', 'seeded legacy entry',
			'[]', 'aa5108e7bd9d4b4a0c2f6c3f1e8d7b6a5f4e3d2c1b0a99887766554433221100', '', 1,
			'2026-01-01T00:00:00Z', '[]', '2026-01-01T00:00:00Z')`,
		`INSERT INTO chart_of_accounts (account_id, entity_code, parent_account_id, account_code,
			account_name, account_type, normal_balance, fs_category, default_wp_ref,
			cash_flow_activity, is_control_account, allow_manual_je, tax_code_default, is_active,
			effective_from, effective_to, created_at)
			VALUES ('AU-OPC-01:1000', 'AU-OPC-01', NULL, '1000', 'Cash at bank', 'ASSET', 'DEBIT',
			'ASSET', 'BS', 'OPERATING_WC', false, true, NULL, true, NULL, NULL, '2026-01-01T00:00:00Z')`,
		`INSERT INTO journal_lines (line_id, journal_id, entity_code, line_number, account_id,
			account_code, account_name, period_code, entry_layer, accounting_date, tx_currency,
			exchange_rate, tx_debit, tx_credit, func_debit, func_credit, counterparty_id,
			counterparty_name, tax_code_id, func_tax_amount, business_use_pct, wp_ref, memo, created_at)
			VALUES ('AU-OPC-01:JV-0001:1', 'AU-OPC-01:JV-0001', 'AU-OPC-01', 1, 'AU-OPC-01:1000',
			'1000', 'Cash at bank', '2026-01', 'OPERATIONAL', '2026-01-01', 'AUD', '1.00000000',
			'100.0000', '0.0000', '100.0000', '0.0000', NULL, '', NULL, '0.0000', '1.0000', 'BS',
			'seeded line', '2026-01-01T00:00:00Z')`,
		`INSERT INTO custom_aje_log (aje_id, entity_code, debit_account_code, credit_account_code,
			amount, wp_ref, memo, created_at)
			VALUES ('AU-OPC-01:AJE-0001', 'AU-OPC-01', '1000', '4000', '50.0000', 'TB',
			'seeded aje', '2026-01-01T00:00:00Z')`,
	}
	for _, stmt := range legacy {
		if _, err := db.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("seed legacy row: %v\nstmt: %s", err, stmt)
		}
	}
}

// assertPGFinalShape checks the migrated schema against the shape SQLAlchemy
// create_all emits for the same models (SERIAL ids, TIMESTAMP WITH TIME ZONE,
// BOOLEAN, the named CHECK): tables, key column types/defaults and the
// reconciled index names.
func assertPGFinalShape(t *testing.T, db *sql.DB, schema string) {
	t.Helper()

	wantTables := []string{
		"monolith_workspaces", "entities", "mcp_audit_logs", "exceptions_log",
		"personal_splits_log", "custom_aje_log", "trial_balance_accounts",
		"journal_entries", "documents", "chart_of_accounts", "fiscal_periods",
		"counterparties", "tax_codes", "document_sources", "journal_lines",
		"command_receipts",
	}
	for _, table := range wantTables {
		if !tableExistsPG(t, db, schema, table) {
			t.Errorf("table %s missing after migrations", table)
		}
	}
	if tableExistsPG(t, db, schema, "etb_accounts") {
		t.Error("etb_accounts still exists after 0002")
	}
	if tableExistsPG(t, db, schema, "goose_db_version") {
		// in search_path schema it must exist; tableExistsPG checks exactly that
	} else {
		t.Error("goose_db_version missing in the migration schema")
	}

	// Column facts: types and defaults as create_all would produce them.
	// data_type carries no length for character varying; the length lives in
	// character_maximum_length, so varchars are asserted as (base, length).
	type columnWant struct {
		table, column   string
		dataType        string
		maxLength       int // 0 = not applicable / no max
		isNullable      string
		defaultIsSerial bool // SERIAL-backed id: default must come from a sequence
		defaultValue    string
	}
	wantColumns := []columnWant{
		{"entities", "reporting_status", "character varying", 32, "NO", false, ""},
		{"journal_entries", "revision", "integer", 0, "NO", false, "0"},
		{"journal_entries", "voucher_no", "character varying", 64, "YES", false, ""},
		{"journal_entries", "submitted_at", "timestamp with time zone", 0, "YES", false, ""},
		{"trial_balance_accounts", "statement_ref", "character varying", 32, "NO", false, ""},
		{"trial_balance_accounts", "adjustment_debit", "character varying", 32, "NO", false, ""},
		{"chart_of_accounts", "default_statement_ref", "character varying", 32, "NO", false, ""},
		{"journal_lines", "entry_layer", "character varying", 24, "NO", false, ""},
		{"monolith_workspaces", "payload_json", "text", 0, "NO", false, ""},
		{"personal_splits_log", "id", "integer", 0, "NO", true, ""},
		{"trial_balance_accounts", "id", "integer", 0, "NO", true, ""},
		// The reference's 65-character genesis marker needs the widened
		// prev_entry_hash (README, reconciliation note 4); pin it so a
		// regeneration of 0001 cannot silently reintroduce the model's
		// too-narrow String(64).
		{"journal_entries", "prev_entry_hash", "character varying", 80, "YES", false, ""},
		// 0007 command_receipts (BL-28, NEW behaviour — no Python counterpart).
		{"command_receipts", "receipt_key", "text", 0, "NO", false, ""},
		{"command_receipts", "principal_key", "character varying", 64, "NO", false, ""},
		{"command_receipts", "entity_code", "character varying", 32, "NO", false, ""},
		{"command_receipts", "payload_hash", "character varying", 64, "NO", false, ""},
		{"command_receipts", "command_id", "character varying", 64, "NO", false, ""},
		{"command_receipts", "outcome_json", "text", 0, "NO", false, ""},
		{"command_receipts", "created_at", "timestamp with time zone", 0, "NO", false, ""},
	}
	for _, want := range wantColumns {
		gotType, gotMax, gotNullable, gotDefault := columnInfoPG(t, db, schema, want.table, want.column)
		key := want.table + "." + want.column
		if gotType == "" {
			t.Errorf("%s missing after migrations", key)
			continue
		}
		if gotType != want.dataType {
			t.Errorf("%s type = %q, want %q", key, gotType, want.dataType)
		}
		if gotMax != want.maxLength {
			t.Errorf("%s length = %d, want %d", key, gotMax, want.maxLength)
		}
		if gotNullable != want.isNullable {
			t.Errorf("%s nullable = %q, want %q", key, gotNullable, want.isNullable)
		}
		if want.defaultIsSerial {
			if gotDefault == "" {
				t.Errorf("%s should default from the SERIAL sequence, got empty", key)
			}
		} else if want.defaultValue != "" && gotDefault != want.defaultValue {
			t.Errorf("%s default = %q, want %q", key, gotDefault, want.defaultValue)
		}
	}

	// Index names: reconciled (no ix_etb_accounts_*, additive indexes present).
	indexes := indexSetPG(t, db, schema)
	for _, name := range []string{
		"ix_trial_balance_accounts_entity_code", "ix_trial_balance_accounts_account_code",
		"ix_journal_entries_voucher_no", "ix_journal_entries_period",
		"ix_journal_entries_entry_layer", "ix_journal_entries_posted_at",
	} {
		if !indexes[name] {
			t.Errorf("index %s missing after migrations", name)
		}
	}
	for _, name := range []string{"ix_etb_accounts_entity_code", "ix_etb_accounts_account_code"} {
		if indexes[name] {
			t.Errorf("legacy index %s still exists after 0002", name)
		}
	}

	// The named CHECK survives the whole chain (the temp schema is the only
	// one in this database containing the constraint).
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pg_constraint
		WHERE conname = 'ck_journal_line_debit_xor_credit'`).Scan(&n); err != nil || n == 0 {
		t.Errorf("ck_journal_line_debit_xor_credit missing after migrations (err=%v)", err)
	}
}

func tableExistsPG(t *testing.T, db *sql.DB, schema, table string) bool {
	t.Helper()
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = $1 AND table_name = $2`, schema, table).Scan(&n)
	if err != nil {
		t.Fatalf("tableExistsPG(%s): %v", table, err)
	}
	return n > 0
}

func columnInfoPG(t *testing.T, db *sql.DB, schema, table, column string) (dataType string, maxLength int, isNullable, columnDefault string) {
	t.Helper()
	var dtype, nullable sql.NullString
	var dflt sql.NullString
	var maxLen sql.NullInt64
	err := db.QueryRow(`SELECT data_type, character_maximum_length, is_nullable, column_default
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, schema, table, column).
		Scan(&dtype, &maxLen, &nullable, &dflt)
	switch {
	case err == sql.ErrNoRows:
		return "", 0, "", ""
	case err != nil:
		t.Fatalf("columnInfoPG(%s.%s): %v", table, column, err)
	}
	outDefault := ""
	if dflt.Valid {
		outDefault = dflt.String
	}
	return dtype.String, int(maxLen.Int64), nullable.String, outDefault
}

func indexSetPG(t *testing.T, db *sql.DB, schema string) map[string]bool {
	t.Helper()
	rows, err := db.Query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, schema)
	if err != nil {
		t.Fatalf("list indexes: %v", err)
	}
	defer rows.Close()
	set := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan index name: %v", err)
		}
		set[name] = true
	}
	return set
}

func columnExistsPG(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, table, column).Scan(&n)
	if err != nil {
		t.Fatalf("columnExistsPG(%s.%s): %v", table, column, err)
	}
	return n > 0
}
