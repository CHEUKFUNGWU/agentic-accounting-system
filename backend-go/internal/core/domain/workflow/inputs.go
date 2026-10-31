package workflow

import (
	"strconv"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the shared input validation of backend/app/core/monolith.py:
// money() (ParseAmount), text() (ValidateText) and iso_date() (ValidateISODate).
//
// The reference's money() rejects bools and non-finite values before parsing;
// in the port the raw value always arrives as a string (the JSON wire form,
// BL-27), so the bool branch is unrepresentable — a caller that received a
// JSON true never reaches here (parity_test.go maps a non-string amount onto
// ErrInvalidAmount, the same refusal the reference produces).

// amountLimit is the reference's supported range bound: abs(amount) must not
// exceed 1000000000000 (monolith.money).
var amountLimit = mustAmount("1000000000000")

// mustAmount parses a compile-time constant; a failure is a programming
// error, not an input condition.
func mustAmount(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("workflow: constant money " + s)
	}
	return m
}

// ParseAmount ports monolith.money: parse a finite amount within the
// supported range, quantize to the money unit 0.0001 with ROUND_HALF_UP, then
// enforce the sign rules — not negative unless signed, strictly positive when
// positive. The result is an exact money.Money: the BL-27 float conversion
// (monolith.py:96,117–118,183–186) does not exist here by construction, and
// the quantized scale is preserved end to end.
//
// The range check runs on the parsed value BEFORE quantization, exactly like
// the reference: 999999999999.99975 is accepted and quantized to
// 999999999999.9998, while 1000000000001 is refused outright.
func ParseAmount(raw string, signed, positive bool) (money.Money, error) {
	m, err := money.Parse(raw)
	if err != nil {
		return money.Money{}, invalidAmount()
	}
	if m.Cmp(amountLimit) > 0 || m.Cmp(amountLimit.Neg()) < 0 {
		return money.Money{}, invalidAmount()
	}
	q, err := m.Round(4, money.RoundHalfUp)
	if err != nil {
		// The reference catches decimal.InvalidOperation from quantize in the
		// same except clause and reports INVALID_AMOUNT.
		return money.Money{}, invalidAmount()
	}
	var zero money.Money
	if (!signed && q.Cmp(zero) < 0) || (positive && q.Cmp(zero) <= 0) {
		return money.Money{}, invalidAmount()
	}
	return q, nil
}

func invalidAmount() error {
	return fail(ErrInvalidAmount, "INVALID_AMOUNT: Enter a finite amount within the supported range.")
}

// ValidateText ports monolith.text: a non-blank string of at most limit
// characters (Python len() counts code points), returned trimmed.
func ValidateText(value, field string, limit int) (string, error) {
	if len([]rune(strings.TrimSpace(value))) == 0 || len([]rune(value)) > limit {
		return "", fail(ErrInvalidField,
			"INVALID_FIELD: "+field+" is required, up to "+strconv.Itoa(limit)+" characters.")
	}
	return strings.TrimSpace(value), nil
}

// ValidateISODate ports monolith.iso_date: a real calendar date, optionally
// required to fall inside the open period's month. The port accepts the
// canonical YYYY-MM-DD form (validated through the ledger package's real-date
// rule); the reference's date.fromisoformat also admits the compact
// YYYYMMDD and ISO week-date forms — no fixture and no caller uses them, and
// the restriction is recorded here rather than silently widened.
func ValidateISODate(value string, period *string) (string, error) {
	if _, err := ledger.ValidatePostingDate(value, nil); err != nil {
		return "", fail(ErrInvalidDate, "INVALID_DATE: Use YYYY-MM-DD.")
	}
	if period != nil && value[:7] != *period {
		return "", fail(ErrPeriodMismatch, "PERIOD_MISMATCH: Accounting date must fall within the open period.")
	}
	return value, nil
}

// ValidateJournalSource ports journal.create's source whitelist: manual
// entries and agentic auto-drafts only — system subledger entries are produced
// by their own commands, never through the generic journal surface.
func ValidateJournalSource(source string) error {
	if source != "Manual Entry" && source != "Agentic Auto-Draft" {
		return fail(ErrInvalidSource, "INVALID_SOURCE: Use the appropriate subledger action for system entries.")
	}
	return nil
}

// EntryStatusFor ports journal.create's status rule: a journal proposed by an
// actor (or an agentic auto-draft) stays a Draft pending human review;
// otherwise it posts directly. The actor arrives as an argument.
func EntryStatusFor(source string, actorPresent bool) string {
	if actorPresent || source == "Agentic Auto-Draft" {
		return "Draft"
	}
	return "Posted"
}

// CommandPeriodGate ports apply_command's period-lock gate: while the period
// is locked only the non-accounting commands may run. The dispatcher itself
// (and the UNKNOWN_ACTION refusal) is the P2 command service's work; this is
// the pure gate every dispatch must call first.
func CommandPeriodGate(isPeriodLocked bool, action string) error {
	if !isPeriodLocked {
		return nil
	}
	switch action {
	case "period.unlock", "preferences.update", "budget.save", "forecast.save":
		return nil
	}
	return fail(ErrPeriodLocked, "PERIOD_LOCKED: Unlock the period before changing its accounting records.")
}
