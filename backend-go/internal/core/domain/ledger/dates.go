package ledger

import "fmt"

// This file ports the period and date helpers of backend/app/core/ledger.py
// (the BL-04 remediation state): canonical real YYYY-MM-DD validation against
// inclusive monthly YYYY-MM and quarterly YYYY-Qn bounds, next/previous period
// derivation, and the explicit rule that an absent period derives from the
// validated date's month while an explicitly empty, malformed, annual or
// mismatched period is rejected. Annual periods remain unsupported.

// PeriodSpan is period_bounds' result: inclusive start/end dates plus the
// fiscal year and period number the code names.
type PeriodSpan struct {
	Start        string // YYYY-MM-DD, inclusive
	End          string // YYYY-MM-DD, inclusive
	FiscalYear   int    // the YYYY part
	PeriodNumber int    // month 1..12, or quarter 1..4
}

// isDigits reports an ASCII digit run. The reference's regexes use \d, which
// in Python also matches Unicode decimal digits; the port reads ASCII only,
// since no caller produces anything else.
func isDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}

func digit(s string) int { return int(s[0] - '0') }

// parseMonthCode matches "^(\d{4})-(\d{2})$" in full (Python MONTH_RE.fullmatch).
func parseMonthCode(s string) (year, month int, ok bool) {
	if len(s) != 7 || s[4] != '-' {
		return 0, 0, false
	}
	if !isDigits(s[:4]) || !isDigits(s[5:]) {
		return 0, 0, false
	}
	return atoi(s[:4]), atoi(s[5:]), true
}

// parseQuarterCode matches "^(\d{4})-Q([1-4])$" in full (Python QUARTER_RE.fullmatch).
func parseQuarterCode(s string) (year, quarter int, ok bool) {
	if len(s) != 7 || s[4] != '-' || s[5] != 'Q' {
		return 0, 0, false
	}
	if !isDigits(s[:4]) || s[6] < '1' || s[6] > '4' {
		return 0, 0, false
	}
	return atoi(s[:4]), digit(s[6:]), true
}

// monthLength is calendar.monthrange's last-day half.
func monthLength(year, month int) int {
	switch month {
	case 1, 3, 5, 7, 8, 10, 12:
		return 31
	case 4, 6, 9, 11:
		return 30
	case 2:
		if year%4 == 0 && (year%100 != 0 || year%400 == 0) {
			return 29
		}
		return 28
	}
	return 0
}

// PeriodBounds ports period_bounds: ('2026-10') → (start, end, fiscal year,
// period number). A quarterly code spans its three calendar months. Anything
// else — including annual codes — is INVALID_PERIOD.
func PeriodBounds(periodCode string) (PeriodSpan, error) {
	if y, m, ok := parseMonthCode(periodCode); ok {
		if y < 1 || y > 9999 || m < 1 || m > 12 {
			return PeriodSpan{}, fail(ErrInvalidPeriod, "INVALID_PERIOD: '"+periodCode+"'")
		}
		last := monthLength(y, m)
		return PeriodSpan{
			Start:        fmt.Sprintf("%04d-%02d-01", y, m),
			End:          fmt.Sprintf("%04d-%02d-%02d", y, m, last),
			FiscalYear:   y,
			PeriodNumber: m,
		}, nil
	}
	if y, q, ok := parseQuarterCode(periodCode); ok {
		if y < 1 || y > 9999 {
			return PeriodSpan{}, fail(ErrInvalidPeriod, "INVALID_PERIOD: '"+periodCode+"'")
		}
		first := (q-1)*3 + 1
		lastMonth := first + 2
		lastDay := monthLength(y, lastMonth)
		return PeriodSpan{
			Start:        fmt.Sprintf("%04d-%02d-01", y, first),
			End:          fmt.Sprintf("%04d-%02d-%02d", y, lastMonth, lastDay),
			FiscalYear:   y,
			PeriodNumber: q,
		}, nil
	}
	return PeriodSpan{}, fail(ErrInvalidPeriod,
		"INVALID_PERIOD: '"+periodCode+"' 不是可辨識的會計期間（支援 YYYY-MM 與 YYYY-Qn）。")
}

