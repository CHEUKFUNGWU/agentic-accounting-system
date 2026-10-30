package workflow

import (
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
)

// humanPrincipal builds an active human principal for the solo-mode inputs.
func humanPrincipal(key string) positions.Principal {
	return positions.Principal{PrincipalKey: key, IsHuman: true, Active: true}
}

// recordTestBill records the audit's bill: 4,200 from Amazon Web Services,
// recorded by the payables clerk against the cloud expense account.
func recordTestBill(t *testing.T, existing []BillRecord, createdBy string) BillRecord {
	t.Helper()
	amount, err := ParseAmount("4200", false, true)
	if err != nil {
		t.Fatalf("amount: %v", err)
	}
	bill, err := RecordBill(existing, NewBill{
		Vendor: "Amazon Web Services", Reference: "AWS-INV-10992",
		BillDate: "2026-10-03", DueDate: "2026-10-28",
		ExpenseAccountCode: "5010", ExpenseAccountName: "Cloud & GPU Inference Hosting",
		Amount: amount, CreatedBy: createdBy,
	}, "BILL-401", "JE-BILL-401", nil)
	if err != nil {
		t.Fatalf("record bill: %v", err)
	}
	return bill
}

// TestBL31_bill_records_creator_and_approver pins the BL-31 record rule: the
// reference recorded neither creator nor approver (one person could record,
// approve and pay a fictitious bill untraceably). The Go bill carries both.
func TestBL31_bill_records_creator_and_approver(t *testing.T) {
	bill := recordTestBill(t, nil, "ap-clerk-01")
	if bill.CreatedByPrincipalKey != "ap-clerk-01" {
		t.Fatalf("creator = %q, want ap-clerk-01", bill.CreatedByPrincipalKey)
	}
	company := []positions.Principal{humanPrincipal("ap-clerk-01"), humanPrincipal("finance-manager-01")}
	approver := humanPrincipal("finance-manager-01")
	approved, decision, err := ApproveBill(bill, approver, company)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.ApprovedByPrincipalKey != "finance-manager-01" {
		t.Fatalf("approver = %q, want finance-manager-01", approved.ApprovedByPrincipalKey)
	}
	if decision.SelfApproved {
		t.Fatal("a two-person approval must not be flagged self-approved")
	}
	if approved.Status != BillApproved {
		t.Fatalf("status = %s, want Approved", approved.Status)
	}
	// A bill without a recorded creator is refused at recording time.
	amount := mustMoneyT(t, "4200.0000")
	if _, err := RecordBill(nil, NewBill{
		Vendor: "V", Reference: "R", BillDate: "2026-10-03", DueDate: "2026-10-28",
		ExpenseAccountCode: "5010", Amount: amount,
	}, "BILL-X", "JE-X", nil); err == nil || errKind(err) != "missing_creator" {
		t.Fatalf("missing creator err = %v, want missing_creator", err)
	}
	// A bill without the link to its posting is refused too (the subledger
	// record and its control-account entry are one decision).
	if _, err := RecordBill(nil, NewBill{
		Vendor: "V", Reference: "R", BillDate: "2026-10-03", DueDate: "2026-10-28",
		ExpenseAccountCode: "5010", Amount: amount, CreatedBy: "ap-clerk-01",
	}, "BILL-X", "", nil); err == nil || errKind(err) != "missing_entry_link" {
		t.Fatalf("missing entry link err = %v, want missing_entry_link", err)
	}
}

// TestBL31_non_solo_refuses_creator_self_approval pins the maker-checker
// refusal: with two active human principals the company is not in solo mode
// and the creator's approval of their own bill is refused.
func TestBL31_non_solo_refuses_creator_self_approval(t *testing.T) {
	bill := recordTestBill(t, nil, "ap-clerk-01")
	company := []positions.Principal{humanPrincipal("ap-clerk-01"), humanPrincipal("finance-manager-01")}
	if positions.SoloMode(company) {
		t.Fatal("two active humans must not be solo mode")
	}
	_, _, err := ApproveBill(bill, humanPrincipal("ap-clerk-01"), company)
	if err == nil || errKind(err) != "sod_maker_checker_violation" {
		t.Fatalf("self-approval err = %v, want sod_maker_checker_violation", err)
	}
}

