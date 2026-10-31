package ledger

import (
	"errors"
	"testing"
)

// BL-14 regression tests: the decided semantics of SRC-0027 (owner-confirmed
// 2026-10-30), implemented by fiscal.go. The defect scenarios from the
// 2026-10-21 business-logic audit are asserted here against the DECIDED
// behaviour, not the reference's — these scenarios are excluded from the
// golden fixtures by design.
//
// The audit defect: opening revenue 100 (December 2025) plus November
// revenue 20 yielded P&L profit 120 versus cash-flow starting profit 20, and
// "revenue from December 2025 remained in January 2027 opening revenue".

// bl14Lines seeds the audit's numbers: revenue 100 dated 2025-12-05, revenue
// 20 and expense 5 dated 2026-11-20, and revenue 20 dated 2027-01-10. Every
// entry balances (the cash leg rides each revenue/expense entry).
func bl14Lines() []Line {
	return []Line{
		{LineID: "B1", JournalID: "JB1", EntityCode: "DEMO", LineNumber: 1,
			AccountCode: "1000", PeriodCode: "2025-12", EntryLayer: "OPERATIONAL",
			AccountingDate: "2025-12-05", TxDebit: mustParse("100.0000"), FuncDebit: mustParse("100.0000")},
		{LineID: "B2", JournalID: "JB1", EntityCode: "DEMO", LineNumber: 2,
			AccountCode: "4100", PeriodCode: "2025-12", EntryLayer: "OPERATIONAL",
			AccountingDate: "2025-12-05", TxCredit: mustParse("100.0000"), FuncCredit: mustParse("100.0000")},
		{LineID: "B3", JournalID: "JB2", EntityCode: "DEMO", LineNumber: 1,
			AccountCode: "1000", PeriodCode: "2026-11", EntryLayer: "OPERATIONAL",
			AccountingDate: "2026-11-20", TxDebit: mustParse("15.0000"), FuncDebit: mustParse("15.0000")},
		{LineID: "B4", JournalID: "JB2", EntityCode: "DEMO", LineNumber: 2,
			AccountCode: "4100", PeriodCode: "2026-11", EntryLayer: "OPERATIONAL",
			AccountingDate: "2026-11-20", TxCredit: mustParse("20.0000"), FuncCredit: mustParse("20.0000")},
		{LineID: "B5", JournalID: "JB2", EntityCode: "DEMO", LineNumber: 3,
			AccountCode: "6100", PeriodCode: "2026-11", EntryLayer: "OPERATIONAL",
			AccountingDate: "2026-11-20", TxDebit: mustParse("5.0000"), FuncDebit: mustParse("5.0000")},
		{LineID: "B6", JournalID: "JB3", EntityCode: "DEMO", LineNumber: 1,
			AccountCode: "4100", PeriodCode: "2027-01", EntryLayer: "OPERATIONAL",
			AccountingDate: "2027-01-10", TxCredit: mustParse("20.0000"), FuncCredit: mustParse("20.0000")},
		{LineID: "B7", JournalID: "JB3", EntityCode: "DEMO", LineNumber: 2,
			AccountCode: "1000", PeriodCode: "2027-01", EntryLayer: "OPERATIONAL",
			AccountingDate: "2027-01-10", TxDebit: mustParse("20.0000"), FuncDebit: mustParse("20.0000")},
	}
}

