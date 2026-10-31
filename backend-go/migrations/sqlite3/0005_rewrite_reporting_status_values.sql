-- 0005 rewrites legacy reporting-status values, mirroring the UPDATE in
-- db.py _ensure_columns: once the column is named reporting_status, values
-- from the retired CPA workflow map onto the reviewed/locked workflow.
-- CPA_SIGNED_LOCKED -> REVIEWED_AND_LOCKED, READY_FOR_CPA -> READY.

-- +goose Up
UPDATE entities SET reporting_status = CASE reporting_status
	WHEN 'CPA_SIGNED_LOCKED' THEN 'REVIEWED_AND_LOCKED'
	WHEN 'READY_FOR_CPA' THEN 'READY' ELSE reporting_status END
WHERE reporting_status IN ('CPA_SIGNED_LOCKED', 'READY_FOR_CPA');

-- +goose Down
-- NO OP on purpose. The rewrite is a lossy value normalization: a READY row
-- may have been READY all along or downgraded from READY_FOR_CPA, and
-- REVIEWED_AND_LOCKED rows were not all CPA_SIGNED_LOCKED. Rewriting values
-- back would fabricate pack history on an audit-bearing table, so the down
-- migration leaves data alone and only the schema vocabulary reverts (0004).
