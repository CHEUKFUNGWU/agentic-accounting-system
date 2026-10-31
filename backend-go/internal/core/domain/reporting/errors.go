package reporting

import (
	"errors"
	"fmt"
)

// The reference raises no typed errors here — generate_reporting_pack never
// refuses anything, which is exactly how the findings happened. The port
// fails closed: each refusal is a classified sentinel (the parity harness
// and callers branch on it) wrapped around user-facing text, mirroring the
// ledger package's LedgerError split.
var (
	// ErrFSCategoryUnmapped (BL-13): a trial-balance row or chart account
	// carries a statement category outside the versioned mapping. Reporting
	// blocks instead of letting the balance disappear from every statement.
	ErrFSCategoryUnmapped = errors.New("fs_category_unmapped")
	// ErrFilingJurisdictionUnsupported (BL-20): no supported filing
	// calculation exists for the jurisdiction. Never a fallback to AU, never
	// a fabricated credit.
	ErrFilingJurisdictionUnsupported = errors.New("filing_jurisdiction_unsupported")
	// ErrCashEntryUnbalanced (BL-12/18 classification): an entry's cash legs
	// cannot be reconciled with its noncash legs. A posted entry balances, so
	// this names ledger corruption rather than being papered over.
	ErrCashEntryUnbalanced = errors.New("cashflow_entry_unbalanced")
	// ErrCOAMissingAccount: a line or projection references an account that
	// is not on the chart. Statements never silently drop activity.
	ErrCOAMissingAccount = errors.New("coa_missing_account")
	// ErrDivisionByZero: the margin derivations guard revenue > 0; a zero
	// divisor reaching division is a caller bug, refused not defaulted.
	ErrDivisionByZero = errors.New("division_by_zero")
	// ErrInvalidStatementInput: malformed input the reference would have
	// silently mis-derivation (unknown legal structure, bad window bounds).
	ErrInvalidStatementInput = errors.New("invalid_statement_input")
)

// fail wraps a kind sentinel with the user-facing message text.
func fail(kind error, msg string) error {
	return fmt.Errorf("%w: %s", kind, msg)
}
