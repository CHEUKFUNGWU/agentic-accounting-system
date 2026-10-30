package workflow

import (
	"time"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the receivables workflow of backend/app/core/monolith.py —
// invoice.create (lines 179–187) and invoice.collect (lines 188–195) — over
// value types, and replaces the stored aging bucket with the BL-35 derived
// aging.
//
// The reference stored every new invoice with agingBucket "Current" and
// reset it to "Current" on collection; no code recomputed the bucket from
// the due date, so overdue receivables stayed "Current" forever. The fixed
// rule derives the bucket from the due date and an as-of date at query time;
// nothing stores a bucket.

// Receivable is one receivable (the reference's receivables row) without the
// aging-bucket column: the bucket is derived, never stored (BL-35).
type Receivable struct {
	ID                 string      `json:"id"`
	Customer           string      `json:"customer"`
	IssueDate          string      `json:"issue_date"`
	DueDate            string      `json:"due_date"`
	RevenueAccountCode string      `json:"revenue_account_code"`
	Amount             money.Money `json:"amount"`
	PaidAmount         money.Money `json:"paid_amount"`
	Status             string      `json:"status"` // "Open" | "Overdue" | "Paid"
	// OriginalEntryID is the journal entry that posted the charge (the
	// receivables-control posting this document resolves).
	OriginalEntryID string `json:"original_entry_id"`
}

// Outstanding reports the still-collectible balance.
func (r Receivable) Outstanding() money.Money {
	return r.Amount.Sub(r.PaidAmount)
}

// NewReceivable is RecordReceivable's input. The issue date is the document
// date the caller supplies (BL-34 — the reference defaulted it through
// posting_date) and the due date is required.
type NewReceivable struct {
	Customer           string
	IssueDate          string
	DueDate            string
	RevenueAccountCode string
	Amount             money.Money
	OriginalEntryID    string
}

// RecordReceivable ports invoice.create's record construction: a positive
// amount, an eligible revenue account, explicit document dates, and no
// stored aging bucket. The charge entry is the caller's:
// Pair(AccountReceivablesControl, revenueAccount, amount) through
// BuildJournalEntry, with the entry ID linked into the record.
func RecordReceivable(in NewReceivable, receivableID string, chart []ChartAccount) (Receivable, error) {
	customer, err := ValidateText(in.Customer, "customer", 500)
	if err != nil {
		return Receivable{}, err
	}
	var zero money.Money
	if in.Amount.Cmp(zero) <= 0 {
		return Receivable{}, invalidAmount()
	}
	if _, err := FindEligibleAccount(chart, in.RevenueAccountCode, "Revenue"); err != nil {
		return Receivable{}, err
	}
	if in.IssueDate == "" {
		return Receivable{}, fail(ErrMissingDocumentDate,
			"MISSING_DOCUMENT_DATE: Supply the invoice's own date; it is never defaulted.")
	}
	if _, err := ValidateISODate(in.IssueDate, nil); err != nil {
		return Receivable{}, err
	}
	if _, err := ValidateISODate(in.DueDate, nil); err != nil {
		return Receivable{}, err
	}
	if in.OriginalEntryID == "" {
		return Receivable{}, fail(ErrMissingEntryLink,
			"MISSING_ENTRY_LINK: An invoice records the entry that posted its charge.")
	}
	return Receivable{
		ID:                 receivableID,
		Customer:           customer,
		IssueDate:          in.IssueDate,
		DueDate:            in.DueDate,
		RevenueAccountCode: in.RevenueAccountCode,
		Amount:             in.Amount,
		Status:             "Open",
		OriginalEntryID:    in.OriginalEntryID,
	}, nil
}

// CollectInvoice ports invoice.collect's state rule: the outstanding balance
// must be positive (ALREADY_PAID) and the collection settles the full
// balance, closing the invoice. The collection entry is the caller's:
// Pair(cashAccount, AccountReceivablesControl, collected) through
// BuildJournalEntry. The reference also reset the stored bucket to "Current"
// here; the derived aging needs no reset.
func CollectInvoice(r Receivable) (Receivable, money.Money, error) {
	collected := r.Outstanding()
	var zero money.Money
	if r.Status == "Paid" || collected.Cmp(zero) <= 0 {
		return Receivable{}, money.Money{}, fail(ErrAlreadyPaid,
			"ALREADY_PAID: This invoice has no outstanding balance.")
	}
	r.PaidAmount = r.Amount
	r.Status = "Paid"
	return r, collected, nil
}

// Aging buckets — the workspace's own bucket names (monolith_seed.json and
// the Monolith UI's AgingBucket union).
const (
	BucketCurrent = "Current"
	Bucket1to30   = "1-30d"
	Bucket31to60  = "31-60d"
	Bucket61to90  = "61-90d"
	Bucket90Plus  = "90+d"
)

// DeriveAgingBucket derives the receivable's aging at query time (BL-35):
// whole days the invoice is past due as of the as-of date, bucketed Current
// (not yet due), 1-30d, 31-60d, 61-90d and 90+d. Both dates are canonical
// YYYY-MM-DD; the day count is exact calendar arithmetic.
func DeriveAgingBucket(dueDate, asOf string) (string, int, error) {
	due, err := parseDay(dueDate)
	if err != nil {
		return "", 0, fail(ErrInvalidDate, "INVALID_DATE: Use YYYY-MM-DD.")
	}
	asOfDate, err := parseDay(asOf)
	if err != nil {
		return "", 0, fail(ErrInvalidDate, "INVALID_DATE: Use YYYY-MM-DD.")
	}
	days := int(asOfDate.Sub(due).Hours() / 24)
	switch {
	case days <= 0:
		return BucketCurrent, days, nil
	case days <= 30:
		return Bucket1to30, days, nil
	case days <= 60:
		return Bucket31to60, days, nil
	case days <= 90:
		return Bucket61to90, days, nil
	default:
		return Bucket90Plus, days, nil
	}
}

// parseDay parses a canonical calendar date exactly.
func parseDay(s string) (time.Time, error) {
	return time.Parse("2006-01-02", s)
}

// AgingSummary totals the outstanding balances by derived bucket as of the
// as-of date. Only still-collectible balances enter the summary; every
// bucket is present so a reader never mistakes an empty bucket for a missing
// one.
func AgingSummary(receivables []Receivable, asOf string) (map[string]money.Money, error) {
	out := map[string]money.Money{
		BucketCurrent: {}, Bucket1to30: {}, Bucket31to60: {}, Bucket61to90: {}, Bucket90Plus: {},
	}
	var zero money.Money
	for _, r := range receivables {
		outstanding := r.Outstanding()
		if outstanding.Cmp(zero) <= 0 {
			continue
		}
		bucket, _, err := DeriveAgingBucket(r.DueDate, asOf)
		if err != nil {
			return nil, err
		}
		out[bucket] = out[bucket].Add(outstanding)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Subledger view — the BL-10 allocation checks' read model
// ---------------------------------------------------------------------------

// SubledgerView carries the subledger documents an ordinary control-account
// posting may allocate to (the store supplies them).
type SubledgerView struct {
	Receivables []Receivable `json:"receivables"`
	Payables    []BillRecord `json:"payables"`
}

func (v SubledgerView) receivable(id string) (Receivable, bool) {
	for _, r := range v.Receivables {
		if r.ID == id {
			return r, true
		}
	}
	return Receivable{}, false
}

func (v SubledgerView) payable(id string) (BillRecord, bool) {
	for _, b := range v.Payables {
		if b.ID == id {
			return b, true
		}
	}
	return BillRecord{}, false
}
