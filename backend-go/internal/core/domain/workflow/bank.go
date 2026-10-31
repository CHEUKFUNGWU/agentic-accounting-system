package workflow

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the bank workflow of backend/app/core/monolith.py —
// reconcile (lines 132–143) and bank.exception (lines 221–234) — over value
// types, with the BL-09 fix.
//
// Store boundary (P2): the reference's reconcile mutates the workspace's
// bank and ledger-cash collections and writes the audit hash chain; the
// bank.batch loop applies it over the suggested matches. Those walks are the
// P2 store adapter's, over the decisions this file returns.

// BankItem is one bank statement movement (the reference's bankItems row).
// Amount is signed: money in is positive, money out is negative.
type BankItem struct {
	ID                string      `json:"id"`
	Date              string      `json:"date"`
	Counterparty      string      `json:"counterparty"`
	BankReference     string      `json:"bank_reference"`
	Description       string      `json:"description"`
	Amount            money.Money `json:"amount"`
	Status            string      `json:"status"` // "Unmatched" | "Matched"
	MatchedLedgerID   string      `json:"matched_ledger_id,omitempty"`
	SuggestedLedgerID string      `json:"suggested_ledger_id,omitempty"`
}

// LedgerCashItem is one book cash movement (the reference's ledgerCashItems
// row), derived from journal entries touching the cash account.
type LedgerCashItem struct {
	ID         string      `json:"id"`
	Date       string      `json:"date"`
	EntryID    string      `json:"entry_id"`
	Memo       string      `json:"memo"`
	Amount     money.Money `json:"amount"` // signed, same convention as BankItem
	Reconciled bool        `json:"reconciled"`
}

// MatchResult is reconcile's outcome: the updated bank and ledger items.
type MatchResult struct {
	Bank   BankItem
	Ledger LedgerCashItem
}

// MatchBankItem ports reconcile's pure rules: a bank or ledger item can be
// matched once (ALREADY_RECONCILED), and the amounts must match including
// direction (MATCH_AMOUNT_MISMATCH). On success the bank item is Matched with
// full confidence and the ledger item reconciled.
func MatchBankItem(bank BankItem, ledger LedgerCashItem) (MatchResult, error) {
	if bank.Status == "Matched" || ledger.Reconciled {
		return MatchResult{}, fail(ErrAlreadyReconciled,
			"ALREADY_RECONCILED: A bank or ledger item can only be matched once.")
	}
	if !bank.Amount.Equal(ledger.Amount) {
		return MatchResult{}, fail(ErrMatchAmountMismatch,
			"MATCH_AMOUNT_MISMATCH: Bank and ledger amounts must match, including direction.")
	}
	bank.Status = "Matched"
	bank.MatchedLedgerID = ledger.ID
	ledger.Reconciled = true
	return MatchResult{Bank: bank, Ledger: ledger}, nil
}

// CloseCheckReconciliation ports reconcile's close-gate tail: the bank
// reconciliation checklist item (CLS-03) completes only when every bank item
// is matched and every book cash movement reconciled.
func CloseCheckReconciliation(bankItems []BankItem, ledgerItems []LedgerCashItem) bool {
	for _, b := range bankItems {
		if b.Status != "Matched" {
			return false
		}
	}
	for _, l := range ledgerItems {
		if !l.Reconciled {
			return false
		}
	}
	return true
}

// ExceptionKind classifies a genuine bank exception (BL-09): a movement with
// no existing candidate is either an unrecorded expense (money out) or an
// unrecorded income (money in).
type ExceptionKind string

const (
	ExceptionExpense ExceptionKind = "expense"
	ExceptionIncome  ExceptionKind = "income"
)

// ResolutionKind is ClassifyBankException's decision kind.
type ResolutionKind string

