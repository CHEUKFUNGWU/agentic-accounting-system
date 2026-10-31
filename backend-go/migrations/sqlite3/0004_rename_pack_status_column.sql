-- 0004 renames the reporting-pack vocabulary column on entities, mirroring
-- the "entities": {"reporting_status": "pack_status"} entry of the rename map
-- in db.py _ensure_columns (legacy pack_status -> current reporting_status).

-- +goose Up
ALTER TABLE entities RENAME COLUMN pack_status TO reporting_status;

-- +goose Down
ALTER TABLE entities RENAME COLUMN reporting_status TO pack_status;
