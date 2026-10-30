package reporting

import (
	"errors"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/localization"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Exact-decimal helpers shared by the statement derivations. Every
// accumulation starts from the reference's ZERO = Decimal("0.0000") so zero
// renders as "0.0000", never a bare "0".

var (
	zeroQ4  = mustParse("0.0000")
	zeroNum = mustParse("0")
)

func mustParse(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("reporting: constant money " + s + ": " + err.Error())
	}
	return m
}

// q4 is the reference's q4 (localization.q4): ROUND_HALF_UP quantize to four
// decimal places, the mode named at this one site.
func q4(m money.Money) (money.Money, error) {
	return localization.Q4(m)
}

// negDisplay is the reference's unary minus on a displayed figure: Python's
// decimal minus is 0 − x, so a zero operand renders as positive zero
// ("-0.0000" never appears where the reference shows "0.0000"). Display
// negations (the "Less: ..." statement lines, the cash-flow delta lines)
// must use this, never raw Neg.
func negDisplay(v money.Money) money.Money {
	if v.IsZero() {
		return zeroQ4
	}
	return v.Neg()
}

// positiveZeroQ4 renders the reference's `Decimal("0.0000")` else-branches:
// a side split always yields positive zero, never the operand's sign.
func positiveZeroQ4(v money.Money, wantPositive bool) money.Money {
	if wantPositive {
		if v.Cmp(zeroNum) > 0 {
			return v
		}
		return zeroQ4
	}
	if v.Cmp(zeroNum) < 0 {
		return v.Neg()
	}
	return zeroQ4
}

// div28 is Python's Decimal division under the default context. money.Div
// carries the full context semantics (28-significant-digit half-even
// rounding, ideal-exponent handling for exact quotients); the wrapper maps
// the money sentinel to the reporting error surface. The margin derivations
// (gross_profit / total_revenue) are the only division sites in the engine.
func div28(a, b money.Money) (money.Money, error) {
	q, err := a.Div(b)
	if err != nil {
		if errors.Is(err, money.ErrDivisionByZero) {
			return money.Money{}, fail(ErrDivisionByZero, "DIVISION_BY_ZERO: 除數為零。")
		}
		return money.Money{}, err
	}
	return q, nil
}

// formatPct1 renders the reference's f"{margin:.1f}%": quantize to one
// decimal place with the context's ROUND_HALF_EVEN (a 12.25 tie renders
// "12.2%", not "12.3%"), fixed notation, sign preserved ("-0.0%").
func formatPct1(m money.Money) (string, error) {
	r, err := m.Round(1, money.RoundHalfEven)
	if err != nil {
		return "", err
	}
	return r.String() + "%", nil
}
