package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// This file carries the append-only surfaces: the mcp_audit_logs trail and
// the BL-28 command receipts.

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

func (s *Store) AppendAudit(ctx context.Context, rec store.AuditRecord) error {
	created := rec.CreatedAt
	if created != "" {
		ts, err := toTS(created)
		if err != nil {
			return fmt.Errorf("sqlite: audit created_at: %w", err)
		}
		created = ts
	}
	params := rec.ParamsJSON
	if params == "" {
		params = "{}"
	}
	sha256s := rec.DocumentSHA256s
	if sha256s == "" {
		sha256s = "[]"
	}
	outcome := rec.Outcome
	if outcome == "" {
		outcome = "OK"
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO mcp_audit_logs (log_id, position,
		principal_key, tool, outcome, error_code, error_message, entity_code,
		journal_id, params_json, document_sha256s, duration_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.LogID, rec.Position, rec.PrincipalKey, rec.Tool, outcome,
		rec.ErrorCode, rec.ErrorMessage, rec.EntityCode, rec.JournalID,
		params, sha256s, rec.DurationMs, created)
	if err != nil {
		return fmt.Errorf("sqlite: audit insert: %w", err)
	}
	return nil
}

func (s *Store) AuditLogs(ctx context.Context, q store.AuditQuery) ([]store.AuditRecord, error) {
	sqlStr := `SELECT ` + strings.Join(store.AuditColumns, ", ") + ` FROM mcp_audit_logs`
	var conds []string
	var args []any
	if q.EntityCode != "" {
		conds = append(conds, "entity_code = ?")
		args = append(args, q.EntityCode)
	}
	if q.Tool != "" {
		conds = append(conds, "tool = ?")
		args = append(args, q.Tool)
	}
	if q.PrincipalKey != "" {
		conds = append(conds, "principal_key = ?")
		args = append(args, q.PrincipalKey)
	}
	if len(conds) > 0 {
		sqlStr += " WHERE " + strings.Join(conds, " AND ")
	}
	sqlStr += " ORDER BY created_at DESC"
	limit := q.Limit
	if limit == 0 {
		limit = 200 // the reference's get_audit_logs default
	}
	sqlStr += fmt.Sprintf(" LIMIT %d", limit)
	rows, err := s.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: audit query: %w", err)
	}
	defer rows.Close()
	out := []store.AuditRecord{}
	for rows.Next() {
		r, err := store.ScanAudit(rows.Scan, renderTS)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Receipts (BL-28) — the command_receipts table is NEW behaviour whose DDL
// belongs in a goose migration (see the store package doc). Until that
// migration lands, every receipts call reports ErrReceiptsTableMissing.
// ---------------------------------------------------------------------------

// receiptsMissing reports the "table absent" error of the current schema.
func receiptsMissing(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such table")
}

func (s *Store) PutReceipt(ctx context.Context, cmd store.PutReceiptCommand) (store.Receipt, bool, error) {
	ts, err := toTS(cmd.At)
	if err != nil {
		return store.Receipt{}, false, fmt.Errorf("sqlite: receipt created_at: %w", err)
	}
	// Insert-if-absent: a retried or concurrent same-key put resolves with
	// the first stored receipt, never overwrites it (the timeout rule).
	res, execErr := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO command_receipts
		(receipt_key, principal_key, entity_code, payload_hash, command_id, outcome_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		cmd.Key.String(), cmd.Key.PrincipalKey, cmd.Key.EntityCode,
		cmd.Key.PayloadHash, cmd.CommandID, cmd.Outcome, ts)
	if execErr != nil {
		if receiptsMissing(execErr) {
			return store.Receipt{}, false, store.ErrReceiptsTableMissing
		}
		return store.Receipt{}, false, fmt.Errorf("sqlite: receipt put: %w", execErr)
	}
	inserted, err := res.RowsAffected()
	if err != nil {
		return store.Receipt{}, false, fmt.Errorf("sqlite: receipt put: %w", err)
	}
	row := s.db.QueryRowContext(ctx, `SELECT principal_key, entity_code, payload_hash,
		command_id, outcome_json, created_at FROM command_receipts WHERE receipt_key = ?`,
		cmd.Key.String())
	r, err := store.ScanReceipt(row.Scan, renderTS)
	if err != nil {
		return store.Receipt{}, false, fmt.Errorf("sqlite: receipt read: %w", err)
	}
	return r, inserted == 0, nil
}

func (s *Store) Receipt(ctx context.Context, key store.ReceiptKey) (store.Receipt, error) {
	row := s.db.QueryRowContext(ctx, `SELECT principal_key, entity_code, payload_hash,
		command_id, outcome_json, created_at FROM command_receipts WHERE receipt_key = ?`,
		key.String())
	r, err := store.ScanReceipt(row.Scan, renderTS)
	if err == sql.ErrNoRows {
		return store.Receipt{}, store.NotFound("RECEIPT_NOT_FOUND", "Receipt")
	}
	if err != nil {
		if receiptsMissing(err) {
			return store.Receipt{}, store.ErrReceiptsTableMissing
		}
		return store.Receipt{}, fmt.Errorf("sqlite: receipt read: %w", err)
	}
	return r, nil
}
