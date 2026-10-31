package workflow

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports append_entry and pair of backend/app/core/monolith.py as
// pure functions over value types, plus the BL-10 control-account rule.
//
// Store boundary (P2): in the reference, append_entry also inserts the journal
// into the workspace state, derives a ledger cash item for 1010 movements and
// re-opens the reconciliation close task; execute_command wraps it in the
// revision-checked transaction, the idempotency receipt and the audit-log
// hash chain. Those are storage concerns: the entry ID and actor arrive here
// as arguments, the cash-ledger derivation and audit append belong to the P2
// store adapter, which must call BuildJournalEntry and then persist.
//
// BL-27: the reference converts every line amount to float64 at this boundary
// (monolith.py:96,117–118); the port's amounts are money.Money end to end.

// ChartAccount is one chart-of-accounts row as account() reads it.
type ChartAccount struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

// FindEligibleAccount ports monolith.account: the code must exist and, when a
// category is named, carry that category.
func FindEligibleAccount(chart []ChartAccount, code, category string) (ChartAccount, error) {
	for _, a := range chart {
		if a.Code == code {
			if category != "" && a.Category != category {
				return ChartAccount{}, invalidAccount(code, category)
			}
			return a, nil
		}
	}
	return ChartAccount{}, invalidAccount(code, category)
}

func invalidAccount(code, category string) error {
	if category == "" {
		category = "ledger"
	}
	return fail(ErrInvalidAccount, "INVALID_ACCOUNT: "+code+" is not an eligible "+category+" account.")
}

// Allocation is one BL-10 subledger allocation: an ordinary journal line that
// touches a control account must name the subledger document it settles and
// the amount allocated to it.
type Allocation struct {
	DocumentID string      `json:"document_id"`
	Amount     money.Money `json:"amount"`
}

// EntryLine is one normalized journal line (append_entry's `normalized` rows,
// minus the float conversion). The zero side carries the zero money value,
// like the reference's 0.
type EntryLine struct {
	LineNumber  int64       `json:"line_number"`
	AccountCode string      `json:"account_code"`
	AccountName string      `json:"account_name"`
	Description string      `json:"description"`
	Debit       money.Money `json:"debit"`
	Credit      money.Money `json:"credit"`
	// Allocation is required when AccountCode is a subledger control account
	// (BL-10); nil elsewhere.
	Allocation *Allocation `json:"allocation,omitempty"`
}

// JournalEntry is the entry append_entry constructs, over exact money.
// Status is "Posted" or "Draft" (EntryStatusFor).
type JournalEntry struct {
	ID                    string      `json:"id"`
	Date                  string      `json:"date"`
	Reference             string      `json:"reference"`
	Memo                  string      `json:"memo"`
	Source                string      `json:"source"`
	Status                string      `json:"status"`
	Currency              string      `json:"currency"`
	Lines                 []EntryLine `json:"lines"`
	CreatedByPrincipalKey string      `json:"created_by_principal_key"`
}

// EntryInput is BuildJournalEntry's command-side input. Date is the explicit
// accounting date: the reference defaulted it through posting_date()
// (monolith.py:80–83) — the BL-34 defect — so the port has no default and
// refuses an empty date. Period is the workspace's open period label for the
// iso_date month-match check; the full open-period validation (locks, real
// bounds) is the caller's, through ValidateDocumentDates and the ledger
// package.
type EntryInput struct {
	EntryID               string
	Memo                  string
	Reference             string
	Source                string
	Date                  string
	Period                string
	Status                string
	Currency              string
	CreatedByPrincipalKey string
	Lines                 []EntryLine
}

// maxJournalLines is the reference's line-count bound.
const maxJournalLines = 200