// TestBL31_solo_self_approval_allowed_and_flagged pins the owner decision of
// 2026-10-21: in a one-person company the owner may record, approve and pay
// their own bills; such approvals are flagged for the year-end audit pack.
func TestBL31_solo_self_approval_allowed_and_flagged(t *testing.T) {
	bill := recordTestBill(t, nil, "founder-director-01")
	company := []positions.Principal{humanPrincipal("founder-director-01")}
	if !positions.SoloMode(company) {
		t.Fatal("one active human must be solo mode")
	}
	approved, decision, err := ApproveBill(bill, humanPrincipal("founder-director-01"), company)
	if err != nil {
		t.Fatalf("solo self-approval: %v", err)
	}
	if !decision.Allowed || !decision.SelfApproved || !approved.SelfApproved {
		t.Fatalf("decision = %+v, want allowed and flagged; bill = %+v", decision, approved)
	}
	if approved.ApprovedByPrincipalKey != "founder-director-01" {
		t.Fatalf("approver = %q, want founder-director-01", approved.ApprovedByPrincipalKey)
	}
}

// TestBL31_second_human_principal_returns_maker_checker pins the automatic
// narrowing: hiring a second active human principal returns the company to
// maker-checker — the same self-approval that was allowed in solo mode is
// now refused.
func TestBL31_second_human_principal_returns_maker_checker(t *testing.T) {
	bill := recordTestBill(t, nil, "founder-director-01")
	solo := []positions.Principal{humanPrincipal("founder-director-01")}
	if _, _, err := ApproveBill(bill, humanPrincipal("founder-director-01"), solo); err != nil {
		t.Fatalf("solo approval refused: %v", err)
	}
	grown := []positions.Principal{humanPrincipal("founder-director-01"), humanPrincipal("bookkeeper-01")}
	if _, _, err := ApproveBill(bill, humanPrincipal("founder-director-01"), grown); err == nil || errKind(err) != "sod_maker_checker_violation" {
		t.Fatalf("post-hire self-approval err = %v, want sod_maker_checker_violation", err)
	}
}

// TestBL31_payment_and_bank_reconciliation_independent_of_payables_recording
// pins the rule-level separation the review record requires: payment
// recording (bill.pay) and bank reconciliation (bank.reconcile/bank.batch)
// never sit in the same authorization set as payables recording (bill.create)
// — the reference's finance manager held all of them (positions.py:325).
func TestBL31_payment_and_bank_reconciliation_independent_of_payables_recording(t *testing.T) {
	cases := []struct {
		name    string
		granted []string
		wantErr bool
	}{
		{"payables with payments", []string{CmdBillCreate, CmdBillPay}, true},
		{"payables with bank reconciliation", []string{CmdBillCreate, CmdBankReconcile}, true},
		{"payables with bank batch", []string{CmdBillCreate, CmdBankBatch}, true},
		{"all of the reference's set", []string{CmdBillCreate, CmdBillApprove, CmdBillPay, CmdBankReconcile, CmdBankBatch}, true},
		{"payables with approval", []string{CmdBillCreate, CmdBillApprove}, false},
		{"payments with reconciliation", []string{CmdBillPay, CmdBankReconcile, CmdBankBatch}, false},
		{"payables alone", []string{CmdBillCreate}, false},
	}
	for _, tc := range cases {
		granted := map[string]bool{}
		for _, c := range tc.granted {
			granted[c] = true
		}
		err := ValidateDutySeparation(granted)
		if tc.wantErr && (err == nil || errKind(err) != "duty_separation_violation") {
			t.Fatalf("%s: err = %v, want duty_separation_violation", tc.name, err)
		}
		if !tc.wantErr && err != nil {
			t.Fatalf("%s: unexpected err %v", tc.name, err)
		}
	}
}

