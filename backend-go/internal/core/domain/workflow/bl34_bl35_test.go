package workflow

import (
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// testPeriods is the fiscal-period state the date tests run against: the
// prior month closed, the workspace month open.
func testPeriods() []ledger.Period {
	return []ledger.Period{
		{PeriodID: "MONOLITH:2026-09", EntityCode: workspaceEntity, PeriodCode: "2026-09",
			StartDate: "2026-09-01", EndDate: "2026-09-30", Status: "LOCKED"},
		{PeriodID: "MONOLITH:2026-10", EntityCode: workspaceEntity, PeriodCode: "2026-10",
			StartDate: "2026-10-01", EndDate: "2026-10-31", Status: "OPEN"},
	}
}

// TestBL34_dates_supplied_and_late_documents_route_to_correction reproduces
// the audit scenario (BL-34): with today outside the workspace period, the
// reference's posting_date stamped every invoice and bill with the period's
// FIRST DAY (2026-10-01), so a supplier invoice dated 2026-09-20 was
// recognized in the current period with a fabricated date. The fixed rule:
// document date and accounting date are separate and supplied, the
// accounting date validates against the open periods, and a late document
// routes to the correction process — never a default.
func TestBL34_dates_supplied_and_late_documents_route_to_correction(t *testing.T) {
	periods := testPeriods()

	// The reference's default produced 2026-10-01 from an absent date. The
	// port refuses instead: neither date is ever defaulted.
	if _, err := ValidateDocumentDates("", "2026-10-15", "2026-10", periods); err == nil || errKind(err) != "missing_document_date" {
		t.Fatalf("missing document date err = %v, want missing_document_date", err)
	}
	if _, err := ValidateDocumentDates("2026-09-20", "", "2026-10", periods); err == nil || errKind(err) != "missing_accounting_date" {
		t.Fatalf("missing accounting date err = %v, want missing_accounting_date", err)
	}
	// The entry-level default is gone too.
	if _, err := ValidateEntryDate("", "2026-10"); err == nil || errKind(err) != "missing_accounting_date" {
		t.Fatalf("missing entry date err = %v, want missing_accounting_date", err)
	}

	// The late document: dated 2026-09-20 (period LOCKED), recognized on the
	// supplied accounting date in the open period. It routes to the
	// correction process, and no defaulted date appears anywhere.
	late, err := ValidateDocumentDates("2026-09-20", "2026-10-15", "2026-10", periods)
	if err != nil {
		t.Fatalf("late document: %v", err)
	}
	if late.Routing != RouteCorrection || !late.LateDocument {
		t.Fatalf("decision = %+v, want correction routing", late)
	}
	if strings.Contains(late.DocumentDate+late.AccountingDate, "2026-10-01") {
		t.Fatalf("decision carries the first-of-month default: %+v", late)
	}
	// A document inside the open period books normally.
	same, err := ValidateDocumentDates("2026-10-05", "2026-10-15", "2026-10", periods)
	if err != nil {
		t.Fatalf("in-period document: %v", err)
	}
	if same.Routing != RouteBook || same.LateDocument {
		t.Fatalf("decision = %+v, want normal booking", same)
	}

	// Refusals: a document dated after its accounting date, an accounting
	// date outside the labeled period, and a locked accounting period.
	if _, err := ValidateDocumentDates("2026-10-20", "2026-10-15", "2026-10", periods); err == nil || errKind(err) != "document_after_accounting_date" {
		t.Fatalf("future document err = %v, want document_after_accounting_date", err)
	}
	if _, err := ValidateDocumentDates("2026-09-20", "2026-09-25", "2026-10", periods); err == nil || errKind(err) != "period_date_mismatch" {
		t.Fatalf("period mismatch err = %v, want period_date_mismatch", err)
	}
	if _, err := ValidateDocumentDates("2026-09-20", "2026-09-25", "2026-09", periods); err == nil || errKind(err) != "period_locked" {
		t.Fatalf("locked accounting date err = %v, want period_locked", err)
	}
	// Impossible dates refuse through the shared real-date rule.
	if _, err := ValidateDocumentDates("2026-02-30", "2026-10-15", "2026-10", periods); err == nil || errKind(err) != "invalid_date" {
		t.Fatalf("impossible document date err = %v, want invalid_date", err)
	}
}

// TestBL35_aging_derived_from_due_date_at_query_time reproduces the audit
// scenario (BL-35): the reference stored every invoice with the bucket
// "Current" and never recomputed it, so overdue receivables stayed Current.
// The Go rule derives the bucket from the due date and an as-of date at
// query time; the record carries no bucket field at all.
func TestBL35_aging_derived_from_due_date_at_query_time(t *testing.T) {
	// The seed's own rows (monolith_seed.json): INV-9015 due 2026-09-24 was
	// stored "Current" while already overdue; INV-9021 due 2026-08-29 stored
	// "61-90d" only because a human seeded it. The Go record type carries no
	// bucket field at all — the bucket is derived from the due date.
	invoice := Receivable{
		ID: "INV-9015", Customer: "Millennium Partners LP",
		IssueDate: "2026-08-25", DueDate: "2026-09-24",
		RevenueAccountCode: "4010", Amount: mustMoneyT(t, "95000.0000"), Status: "Open",
	}
	bucket, days, err := DeriveAgingBucket(invoice.DueDate, "2026-10-31")
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if bucket != Bucket31to60 || days != 37 {
		t.Fatalf("bucket/days = %s/%d, want 31-60d/37", bucket, days)
	}
	// 61-90 and 90+ boundaries (as-of 2026-10-31).
	if b, _, _ := DeriveAgingBucket("2026-08-29", "2026-10-31"); b != Bucket61to90 {
		t.Fatalf("INV-9021 bucket = %s, want 61-90d", b)
	}
	if b, _, _ := DeriveAgingBucket("2026-07-31", "2026-10-31"); b != Bucket90Plus {
		t.Fatalf("92-days-past bucket = %s, want 90+d", b)
	}
	if b, _, _ := DeriveAgingBucket("2026-10-31", "2026-10-31"); b != BucketCurrent {
		t.Fatalf("due-today bucket = %s, want Current", b)
	}
	if b, _, _ := DeriveAgingBucket("2026-11-15", "2026-10-31"); b != BucketCurrent {
		t.Fatalf("not-yet-due bucket = %s, want Current", b)
	}
	// A stored bucket could drift with no as-of argument; deriving refuses a
	// malformed due date instead of guessing.
	if _, _, err := DeriveAgingBucket("24/09/2026", "2026-10-31"); err == nil {
		t.Fatal("malformed due date accepted")
	}

	// The query-time summary over the seed's receivables: outstanding
	// balances grouped by derived bucket; the paid invoice contributes
	// nothing.
	open := []Receivable{
		{ID: "INV-9012", DueDate: "2026-10-31", Amount: mustMoneyT(t, "145000.0000"), Status: "Open"},
		{ID: "INV-9015", DueDate: "2026-09-24", Amount: mustMoneyT(t, "95000.0000"), Status: "Open"},
		{ID: "INV-9018", DueDate: "2026-11-04", Amount: mustMoneyT(t, "70000.0000"), Status: "Open"},
		{ID: "INV-9021", DueDate: "2026-08-29", Amount: mustMoneyT(t, "65000.0000"), Status: "Open"},
		{ID: "INV-9008", DueDate: "2026-10-16", Amount: mustMoneyT(t, "185000.0000"), PaidAmount: mustMoneyT(t, "185000.0000"), Status: "Paid"},
	}
	summary, err := AgingSummary(open, "2026-10-31")
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	checks := map[string]string{
		BucketCurrent: "215000", Bucket1to30: "0", Bucket31to60: "95000", Bucket61to90: "65000", Bucket90Plus: "0",
	}
	for bucket, want := range checks {
		w := mustMoneyT(t, want)
		if !summary[bucket].Equal(w) {
			t.Fatalf("bucket %s = %s, want %s", bucket, summary[bucket], w)
		}
	}
}
