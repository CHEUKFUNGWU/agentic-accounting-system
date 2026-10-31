-- 0004 renames the reporting-pack vocabulary column on entities (same step as
-- the SQLite dialect; see the "entities": {"reporting_status": "pack_status"}
-- entry of the rename map in db.py _ensure_columns).

-- +goose Up
ALTER TABLE entities RENAME COLUMN pack_status TO reporting_status;

-- +goose Down
ALTER TABLE entities RENAME COLUMN reporting_status TO pack_status;