// BuildJournalEntry ports append_entry's validation and construction: between
// 2 and 200 lines, each on an eligible account with a debit or a credit
// exclusively, debits equal to credits and positive, the date validated
// against the open period's month, and per-line descriptions falling back to
// the memo at 500 characters. The lines arrive pre-parsed (ParseAmount at the
// boundary); a negative or unquantized amount is unrepresentable in
// money.Money input built that way, and BuildJournalEntry refuses a line
// whose debit and credit are both positive or both zero (INVALID_LINE) and an
// unbalanced or zero entry (UNBALANCED_ENTRY) exactly as the reference does.
func BuildJournalEntry(in EntryInput, chart []ChartAccount) (JournalEntry, error) {
	if len(in.Lines) < 2 || len(in.Lines) > maxJournalLines {
		return JournalEntry{}, fail(ErrInvalidLines,
			"INVALID_LINES: A journal needs between 2 and 200 lines.")
	}
	if _, err := ValidateISODate(in.Date, &in.Period); err != nil {
		return JournalEntry{}, err
	}
	names := map[string]string{}
	for _, a := range chart {
		names[a.Code] = a.Name
	}
	debitTotal := money.Money{}
	creditTotal := money.Money{}
	lines := make([]EntryLine, 0, len(in.Lines))
	for i, l := range in.Lines {
		code := l.AccountCode
		if _, err := FindEligibleAccount(chart, code, ""); err != nil {
			return JournalEntry{}, err
		}
		var zero money.Money
		if (l.Debit.Cmp(zero) > 0) == (l.Credit.Cmp(zero) > 0) {
			return JournalEntry{}, fail(ErrInvalidLine,
				"INVALID_LINE: Each line must contain a debit or a credit, exclusively.")
		}
		description := l.Description
		if description == "" {
			description = in.Memo
		}
		if r := []rune(description); len(r) > 500 {
			description = string(r[:500])
		}
		line := EntryLine{
			LineNumber:  int64(i + 1),
			AccountCode: code,
			AccountName: names[code],
			Description: description,
			Debit:       l.Debit,
			Credit:      l.Credit,
			Allocation:  l.Allocation,
		}
		debitTotal = debitTotal.Add(line.Debit)
		creditTotal = creditTotal.Add(line.Credit)
		lines = append(lines, line)
	}
	if !debitTotal.Equal(creditTotal) || debitTotal.Cmp(money.Money{}) <= 0 {
		return JournalEntry{}, fail(ErrUnbalancedEntry,
			"UNBALANCED_ENTRY: Journal debits and credits must be equal and positive.")
	}
	status := in.Status
	if status == "" {
		status = "Posted"
	}
	return JournalEntry{
		ID:                    in.EntryID,
		Date:                  in.Date,
		Reference:             in.Reference,
		Memo:                  in.Memo,
		Source:                in.Source,
		Status:                status,
		Currency:              in.Currency,
		Lines:                 lines,
		CreatedByPrincipalKey: in.CreatedByPrincipalKey,
	}, nil
}

// Pair ports monolith.pair: the two-line construction behind every subledger
// posting — debit the first account, credit the second, same exact amount.
func Pair(debitCode, creditCode string, amount money.Money) []EntryLine {
	return []EntryLine{
		{LineNumber: 1, AccountCode: debitCode, Debit: amount},
		{LineNumber: 2, AccountCode: creditCode, Credit: amount},
	}
}

// The Monolith subledger-backed control accounts (BL-10). Cash (1010) and the
// accrual, deferred and equity accounts are not subledger-backed in the
// workspace and post freely; the receivables and payables controls are the
// subledger roll-ups the finding names.
const (
	AccountReceivablesControl = "1100"
	AccountPayablesControl    = "2010"
)

// SubledgerKind names which subledger a control account rolls up.
type SubledgerKind string

const (
	SubledgerReceivable SubledgerKind = "receivable"
	SubledgerPayable    SubledgerKind = "payable"
)

// controlKind reports the subledger behind a control-account code.
func controlKind(code string) (SubledgerKind, bool) {
	switch code {
	case AccountReceivablesControl:
		return SubledgerReceivable, true
	case AccountPayablesControl:
		return SubledgerPayable, true
	}
	return "", false
}

