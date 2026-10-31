package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// Shared read mappings for the two adapters: column lists and scan helpers
// for the rows both dialects serve identically. The adapters cast timestamps
// to text and booleans to int in their dialect so every column scans as a
// string or integer; the renderTS hook converts stored timestamps to the ISO
// wire form. Adapter plumbing, not caller surface.

// DocumentColumns is the documents read list (created_at/posted_at cast to
// text by the adapter).
var DocumentColumns = []string{
	"document_id", "entity_code", "doc_type", "doc_date", "counterparty_id",
	"counterparty_name", "amount", "currency", "status", "journal_id",
	"filename", "stored_name", "mime", "size", "sha256", "uploaded_by",
	"note", "created_at", "posted_at",
}

// ScanDocument scans one documents row into the wire form.
func ScanDocument(scan func(dest ...any) error, renderTS func(string) (string, error)) (Document, error) {
	var d Document
	var counterpartyID, journalID sql.NullString
	var createdAt, postedAt sql.NullString
	var size sql.NullInt64
	if err := scan(&d.DocumentID, &d.EntityCode, &d.DocType, &d.DocDate,
		&counterpartyID, &d.CounterpartyName, &d.Amount, &d.Currency,
		&d.Status, &journalID, &d.Filename, &d.StoredName, &d.Mime,
		&size, &d.SHA256, &d.UploadedBy, &d.Note, &createdAt, &postedAt); err != nil {
		return Document{}, err
	}
	if counterpartyID.Valid {
		d.CounterpartyID = &counterpartyID.String
	}
	if journalID.Valid {
		d.JournalID = &journalID.String
	}
	d.Size = size.Int64
	if createdAt.Valid {
		iso, err := renderTS(createdAt.String)
		if err != nil {
			return Document{}, err
		}
		d.CreatedAt = iso
	}
	if postedAt.Valid {
		iso, err := renderTS(postedAt.String)
		if err != nil {
			return Document{}, err
		}
		d.PostedAt = &iso
	}
	return d, nil
}

// AuditColumns is the mcp_audit_logs read list (created_at cast to text).
var AuditColumns = []string{
	"log_id", "position", "principal_key", "tool", "outcome", "error_code",
	"error_message", "entity_code", "journal_id", "params_json",
	"document_sha256s", "duration_ms", "created_at",
}

// ScanAudit scans one mcp_audit_logs row.
func ScanAudit(scan func(dest ...any) error, renderTS func(string) (string, error)) (AuditRecord, error) {
	var r AuditRecord
	var errorCode, errorMessage, entityCode, journalID sql.NullString
	var durationMs sql.NullInt64
	var createdAt sql.NullString
	if err := scan(&r.LogID, &r.Position, &r.PrincipalKey, &r.Tool, &r.Outcome,
		&errorCode, &errorMessage, &entityCode, &journalID, &r.ParamsJSON,
		&r.DocumentSHA256s, &durationMs, &createdAt); err != nil {
		return AuditRecord{}, err
	}
	if errorCode.Valid {
		r.ErrorCode = &errorCode.String
	}
	if errorMessage.Valid {
		r.ErrorMessage = &errorMessage.String
	}
	if entityCode.Valid {
		r.EntityCode = &entityCode.String
	}
	if journalID.Valid {
		r.JournalID = &journalID.String
	}
	r.DurationMs = nil
	if durationMs.Valid {
		v := durationMs.Int64
		r.DurationMs = &v
	}
	if createdAt.Valid {
		iso, err := renderTS(createdAt.String)
		if err != nil {
			return AuditRecord{}, err
		}
		r.CreatedAt = iso
	}
	return r, nil
}

// PeriodColumns is the fiscal_periods read list (closed_at/created_at cast
// to text).
var PeriodColumns = []string{
	"period_id", "entity_code", "period_code", "fiscal_year", "period_number",
	"start_date", "end_date", "status", "closed_by_principal_key", "closed_at",
	"created_at",
}

// ScanPeriod scans one fiscal_periods row into the ledger value type.
func ScanPeriod(scan func(dest ...any) error, renderTS func(string) (string, error)) (ledger.Period, error) {
	var p ledger.Period
	var closedBy, closedAt sql.NullString
	var fiscalYear, periodNumber sql.NullInt64
	var createdAt sql.NullString
	if err := scan(&p.PeriodID, &p.EntityCode, &p.PeriodCode, &fiscalYear,
		&periodNumber, &p.StartDate, &p.EndDate, &p.Status, &closedBy,
		&closedAt, &createdAt); err != nil {
		return ledger.Period{}, err
	}
	if fiscalYear.Valid {
		p.FiscalYear = int(fiscalYear.Int64)
	}
	if periodNumber.Valid {
		p.PeriodNumber = int(periodNumber.Int64)
	}
	if closedBy.Valid {
		p.ClosedByPrincipalKey = &closedBy.String
	}
	if closedAt.Valid {
		iso, err := renderTS(closedAt.String)
		if err != nil {
			return ledger.Period{}, err
		}
		p.ClosedAt = &iso
	}
	return p, nil
}

// AccountColumns is the chart_of_accounts read list; the adapter aliases
// default_statement_ref AS statement_ref and casts the booleans to int. The
// entity_code column is not read: the query is already entity-scoped and the
// ledger.Account value type does not carry it.
var AccountColumns = []string{
	"account_id", "parent_account_id", "account_code",
	"account_name", "account_type", "normal_balance", "fs_category",
	"statement_ref", "cash_flow_activity", "is_control_account",
	"allow_manual_je", "tax_code_default", "is_active", "effective_from",
	"effective_to", "created_at",
}

