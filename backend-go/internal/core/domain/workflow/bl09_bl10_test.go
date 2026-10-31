package workflow

import (
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// mustMoneyT parses a test constant; a failure fails the test.
func mustMoneyT(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := money.Parse(s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return m
}

// chartFor builds the workspace chart the tests post against: the monolith
// accounts the reference's seed carries (plus the fixed-asset and depreciation
// accounts initial_state adds).
func testChart() []ChartAccount {
	codes := []struct{ code, name, category string }{
		{"1010", "Operating Cash", "Asset"},
		{"1100", "Accounts Receivable", "Asset"},
		{"1590", "Accumulated depreciation", "Asset"},
		{"1610", "Fixed assets", "Asset"},
		{"2010", "Accounts Payable", "Liability"},
		{"2150", "Accrued Tax Liability", "Liability"},
		{"4020", "Usage & Compute Overages", "Revenue"},
		{"5010", "Cloud & GPU Inference Hosting", "Expense"},
		{"6800", "Corporate Tax Provision Expense", "Expense"},
		{"6900", "Depreciation expense", "Expense"},
	}
	chart := make([]ChartAccount, 0, len(codes))
	for _, c := range codes {
		chart = append(chart, ChartAccount{Code: c.code, Name: c.name, Category: c.category})
	}
	return chart
}

func errKind(err error) string {
	var k *fixture.Error
	if errors.As(classify(err), &k) {
		return k.Kind
	}
	return ""
}

// TestBL09_bank_exception_matches_instead_of_doubling reproduces the audit
// scenario (BL-09, 07-reviews/2026-10-21-business-logic-audit.md): paying a
// 4,200 bill then applying bank.exception produced 8,400 cash credits — the
// exception created another expense instead of matching. The Go behaviour
// resolves the existing book candidate: the matched movement posts nothing,
// the payable candidate routes to the payment command, and only a movement
// with no candidate at all posts an explicitly classified exception.
func TestBL09_bank_exception_matches_instead_of_doubling(t *testing.T) {
	// The bill was recorded (4,200), approved and paid: the payment entry
	// credited cash 4,200 and left an unreconciled book cash movement.
	bill := BillRecord{
		ID: "BILL-401", Vendor: "Amazon Web Services", Reference: "AWS-INV-10992",
		Amount: mustMoneyT(t, "4200.0000"), Status: BillApproved,
		ExpenseAccountCode: "5010", OriginalEntryID: "JE-BILL-401",
	}
	payment := Pair(AccountPayablesControl, "1010", bill.Amount)
	ledgerItems := []LedgerCashItem{{
		ID: "LC-02", Date: "2026-10-15", EntryID: "JE-PAY-401",
		Memo: "AWS net ACH settlement", Amount: bill.Amount.Neg(), Reconciled: false,
	}}
	bankItems := []BankItem{{
		ID: "BF-902", Date: "2026-10-15", Counterparty: "AMAZON WEB SERVICES INC",
		BankReference: "ACH-2940118", Amount: mustMoneyT(t, "-4200.0000"), Status: "Unmatched",
	}}

	// The fixed behaviour: the exception matches the existing book movement
	// and posts nothing.
	res, err := ClassifyBankException(bankItems[0], ledgerItems, []BillRecord{bill}, nil)
	if err != nil {
		t.Fatalf("classify: %v", err)
	}
	if res.Kind != ResolveMatchLedger || res.MatchedLedgerID != "LC-02" || len(res.Lines) != 0 {
		t.Fatalf("resolution = %+v, want match of LC-02 with no posting", res)
	}
	// Cash credits across the whole flow stay 4,200 — the Python flow
	// produced 8,400 (4,200 payment + 4,200 duplicated expense).
	var cashCredits money.Money
	for _, l := range payment {
		cashCredits = cashCredits.Add(l.Credit)
	}
	if !cashCredits.Equal(mustMoneyT(t, "4200.0000")) {
		t.Fatalf("cash credits = %s, want 4200.0000", cashCredits)
	}

	// Even without the book movement, the approved bill is a candidate: the
	// movement routes to the payment command instead of a second expense.
	res, err = ClassifyBankException(bankItems[0], nil, []BillRecord{bill}, nil)
	if err != nil {
		t.Fatalf("classify without ledger item: %v", err)
	}
	if res.Kind != ResolvePayable || res.DocumentID != "BILL-401" {
		t.Fatalf("resolution = %+v, want settle_payable BILL-401", res)
	}

	// A movement with no candidate at all posts the explicitly classified
	// exception: money out is the expense pair, money in the income pair.
	stray := BankItem{ID: "BF-903", Amount: mustMoneyT(t, "-88.0000"), Status: "Unmatched"}
	res, err = ClassifyBankException(stray, ledgerItems, []BillRecord{bill}, nil)
	if err != nil {
		t.Fatalf("classify stray: %v", err)
	}
	if res.Kind != ResolvePostException || res.ExceptionKind != ExceptionExpense {
		t.Fatalf("resolution = %+v, want expense exception", res)
	}
	if len(res.Lines) != 2 || res.Lines[0].AccountCode != "6800" || res.Lines[1].AccountCode != "1010" ||
		!res.Lines[1].Credit.Equal(mustMoneyT(t, "88.0000")) {
		t.Fatalf("exception lines = %+v, want 6800/1010 for 88.0000", res.Lines)
	}
	income := BankItem{ID: "BF-904", Amount: mustMoneyT(t, "500.0000"), Status: "Unmatched"}
	res, err = ClassifyBankException(income, ledgerItems, []BillRecord{bill}, nil)
	if err != nil {
		t.Fatalf("classify income: %v", err)
	}
	if res.Kind != ResolvePostException || res.ExceptionKind != ExceptionIncome ||
		res.Lines[0].AccountCode != "1010" || res.Lines[1].AccountCode != "4020" {
		t.Fatalf("resolution = %+v, want income exception 1010/4020", res)
	}
}

// TestBL10_control_account_postings_allocate_or_reject reproduces the audit
// scenario (BL-10): a reviewed manual receipt against the receivables control
// left the 100 invoice collectible, and collecting the same invoice then
// increased cash by 200. The Go rule rejects the unallocated control-account
// posting; an allocated receipt resolves the invoice so the later collection
// is refused and cash moves once.
func TestBL10_control_account_postings_allocate_or_reject(t *testing.T) {
	invoice := Receivable{
		ID: "INV-100", Customer: "Millennium Partners LP",
		IssueDate: "2026-10-01", DueDate: "2026-10-31",
		RevenueAccountCode: "4010", Amount: mustMoneyT(t, "100.0000"), Status: "Open",
		OriginalEntryID: "JE-INV-100",
	}
	view := SubledgerView{Receivables: []Receivable{invoice}}

	// The Python-accepted manual receipt: cash in 100 against the control
	// account, no subledger allocation.
	receipt := []EntryLine{
		{LineNumber: 1, AccountCode: "1010", Debit: mustMoneyT(t, "100.0000")},
		{LineNumber: 2, AccountCode: AccountReceivablesControl, Credit: mustMoneyT(t, "100.0000")},
	}
	if _, err := ValidateControlAllocations(receipt, view); err == nil || errKind(err) != "control_account_allocation_required" {
		t.Fatalf("unallocated receipt err = %v, want control_account_allocation_required", err)
	}

	// An allocated receipt is accepted and resolves the invoice.
	allocated := []EntryLine{
		{LineNumber: 1, AccountCode: "1010", Debit: mustMoneyT(t, "100.0000")},
		{LineNumber: 2, AccountCode: AccountReceivablesControl, Credit: mustMoneyT(t, "100.0000"),
			Allocation: &Allocation{DocumentID: "INV-100", Amount: mustMoneyT(t, "100.0000")}},
	}
	if _, err := ValidateControlAllocations(allocated, view); err != nil {
		t.Fatalf("allocated receipt: %v", err)
	}
	updated, err := ApplyReceivableAllocation(invoice, *allocated[1].Allocation)
	if err != nil {
		t.Fatalf("apply allocation: %v", err)
	}
	if !updated.Outstanding().Equal(money.Money{}) || updated.Status != "Paid" {
		t.Fatalf("invoice after allocation = %+v, want settled", updated)
	}

	// Collecting the same invoice is now refused — the audit's second 100 of
	// cash never happens.
	if _, _, err := CollectInvoice(updated); err == nil || errKind(err) != "already_paid" {
		t.Fatalf("collect after allocation err = %v, want already_paid", err)
	}

	// Refusals at the edges: unknown document, over-allocation, and a
	// receipt whose allocation does not equal the control-side amount.
	bad := []EntryLine{
		{LineNumber: 1, AccountCode: "1010", Debit: mustMoneyT(t, "100.0000")},
		{LineNumber: 2, AccountCode: AccountReceivablesControl, Credit: mustMoneyT(t, "100.0000"),
			Allocation: &Allocation{DocumentID: "INV-404", Amount: mustMoneyT(t, "100.0000")}},
	}
	if _, err := ValidateControlAllocations(bad, view); err == nil || errKind(err) != "invalid_allocation" {
		t.Fatalf("unknown document err = %v, want invalid_allocation", err)
	}
	over := []EntryLine{
		{LineNumber: 1, AccountCode: "1010", Debit: mustMoneyT(t, "100.0000")},
		{LineNumber: 2, AccountCode: AccountReceivablesControl, Credit: mustMoneyT(t, "100.0000"),
			Allocation: &Allocation{DocumentID: "INV-100", Amount: mustMoneyT(t, "60.0000")}},
	}
	if _, err := ValidateControlAllocations(over, view); err == nil || errKind(err) != "invalid_allocation" {
		t.Fatalf("partial allocation err = %v, want invalid_allocation", err)
	}
	if _, err := ApplyReceivableAllocation(invoice, Allocation{DocumentID: "INV-100", Amount: mustMoneyT(t, "200.0000")}); err == nil || errKind(err) != "invalid_allocation" {
		t.Fatalf("over-allocation err = %v, want invalid_allocation", err)
	}
}
