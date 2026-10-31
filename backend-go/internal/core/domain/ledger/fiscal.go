package ledger

import (
	"fmt"
	"sort"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Fiscal-period anchoring for reports — the SRC-0027 owner decision on BL-14
// (confirmed by the owner 2026-10-30). NOT present in the frozen Python
// backend; this is the owner-decided rule the Go port implements, the way
// positions.SoloMode carries SRC-0028. design.md assigns the ledger package
// "chart, fiscal periods, carry-forward (BL-14, 30)", and these are the
// period-anchoring primitives the reporting package builds on.
//
// The decision, as recorded in SRC-0027's resolution:
//
//   - Financial reports are limited to monthly, quarterly, semi-annually and
//     annually. A standard-period report is the aggregation of its underlying
//     fiscal periods and reports their open/soft-closed/locked state.
//   - "Annually" means the entity's fiscal year — CN commonly the calendar
//     year, AU July–June, HK April–March for tax — not the calendar year, and
//     the quarterly and semi-annual split points follow that fiscal year.
//   - Management reports keep custom periods: read-only projections over
//     posted entries that never bypass period locks. They never create or
//     mutate period state, and they report which overlapping fiscal periods
//     are still open so nobody mistakes an unsettled window for a settled one.
//
// The BL-14 defect this closes: the reference's P&L read an all-time "opening"
// (every line ever dated before the period), so December 2025 revenue kept
// appearing in January 2027 opening revenue and the P&L profit disagreed with
// the cash-flow statement's movement-based starting profit. Under the decided
// semantics a financial report aggregates the anchored window's activity by
// date (SumActivity); all-time openings remain a balance-sheet concept only.
// The defect scenarios are pinned by TestBL14_* regression tests, excluded
// from the golden fixtures by design.

// ReportFrequency is the frequency of a standard financial report. SRC-0027
// limits financial reports to exactly these four; a custom window is a
// management report (ManagementWindow), never a financial one.
type ReportFrequency string

const (
	FrequencyMonthly      ReportFrequency = "MONTHLY"
	FrequencyQuarterly    ReportFrequency = "QUARTERLY"
	FrequencySemiAnnually ReportFrequency = "SEMI_ANNUALLY"
	FrequencyAnnually     ReportFrequency = "ANNUALLY"
)

// ParseReportFrequency accepts only the four financial-report frequencies;
// anything else (including "CUSTOM") is refused.
func ParseReportFrequency(s string) (ReportFrequency, error) {
	switch ReportFrequency(s) {
	case FrequencyMonthly, FrequencyQuarterly, FrequencySemiAnnually, FrequencyAnnually:
		return ReportFrequency(s), nil
	}
	return "", fail(ErrInvalidReportFrequency,
		fmt.Sprintf("INVALID_REPORT_FREQUENCY: '%s' 不是財務報告期間（支援 MONTHLY、QUARTERLY、SEMI_ANNUALLY、ANNUALLY）。", s))
}

// FiscalCalendar fixes the entity's fiscal year by its starting month
// (1 = calendar year, 7 = AU July–June, 4 = HK April–March). The fiscal-year
// label is the calendar year of its first month.
type FiscalCalendar struct {
	StartMonth int
}

// NewFiscalCalendar validates the starting month.
func NewFiscalCalendar(startMonth int) (FiscalCalendar, error) {
	if startMonth < 1 || startMonth > 12 {
		return FiscalCalendar{}, fail(ErrInvalidFiscalCalendar,
			fmt.Sprintf("INVALID_FISCAL_CALENDAR: 起始月份 %d 不在 1..12。", startMonth))
	}
	return FiscalCalendar{StartMonth: startMonth}, nil
}

// FiscalYearOf reports which fiscal year the (canonical) date belongs to.
func (c FiscalCalendar) FiscalYearOf(day string) (int, error) {
	if !validDate(day) {
		return 0, fail(ErrInvalidAccountingDate,
			"INVALID_ACCOUNTING_DATE: '"+day+"' must be YYYY-MM-DD.")
	}
	y, m := atoi(day[:4]), atoi(day[5:7])
	if m >= c.StartMonth {
		return y, nil
	}
	return y - 1, nil
}

// FiscalYearBounds returns the inclusive first and last day of fiscal year fy.
func (c FiscalCalendar) FiscalYearBounds(fy int) (string, string, error) {
	if fy < 1 || fy > 9999 {
		return "", "", fail(ErrInvalidFiscalCalendar,
			fmt.Sprintf("INVALID_FISCAL_CALENDAR: 年度 %d 不在 1..9999。", fy))
	}
	endYear, endMonth := fy+1, c.StartMonth-1
	if endMonth == 0 {
		endYear, endMonth = fy, 12
	}
	if endYear > 9999 {
		return "", "", fail(ErrInvalidFiscalCalendar,
			fmt.Sprintf("INVALID_FISCAL_CALENDAR: 年度 %d 超出可表示範圍。", fy))
	}
	start := fmt.Sprintf("%04d-%02d-01", fy, c.StartMonth)
	end := fmt.Sprintf("%04d-%02d-%02d", endYear, endMonth, monthLength(endYear, endMonth))
	return start, end, nil
}

// fiscalYearMonths returns the twelve monthly period codes of fiscal year fy,
// chronological, crossing the calendar year when StartMonth != 1.
func (c FiscalCalendar) fiscalYearMonths(fy int) ([]string, error) {
	if fy < 1 || fy > 9999 {
		return nil, fail(ErrInvalidFiscalCalendar,
			fmt.Sprintf("INVALID_FISCAL_CALENDAR: 年度 %d 不在 1..9999。", fy))
	}
	months := make([]string, 0, 12)
	y, m := fy, c.StartMonth
	for i := 0; i < 12; i++ {
		months = append(months, fmt.Sprintf("%04d-%02d", y, m))
		m++
		if m == 13 {
			m = 1
			y++
		}
	}
	return months, nil
}

// FinancialReportSpec selects a standard financial-report period inside one
// fiscal year. Index counts periods from the start of the fiscal year:
// MONTHLY 1..12, QUARTERLY 1..4, SEMI_ANNUALLY 1..2; ANNUALLY ignores it.
type FinancialReportSpec struct {
	Frequency  ReportFrequency
	FiscalYear int
	Index      int
}

// ReportWindow is the anchored window of a standard financial report: the
// inclusive date bounds and the underlying monthly fiscal-period codes whose
// state the report aggregates.
type ReportWindow struct {
	Start      string   `json:"start"`
	End        string   `json:"end"`
	MonthCodes []string `json:"month_codes"`
}

// FinancialReportWindow anchors a standard financial report to the fiscal
// calendar. The split points follow the entity's fiscal year, so AU fiscal
// Q1 is July–September and the "annual" window for fiscal 2026 starting July
// is 2026-07-01..2027-06-30.
func (c FiscalCalendar) FinancialReportWindow(spec FinancialReportSpec) (ReportWindow, error) {
	months, err := c.fiscalYearMonths(spec.FiscalYear)
	if err != nil {
		return ReportWindow{}, err
	}
	var sel []string
	switch spec.Frequency {
	case FrequencyAnnually:
		sel = months
	case FrequencySemiAnnually:
		if spec.Index < 1 || spec.Index > 2 {
			return ReportWindow{}, fail(ErrInvalidReportPeriod,
				fmt.Sprintf("INVALID_REPORT_PERIOD: 半年報序號 %d 不在 1..2。", spec.Index))
		}
		sel = months[(spec.Index-1)*6 : spec.Index*6]
	case FrequencyQuarterly:
		if spec.Index < 1 || spec.Index > 4 {
			return ReportWindow{}, fail(ErrInvalidReportPeriod,
				fmt.Sprintf("INVALID_REPORT_PERIOD: 季報序號 %d 不在 1..4。", spec.Index))
		}
		sel = months[(spec.Index-1)*3 : spec.Index*3]
	case FrequencyMonthly:
		if spec.Index < 1 || spec.Index > 12 {
			return ReportWindow{}, fail(ErrInvalidReportPeriod,
				fmt.Sprintf("INVALID_REPORT_PERIOD: 月報序號 %d 不在 1..12。", spec.Index))
		}
		sel = months[spec.Index-1 : spec.Index]
	default:
		return ReportWindow{}, fail(ErrInvalidReportFrequency,
			fmt.Sprintf("INVALID_REPORT_FREQUENCY: '%s' 不是財務報告期間。", string(spec.Frequency)))
	}
	startYear, startMonth := atoi(sel[0][:4]), atoi(sel[0][5:7])
	endYear, endMonth := atoi(sel[len(sel)-1][:4]), atoi(sel[len(sel)-1][5:7])
	return ReportWindow{
		Start:      fmt.Sprintf("%04d-%02d-01", startYear, startMonth),
		End:        fmt.Sprintf("%04d-%02d-%02d", endYear, endMonth, monthLength(endYear, endMonth)),
		MonthCodes: append([]string(nil), sel...),
	}, nil
}

// AggregatePeriodState anchors a standard report to fiscal_periods state: the
// report's state is the aggregation of its underlying fiscal periods. A
// period code with no stored row behaves as OPEN — the reference auto-creates
// OPEN periods on demand. The reference's other statuses map onto the three
// settled/unsettled states the owner named (SRC-0027): FUTURE is not settled
// (it can still change, like OPEN) and HARD_CLOSE is settled like LOCKED;
// anything else fails closed. The combination is the least-settled state
// wins, so a reader is never told the numbers are settled while a component
// period can still change: any OPEN → OPEN, else any SOFT_CLOSE → SOFT_CLOSE,
// else all LOCKED → LOCKED.
func AggregatePeriodState(periods []Period, monthCodes []string) (string, error) {
	anyOpen, anySoftClose := false, false
	for _, code := range monthCodes {
		status, found := "", false
		for _, p := range periods {
			if p.PeriodCode == code {
				status, found = p.Status, true
				break
			}
		}
		if !found {
			status = "OPEN" // ensure_period's auto-created default
		}
		switch status {
		case "OPEN", "FUTURE":
			anyOpen = true
		case "SOFT_CLOSE":
			anySoftClose = true
		case "LOCKED", "HARD_CLOSE":
			// settled
		default:
			return "", fail(ErrUnknownPeriodStatus,
				fmt.Sprintf("UNKNOWN_PERIOD_STATUS: 期間 %s 狀態 '%s' 無法辨識。", code, status))
		}
	}
	switch {
	case anyOpen:
		return "OPEN", nil
	case anySoftClose:
		return "SOFT_CLOSE", nil
	}
	return "LOCKED", nil
}

// ManagementWindow is a custom reporting period for management reports
// (SRC-0027). It is a read-only projection over posted entries by design:
// nothing in this package turns it into a writable period or a fiscal-period
// row, and the overlap helper reports the lock state it touches. Start and
// End are inclusive real dates.
type ManagementWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// ParseManagementWindow validates a custom management window: both bounds
// must be real canonical dates and Start must not come after End.
func ParseManagementWindow(start, end string) (ManagementWindow, error) {
	if !validDate(start) || !validDate(end) {
		return ManagementWindow{}, fail(ErrInvalidManagementWindow,
			"INVALID_MANAGEMENT_WINDOW: 自訂期間必須是真實的 YYYY-MM-DD 日期。")
	}
	if start > end {
		return ManagementWindow{}, fail(ErrInvalidManagementWindow,
			"INVALID_MANAGEMENT_WINDOW: 起日 "+start+" 晚於迄日 "+end+"。")
	}
	return ManagementWindow{Start: start, End: end}, nil
}

// PeriodsOverlappingWindow returns the fiscal periods that overlap the
// window, ordered by period code, with their stored state. A management
// projection reports these so the reader can see which parts of the window
// are still open; reading never bypasses a lock, and writing through a
// window is not expressible here.
func PeriodsOverlappingWindow(periods []Period, w ManagementWindow) []Period {
	out := []Period{}
	for _, p := range periods {
		if p.StartDate <= w.End && p.EndDate >= w.Start {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].PeriodCode < out[j].PeriodCode })
	return out
}

// SumActivity totals functional debits and credits over lines dated within
// [start, end] inclusive — the explicit date-bounded definition a financial
// report aggregates under SRC-0027. Every line is validated first: malformed
// legacy records are rejected, never silently omitted. The BL-14 regression
// tests use this to show prior-fiscal-year revenue stays out of an anchored
// report while the movement basis and the P&L basis agree on the same window.
func SumActivity(lines []Line, start, end string) (debit, credit money.Money, err error) {
	debit, credit = zeroQ4, zeroQ4
	for i := range lines {
		pc := lines[i].PeriodCode
		if _, verr := ValidatePostingDate(lines[i].AccountingDate, &pc); verr != nil {
			return money.Money{}, money.Money{}, verr
		}
		if lines[i].AccountingDate < start || lines[i].AccountingDate > end {
			continue
		}
		debit = debit.Add(lines[i].FuncDebit)
		credit = credit.Add(lines[i].FuncCredit)
	}
	return debit, credit, nil
}