// ValidateControlAllocations is the BL-10 rule: an ordinary posting that
// touches a subledger control account must carry a validated allocation to an
// existing, still-outstanding subledger document for the full control-side
// amount of the line — otherwise it is rejected and the flow must go through
// the subledger commands (invoice.collect, bill.pay), which create and settle
// documents in the same decision. This is what the reference's
// monolith.py:85–98 lacks: a manual receipt against 1100 left the invoice
// collectible and the later collection double-counted the cash.
//
// The subledger commands themselves (RecordBill, RecordReceivable, and the
// settlement entries built from CollectInvoice/RecordBillPayment) post to the
// control accounts without an allocation by design: the document is created
// or resolved inside the same command, and each document carries the ID of
// the entry that posted it (MissingEntryLink refusal).
func ValidateControlAllocations(lines []EntryLine, view SubledgerView) ([]EntryLine, error) {
	for _, l := range lines {
		kind, ok := controlKind(l.AccountCode)
		if !ok {
			continue
		}
		if l.Allocation == nil {
			return nil, fail(ErrControlAllocation,
				"CONTROL_ACCOUNT_ALLOCATION_REQUIRED: "+l.AccountCode+
					" is a subledger control account; allocate to the document or use the subledger action.")
		}
		var zero money.Money
		if l.Allocation.Amount.Cmp(zero) <= 0 {
			return nil, fail(ErrInvalidAllocation,
				"INVALID_ALLOCATION: The allocation amount must be positive.")
		}
		// The settled side of a control account is the credit for receivables
		// (a receipt) and the debit for payables (a payment). The opposite
		// side creates or adjusts subledger documents — that is the
		// subledger commands' work (invoice.create, bill.create, REQ-0011
		// credit memos), never an ordinary posting.
		var settled money.Money
		switch kind {
		case SubledgerReceivable:
			if l.Credit.Cmp(zero) <= 0 {
				return nil, fail(ErrControlAllocation,
					"CONTROL_ACCOUNT_ALLOCATION_REQUIRED: only settlement credits may post to "+l.AccountCode+
						"; record new invoices through the receivables action.")
			}
			settled = l.Credit
		case SubledgerPayable:
			if l.Debit.Cmp(zero) <= 0 {
				return nil, fail(ErrControlAllocation,
					"CONTROL_ACCOUNT_ALLOCATION_REQUIRED: only settlement debits may post to "+l.AccountCode+
						"; record new bills through the payables action.")
			}
			settled = l.Debit
		}
		// The control-side amount must equal the allocation: a partial or
		// over allocation would desynchronize the roll-up.
		if !settled.Equal(l.Allocation.Amount) {
			return nil, fail(ErrInvalidAllocation,
				"INVALID_ALLOCATION: The allocation must equal the control-account amount of the line.")
		}
		switch kind {
		case SubledgerReceivable:
			r, ok := view.receivable(l.Allocation.DocumentID)
			if !ok {
				return nil, fail(ErrInvalidAllocation,
					"INVALID_ALLOCATION: Unknown receivable "+l.Allocation.DocumentID+".")
			}
			if r.Outstanding().Cmp(l.Allocation.Amount) < 0 {
				return nil, fail(ErrInvalidAllocation,
					"INVALID_ALLOCATION: Receivable "+r.ID+" has no outstanding balance for this allocation.")
			}
		case SubledgerPayable:
			b, ok := view.payable(l.Allocation.DocumentID)
			if !ok {
				return nil, fail(ErrInvalidAllocation,
					"INVALID_ALLOCATION: Unknown bill "+l.Allocation.DocumentID+".")
			}
			if b.Status != BillApproved {
				return nil, fail(ErrInvalidAllocation,
					"INVALID_ALLOCATION: Bill "+b.ID+" is not approved for settlement.")
			}
			if !b.Amount.Equal(l.Allocation.Amount) {
				return nil, fail(ErrInvalidAllocation,
					"INVALID_ALLOCATION: The allocation must equal the bill amount (partial settlements are REQ-0011).")
			}
		}
	}
	return lines, nil
}

// ApplyReceivableAllocation resolves a receivable allocation against the
// subledger record: the collected amount moves to PaidAmount and a fully
// settled invoice closes. This is the update the reference's manual receipt
// never performed (BL-10).
func ApplyReceivableAllocation(r Receivable, a Allocation) (Receivable, error) {
	if r.Outstanding().Cmp(a.Amount) < 0 {
		return Receivable{}, fail(ErrInvalidAllocation,
			"INVALID_ALLOCATION: Receivable "+r.ID+" has no outstanding balance for this allocation.")
	}
	r.PaidAmount = r.PaidAmount.Add(a.Amount)
	if r.Outstanding().Cmp(money.Money{}) <= 0 {
		r.Status = "Paid"
	}
	return r, nil
}
