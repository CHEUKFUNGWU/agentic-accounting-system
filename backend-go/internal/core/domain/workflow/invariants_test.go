package workflow

import (
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// assertBalanced is the §3 invariant check: total debits equal total credits
// in exact decimal money, and no line posts a negative amount.
func assertBalanced(t *testing.T, e JournalEntry) money.Money {
	t.Helper()
	debits := money.Money{}
	credits := money.Money{}
	var zero money.Money
	for _, l := range e.Lines {
		if l.Debit.Cmp(zero) < 0 || l.Credit.Cmp(zero) < 0 {
			t.Fatalf("entry %s line %d posts a negative amount: %+v", e.ID, l.LineNumber, l)
		}
		debits = debits.Add(l.Debit)
		credits = credits.Add(l.Credit)
	}
	if !debits.Equal(credits) {
		t.Fatalf("entry %s unbalanced: debits %s != credits %s", e.ID, debits, credits)
	}
	return debits
}

// TestInvariant_every_constructed_journal_balances_exact builds one journal
// per workflow (bill charge, payment, collection, provision, depreciation,
// void) and asserts the double-entry invariant in exact decimals.
func TestInvariant_every_constructed_journal_balances_exact(t *testing.T) {
	chart := testChart()
	amount := mustMoneyT(t, "4200.0000")
	entries := []struct {
		name  string
		input EntryInput
	}{
		{"bill charge", EntryInput{EntryID: "JE-1", Memo: "Bill from Amazon Web Services",
			Reference: "AWS-INV-10992", Date: "2026-10-03", Period: "2026-10",
			Lines: Pair("5010", "2010", amount)}},
		{"bill payment", EntryInput{EntryID: "JE-2", Memo: "Payment to Amazon Web Services",
			Reference: "AWS-INV-10992", Date: "2026-10-15", Period: "2026-10",
			Lines: Pair("2010", "1010", amount)}},
		{"invoice collection", EntryInput{EntryID: "JE-3", Memo: "Collection from Millennium Partners LP",
			Reference: "INV-100", Date: "2026-10-20", Period: "2026-10",
			Lines: Pair("1010", "1100", mustMoneyT(t, "100.0000"))}},
		{"tax provision", EntryInput{EntryID: "JE-4", Memo: "Tax provision: United States — Federal",
			Reference: "Form 1120-W", Date: "2026-10-31", Period: "2026-10",
			Lines: Pair("6800", "2150", mustMoneyT(t, "210.0000"))}},
		{"depreciation", EntryInput{EntryID: "JE-5", Memo: "Monthly fixed asset depreciation",
			Reference: "DEPR-2026-10", Date: "2026-10-31", Period: "2026-10",
			Lines: Pair("6900", "1590", mustMoneyT(t, "100.00"))}},
		{"bill void reversal", EntryInput{EntryID: "JE-6", Memo: "Void bill BILL-401",
			Reference: "BILL-401", Date: "2026-10-31", Period: "2026-10",
			Lines: Pair("2010", "5010", amount)}},
		{"multi-line receipt", EntryInput{EntryID: "JE-7", Memo: "Combined settlement",
			Reference: "MIX", Date: "2026-10-20", Period: "2026-10",
			Lines: []EntryLine{
				{AccountCode: "1010", Debit: mustMoneyT(t, "300.0000")},
				{AccountCode: "1100", Credit: mustMoneyT(t, "100.0000")},
				{AccountCode: "4020", Credit: mustMoneyT(t, "200.0000")},
			}}},
	}
	for _, tc := range entries {
		entry, err := BuildJournalEntry(tc.input, chart)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		total := assertBalanced(t, entry)
		if total.IsZero() {
			t.Fatalf("%s: zero entry accepted", tc.name)
		}
	}
}

// TestInvariant_no_negative_amounts_posted: the money parser refuses
// unsigned negatives and the line-exclusivity rule refuses any line whose
// debit and credit are not strictly exclusive — a negative amount cannot
// enter a constructed journal.
func TestInvariant_no_negative_amounts_posted(t *testing.T) {
	if _, err := ParseAmount("-4200", false, false); err == nil {
		t.Fatal("unsigned negative accepted")
	}
	positive, err := ParseAmount("4200", false, true)
	if err != nil {
		t.Fatalf("positive amount: %v", err)
	}
	if _, err := ParseAmount("0", false, true); err == nil {
		t.Fatal("zero accepted under the positive rule")
	}
	// A manually smuggled negative debit is refused by the exclusivity rule
	// (debit -5, credit 0: neither side positive).
	negative := mustMoneyT(t, "-5")
	_, err = BuildJournalEntry(EntryInput{
		EntryID: "JE-NEG", Date: "2026-10-15", Period: "2026-10",
		Lines: []EntryLine{
			{AccountCode: "5010", Debit: negative},
			{AccountCode: "2010", Credit: positive},
		},
	}, testChart())
	if err == nil || errKind(err) != "invalid_line" {
		t.Fatalf("negative line err = %v, want invalid_line", err)
	}
	// Both sides on one line is refused the same way.
	_, err = BuildJournalEntry(EntryInput{
		EntryID: "JE-BOTH", Date: "2026-10-15", Period: "2026-10",
		Lines: []EntryLine{
			{AccountCode: "5010", Debit: positive, Credit: positive},
			{AccountCode: "2010", Credit: positive},
		},
	}, testChart())
	if err == nil || errKind(err) != "invalid_line" {
		t.Fatalf("double-side line err = %v, want invalid_line", err)
	}
	// Unbalanced and zero entries refuse.
	_, err = BuildJournalEntry(EntryInput{
		EntryID: "JE-UNBAL", Date: "2026-10-15", Period: "2026-10",
		Lines: []EntryLine{
			{AccountCode: "5010", Debit: positive},
			{AccountCode: "2010", Credit: mustMoneyT(t, "4199.0000")},
		},
	}, testChart())
	if err == nil || errKind(err) != "unbalanced_entry" {
		t.Fatalf("unbalanced err = %v, want unbalanced_entry", err)
	}
	// Structural bounds: one line and 201 lines refuse.
	_, err = BuildJournalEntry(EntryInput{EntryID: "JE-ONE", Date: "2026-10-15", Period: "2026-10",
		Lines: []EntryLine{{AccountCode: "5010", Debit: positive}}}, testChart())
	if err == nil || errKind(err) != "invalid_lines" {
		t.Fatalf("one-line entry err = %v, want invalid_lines", err)
	}
	many := make([]EntryLine, 201)
	for i := range many {
		many[i] = EntryLine{AccountCode: "5010", Debit: mustMoneyT(t, "1")}
	}
	_, err = BuildJournalEntry(EntryInput{EntryID: "JE-MANY", Date: "2026-10-15", Period: "2026-10", Lines: many}, testChart())
	if err == nil || errKind(err) != "invalid_lines" {
		t.Fatalf("201-line entry err = %v, want invalid_lines", err)
	}
	// Unknown accounts refuse.
	_, err = BuildJournalEntry(EntryInput{EntryID: "JE-UNK", Date: "2026-10-15", Period: "2026-10",
		Lines: Pair("9999", "2010", positive)}, testChart())
	if err == nil || errKind(err) != "invalid_account" {
		t.Fatalf("unknown account err = %v, want invalid_account", err)
	}
}

// TestInvariant_void_keeps_audit_link: the BL-33 audit trail — the voided
// bill keeps the link to its original entry, and the original entry itself
// is never rewritten.
func TestInvariant_void_keeps_audit_link(t *testing.T) {
	bill := recordTestBill(t, nil, "ap-clerk-01")
	original := JournalEntry{
		ID: "JE-BILL-401", Date: "2026-10-03", Status: "Posted", Currency: "USD",
		Lines: []EntryLine{
			{LineNumber: 1, AccountCode: "5010", Debit: mustMoneyT(t, "4200.0000")},
			{LineNumber: 2, AccountCode: "2010", Credit: mustMoneyT(t, "4200.0000")},
		},
	}
	updated, voidLines, err := VoidBill(bill, "Supplier duplication confirmed", "finance-manager-01", "USD", original)
	if err != nil {
		t.Fatalf("void: %v", err)
	}
	if updated.VoidedOriginalEntryID != original.ID {
		t.Fatalf("audit link = %q, want %q", updated.VoidedOriginalEntryID, original.ID)
	}
	if updated.OriginalEntryID != original.ID {
		t.Fatalf("original link disturbed: %q", updated.OriginalEntryID)
	}
	// The reversal mirrors the original exactly (net zero across the pair).
	if len(voidLines) != len(original.Lines) {
		t.Fatalf("reversal has %d lines, original %d", len(voidLines), len(original.Lines))
	}
	origDebits, voidCredits := money.Money{}, money.Money{}
	for _, l := range original.Lines {
		origDebits = origDebits.Add(l.Debit)
	}
	for _, l := range voidLines {
		voidCredits = voidCredits.Add(l.Credit)
	}
	if !origDebits.Equal(voidCredits) {
		t.Fatalf("reversal does not mirror the original: %s vs %s", origDebits, voidCredits)
	}
	// The original entry's fields are untouched by the void.
	if original.Status != "Posted" || len(original.Lines) != 2 {
		t.Fatalf("original entry was rewritten: %+v", original)
	}
	if !strings.Contains(voidLines[0].Description, "BILL-401") {
		t.Fatalf("reversal memo does not name the bill: %q", voidLines[0].Description)
	}
}

// TestInvariant_divisionMatchesReference pins the Decimal-division semantics
// divMoneyInt must reproduce (probed against the reference interpreter):
// exact quotients keep the ideal exponent and trim trailing zeros only down
// to it; inexact quotients round half-even at 28 significant digits.
func TestInvariant_divisionMatchesReference(t *testing.T) {
	cases := []struct {
		value   string
		divisor int64
		want    string
	}{
		{"1200.0000", 12, "100.0000"}, // ideal exponent kept
		{"1200", 12, "100"},
		{"100", 100, "1"},
		{"1", 4, "0.25"},
		{"1.0000", 8, "0.1250"},
		{"2", 4, "0.5"},
		{"0", 12, "0"},
		{"0.0000", 12, "0.0000"},
	}
	for _, tc := range cases {
		got, err := divMoneyInt(mustMoneyT(t, tc.value), int64(tc.divisor))
		if err != nil {
			t.Fatalf("%s/%d: %v", tc.value, tc.divisor, err)
		}
		if got.String() != tc.want {
			t.Fatalf("%s/%d = %s, want %s", tc.value, tc.divisor, got, tc.want)
		}
	}
	// The inexact path: 1000/3 rounds to 28 significant digits, so the
	// two-dep quantize gives 333.33 — and 2/3's 0.666… rounds to 0.67 under
	// HALF_UP.
	repeating, err := divMoneyInt(mustMoneyT(t, "1000"), 3)
	if err != nil {
		t.Fatalf("1000/3: %v", err)
	}
	q, err := repeating.Round(2, money.RoundHalfUp)
	if err != nil {
		t.Fatalf("quantize: %v", err)
	}
	if q.String() != "333.33" {
		t.Fatalf("1000/3 quantized = %s, want 333.33", q)
	}
	third, err := divMoneyInt(mustMoneyT(t, "2"), 3)
	if err != nil {
		t.Fatalf("2/3: %v", err)
	}
	if q, _ := third.Round(2, money.RoundHalfUp); q.String() != "0.67" {
		t.Fatalf("2/3 quantized = %s, want 0.67", q)
	}
	if _, err := divMoneyInt(mustMoneyT(t, "100"), 0); err == nil {
		t.Fatal("division by zero accepted")
	}
	if _, err := divMoneyInt(mustMoneyT(t, "100"), -3); err == nil {
		t.Fatal("negative divisor accepted")
	}
}
