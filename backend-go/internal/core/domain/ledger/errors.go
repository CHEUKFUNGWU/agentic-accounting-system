package ledger

import (
	"errors"
	"fmt"
)

// The reference raises LedgerError with an UPPER_SNAKE kind prefix followed by
// user-facing text ("Message is user-facing"). The port splits the two: the
// sentinel error is the classified kind — the parity harness and callers
// branch on it, and tools/gen_ledger.py writes the same kinds into fixture
// expected_error fields — while the wrapped message keeps the reference's
// user-facing text.
var (
	ErrInvalidPeriod             = errors.New("invalid_period")
	ErrInvalidAccountingDate     = errors.New("invalid_accounting_date")
	ErrPeriodDateMismatch        = errors.New("period_date_mismatch")
	ErrPeriodLocked              = errors.New("period_locked")
	ErrPeriodAlreadyLocked       = errors.New("period_already_locked")
	ErrPeriodHasUnpostedVouchers = errors.New("period_has_unposted_vouchers")
	ErrTrialBalanceBroken        = errors.New("trial_balance_broken")
	ErrCOAMissingAccount         = errors.New("coa_missing_account")
	ErrAccountCodeRequired       = errors.New("account_code_required")
	ErrInvalidAccountType        = errors.New("invalid_account_type")
	ErrCounterpartyRequired      = errors.New("counterparty_required")
)

// Sentinels introduced by the SRC-0027 owner-decided rules (fiscal.go); the
// frozen reference has no counterparts for them.
var (
	ErrInvalidReportFrequency  = errors.New("invalid_report_frequency")
	ErrInvalidFiscalCalendar   = errors.New("invalid_fiscal_calendar")
	ErrInvalidReportPeriod     = errors.New("invalid_report_period")
	ErrUnknownPeriodStatus     = errors.New("unknown_period_status")
	ErrInvalidManagementWindow = errors.New("invalid_management_window")
)

// fail wraps a kind sentinel with the reference's user-facing message text.
func fail(kind error, msg string) error {
	return fmt.Errorf("%w: %s", kind, msg)
}
