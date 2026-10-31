package workflow

import (
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// This file ports the date rules of backend/app/core/monolith.py and replaces
// its BL-34 defect. The reference's posting_date (monolith.py:80–83) stamped
// every invoice and bill with today's date when today fell in the workspace
// period and with the period's FIRST DAY otherwise — a supplier invoice dated
// in a prior period was recognized in the current one with a fabricated
// date. Control C04 (accounting-control matrix) forbids exactly that:
// 交易日、文件日、會計日可區分；遲到單據進明確更正流程，不默認回填某月第一天.
//
// The fixed rule, per the review record's Required text:
//
//   - the document date and the accounting date are separate and BOTH must be
//     supplied — there is no default, first-of-month or otherwise;
//   - the accounting date is validated against the open periods through the
//     ledger package (real date, period bounds, lock state);
//   - a late document (its date falls in a no-longer-writable period) routes
//     to the correction process instead of being silently booked.
//
// The P2 store adapter routes a correction decision to the correction
// workflow (a reversing entry in an open period linked to the late document,
// or an authorized reopen) — the routing decision is pure and lives here.

// DateRouting is the late-document decision: book the document on its
// accounting date, or route it to the correction process.
type DateRouting string

const (
	// RouteBook: the accounting date is writable; the document books normally.
	RouteBook DateRouting = "book"
	// RouteCorrection: the document is late (its date falls in a closed or
	// locked period); it goes to the correction process, never to a
	// defaulted date.
	RouteCorrection DateRouting = "correction"
)

// DocumentDateDecision is ValidateDocumentDates' outcome.
type DocumentDateDecision struct {
	DocumentDate   string      `json:"document_date"`
	AccountingDate string      `json:"accounting_date"`
	Routing        DateRouting `json:"routing"`
	// LateDocument is true exactly when Routing is correction.
	LateDocument bool   `json:"late_document"`
	Reason       string `json:"reason"`
}

// ValidateDocumentDates applies the BL-34 rule to one document. period is the
// workspace's open period label (YYYY-MM) the accounting date must carry;
// periods is the entity's fiscal-period state (ledger.Period rows).
//
// Refusals: a missing document or accounting date (the reference would have
// defaulted — the port refuses), a non-canonical or impossible date, an
// accounting date outside the labeled period, a locked accounting period, and
// a document dated after its accounting date.
func ValidateDocumentDates(documentDate, accountingDate, period string, periods []ledger.Period) (DocumentDateDecision, error) {
	if documentDate == "" {
		return DocumentDateDecision{}, fail(ErrMissingDocumentDate,
			"MISSING_DOCUMENT_DATE: Supply the document's own date; it is never defaulted.")
	}
	if accountingDate == "" {
		return DocumentDateDecision{}, fail(ErrMissingAccountingDate,
			"MISSING_ACCOUNTING_DATE: Supply the accounting date; it is never defaulted to the period start.")
	}
	if _, err := ValidateISODate(documentDate, nil); err != nil {
		return DocumentDateDecision{}, err
	}
	// The accounting date must be a real date inside the labeled period
	// (ledger.ValidatePostingDate) and the period must actually be writable
	// (ledger.AssertWritable over the entity's period state). The workspace
	// is single-entity; the constant names it for the period lookup.
	if _, err := ledger.ValidatePostingDate(accountingDate, &period); err != nil {
		return DocumentDateDecision{}, err
	}
	if _, err := ledger.AssertWritable(workspaceEntity, period, &accountingDate, periods); err != nil {
		return DocumentDateDecision{}, err
	}
	if documentDate > accountingDate {
		return DocumentDateDecision{}, fail(ErrDocumentAfterAccounting,
			"DOCUMENT_AFTER_ACCOUNTING_DATE: "+documentDate+" is after the accounting date "+accountingDate+".")
	}
	decision := DocumentDateDecision{
		DocumentDate:   documentDate,
		AccountingDate: accountingDate,
		Routing:        RouteBook,
		Reason:         "accounting date is in a writable period",
	}
	// A document dated before the accounting period is late when its own
	// period is no longer writable: it routes to the correction process.
	// A document inside the same (writable) month, or inside a period still
	// open, books normally.
	if documentDate[:7] != accountingDate[:7] {
		docPeriod := documentDate[:7]
		if _, err := ledger.AssertWritable(workspaceEntity, docPeriod, &documentDate, periods); err != nil {
			decision.Routing = RouteCorrection
			decision.LateDocument = true
			decision.Reason = "document date " + documentDate + " falls in non-writable period " + docPeriod +
				"; route to the correction process, never default the date"
		} else {
			decision.Reason = "document period " + docPeriod + " is still writable"
		}
	}
	return decision, nil
}

// ValidateEntryDate is the entry-level half of the rule for postings that
// carry no document (journal.create): the accounting date must be supplied
// and valid against the labeled period. The reference's
// `iso_date(entry_date or posting_date(state), ...)` default is gone.
func ValidateEntryDate(entryDate, period string) (string, error) {
	if strings.TrimSpace(entryDate) == "" {
		return "", fail(ErrMissingAccountingDate,
			"MISSING_ACCOUNTING_DATE: Supply the accounting date; it is never defaulted to the period start.")
	}
	return ValidateISODate(entryDate, &period)
}
