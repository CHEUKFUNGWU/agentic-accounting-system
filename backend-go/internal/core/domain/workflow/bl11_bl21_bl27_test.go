package workflow

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// TestBL11_depreciation_requires_capitalization reproduces the audit
// scenario (BL-11): registering a 1,200 asset did not capitalize it, but a
// 12-month life allowed depreciation 100. The Go rule refuses the run until
// a validated capitalization link exists and reconciles; with the link the
// run produces the reference's own math (1200 ÷ 12 = 100.00/month).
func TestBL11_depreciation_requires_capitalization(t *testing.T) {
	asset, err := RegisterAsset(NewAsset{
		Name: "NVIDIA H100 Node", Category: "Compute Cluster", InServiceDate: "2026-10-01",
		UsefulLifeMonths: 12, CostBasis: mustMoneyT(t, "1200.0000"),
	}, "FA-200")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	// Python's outcome — a 100 depreciation on an uncaptalized register —
	// is refused.
	_, _, err = RunDepreciation([]AssetRecord{asset}, nil, testChart(), "2026-10")
	if err == nil || errKind(err) != "asset_not_capitalized" {
		t.Fatalf("uncaptalized run err = %v, want asset_not_capitalized", err)
	}

	// The linked acquisition: a POSTED entry capitalizing exactly the cost.
	capEntry := JournalEntry{
		ID: "JE-CAP-200", Date: "2026-10-01", Status: "Posted", Currency: "USD",
		Lines: []EntryLine{
			{LineNumber: 1, AccountCode: "1610", Debit: mustMoneyT(t, "1200.0000")},
			{LineNumber: 2, AccountCode: "2010", Credit: mustMoneyT(t, "1200.0000")},
		},
	}
	capitalized := CapitalizeAsset(asset, "JE-CAP-200", "1610")
	// Fail-closed variants: a draft entry and a mismatched amount. Each
	// variant copies its lines (the slice backs both copies).
	draft := capEntry
	draft.Status = "Draft"
	if _, _, err := RunDepreciation([]AssetRecord{capitalized}, []JournalEntry{draft}, testChart(), "2026-10"); err == nil || errKind(err) != "capitalization_not_posted" {
		t.Fatalf("draft capitalization err = %v, want capitalization_not_posted", err)
	}
	short := capEntry
	short.Lines = append([]EntryLine(nil), capEntry.Lines...)
	short.Lines[0].Debit = mustMoneyT(t, "1100.0000")
	if _, _, err := RunDepreciation([]AssetRecord{capitalized}, []JournalEntry{short}, testChart(), "2026-10"); err == nil || errKind(err) != "capitalization_amount_mismatch" {
		t.Fatalf("mismatched capitalization err = %v, want capitalization_amount_mismatch", err)
	}

	// The validated run: 1200/12 = 100.00 exactly.
	results, total, err := RunDepreciation([]AssetRecord{capitalized}, []JournalEntry{capEntry}, testChart(), "2026-10")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(results) != 1 || !results[0].Amount.Equal(mustMoneyT(t, "100.00")) {
		t.Fatalf("results = %+v, want 100.00 for FA-200", results)
	}
	if !total.Equal(mustMoneyT(t, "100.00")) || !results[0].AccumulatedDepreciation.Equal(mustMoneyT(t, "100.00")) {
		t.Fatalf("total/accumulated = %s/%s, want 100.00", total, results[0].AccumulatedDepreciation)
	}
	// The posting pair is the reference's own: depreciation expense against
	// the accumulated-depreciation contra account.
	lines := Pair("6900", "1590", total)
	entry, err := BuildJournalEntry(EntryInput{
		EntryID: "JE-DEPR-2026-10", Memo: "Monthly fixed asset depreciation",
		Reference: "DEPR-2026-10", Date: "2026-10-31", Period: "2026-10", Lines: lines,
	}, testChart())
	if err != nil {
		t.Fatalf("depreciation entry: %v", err)
	}
	assertBalanced(t, entry)
}

