-- 0006 adds the voucher/revision columns to journal_entries, mirroring the
-- "wanted" additive list in db.py _ensure_columns (BL-02 revision first, then
-- the voucher fields). Existing rows keep their data and get the column
-- defaults: revision 0 on every pre-existing journal.
--
-- Reconciliation beyond the reference: _ensure_columns only adds columns and
-- never creates the indexes that a fresh create_all declares on the new
-- columns (voucher_no, period, entry_layer carry index=True on the models).
-- 0006 creates them so a legacy-upgraded database ends identical to a fresh
-- one (fixture: backend-go/fixtures/chainparity/python_ledger.db).

-- +goose Up
-- Token order DEFAULT '0' NOT NULL matches what create_all stores, so the
-- end state compares clean against the fixture.
ALTER TABLE journal_entries ADD COLUMN revision INTEGER DEFAULT '0' NOT NULL;
ALTER TABLE journal_entries ADD COLUMN voucher_no VARCHAR(64);
ALTER TABLE journal_entries ADD COLUMN period VARCHAR(16);
ALTER TABLE journal_entries ADD COLUMN memo TEXT;
ALTER TABLE journal_entries ADD COLUMN reject_reason TEXT;
ALTER TABLE journal_entries ADD COLUMN submitted_at DATETIME;
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
