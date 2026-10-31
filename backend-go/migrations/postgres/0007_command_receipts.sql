-- 0007 adds the BL-28 command-receipts table (same step as the SQLite
-- dialect; see that file for the full rationale). New behaviour with no
-- Python counterpart: outside the 0001..0006 fixture-equality surface. The
-- PRIMARY KEY is the uniqueness the adapters' ON CONFLICT (receipt_key)
-- DO NOTHING resolves against; component columns mirror the audit log's
-- widths; created_at follows the set's TIMESTAMP WITH TIME ZONE convention
-- (the adapters read it with ::text).

-- +goose Up
CREATE TABLE command_receipts (
	receipt_key TEXT NOT NULL,
	principal_key VARCHAR(64) NOT NULL,
	entity_code VARCHAR(32) NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	command_id VARCHAR(64) NOT NULL,
	outcome_json TEXT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (receipt_key)
);

-- +goose Down
DROP TABLE command_receipts;
