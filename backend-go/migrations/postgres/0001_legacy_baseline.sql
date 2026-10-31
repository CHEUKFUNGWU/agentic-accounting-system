-- 0001 legacy baseline: the pre-rename schema of the frozen Python reference.
--
-- Shape a legacy Python install had before db.py's hand-written migrations ran:
--   * entities carries pack_status (legacy vocabulary)
--   * the trial balance table is still etb_accounts with wp_ref / aje_debit / aje_credit
--   * wp_ref survives in journal_lines, custom_aje_log and chart_of_accounts.default_wp_ref
--   * journal_entries has none of the additive voucher/revision columns
--
-- Derived by inverting the rename map in backend/app/core/db.py (_ensure_columns)
-- against the model DDL. 0002..0006 walk this shape forward to the current shape.
-- PostgreSQL DDL mirrors what SQLAlchemy create_all emits for the same models
-- (SERIAL ids, TIMESTAMP WITH TIME ZONE, BOOLEAN).

-- +goose Up
CREATE TABLE custom_aje_log (
	aje_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	debit_account_code VARCHAR(32) NOT NULL, 
	credit_account_code VARCHAR(32) NOT NULL, 
	amount VARCHAR(32) NOT NULL, 
	wp_ref VARCHAR(32) NOT NULL, 
	memo TEXT NOT NULL, 
	created_at VARCHAR(64) NOT NULL, 
	PRIMARY KEY (aje_id)
);

CREATE TABLE entities (
	entity_code VARCHAR(32) NOT NULL, 
	legal_name VARCHAR(255) NOT NULL, 
	entity_structure VARCHAR(32) NOT NULL, 
	jurisdiction VARCHAR(8) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	accounting_standard VARCHAR(32) NOT NULL, 
	tax_id VARCHAR(64) NOT NULL, 
	pack_status VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (entity_code)
);

CREATE TABLE exceptions_log (
	exception_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	journal_id VARCHAR(64), 
	subject VARCHAR(255) NOT NULL, 
	detail TEXT NOT NULL, 
	raised_by_principal_key VARCHAR(64) NOT NULL, 
	raised_by_position VARCHAR(32) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	resolved_by_principal_key VARCHAR(64), 
	resolution_note TEXT, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	resolved_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (exception_id)
);

CREATE TABLE mcp_audit_logs (
	log_id VARCHAR(64) NOT NULL, 
	position VARCHAR(32) NOT NULL, 
	principal_key VARCHAR(64) NOT NULL, 
	tool VARCHAR(64) NOT NULL, 
	outcome VARCHAR(16) NOT NULL, 
	error_code VARCHAR(64), 
	error_message TEXT, 
	entity_code VARCHAR(32), 
	journal_id VARCHAR(64), 
	params_json TEXT NOT NULL, 
	document_sha256s TEXT NOT NULL, 
	duration_ms INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (log_id)
);

CREATE TABLE monolith_workspaces (
	workspace_id VARCHAR(32) NOT NULL, 
	revision INTEGER NOT NULL, 
	payload_json TEXT NOT NULL, 
	receipts_json TEXT NOT NULL, 
	PRIMARY KEY (workspace_id)
);