// TestBL14_annual_report_anchors_to_entity_fiscal_year pins "annually means
// the entity's fiscal year": a CN calendar-year entity's fiscal 2027 spans
// 2027-01-01..2027-12-31, while an AU July–June entity's fiscal 2026 spans
// 2026-07-01..2027-06-30, with quarterly and semi-annual split points
// following that year, not the calendar year.
func TestBL14_annual_report_anchors_to_entity_fiscal_year(t *testing.T) {
	cn, err := NewFiscalCalendar(1)
	if err != nil {
		t.Fatal(err)
	}
	w, err := cn.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyAnnually, FiscalYear: 2027,
	})
	if err != nil {
		t.Fatal(err)
	}
	if w.Start != "2027-01-01" || w.End != "2027-12-31" {
		t.Errorf("CN fiscal 2027 annual window = [%s, %s], want [2027-01-01, 2027-12-31]", w.Start, w.End)
	}
	if len(w.MonthCodes) != 12 || w.MonthCodes[0] != "2027-01" || w.MonthCodes[11] != "2027-12" {
		t.Errorf("CN fiscal 2027 months = %v, want 2027-01..2027-12", w.MonthCodes)
	}

	au, err := NewFiscalCalendar(7)
	if err != nil {
		t.Fatal(err)
	}
	w, err = au.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyAnnually, FiscalYear: 2026,
	})
	if err != nil {
		t.Fatal(err)
	}
	if w.Start != "2026-07-01" || w.End != "2027-06-30" {
		t.Errorf("AU fiscal 2026 annual window = [%s, %s], want [2026-07-01, 2027-06-30]", w.Start, w.End)
	}
	// Fiscal Q1 follows the year: July–September, not January–March.
	q1, err := au.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyQuarterly, FiscalYear: 2026, Index: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if q1.Start != "2026-07-01" || q1.End != "2026-09-30" {
		t.Errorf("AU fiscal 2026 Q1 = [%s, %s], want [2026-07-01, 2026-09-30]", q1.Start, q1.End)
	}
	// Semi-annual split points follow the fiscal year too.
	h2, err := au.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencySemiAnnually, FiscalYear: 2026, Index: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if h2.Start != "2027-01-01" || h2.End != "2027-06-30" {
		t.Errorf("AU fiscal 2026 H2 = [%s, %s], want [2027-01-01, 2027-06-30]", h2.Start, h2.End)
	}
	// Fiscal-year membership follows the calendar.
	if fy, err := au.FiscalYearOf("2027-06-30"); err != nil || fy != 2026 {
		t.Errorf("FiscalYearOf(2027-06-30) = %d, %v; want 2026, nil", fy, err)
	}
	if fy, err := au.FiscalYearOf("2027-07-01"); err != nil || fy != 2027 {
		t.Errorf("FiscalYearOf(2027-07-01) = %d, %v; want 2027, nil", fy, err)
	}
}

// bl14RevenueChart is the slice of the chart the P&L assertions read.
func bl14Chart() []Account {
	return []Account{
		{AccountID: "DEMO:1000", AccountCode: "1000", AccountName: "銀行存款",
			AccountType: "ASSET", NormalBalance: "DEBIT", FSCategory: "CASH"},
		{AccountID: "DEMO:4100", AccountCode: "4100", AccountName: "主營業務收入",
			AccountType: "REVENUE", NormalBalance: "CREDIT", FSCategory: "REVENUE"},
		{AccountID: "DEMO:6100", AccountCode: "6100", AccountName: "管理及營運費用",
			AccountType: "EXPENSE", NormalBalance: "DEBIT", FSCategory: "OPEX"},
	}
}

// accountLines filters lines to one account for the P&L-style sums (the
// reporting package maps account types; here the codes are fixed).
func accountLines(lines []Line, code string) []Line {
	out := []Line{}
	for _, l := range lines {
		if l.AccountCode == code {
			out = append(out, l)
		}
	}
	return out
}

// TestBL14_prior_year_revenue_stays_out_of_fiscal_year_report pins the first
// defect scenario: December 2025 revenue must not appear in a fiscal 2027
// report. The reference's all-time opening carried it forward into January
// 2027 opening revenue; the decided semantics aggregate the anchored window's
// activity by date, so fiscal 2027 sees only the January 2027 revenue.
func TestBL14_prior_year_revenue_stays_out_of_fiscal_year_report(t *testing.T) {
	cn, err := NewFiscalCalendar(1)
	if err != nil {
		t.Fatal(err)
	}
	w, err := cn.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyAnnually, FiscalYear: 2027,
	})
	if err != nil {
		t.Fatal(err)
	}
	lines := bl14Lines()
	// All lines validate (canonical dates, matching periods); the window
	// filter is what keeps December 2025 out.
	debit, credit, err := SumActivity(lines, w.Start, w.End)
	if err != nil {
		t.Fatal(err)
	}
	// January 2027: revenue credit 20, cash debit 20. The 100 from December
	// 2025 is outside the window.
	if credit.String() != "20.0000" {
		t.Errorf("fiscal 2027 credits = %s, want 20.0000 (December 2025 revenue must stay out)", credit.String())
	}
	if debit.String() != "20.0000" {
		t.Errorf("fiscal 2027 debits = %s, want 20.0000", debit.String())
	}
	// The contrast is explicit: the legacy all-time opening for January 2027
	// still carries prior-year revenue (balance-sheet concept), but the
	// report aggregation does not read it.
	balances, err := DeriveBalances(bl14Chart(), lines, "DEMO", "2027-01")
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range balances {
		if b.AccountCode == "4100" && b.Opening.String() != "-120.0000" {
			t.Errorf("legacy opening for 4100 = %s, want -120.0000 (documents the difference: -100 prior year -20 November)", b.Opening.String())
		}
	}
}