// TestBL21_provision_inputs_freeze_after_posting reproduces the audit
// scenario (BL-21): after provision 210, editing the inputs calculated 420
// while the journal remained 210. The Go rule freezes the inputs once the
// provision is posted; adjustments go through the correction workflow.
func TestBL21_provision_inputs_freeze_after_posting(t *testing.T) {
	schedule := TaxSchedule{
		ID: "TAX-FED", FormCode: "Form 1120-W", Jurisdiction: "United States — Federal",
		TaxableBase: mustMoneyT(t, "1000.0000"), StatutoryRate: mustMoneyT(t, "21"),
		CreditsAndDeductions: mustMoneyT(t, "0"), Status: "In Review",
	}
	if got := ProvisionAmount(schedule); !got.Equal(mustMoneyT(t, "210")) {
		t.Fatalf("provision = %s, want 210", got)
	}
	posted, err := PostProvision(schedule, mustMoneyT(t, "210"), "JE-PROV-210")
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if posted.ProvisionJournalID != "JE-PROV-210" {
		t.Fatalf("provision journal = %q, want JE-PROV-210", posted.ProvisionJournalID)
	}
	// Reposting stays blocked (the reference's own guard).
	if _, err := PostProvision(posted, mustMoneyT(t, "210"), "JE-PROV-210B"); err == nil || errKind(err) != "already_posted" {
		t.Fatalf("repost err = %v, want already_posted", err)
	}
	// The defect: editing taxableBase to 2000 would calculate 420 against
	// the recorded 210 journal. The fixed behaviour refuses; the schedule
	// value is untouched (the refusal returns nothing to apply).
	newBase := mustMoneyT(t, "2000.0000")
	if _, err := UpdateTaxSchedule(posted, TaxUpdates{TaxableBase: &newBase}); err == nil || errKind(err) != "provision_inputs_frozen" {
		t.Fatalf("input edit err = %v, want provision_inputs_frozen", err)
	}
	if got := ProvisionAmount(posted); !got.Equal(mustMoneyT(t, "210")) {
		t.Fatalf("provision after refused edit = %s, want 210", got)
	}
	// The review-status update stays allowed.
	status := "Ready to File"
	reviewed, err := UpdateTaxSchedule(posted, TaxUpdates{Status: &status})
	if err != nil {
		t.Fatalf("status update: %v", err)
	}
	if reviewed.Status != "Ready to File" {
		t.Fatalf("status = %q, want Ready to File", reviewed.Status)
	}
	// The reference's whitelist holds for unposted schedules too.
	filed := "Filed"
	if _, err := UpdateTaxSchedule(schedule, TaxUpdates{Status: &filed}); err == nil || errKind(err) != "filing_not_connected" {
		t.Fatalf("filed status err = %v, want filing_not_connected", err)
	}
	if _, err := UpdateTaxSchedule(schedule, TaxUpdates{Other: []string{"taxRate"}}); err == nil || errKind(err) != "invalid_tax_update" {
		t.Fatalf("bogus field err = %v, want invalid_tax_update", err)
	}
}

// TestBL27_exact_decimal_round_trip reproduces the audit scenario (BL-27):
// the reference accepted 999999999999.9997 and stored 999999999999.9998 —
// money crossed through float64 at the persistence boundary
// (monolith.py:33–43,96,183–186). The Go port carries money.Money end to
// end: the value round-trips through parsing, entry construction and JSON as
// the exact decimal string, and the float-mangled form never appears.
func TestBL27_exact_decimal_round_trip(t *testing.T) {
	const exact = "999999999999.9997"
	amount, err := ParseAmount(exact, false, false)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got := amount.String(); got != exact {
		t.Fatalf("parsed = %s, want %s", got, exact)
	}
	// The reference's float conversion produced 999999999999.9998; the port
	// has no float path, so that form never appears.
	if amount.String() == "999999999999.9998" {
		t.Fatal("float-mangled form appeared")
	}
	// The value crosses a constructed journal line unchanged.
	entry, err := BuildJournalEntry(EntryInput{
		EntryID: "JE-BL27", Memo: "BL-27 round trip", Reference: "BL27",
		Date: "2026-10-15", Period: "2026-10",
		Lines: []EntryLine{
			{LineNumber: 1, AccountCode: "5010", Debit: amount},
			{LineNumber: 2, AccountCode: "2010", Credit: amount},
		},
	}, testChart())
	if err != nil {
		t.Fatalf("entry: %v", err)
	}
	if got := entry.Lines[0].Debit.String(); got != exact {
		t.Fatalf("line debit = %s, want %s", got, exact)
	}
	assertBalanced(t, entry)
	// JSON crosses as a string, never a number.
	wire, err := json.Marshal(entry.Lines[0].Debit)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(wire) != `"`+exact+`"` {
		t.Fatalf("wire = %s, want the quoted exact string", wire)
	}
	var back money.Money
	if err := json.Unmarshal(wire, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.String() != exact || !back.Equal(amount) {
		t.Fatalf("round trip = %s, want %s", back, exact)
	}
	// A one-cent-precision boundary case: quantization is HALF_UP on the
	// parsed value, the range check runs before it (the reference's order).
	q, err := ParseAmount("999999999999.99975", false, false)
	if err != nil {
		t.Fatalf("boundary parse: %v", err)
	}
	if got := q.String(); got != "999999999999.9998" {
		t.Fatalf("boundary quantize = %s, want 999999999999.9998", got)
	}
	if _, err := ParseAmount("1000000000001", false, false); err == nil {
		t.Fatal("over-limit amount accepted")
	}
	// No float64 may appear in a marshalled entry (the BL-27 wire rule).
	raw, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal entry: %v", err)
	}
	if strings.Contains(string(raw), "999999999999.9998") {
		t.Fatalf("float-mangled form in entry wire: %s", raw)
	}
}