// ScanAccount scans one chart_of_accounts row into the ledger value type.
func ScanAccount(scan func(dest ...any) error) (ledger.Account, error) {
	var a ledger.Account
	var parentID, taxDefault sql.NullString
	var isControl, allowManual, isActive sql.NullInt64
	var discard sql.NullString
	if err := scan(&a.AccountID, &parentID, &a.AccountCode,
		&a.AccountName, &a.AccountType, &a.NormalBalance, &a.FSCategory,
		&a.StatementRef, &a.CashFlowActivity, &isControl, &allowManual,
		&taxDefault, &isActive, &discard, &discard, &discard); err != nil {
		return ledger.Account{}, err
	}
	if parentID.Valid {
		a.ParentAccountID = &parentID.String
	}
	if taxDefault.Valid {
		a.TaxCodeDefault = &taxDefault.String
	}
	a.IsControlAccount = isControl.Int64 != 0
	a.AllowManualJE = allowManual.Int64 != 0
	a.IsActive = isActive.Int64 != 0
	return a, nil
}

// LineColumns is the journal_lines read list (created_at cast to text).
var LineColumns = []string{
	"line_id", "journal_id", "entity_code", "line_number", "account_id",
	"account_code", "account_name", "period_code", "entry_layer",
	"accounting_date", "tx_currency", "exchange_rate", "tx_debit",
	"tx_credit", "func_debit", "func_credit", "counterparty_id",
	"counterparty_name", "tax_code_id", "func_tax_amount", "business_use_pct",
	"statement_ref", "memo", "created_at",
}

// ScanLine scans one journal_lines row into the persisted line shape (money
// strings verbatim). created_at is read and discarded: the persisted line
// shape the reversal and projection rules read has no timestamp.
func ScanLine(scan func(dest ...any) error) (voucher.LedgerLine, error) {
	var l voucher.LedgerLine
	var counterpartyID, taxCodeID sql.NullString
	var lineNumber sql.NullInt64
	var discard sql.NullString
	if err := scan(&l.LineID, &l.JournalID, &l.EntityCode, &lineNumber,
		&l.AccountID, &l.AccountCode, &l.AccountName, &l.PeriodCode,
		&l.EntryLayer, &l.AccountingDate, &l.TxCurrency, &l.ExchangeRate,
		&l.TxDebit, &l.TxCredit, &l.FuncDebit, &l.FuncCredit,
		&counterpartyID, &l.CounterpartyName, &taxCodeID, &l.FuncTaxAmount,
		&l.BusinessUsePct, &l.StatementRef, &l.Memo, &discard); err != nil {
		return voucher.LedgerLine{}, err
	}
	l.LineNumber = lineNumber.Int64
	if counterpartyID.Valid {
		l.CounterpartyID = &counterpartyID.String
	}
	if taxCodeID.Valid {
		l.TaxCodeID = &taxCodeID.String
	}
	return l, nil
}

// ReceiptColumns is the command_receipts read list (the BL-28 table; see the
// package doc for the DDL the goose migration must add). The composed
// receipt_key column is the lookup key; the read returns its parts.
var ReceiptColumns = []string{
	"principal_key", "entity_code", "payload_hash",
	"command_id", "outcome_json", "created_at",
}

// ScanReceipt scans one command_receipts row.
func ScanReceipt(scan func(dest ...any) error, renderTS func(string) (string, error)) (Receipt, error) {
	var r Receipt
	var createdAt sql.NullString
	if err := scan(&r.Key.PrincipalKey, &r.Key.EntityCode, &r.Key.PayloadHash,
		&r.CommandID, &r.Outcome, &createdAt); err != nil {
		return Receipt{}, err
	}
	if createdAt.Valid {
		iso, err := renderTS(createdAt.String)
		if err != nil {
			return Receipt{}, err
		}
		r.CreatedAt = iso
	}
	return r, nil
}

// ParseHashLines decodes a lines_json value into the pure rule's line shape:
// a key present with a value keeps it (even empty), absent or null stays
// nil — exactly the reference's l.get(key, default) reads. Both adapters
// feed VerifyChain with it.
func ParseHashLines(linesJSON string) ([]positions.HashLine, error) {
	if strings.TrimSpace(linesJSON) == "" {
		return nil, nil
	}
	var lines []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(linesJSON), &lines); err != nil {
		return nil, fmt.Errorf("store: lines_json: %w", err)
	}
	out := make([]positions.HashLine, 0, len(lines))
	for _, l := range lines {
		var h positions.HashLine
		if v, ok := stringPtr(l["line_number"]); ok {
			var n int64
			if err := json.Unmarshal(v, &n); err != nil {
				return nil, fmt.Errorf("store: lines_json line_number: %w", err)
			}
			h.LineNumber = &n
		}
		if v, ok := stringPtr(l["account_code"]); ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil {
				h.AccountCode = &s
			}
		}
		if v, ok := stringPtr(l["debit"]); ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil {
				h.Debit = &s
			}
		}
		if v, ok := stringPtr(l["credit"]); ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil {
				h.Credit = &s
			}
		}
		out = append(out, h)
	}
	return out, nil
}

func stringPtr(raw json.RawMessage) (json.RawMessage, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false
	}
	return raw, true
}