// TestBL14_monthly_profit_matches_cash_movement_basis pins the second defect
// scenario: the P&L profit and the cash-flow statement's starting profit must
// come from the same anchored window. The reference compared an all-time
// opening+movement profit (115) against the windowed movement (15); under the
// decided semantics both are the window's activity, so they agree.
func TestBL14_monthly_profit_matches_cash_movement_basis(t *testing.T) {
	cn, err := NewFiscalCalendar(1)
	if err != nil {
		t.Fatal(err)
	}
	w, err := cn.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyMonthly, FiscalYear: 2026, Index: 11,
	})
	if err != nil {
		t.Fatal(err)
	}
	if w.Start != "2026-11-01" || w.End != "2026-11-30" {
		t.Fatalf("monthly window = [%s, %s], want [2026-11-01, 2026-11-30]", w.Start, w.End)
	}
	lines := bl14Lines()
	// The whole seed validates over the window (fail-closed rule intact).
	if _, _, err := SumActivity(lines, w.Start, w.End); err != nil {
		t.Fatal(err)
	}
	profit := func(start, end string) string {
		_, revenue, err := SumActivity(accountLines(lines, "4100"), start, end)
		if err != nil {
			t.Fatal(err)
		}
		expense, _, err := SumActivity(accountLines(lines, "6100"), start, end)
		if err != nil {
			t.Fatal(err)
		}
		return revenue.Sub(expense).String()
	}
	if got := profit(w.Start, w.End); got != "15.0000" {
		t.Errorf("monthly report profit = %s, want 15.0000 (revenue 20 - expense 5)", got)
	}
	// The same window bounds the cash-flow derivation's movement basis, so
	// the two statements can no longer disagree about the period: the fiscal
	// year-to-date window gives the same answer as the month.
	fy, err := cn.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyAnnually, FiscalYear: 2026,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := profit(fy.Start, fy.End); got != "15.0000" {
		t.Errorf("fiscal 2026 profit = %s, want 15.0000 (same basis as the monthly report)", got)
	}
	// The legacy contrast: the all-time opening for November still carried
	// the December 2025 revenue, which is how the reference produced 120.
	balances, err := DeriveBalances(bl14Chart(), lines, "DEMO", "2026-11")
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range balances {
		if b.AccountCode == "4100" && b.Opening.String() != "-100.0000" {
			t.Errorf("legacy opening for 4100 in 2026-11 = %s, want -100.0000 (documents the defect's source)", b.Opening.String())
		}
	}
}

// TestBL14_financial_reports_reject_custom_frequencies pins the frequency
// limit: financial reports are monthly, quarterly, semi-annually or annually;
// a custom window is a management report (read-only projection), never a
// financial one.
func TestBL14_financial_reports_reject_custom_frequencies(t *testing.T) {
	for _, f := range []string{"MONTHLY", "QUARTERLY", "SEMI_ANNUALLY", "ANNUALLY"} {
		if _, err := ParseReportFrequency(f); err != nil {
			t.Errorf("ParseReportFrequency(%q) refused: %v", f, err)
		}
	}
	if _, err := ParseReportFrequency("CUSTOM"); !errors.Is(err, ErrInvalidReportFrequency) {
		t.Errorf("ParseReportFrequency(CUSTOM) = %v, want ErrInvalidReportFrequency", err)
	}
	if _, err := ParseReportFrequency(""); !errors.Is(err, ErrInvalidReportFrequency) {
		t.Errorf("ParseReportFrequency(\"\") = %v, want ErrInvalidReportFrequency", err)
	}
	// A custom window exists, but it is read-only by construction: no
	// function turns it into a writable period or a fiscal-period row.
	mw, err := ParseManagementWindow("2026-11-01", "2026-12-15")
	if err != nil {
		t.Fatal(err)
	}
	if mw.Start != "2026-11-01" || mw.End != "2026-12-15" {
		t.Errorf("management window = %+v", mw)
	}
	if _, err := ParseManagementWindow("2026-12-15", "2026-11-01"); !errors.Is(err, ErrInvalidManagementWindow) {
		t.Errorf("reversed window = %v, want ErrInvalidManagementWindow", err)
	}
	if _, err := ParseManagementWindow("2026-02-30", "2026-03-01"); !errors.Is(err, ErrInvalidManagementWindow) {
		t.Errorf("impossible-date window = %v, want ErrInvalidManagementWindow", err)
	}
}