// TestBL32_duplicate_bills_rejected_with_recorded_override reproduces the
// audit scenario (BL-32): the reference accepted the same supplier invoice
// twice (bill.create checked nothing), so it could be paid twice. The Go
// rule rejects the duplicate on supplier + invoice reference and allows only
// an explicit, recorded, reviewable override.
func TestBL32_duplicate_bills_rejected_with_recorded_override(t *testing.T) {
	existing := []BillRecord{recordTestBill(t, nil, "ap-clerk-01")}
	_, err := RecordBill(existing, NewBill{
		Vendor: "Amazon Web Services", Reference: "AWS-INV-10992",
		BillDate: "2026-10-20", DueDate: "2026-11-10",
		ExpenseAccountCode: "5010", Amount: mustMoneyT(t, "4200.0000"), CreatedBy: "ap-clerk-01",
	}, "BILL-402", "JE-BILL-402", nil)
	if err == nil || errKind(err) != "duplicate_bill" {
		t.Fatalf("duplicate err = %v, want duplicate_bill", err)
	}
	// An override without a reason or a deciding principal is no override.
	if _, err := RecordBill(existing, NewBill{
		Vendor: "Amazon Web Services", Reference: "AWS-INV-10992",
		BillDate: "2026-10-20", DueDate: "2026-11-10",
		ExpenseAccountCode: "5010", Amount: mustMoneyT(t, "4200.0000"), CreatedBy: "ap-clerk-01",
	}, "BILL-402", "JE-BILL-402", &BillOverride{}); err == nil || errKind(err) != "duplicate_bill" {
		t.Fatalf("empty override err = %v, want duplicate_bill", err)
	}
	// The recorded, reviewable override.
	rerecorded, err := RecordBill(existing, NewBill{
		Vendor: "Amazon Web Services", Reference: "AWS-INV-10992",
		BillDate: "2026-10-20", DueDate: "2026-11-10",
		ExpenseAccountCode: "5010", Amount: mustMoneyT(t, "4200.0000"), CreatedBy: "ap-clerk-01",
	}, "BILL-402", "JE-BILL-402", &BillOverride{Reason: "Vendor re-issued the October invoice under a corrected tax split", ByPrincipalKey: "finance-manager-01"})
	if err != nil {
		t.Fatalf("override record: %v", err)
	}
	if rerecorded.DuplicateOverride == nil ||
		rerecorded.DuplicateOverride.ByPrincipalKey != "finance-manager-01" ||
		rerecorded.DuplicateOverride.Reason == "" {
		t.Fatalf("override = %+v, want recorded reason and principal", rerecorded.DuplicateOverride)
	}
	// A different reference is not a duplicate; a voided bill does not block.
	ok, err := RecordBill(existing, NewBill{
		Vendor: "Amazon Web Services", Reference: "AWS-INV-11000",
		BillDate: "2026-10-20", DueDate: "2026-11-10",
		ExpenseAccountCode: "5010", Amount: mustMoneyT(t, "4200.0000"), CreatedBy: "ap-clerk-01",
	}, "BILL-403", "JE-BILL-403", nil)
	if err != nil || ok.DuplicateOverride != nil {
		t.Fatalf("new reference: err = %v, override = %+v, want clean record", err, ok.DuplicateOverride)
	}
	voided := []BillRecord{{ID: "BILL-401", Vendor: "Amazon Web Services", Reference: "AWS-INV-10992", Status: BillVoid}}
	if _, err := RecordBill(voided, NewBill{
		Vendor: "Amazon Web Services", Reference: "AWS-INV-10992",
		BillDate: "2026-10-20", DueDate: "2026-11-10",
		ExpenseAccountCode: "5010", Amount: mustMoneyT(t, "4200.0000"), CreatedBy: "ap-clerk-01",
	}, "BILL-404", "JE-BILL-404", nil); err != nil {
		t.Fatalf("voided bill must not block re-recording: %v", err)
	}
}

