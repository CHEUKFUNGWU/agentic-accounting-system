-- 0002 renames the retired extended-trial-balance table (same step as the
-- SQLite dialect: the first hand-written migration of the frozen Python
-- reference, db.py _ensure_columns).
--
-- Note on the reference: on PostgreSQL the reference never ran the vocabulary
-- renames (_ensure_columns is SQLite-only apart from the revision backfill),
-- so a legacy PG database cannot actually be opened by current Python code.
-- The goose set ports the renames to PostgreSQL anyway so both dialects share
-- one migration history and legacy PG shapes can upgrade in place (P2 gate).
--
-- Reconciliation: index names created under etb_accounts are renamed to the
-- names a fresh create_all produces on the current table.

-- +goose Up
ALTER TABLE etb_accounts RENAME TO trial_balance_accounts;
ALTER INDEX ix_etb_accounts_entity_code RENAME TO ix_trial_balance_accounts_entity_code;
ALTER INDEX ix_etb_accounts_account_code RENAME TO ix_trial_balance_accounts_account_code;

-- +goose Down
ALTER INDEX ix_trial_balance_accounts_entity_code RENAME TO ix_etb_accounts_entity_code;
ALTER INDEX ix_trial_balance_accounts_account_code RENAME TO ix_etb_accounts_account_code;
ALTER TABLE trial_balance_accounts RENAME TO etb_accounts;