const (
	// ResolveMatchLedger: an existing book cash movement matches the bank
	// item — reconcile it, post nothing (the BL-09 fix).
	ResolveMatchLedger ResolutionKind = "match_ledger"
	// ResolvePayable: the movement is the payment of an approved, unsettled
	// bill — route to the payment recording command, post no exception.
	ResolvePayable ResolutionKind = "settle_payable"
	// ResolveReceivable: the movement is the collection of an open invoice —
	// route to the receivables action, post no exception.
	ResolveReceivable ResolutionKind = "collect_receivable"
	// ResolvePostException: no candidate exists — the movement is a genuine
	// exception and posts its explicitly classified entry.
	ResolvePostException ResolutionKind = "post_exception"
)

// BankResolution is ClassifyBankException's outcome.
type BankResolution struct {
	Kind            ResolutionKind `json:"kind"`
	MatchedLedgerID string         `json:"matched_ledger_id,omitempty"`
	DocumentID      string         `json:"document_id,omitempty"`
	// ExceptionKind and Lines are set only for ResolvePostException.
	ExceptionKind ExceptionKind `json:"exception_kind,omitempty"`
	Lines         []EntryLine   `json:"lines,omitempty"`
}

// ClassifyBankException ports bank.exception with the BL-09 fix. The
// reference jumped straight to posting — paying a 4,200 bill and then
// applying the exception produced a second 4,200 cash credit (8,400 total),
// because the exception created another expense instead of matching. The
// fixed rule separates matching from posting:
//
//  1. refuse an already-recorded item and a zero movement (the reference's
//     own guards);
//  2. resolve EXISTING candidates first: an unreconciled book cash movement
//     of the same signed amount is a match (reconcile it, post nothing); a
//     negative movement matching an approved unsettled bill routes to the
//     payment command; a positive movement matching an open invoice routes
//     to the receivables action;
//  3. only with no candidate at all does the movement post as an explicitly
//     classified exception: money out is the expense pair (6800/1010), money
//     in the income pair (1010/4020) — the reference's own classification,
//     which parity keeps for the genuine-exception path.
//
// The candidate lists arrive as arguments (the store supplies them ordered).
func ClassifyBankException(item BankItem, ledgerItems []LedgerCashItem, bills []BillRecord, receivables []Receivable) (BankResolution, error) {
	if item.Status == "Matched" {
		return BankResolution{}, fail(ErrAlreadyReconciled,
			"ALREADY_RECONCILED: This bank item has been recorded.")
	}
	var zero money.Money
	if item.Amount.Cmp(zero) == 0 {
		return BankResolution{}, fail(ErrInvalidAmount,
			"INVALID_AMOUNT: Zero bank movements cannot be posted.")
	}
	// 2a. An existing unreconciled book cash movement of the same signed
	// amount: match it, post nothing.
	for _, l := range ledgerItems {
		if !l.Reconciled && l.Amount.Equal(item.Amount) {
			return BankResolution{Kind: ResolveMatchLedger, MatchedLedgerID: l.ID}, nil
		}
	}
	if item.Amount.Cmp(zero) < 0 {
		// 2b. Money out matching an approved, unsettled bill: that is the
		// payment recording command's posting, not an exception.
		out := item.Amount.Neg()
		for _, b := range bills {
			if b.Status == BillApproved && b.Amount.Equal(out) {
				return BankResolution{Kind: ResolvePayable, DocumentID: b.ID}, nil
			}
		}
	} else {
		// 2c. Money in matching an open invoice: the receivables action.
		for _, r := range receivables {
			if r.Status != "Paid" && r.Outstanding().Equal(item.Amount) {
				return BankResolution{Kind: ResolveReceivable, DocumentID: r.ID}, nil
			}
		}
	}
	// 3. Genuine exception: the explicit classification.
	kind := ExceptionIncome
	lines := Pair("1010", "4020", item.Amount)
	if item.Amount.Cmp(zero) < 0 {
		kind = ExceptionExpense
		lines = Pair("6800", "1010", item.Amount.Neg())
	}
	return BankResolution{Kind: ResolvePostException, ExceptionKind: kind, Lines: lines}, nil
}
