package workflow

import (
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the bill workflow of backend/app/core/monolith.py
// (bill.create / bill.approve / bill.pay, lines 196–214) with the absorbed
// BL-31, BL-32 and BL-33 rules, over value types.
//
// Store boundary (P2): the reference's commands mutate the workspace's
// payables collection, append the journal entry and write the audit-log hash
// chain in one revision-checked transaction. The port produces the decisions
// and the records; the P2 store adapter persists them (bill row, entry,
// audit events) inside its command transaction.

// BillStatus is the bill lifecycle. Pending and Approved carry the posted
// expense+payables entry (the reference posts at creation); Paid is settled;
// Void and Rejected are the BL-33 dispositions that reverse the original
// entry.
type BillStatus string

const (
	BillPending  BillStatus = "Pending"
	BillApproved BillStatus = "Approved"
	BillPaid     BillStatus = "Paid"
	BillVoid     BillStatus = "Void"
	BillRejected BillStatus = "Rejected"
)

// BillOverride is the BL-32 recorded duplicate override: who decided the
// duplicate is not one, and why. The override is stored on the bill for
// review (the reference silently accepted duplicates).
type BillOverride struct {
	Reason         string `json:"reason"`
	ByPrincipalKey string `json:"by_principal_key"`
}

// BillRecord is one payable (the reference's payables row) plus the fields
// BL-31 and BL-33 add: creator and approver, the self-approval flag, the
// recorded duplicate override, and the void/reject audit link back to the
// original entry.
type BillRecord struct {
	ID                 string      `json:"id"`
	Vendor             string      `json:"vendor"`
	Reference          string      `json:"reference"`
	BillDate           string      `json:"bill_date"`
	DueDate            string      `json:"due_date"`
	ExpenseAccountCode string      `json:"expense_account_code"`
	ExpenseAccountName string      `json:"expense_account_name"`
	Amount             money.Money `json:"amount"`
	Status             BillStatus  `json:"status"`
	// OriginalEntryID is the journal entry that posted the expense+payables
	// charge. Required at creation (MissingEntryLink): the payable record and
	// its control-account posting are one decision, and the BL-33 reversal
	// links back through this ID.
	OriginalEntryID string `json:"original_entry_id"`
	// BL-31: who recorded and who approved. The reference recorded neither.
	CreatedByPrincipalKey  string `json:"created_by_principal_key"`
	ApprovedByPrincipalKey string `json:"approved_by_principal_key,omitempty"`
	// SelfApproved is the solo-mode flag for the year-end audit pack
	// (BL-31 owner decision): true only for a self-approval in one-person
	// company mode.
	SelfApproved bool `json:"self_approved,omitempty"`
	// DuplicateOverride is the recorded BL-32 override, nil when the bill was
	// not a detected duplicate.
	DuplicateOverride *BillOverride `json:"duplicate_override,omitempty"`
	// BL-33 audit link: the disposition, who decided it, why, and the
	// original entry the reversal reverses.
	VoidedByPrincipalKey  string `json:"voided_by_principal_key,omitempty"`
	VoidReason            string `json:"void_reason,omitempty"`
	VoidedOriginalEntryID string `json:"voided_original_entry_id,omitempty"`
}

// NewBill is RecordBill's input; every ID and principal arrives as an
// argument (no clocks, no generators).
type NewBill struct {
	Vendor             string
	Reference          string
	BillDate           string
	DueDate            string
	ExpenseAccountCode string
	// ExpenseAccountName is resolved by the caller from the chart
	// (FindEligibleAccount with the Expense category).
	ExpenseAccountName string
	Amount             money.Money
	CreatedBy          string
}

// RecordBill ports bill.create with the BL-32 duplicate rule and the BL-31
// creator record. The duplicate key is supplier + invoice reference (the
// review record's Required text); voided and rejected bills do not block
// re-recording — their entries were reversed. A detected duplicate is
// refused unless an override with a reason and a deciding principal is
// supplied; the override is then recorded on the bill for review.
//
// The amount must be a positive parsed amount and the dates must be supplied
// (BL-34 — the reference defaulted BillDate through posting_date); the caller
// validates them against the open periods via ValidateDocumentDates first.
func RecordBill(existing []BillRecord, in NewBill, billID, originalEntryID string, override *BillOverride) (BillRecord, error) {
	vendor, err := ValidateText(in.Vendor, "vendor", 500)
	if err != nil {
		return BillRecord{}, err
	}
	reference, err := ValidateText(in.Reference, "reference", 500)
	if err != nil {
		return BillRecord{}, err
	}
	var zero money.Money
	if in.Amount.Cmp(zero) <= 0 {
		return BillRecord{}, invalidAmount()
	}
	if in.BillDate == "" {
		return BillRecord{}, fail(ErrMissingDocumentDate,
			"MISSING_DOCUMENT_DATE: Supply the bill's own date; it is never defaulted.")
	}
	if in.DueDate == "" {
		return BillRecord{}, fail(ErrInvalidDate, "INVALID_DATE: Use YYYY-MM-DD.")
	}
	if _, err := ValidateISODate(in.BillDate, nil); err != nil {
		return BillRecord{}, err
	}
	if _, err := ValidateISODate(in.DueDate, nil); err != nil {
		return BillRecord{}, err
	}
	if in.ExpenseAccountCode == "" {
		return BillRecord{}, invalidAccount("", "Expense")
	}
	if strings.TrimSpace(in.CreatedBy) == "" {
		return BillRecord{}, fail(ErrMissingCreator,
			"MISSING_CREATOR: A bill records who recorded it.")
	}
	if strings.TrimSpace(originalEntryID) == "" {
		return BillRecord{}, fail(ErrMissingEntryLink,
			"MISSING_ENTRY_LINK: A bill records the entry that posted its charge.")
	}
	if dup, isDup := findDuplicateBill(existing, vendor, reference); isDup && override == nil {
		return BillRecord{}, fail(ErrDuplicateBill,
			"DUPLICATE_BILL: "+dup.ID+" already records vendor '"+vendor+"' with invoice reference '"+reference+
				"'; supply a recorded override if this is genuinely not a duplicate.")
	} else if isDup {
		if strings.TrimSpace(override.Reason) == "" || strings.TrimSpace(override.ByPrincipalKey) == "" {
			return BillRecord{}, fail(ErrDuplicateBill,
				"DUPLICATE_BILL: An override records a reason and the deciding principal.")
		}
		override = &BillOverride{Reason: strings.TrimSpace(override.Reason), ByPrincipalKey: strings.TrimSpace(override.ByPrincipalKey)}
	} else {
		override = nil
	}
	return BillRecord{
		ID:                    billID,
		Vendor:                vendor,
		Reference:             reference,
		BillDate:              in.BillDate,
		DueDate:               in.DueDate,
		ExpenseAccountCode:    in.ExpenseAccountCode,
		ExpenseAccountName:    in.ExpenseAccountName,
		Amount:                in.Amount,
		Status:                BillPending,
		OriginalEntryID:       originalEntryID,
		CreatedByPrincipalKey: in.CreatedBy,
		DuplicateOverride:     override,
	}, nil
}

// findDuplicateBill applies the BL-32 duplicate key: same vendor and same
// supplier invoice reference among live bills (void/rejected ones reversed
// their entries and do not block).
func findDuplicateBill(existing []BillRecord, vendor, reference string) (BillRecord, bool) {
	for _, b := range existing {
		if b.Status == BillVoid || b.Status == BillRejected {
			continue
		}
		if b.Vendor == vendor && b.Reference == reference {
			return b, true
		}
	}
	return BillRecord{}, false
}

// ApproveBill ports bill.approve with the BL-31 maker-checker rule: the bill
// records its approver, a creator may not approve their own bill unless the
// company is in solo mode (positions.SoloMode over the company's principals —
// a second active human principal returns the company to maker-checker
// automatically), and agents never approve. Solo-mode self-approvals are
// allowed and flagged (SelfApproved) for the year-end audit pack.
//
// The state check comes first, matching the reference's observable order: a
// bill not awaiting approval is refused whoever asks.
func ApproveBill(bill BillRecord, approver positions.Principal, companyPrincipals []positions.Principal) (BillRecord, positions.SelfApprovalDecision, error) {
	if bill.Status != BillPending {
		return BillRecord{}, positions.SelfApprovalDecision{}, invalidBillState(BillPending, bill.Status)
	}
	solo := positions.SoloMode(companyPrincipals)
	decision := positions.CheckSelfApproval(solo,
		approver.PrincipalKey == bill.CreatedByPrincipalKey,
		approver.IsHuman)
	if !decision.Allowed {
		return BillRecord{}, decision, sodDecisionErr(decision.Reason)
	}
	bill.Status = BillApproved
	bill.ApprovedByPrincipalKey = approver.PrincipalKey
	bill.SelfApproved = decision.SelfApproved
	return bill, decision, nil
}

// RecordBillPayment ports bill.pay's state rule (the reference posts
// pair("2010", "1010", amount) and marks Paid). The payment entry is the
// caller's: Pair(AccountPayablesControl, cashAccount, amount) through
// BuildJournalEntry — a payment recording command, whose authorization the
// BL-31 duty separation keeps independent of payables recording. The full
// amount settles (partial settlements are REQ-0011).
func RecordBillPayment(bill BillRecord) (BillRecord, money.Money, error) {
	if bill.Status != BillApproved {
		return BillRecord{}, money.Money{}, invalidBillState(BillApproved, bill.Status)
	}
	bill.Status = BillPaid
	return bill, bill.Amount, nil
}

func invalidBillState(expected, found BillStatus) error {
	return fail(ErrInvalidBillState,
		"INVALID_BILL_STATE: Expected "+string(expected)+"; found "+string(found)+".")
}

// The bill-workflow command names, as the BL-31 rule sees them. The
// reference's finance manager held all five commands (positions.py:325) —
// one person could record, approve and pay a fictitious bill, then reconcile
// the bank account that would reveal it.
const (
	CmdBillCreate    = "bill.create"
	CmdBillApprove   = "bill.approve"
	CmdBillPay       = "bill.pay"
	CmdBankReconcile = "bank.reconcile"
	CmdBankBatch     = "bank.batch"
)

// payablesRecordingConflicts is the BL-31 separation rule: payables recording
// is incompatible with payment recording and with bank reconciliation. The
// command authorizations must therefore differ — no authorization set may
// hold bill.create together with either. Recording-then-approving one's own
// bill is maker-checker's business (ApproveBill), not this rule's.
var payablesRecordingConflicts = map[string][]string{
	CmdBillCreate: {CmdBillPay, CmdBankReconcile, CmdBankBatch},
}

// ValidateDutySeparation checks one principal's authorized-command set
// against the BL-31 separation rule. The enforcement wall sits in mcproles
// (P4); this is the rule it applies, pure over the authorization set.
func ValidateDutySeparation(authorized map[string]bool) error {
	for holder, conflicts := range payablesRecordingConflicts {
		if !authorized[holder] {
			continue
		}
		for _, conflict := range conflicts {
			if authorized[conflict] {
				return fail(ErrDutySeparation,
					"DUTY_SEPARATION_VIOLATION: "+holder+" and "+conflict+
						" must not sit with the same principal (BL-31).")
			}
		}
	}
	return nil
}

// VoidBill and RejectBill are the BL-33 transition the reference lacked: a
// disputed, wrong or fictitious bill can leave the ledger through a reversal
// of the original entry instead of an unlinked manual journal. Both build the
// reversal through the voucher package's reversal semantics
// (voucher.BuildReversalLines — the BL-03 remediation rules: mirror the
// original line amounts with the sides swapped, fail closed on inconsistent
// metadata) and keep the audit link (VoidedOriginalEntryID, the deciding
// principal and the reason stay on the bill).
//
// Only a bill whose charge is still outstanding can be resolved: a Paid bill
// needs its payment reversed separately. The caller posts the returned lines
// through BuildJournalEntry (the correction workflow's entry) and records the
// updated bill in the same transaction.
func VoidBill(bill BillRecord, reason, voidedBy, currency string, originalEntry JournalEntry) (BillRecord, []EntryLine, error) {
	return resolveBill(bill, BillVoid, reason, voidedBy, currency, originalEntry)
}

// RejectBill is VoidBill with the Rejected disposition: the entry reverses
// exactly the same way and the audit link records the rejection.
func RejectBill(bill BillRecord, reason, voidedBy, currency string, originalEntry JournalEntry) (BillRecord, []EntryLine, error) {
	return resolveBill(bill, BillRejected, reason, voidedBy, currency, originalEntry)
}

func resolveBill(bill BillRecord, disposition BillStatus, reason, voidedBy, currency string, originalEntry JournalEntry) (BillRecord, []EntryLine, error) {
	if bill.Status == BillPaid {
		return BillRecord{}, nil, fail(ErrPaidBillNotVoidable,
			"PAID_BILL_NOT_VOIDABLE: Reverse the payment before resolving the bill.")
	}
	if bill.Status == BillVoid || bill.Status == BillRejected {
		return BillRecord{}, nil, fail(ErrBillAlreadyResolved,
			"BILL_ALREADY_RESOLVED: Bill "+bill.ID+" is already "+string(bill.Status)+".")
	}
	if bill.Status != BillPending && bill.Status != BillApproved {
		return BillRecord{}, nil, invalidBillState(BillPending, bill.Status)
	}
	if _, err := ValidateText(reason, "reason", 500); err != nil {
		return BillRecord{}, nil, err
	}
	if strings.TrimSpace(voidedBy) == "" {
		return BillRecord{}, nil, fail(ErrMissingCreator,
			"MISSING_CREATOR: A disposition records who decided it.")
	}
	if bill.OriginalEntryID == "" || originalEntry.ID != bill.OriginalEntryID {
		return BillRecord{}, nil, fail(ErrOriginalEntryMismatch,
			"ORIGINAL_ENTRY_MISMATCH: The reversal must link bill "+bill.ID+"'s original entry "+bill.OriginalEntryID+".")
	}
	rows, voidLines, err := billReversal(bill, originalEntry, currency, reason)
	if err != nil {
		return BillRecord{}, nil, err
	}
	// The voucher package's net-to-zero guarantee, asserted on the built
	// reversal (the BL-03 mirror semantics).
	if err := voucher.ValidateReversalMirror(rows, voidRows(voidLines, currency)); err != nil {
		return BillRecord{}, nil, err
	}
	bill.Status = disposition
	bill.VoidedByPrincipalKey = strings.TrimSpace(voidedBy)
	bill.VoidReason = strings.TrimSpace(reason)
	bill.VoidedOriginalEntryID = originalEntry.ID
	return bill, voidLines, nil
}

// workspaceEntity is the workspace identifier stamped on the conversion rows
// (the monolith workspace is single-entity). The P2 store adapter carries the
// real entity code; the constant is internal to the voucher conversion, which
// only requires row and original agreement.
const workspaceEntity = "MONOLITH"

// entryLayerMonolith marks the workflow package's entries in the conversion.
const entryLayerMonolith = "OPERATIONAL"

// billReversal builds the void entry's lines through the voucher package's
// reversal builder: the original entry's persisted-row form goes in, the
// mirrored lines (sides swapped, 沖銷-style memo naming the bill) come out.
func billReversal(bill BillRecord, originalEntry JournalEntry, currency, reason string) ([]voucher.LedgerLine, []EntryLine, error) {
	if len(originalEntry.Lines) == 0 {
		return nil, nil, fail(ErrOriginalEntryMismatch,
			"ORIGINAL_ENTRY_MISMATCH: The original entry has no lines to reverse.")
	}
	rows := entryToLedgerRows(originalEntry, currency)
	original := voucher.Voucher{
		JournalID:  originalEntry.ID,
		EntityCode: workspaceEntity,
		Status:     voucher.StatusPosted,
		// The bill's ID names the reversal memo the way the regional ledger's
		// voucher number does.
		VoucherNo:  &bill.ID,
		EntryLayer: entryLayerMonolith,
	}
	reversal, err := voucher.BuildReversalLines(original, rows, reason)
	if err != nil {
		return nil, nil, fail(ErrOriginalEntryMismatch,
			"ORIGINAL_ENTRY_MISMATCH: the original entry cannot be reversed: "+err.Error())
	}
	lines := make([]EntryLine, 0, len(reversal))
	for _, rl := range reversal {
		debit, perr := money.Parse(rl.Debit)
		if perr != nil {
			return nil, nil, fail(ErrOriginalEntryMismatch,
				"ORIGINAL_ENTRY_MISMATCH: unparsable reversal amount "+rl.Debit+".")
		}
		credit, perr := money.Parse(rl.Credit)
		if perr != nil {
			return nil, nil, fail(ErrOriginalEntryMismatch,
				"ORIGINAL_ENTRY_MISMATCH: unparsable reversal amount "+rl.Credit+".")
		}
		lines = append(lines, EntryLine{
			LineNumber:  rl.LineNumber,
			AccountCode: rl.AccountCode,
			AccountName: rl.AccountName,
			Description: rl.Memo,
			Debit:       debit,
			Credit:      credit,
		})
	}
	return rows, lines, nil
}

// entryToLedgerRows converts a workflow entry into the voucher package's
// persisted-row shape. The workspace is single-currency at rate 1 with no
// line-level tax, so the functional amounts mirror the transaction amounts.
func entryToLedgerRows(e JournalEntry, currency string) []voucher.LedgerLine {
	rows := make([]voucher.LedgerLine, 0, len(e.Lines))
	for _, l := range e.Lines {
		rows = append(rows, voucher.LedgerLine{
			LineNumber:     l.LineNumber,
			EntityCode:     workspaceEntity,
			AccountCode:    l.AccountCode,
			AccountID:      l.AccountCode,
			EntryLayer:     entryLayerMonolith,
			AccountingDate: e.Date,
			TxCurrency:     currency,
			ExchangeRate:   "1",
			TxDebit:        l.Debit.String(),
			TxCredit:       l.Credit.String(),
			FuncDebit:      l.Debit.String(),
			FuncCredit:     l.Credit.String(),
			FuncTaxAmount:  "0",
			BusinessUsePct: "1",
			Memo:           l.Description,
		})
	}
	return rows
}

// voidRows converts the built void lines back into the voucher package's
// persisted-row shape for the mirror check.
func voidRows(lines []EntryLine, currency string) []voucher.LedgerLine {
	out := make([]voucher.LedgerLine, 0, len(lines))
	for _, l := range lines {
		out = append(out, voucher.LedgerLine{
			LineNumber:     l.LineNumber,
			EntityCode:     workspaceEntity,
			AccountCode:    l.AccountCode,
			EntryLayer:     entryLayerMonolith,
			TxCurrency:     currency,
			ExchangeRate:   "1",
			TxDebit:        l.Debit.String(),
			TxCredit:       l.Credit.String(),
			FuncDebit:      l.Debit.String(),
			FuncCredit:     l.Credit.String(),
			FuncTaxAmount:  "0",
			BusinessUsePct: "1",
		})
	}
	return out
}
