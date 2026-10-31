-- 0003 renames the worksheet-vocabulary columns to the current audit
-- vocabulary, mirroring the rename map in db.py _ensure_columns (dict keys are
-- the new model names, values the legacy names; the reference renames
-- old_name -> new_name for every table that still carries the old one):
--   trial_balance_accounts: wp_ref -> statement_ref, aje_debit -> adjustment_debit,
--                           aje_credit -> adjustment_credit
--   journal_lines:          wp_ref -> statement_ref
--   custom_aje_log:         wp_ref -> statement_ref
--   chart_of_accounts:      default_wp_ref -> default_statement_ref
--
-- Data survives untouched: RENAME COLUMN rewrites the schema only.

-- +goose Up
ALTER TABLE trial_balance_accounts RENAME COLUMN wp_ref TO statement_ref;
ALTER TABLE trial_balance_accounts RENAME COLUMN aje_debit TO adjustment_debit;
ALTER TABLE trial_balance_accounts RENAME COLUMN aje_credit TO adjustment_credit;
ALTER TABLE journal_lines RENAME COLUMN wp_ref TO statement_ref;
ALTER TABLE custom_aje_log RENAME COLUMN wp_ref TO statement_ref;
ALTER TABLE chart_of_accounts RENAME COLUMN default_wp_ref TO default_statement_ref;

-- +goose Down
ALTER TABLE chart_of_accounts RENAME COLUMN default_statement_ref TO default_wp_ref;
ALTER TABLE custom_aje_log RENAME COLUMN statement_ref TO wp_ref;
ALTER TABLE journal_lines RENAME COLUMN statement_ref TO wp_ref;
ALTER TABLE trial_balance_accounts RENAME COLUMN adjustment_credit TO aje_credit;
ALTER TABLE trial_balance_accounts RENAME COLUMN adjustment_debit TO aje_debit;
ALTER TABLE trial_balance_accounts RENAME COLUMN statement_ref TO wp_ref;