// TestBL33_void_reverses_through_correction_and_keeps_audit_link reproduces
// the audit scenario (BL-33): a disputed or wrong bill stayed in the ledger
// because the only transitions were approve and pay — corrections were
// unlinked manual journals. The Go void/reject reverses the original entry
// through the voucher package's reversal semantics and keeps the audit link.
func TestBL33_void_reverses_through_correction_and_keeps_audit_link(t *testing.T) {
	bill := recordTestBill(t, nil, "ap-clerk-01")
	original := JournalEntry{
		ID: "JE-BILL-401", Date: "2026-10-03", Status: "Posted", Currency: "USD",
		Lines: []EntryLine{
			{LineNumber: 1, AccountCode: "5010", AccountName: "Cloud & GPU Inference Hosting",
				Description: "Bill from Amazon Web Services", Debit: mustMoneyT(t, "4200.0000")},
			{LineNumber: 2, AccountCode: AccountPayablesControl, AccountName: "Accounts Payable",
				Description: "Bill from Amazon Web Services", Credit: mustMoneyT(t, "4200.0000")},
		},
	}

	// The void builds the mirror of the original: line order preserved with
	// the sides swapped — the expense line flips to a credit, the payables
	// line to a debit — and the bill named in the reversal memo.
	updated, voidLines, err := VoidBill(bill, "Vendor withdrew the invoice", "founder-director-01", "USD", original)
	if err != nil {
		t.Fatalf("void: %v", err)
	}
	if len(voidLines) != 2 {
		t.Fatalf("void lines = %+v, want the mirrored pair", voidLines)
	}
	if voidLines[0].AccountCode != "5010" || !voidLines[0].Credit.Equal(mustMoneyT(t, "4200.0000")) {
		t.Fatalf("void line 1 = %+v, want 5010 credit 4200.0000", voidLines[0])
	}
	if voidLines[1].AccountCode != AccountPayablesControl || !voidLines[1].Debit.Equal(mustMoneyT(t, "4200.0000")) {
		t.Fatalf("void line 2 = %+v, want 2010 debit 4200.0000", voidLines[1])
	}
	// The reversal entry posts through the ordinary builder and balances.
	voidEntry, err := BuildJournalEntry(EntryInput{
		EntryID: "JE-VOID-401", Memo: "Void bill BILL-401", Reference: "BILL-401",
		Date: "2026-10-31", Period: "2026-10", Lines: voidLines,
	}, testChart())
	if err != nil {
		t.Fatalf("void entry: %v", err)
	}
	assertBalanced(t, voidEntry)
	// The audit link stays: who voided, why, and which original entry.
	if updated.Status != BillVoid ||
		updated.VoidedByPrincipalKey != "founder-director-01" ||
		updated.VoidedOriginalEntryID != "JE-BILL-401" ||
		updated.VoidReason != "Vendor withdrew the invoice" {
		t.Fatalf("voided bill = %+v, want status Void with the audit link", updated)
	}
	if voidEntry.Lines[1].Description != "沖銷 BILL-401：Vendor withdrew the invoice" {
		t.Fatalf("reversal memo = %q, want the bill-naming reversal memo", voidEntry.Lines[1].Description)
	}

	// Rejecting a bill reverses the same way with the Rejected disposition.
	rejected, _, err := RejectBill(bill, "Fictitious invoice — confirmed with vendor", "finance-manager-01", "USD", original)
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if rejected.Status != BillRejected || rejected.VoidedOriginalEntryID != "JE-BILL-401" {
		t.Fatalf("rejected bill = %+v, want Rejected with the audit link", rejected)
	}

	// Refusals: double resolution, a paid bill, and a wrong original entry.
	if _, _, err := VoidBill(updated, "again", "founder-director-01", "USD", original); err == nil || errKind(err) != "bill_already_resolved" {
		t.Fatalf("double void err = %v, want bill_already_resolved", err)
	}
	paid := bill
	paid.Status = BillPaid
	if _, _, err := VoidBill(paid, "reason", "founder-director-01", "USD", original); err == nil || errKind(err) != "paid_bill_not_voidable" {
		t.Fatalf("paid void err = %v, want paid_bill_not_voidable", err)
	}
	if _, _, err := VoidBill(bill, "reason", "founder-director-01", "USD", JournalEntry{ID: "JE-OTHER"}); err == nil || errKind(err) != "original_entry_mismatch" {
		t.Fatalf("wrong original err = %v, want original_entry_mismatch", err)
	}
	if _, _, err := VoidBill(bill, "  ", "founder-director-01", "USD", original); err == nil || errKind(err) != "invalid_field" {
		t.Fatalf("blank reason err = %v, want invalid_field", err)
	}
}
