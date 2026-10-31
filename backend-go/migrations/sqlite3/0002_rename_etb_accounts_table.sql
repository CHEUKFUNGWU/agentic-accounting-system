-- 0002 renames the retired extended-trial-balance table, mirroring the first
-- hand-written step of the frozen Python reference (db.py _ensure_columns):
-- "the retired table was named after the old extended-trial-balance design;
-- balances are derived now, so it is just the trial balance".
--
-- Reconciliation: the reference only renames the table and leaves the index
-- names created under etb_accounts in place (SQLite indexes follow the table
-- but keep their names). A fresh create_all names them after the current
-- table, so 0002 recreates them under the current names — otherwise a
-- legacy-upgraded database would end with ix_etb_accounts_* and never match
-- the fixture (backend-go/fixtures/chainparity/python_ledger.db).

-- +goose Up
ALTER TABLE etb_accounts RENAME TO trial_balance_accounts;
DROP INDEX ix_etb_accounts_entity_code;
DROP INDEX ix_etb_accounts_account_code;
CREATE INDEX ix_trial_balance_accounts_entity_code ON trial_balance_accounts (entity_code);
CREATE INDEX ix_trial_balance_accounts_account_code ON trial_balance_accounts (account_code);

-- +goose Down
ALTER TABLE trial_balance_accounts RENAME TO etb_accounts;
DROP INDEX ix_trial_balance_accounts_entity_code;
DROP INDEX ix_trial_balance_accounts_account_code;
CREATE INDEX ix_etb_accounts_entity_code ON etb_accounts (entity_code);
CREATE INDEX ix_etb_accounts_account_code ON etb_accounts (account_code);