// validDate reports a canonical, real YYYY-MM-DD calendar date. The reference
// parses with date.fromisoformat and then requires parsed.isoformat() to
// reproduce the input byte for byte, which admits exactly this shape
// (including leap days, rejecting 2026-02-30 and non-canonical spellings).
func validDate(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	if !isDigits(s[:4]) || !isDigits(s[5:7]) || !isDigits(s[8:]) {
		return false
	}
	y, m, d := atoi(s[:4]), atoi(s[5:7]), atoi(s[8:])
	if y < 1 || y > 9999 || m < 1 || m > 12 {
		return false
	}
	return d >= 1 && d <= monthLength(y, m)
}

// ValidatePostingDate ports validate_posting_date: require a real YYYY-MM-DD
// date within inclusive calendar period bounds, and return the effective
// period code. A nil period derives from the validated date's month; an
// explicitly empty, malformed, annual or mismatched period is rejected, and
// the date is never rewritten to fit a label.
func ValidatePostingDate(accountingDate string, periodCode *string) (string, error) {
	if !validDate(accountingDate) {
		return "", fail(ErrInvalidAccountingDate,
			"INVALID_ACCOUNTING_DATE: '"+accountingDate+"' must be YYYY-MM-DD.")
	}
	period := ""
	if periodCode != nil {
		period = *periodCode
	} else {
		period = accountingDate[:7]
	}
	span, err := PeriodBounds(period)
	if err != nil {
		return "", err
	}
	// String comparison is date comparison for canonical YYYY-MM-DD values,
	// exactly as the reference compares them.
	if span.Start > accountingDate || accountingDate > span.End {
		return "", fail(ErrPeriodDateMismatch,
			"PERIOD_DATE_MISMATCH: "+accountingDate+" is outside "+period+" ["+span.Start+", "+span.End+"].")
	}
	return period, nil
}

// NextPeriodCode ports next_period_code: the month or quarter after the code,
// rolling the year. The reference's regexes carry $, so its re.match is a
// full match; the month number is not bound-checked ("2026-13" rolls to
// "2026-14") but anything not shaped like a code is INVALID_PERIOD.
func NextPeriodCode(periodCode string) (string, error) {
	if y, m, ok := parseMonthCode(periodCode); ok {
		if m == 12 {
			return fmt.Sprintf("%d-01", y+1), nil
		}
		return fmt.Sprintf("%d-%02d", y, m+1), nil
	}
	if y, q, ok := parseQuarterCode(periodCode); ok {
		if q == 4 {
			return fmt.Sprintf("%d-Q1", y+1), nil
		}
		return fmt.Sprintf("%d-Q%d", y, q+1), nil
	}
	return "", fail(ErrInvalidPeriod, "INVALID_PERIOD: 無法推算 '"+periodCode+"' 的下一期。")
}

// PreviousPeriodCode ports previous_period_code, the mirror of NextPeriodCode.
func PreviousPeriodCode(periodCode string) (string, error) {
	if y, m, ok := parseMonthCode(periodCode); ok {
		if m == 1 {
			return fmt.Sprintf("%d-12", y-1), nil
		}
		return fmt.Sprintf("%d-%02d", y, m-1), nil
	}
	if y, q, ok := parseQuarterCode(periodCode); ok {
		if q == 1 {
			return fmt.Sprintf("%d-Q4", y-1), nil
		}
		return fmt.Sprintf("%d-Q%d", y, q-1), nil
	}
	return "", fail(ErrInvalidPeriod, "INVALID_PERIOD: 無法推算 '"+periodCode+"' 的上一期。")
}

func atoi(s string) int {
	v := 0
	for i := 0; i < len(s); i++ {
		v = v*10 + int(s[i]-'0')
	}
	return v
}
