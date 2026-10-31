-- 0007 adds the BL-28 command-receipts table — the one NEW-behaviour table in
-- this set: no Python reference schema holds it, so it sits deliberately
-- outside the 0001..0006 fixture-equality surface (migrations_test.go excludes
-- it from the comparison and asserts its shape separately).
--
-- ReceiptKey = principal + entity + payload hash (sha256 hex of the canonical
-- JSON command payload). receipt_key stores the composed key the store layer
-- builds (principal \n entity \n payload_hash — at most 162 characters from
-- the component widths below) and its PRIMARY KEY is the uniqueness the
-- insert-if-absent put relies on: a retried or concurrent same-key command
-- resolves with the first stored receipt and never overwrites it
-- (engineering workflow §3 timeout rule). The component columns are stored
-- alongside so reads return the key parts directly.
--
-- Deliberately absent:
--   - foreign keys: a receipt must outlive the principal it names; removing
--     a position row must never cascade a replay-proof away;
--   - a CHECK tying receipt_key to its parts: SQLite's INSERT OR IGNORE
--     swallows CHECK violations silently and would report corruption as
--     "already existed" (false idempotency); the store suite's put/read
--     round-trip carries that invariant instead.

-- +goose Up
CREATE TABLE command_receipts (
	receipt_key TEXT NOT NULL,
	principal_key VARCHAR(64) NOT NULL,
	entity_code VARCHAR(32) NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	command_id VARCHAR(64) NOT NULL,
	outcome_json TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (receipt_key)
);

-- +goose Down
DROP TABLE command_receipts;