// TestBL14_report_state_anchors_to_fiscal_periods pins the anchoring: a
// standard report reports the aggregated state of its underlying fiscal
// periods, least-settled wins; a missing row behaves as OPEN; FUTURE is
// unsettled, HARD_CLOSE settled; unknown statuses fail closed.
func TestBL14_report_state_anchors_to_fiscal_periods(t *testing.T) {
	cn, err := NewFiscalCalendar(1)
	if err != nil {
		t.Fatal(err)
	}
	w, err := cn.FinancialReportWindow(FinancialReportSpec{
		Frequency: FrequencyQuarterly, FiscalYear: 2026, Index: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	codes := w.MonthCodes // 2026-10, 2026-11, 2026-12
	p := func(code, status string) Period {
		return Period{PeriodID: "DEMO:" + code, EntityCode: "DEMO", PeriodCode: code, Status: status}
	}
	cases := []struct {
		name    string
		periods []Period
		want    string
	}{
		{"all locked", []Period{p("2026-10", "LOCKED"), p("2026-11", "LOCKED"), p("2026-12", "LOCKED")}, "LOCKED"},
		{"hard close counts as settled", []Period{p("2026-10", "HARD_CLOSE"), p("2026-11", "LOCKED"), p("2026-12", "HARD_CLOSE")}, "LOCKED"},
		{"any open wins", []Period{p("2026-10", "LOCKED"), p("2026-11", "LOCKED"), p("2026-12", "OPEN")}, "OPEN"},
		{"future is unsettled", []Period{p("2026-10", "LOCKED"), p("2026-11", "LOCKED"), p("2026-12", "FUTURE")}, "OPEN"},
		{"soft close between", []Period{p("2026-10", "LOCKED"), p("2026-11", "SOFT_CLOSE"), p("2026-12", "LOCKED")}, "SOFT_CLOSE"},
		{"missing rows behave as open", nil, "OPEN"},
	}
	for _, tc := range cases {
		state, err := AggregatePeriodState(tc.periods, codes)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if state != tc.want {
			t.Errorf("%s: state = %q, want %q", tc.name, state, tc.want)
		}
	}
	if _, err := AggregatePeriodState([]Period{p("2026-10", "GARBAGE")}, codes[:1]); !errors.Is(err, ErrUnknownPeriodStatus) {
		t.Errorf("unknown status = %v, want ErrUnknownPeriodStatus", err)
	}
}

// TestBL14_management_projection_reports_lock_coverage pins the management
// projection's read-only contract: the custom window reports which fiscal
// periods it overlaps and their stored state, so nobody mistakes an
// unsettled window for a settled one; nothing in the window is writable.
func TestBL14_management_projection_reports_lock_coverage(t *testing.T) {
	mw, err := ParseManagementWindow("2026-10-15", "2027-01-15")
	if err != nil {
		t.Fatal(err)
	}
	periods := []Period{
		{PeriodID: "DEMO:2026-10", PeriodCode: "2026-10", StartDate: "2026-10-01", EndDate: "2026-10-31", Status: "SOFT_CLOSE"},
		{PeriodID: "DEMO:2026-11", PeriodCode: "2026-11", StartDate: "2026-11-01", EndDate: "2026-11-30", Status: "LOCKED"},
		{PeriodID: "DEMO:2026-12", PeriodCode: "2026-12", StartDate: "2026-12-01", EndDate: "2026-12-31", Status: "OPEN"},
		{PeriodID: "DEMO:2027-02", PeriodCode: "2027-02", StartDate: "2027-02-01", EndDate: "2027-02-28", Status: "OPEN"},
	}
	got := PeriodsOverlappingWindow(periods, mw)
	if len(got) != 3 {
		t.Fatalf("overlapping periods = %d, want 3 (October through December; February is outside)", len(got))
	}
	wantStates := map[string]string{"2026-10": "SOFT_CLOSE", "2026-11": "LOCKED", "2026-12": "OPEN"}
	for _, p := range got {
		if wantStates[p.PeriodCode] != p.Status {
			t.Errorf("period %s state = %q, want %q", p.PeriodCode, p.Status, wantStates[p.PeriodCode])
		}
	}
	// Read-only by construction: the window type carries no writable state,
	// and the overlap rule that guards writes is AssertWritable, which the
	// projection never invokes.
	for _, p := range got {
		if p.PeriodCode == "2026-11" && p.IsWritable() {
			t.Error("a LOCKED period must not present as writable through the projection")
		}
	}
}

// TestSumActivity_rejects_malformed_legacy_rows pins the derivation rule on
// the SRC-0027 aggregation helper too: malformed legacy records are rejected,
// never silently omitted.
func TestSumActivity_rejects_malformed_legacy_rows(t *testing.T) {
	lines := append(bl14Lines(), Line{
		JournalID: "JX", EntityCode: "DEMO", AccountCode: "4100",
		PeriodCode: "2026-02", AccountingDate: "2026-02-30",
	})
	if _, _, err := SumActivity(lines, "2026-01-01", "2027-12-31"); !errors.Is(err, ErrInvalidAccountingDate) {
		t.Errorf("SumActivity with malformed legacy row = %v, want ErrInvalidAccountingDate", err)
	}
}