CREATE TABLE personal_splits_log (
	id SERIAL NOT NULL, 
	journal_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	description VARCHAR(255) NOT NULL, 
	gross_amount VARCHAR(32) NOT NULL, 
	business_use_pct VARCHAR(16) NOT NULL, 
	business_expense_debit VARCHAR(32) NOT NULL, 
	recoverable_tax_debit VARCHAR(32) NOT NULL, 
	personal_amount VARCHAR(32) NOT NULL, 
	evidence_uri VARCHAR(512) NOT NULL, 
	created_by VARCHAR(64) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE chart_of_accounts (
	account_id VARCHAR(96) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	parent_account_id VARCHAR(96), 
	account_code VARCHAR(32) NOT NULL, 
	account_name VARCHAR(255) NOT NULL, 
	account_type VARCHAR(32) NOT NULL, 
	normal_balance VARCHAR(8) NOT NULL, 
	fs_category VARCHAR(32) NOT NULL, 
	default_wp_ref VARCHAR(32) NOT NULL, 
	cash_flow_activity VARCHAR(32) NOT NULL, 
	is_control_account BOOLEAN NOT NULL, 
	allow_manual_je BOOLEAN NOT NULL, 
	tax_code_default VARCHAR(32), 
	is_active BOOLEAN NOT NULL, 
	effective_from VARCHAR(16), 
	effective_to VARCHAR(16), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (account_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE counterparties (
	counterparty_id VARCHAR(128) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	counterparty_type VARCHAR(24) NOT NULL, 
	legal_name VARCHAR(255) NOT NULL, 
	country_code VARCHAR(2) NOT NULL, 
	tax_id_number VARCHAR(64) NOT NULL, 
	withholding_rule VARCHAR(32) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (counterparty_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE documents (
	document_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	doc_type VARCHAR(24) NOT NULL, 
	doc_date VARCHAR(16) NOT NULL, 
	counterparty_id VARCHAR(128), 
	counterparty_name VARCHAR(255) NOT NULL, 
	amount VARCHAR(32) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	journal_id VARCHAR(64), 
	filename VARCHAR(255) NOT NULL, 
	stored_name VARCHAR(255) NOT NULL, 
	mime VARCHAR(96) NOT NULL, 
	size INTEGER NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	uploaded_by VARCHAR(64) NOT NULL, 
	note TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	posted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (document_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE fiscal_periods (
	period_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	period_code VARCHAR(16) NOT NULL, 
	fiscal_year INTEGER NOT NULL, 
	period_number INTEGER NOT NULL, 
	start_date VARCHAR(16) NOT NULL, 
	end_date VARCHAR(16) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	closed_by_principal_key VARCHAR(64), 
	closed_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (period_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE journal_entries (
	journal_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	source_module VARCHAR(32) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	accounting_date VARCHAR(16) NOT NULL, 
	currency VARCHAR(8) NOT NULL, 
	total_debit VARCHAR(32) NOT NULL, 
	total_credit VARCHAR(32) NOT NULL, 
	created_by_principal_key VARCHAR(64) NOT NULL, 
	created_by_principal_id VARCHAR(64) NOT NULL, 
	approved_by_principal_key VARCHAR(64), 
	approved_by_principal_id VARCHAR(64), 
	ai_confidence_score VARCHAR(16) NOT NULL, 
	ai_reasoning_summary TEXT NOT NULL, 
	evidence_uris TEXT NOT NULL, 
	entry_hash VARCHAR(64),
	-- The reference's own genesis marker (sod_guard.py:228 /
	-- repository.py:780) is 72 characters — 8 wider than the model's
	-- String(64) declares. Latent in the reference because SQLite enforces
	-- no width and it never posted on PostgreSQL; the first block of an
	-- entity chain needs the full marker (README, reconciliation note 4).
	prev_entry_hash VARCHAR(80),
	block_index INTEGER NOT NULL,
	posted_at TIMESTAMP WITH TIME ZONE, 
	lines_json TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (journal_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE tax_codes (
	tax_code_id VARCHAR(96) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	jurisdiction VARCHAR(8) NOT NULL, 
	tax_code VARCHAR(32) NOT NULL, 
	description VARCHAR(255) NOT NULL, 
	tax_mechanism VARCHAR(32) NOT NULL, 
	rate VARCHAR(16) NOT NULL, 
	recoverable_pct VARCHAR(16) NOT NULL, 
	statutory_return_box VARCHAR(32) NOT NULL, 
	tax_account_code VARCHAR(32), 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (tax_code_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE etb_accounts (
	id SERIAL NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	account_code VARCHAR(32) NOT NULL, 
	account_name VARCHAR(255) NOT NULL, 
	account_type VARCHAR(32) NOT NULL, 
	fs_category VARCHAR(32) NOT NULL, 
	wp_ref VARCHAR(32) NOT NULL, 
	cash_flow_activity VARCHAR(32) NOT NULL, 
	opening_balance VARCHAR(32) NOT NULL, 
	period_op_debit VARCHAR(32) NOT NULL, 
	period_op_credit VARCHAR(32) NOT NULL, 
	aje_debit VARCHAR(32) NOT NULL, 
	aje_credit VARCHAR(32) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code)
);

CREATE TABLE document_sources (
	entity_code VARCHAR(32) NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	document_id VARCHAR(64), 
	journal_id VARCHAR(64), 
	PRIMARY KEY (entity_code, sha256), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code), 
	FOREIGN KEY(document_id) REFERENCES documents (document_id), 
	FOREIGN KEY(journal_id) REFERENCES journal_entries (journal_id)
);

CREATE TABLE journal_lines (
	line_id VARCHAR(64) NOT NULL, 
	journal_id VARCHAR(64) NOT NULL, 
	entity_code VARCHAR(32) NOT NULL, 
	line_number INTEGER NOT NULL, 
	account_id VARCHAR(96) NOT NULL, 
	account_code VARCHAR(32) NOT NULL, 
	account_name VARCHAR(255) NOT NULL, 
	period_code VARCHAR(16) NOT NULL, 
	entry_layer VARCHAR(24) NOT NULL, 
	accounting_date VARCHAR(16) NOT NULL, 
	tx_currency VARCHAR(8) NOT NULL, 
	exchange_rate VARCHAR(24) NOT NULL, 
	tx_debit VARCHAR(32) NOT NULL, 
	tx_credit VARCHAR(32) NOT NULL, 
	func_debit VARCHAR(32) NOT NULL, 
	func_credit VARCHAR(32) NOT NULL, 
	counterparty_id VARCHAR(128), 
	counterparty_name VARCHAR(255) NOT NULL, 
	tax_code_id VARCHAR(96), 
	func_tax_amount VARCHAR(32) NOT NULL, 
	business_use_pct VARCHAR(16) NOT NULL, 
	wp_ref VARCHAR(32) NOT NULL, 
	memo TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (line_id), 
	CONSTRAINT ck_journal_line_debit_xor_credit CHECK ((CAST(tx_debit AS REAL) > 0 AND CAST(tx_credit AS REAL) = 0) OR (CAST(tx_credit AS REAL) > 0 AND CAST(tx_debit AS REAL) = 0)), 
	FOREIGN KEY(journal_id) REFERENCES journal_entries (journal_id), 
	FOREIGN KEY(entity_code) REFERENCES entities (entity_code), 
	FOREIGN KEY(account_id) REFERENCES chart_of_accounts (account_id)
);

CREATE INDEX ix_custom_aje_log_entity_code ON custom_aje_log (entity_code);

CREATE INDEX ix_exceptions_log_raised_by_position ON exceptions_log (raised_by_position);

CREATE INDEX ix_exceptions_log_entity_code ON exceptions_log (entity_code);

CREATE INDEX ix_exceptions_log_status ON exceptions_log (status);

CREATE INDEX ix_exceptions_log_journal_id ON exceptions_log (journal_id);

CREATE INDEX ix_mcp_audit_logs_created_at ON mcp_audit_logs (created_at);

CREATE INDEX ix_mcp_audit_logs_journal_id ON mcp_audit_logs (journal_id);

CREATE INDEX ix_mcp_audit_logs_position ON mcp_audit_logs (position);

CREATE INDEX ix_mcp_audit_logs_tool ON mcp_audit_logs (tool);

CREATE INDEX ix_mcp_audit_logs_outcome ON mcp_audit_logs (outcome);

CREATE INDEX ix_mcp_audit_logs_entity_code ON mcp_audit_logs (entity_code);

CREATE INDEX ix_mcp_audit_logs_principal_key ON mcp_audit_logs (principal_key);

CREATE INDEX ix_personal_splits_log_entity_code ON personal_splits_log (entity_code);

CREATE UNIQUE INDEX ix_personal_splits_log_journal_id ON personal_splits_log (journal_id);

CREATE INDEX ix_chart_of_accounts_account_code ON chart_of_accounts (account_code);

CREATE INDEX ix_chart_of_accounts_entity_code ON chart_of_accounts (entity_code);

CREATE INDEX ix_counterparties_counterparty_type ON counterparties (counterparty_type);

CREATE INDEX ix_counterparties_entity_code ON counterparties (entity_code);

CREATE INDEX ix_counterparties_legal_name ON counterparties (legal_name);

CREATE INDEX ix_documents_status ON documents (status);

CREATE INDEX ix_documents_journal_id ON documents (journal_id);

CREATE INDEX ix_documents_doc_type ON documents (doc_type);

CREATE INDEX ix_documents_entity_code ON documents (entity_code);

CREATE INDEX ix_fiscal_periods_status ON fiscal_periods (status);

CREATE INDEX ix_fiscal_periods_period_code ON fiscal_periods (period_code);

CREATE INDEX ix_fiscal_periods_entity_code ON fiscal_periods (entity_code);

CREATE INDEX ix_journal_entries_block_index ON journal_entries (block_index);

CREATE INDEX ix_journal_entries_entity_code ON journal_entries (entity_code);

CREATE INDEX ix_journal_entries_status ON journal_entries (status);

CREATE INDEX ix_journal_entries_posted_at ON journal_entries (posted_at);

CREATE INDEX ix_tax_codes_tax_code ON tax_codes (tax_code);

CREATE INDEX ix_tax_codes_entity_code ON tax_codes (entity_code);

CREATE INDEX ix_etb_accounts_account_code ON etb_accounts (account_code);

CREATE INDEX ix_etb_accounts_entity_code ON etb_accounts (entity_code);

CREATE INDEX ix_journal_lines_entity_code ON journal_lines (entity_code);

CREATE INDEX ix_journal_lines_entry_layer ON journal_lines (entry_layer);

CREATE INDEX ix_journal_lines_accounting_date ON journal_lines (accounting_date);

CREATE INDEX ix_journal_lines_counterparty_id ON journal_lines (counterparty_id);

CREATE INDEX ix_journal_lines_period_code ON journal_lines (period_code);

CREATE INDEX ix_journal_lines_counterparty ON journal_lines (entity_code, counterparty_id);

CREATE INDEX ix_journal_lines_account_period ON journal_lines (entity_code, account_code, period_code);

CREATE INDEX ix_journal_lines_journal_id ON journal_lines (journal_id);

CREATE INDEX ix_journal_lines_account_code ON journal_lines (account_code);

CREATE INDEX ix_journal_lines_account_id ON journal_lines (account_id);

CREATE INDEX ix_journal_lines_tax_code_id ON journal_lines (tax_code_id);

-- +goose Down
-- Drops every table this migration created. Destructive by definition: 0001 is
-- the empty-database baseline, so its only honest inverse is an empty database.

DROP TABLE journal_lines;
DROP TABLE document_sources;
DROP TABLE etb_accounts;
DROP TABLE tax_codes;
DROP TABLE journal_entries;
DROP TABLE fiscal_periods;
DROP TABLE documents;
DROP TABLE counterparties;
DROP TABLE chart_of_accounts;
DROP TABLE personal_splits_log;
DROP TABLE monolith_workspaces;
DROP TABLE mcp_audit_logs;
DROP TABLE exceptions_log;
DROP TABLE entities;
DROP TABLE custom_aje_log;
