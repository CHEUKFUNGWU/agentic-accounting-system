-- 0006 adds the voucher/revision columns to journal_entries and the indexes a
-- fresh create_all declares on them (same step as the SQLite dialect).
--
-- Mirrors the reference's only PostgreSQL migration (db.py _ensure_columns,
-- is_postgres branch): the revision backfill runs with ADD COLUMN IF NOT
-- EXISTS and takes the table DDL lock while backfilling existing rows to 0.

-- +goose Up
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journal_entries ADD COLUMN voucher_no VARCHAR(64);
ALTER TABLE journal_entries ADD COLUMN period VARCHAR(16);
ALTER TABLE journal_entries ADD COLUMN memo TEXT;
ALTER TABLE journal_entries ADD COLUMN reject_reason TEXT;
ALTER TABLE journal_entries ADD COLUMN submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE journal_entries ADD COLUMN reversal_of_journal_id VARCHAR(64);
ALTER TABLE journal_entries ADD COLUMN basis VARCHAR(24);
ALTER TABLE journal_entries ADD COLUMN review_notes TEXT;
ALTER TABLE journal_entries ADD COLUMN entry_layer VARCHAR(24);
ALTER TABLE journal_entries ADD COLUMN proposal_json TEXT;
CREATE INDEX ix_journal_entries_voucher_no ON journal_entries (voucher_no);
CREATE INDEX ix_journal_entries_period ON journal_entries (period);
CREATE INDEX ix_journal_entries_entry_layer ON journal_entries (entry_layer);

-- +goose Down
DROP INDEX ix_journal_entries_entry_layer;
DROP INDEX ix_journal_entries_period;
DROP INDEX ix_journal_entries_voucher_no;
ALTER TABLE journal_entries DROP COLUMN proposal_json;
ALTER TABLE journal_entries DROP COLUMN entry_layer;
ALTER TABLE journal_entries DROP COLUMN review_notes;
ALTER TABLE journal_entries DROP COLUMN basis;
ALTER TABLE journal_entries DROP COLUMN reversal_of_journal_id;
ALTER TABLE journal_entries DROP COLUMN submitted_at;
ALTER TABLE journal_entries DROP COLUMN reject_reason;
ALTER TABLE journal_entries DROP COLUMN memo;
ALTER TABLE journal_entries DROP COLUMN period;
ALTER TABLE journal_entries DROP COLUMN voucher_no;
ALTER TABLE journal_entries DROP COLUMN revision;
