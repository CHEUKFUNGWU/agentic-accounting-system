package reporting

import (
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// BL-14 regression, reporting side: statement periods anchor to the ledger
// package's decided fiscal primitives (SRC-0027, owner-confirmed
// 2026-10-30). The reference's own period derivation is the defect and is
// not ported: the P&L read an all-time adjusted ending, so December 2025
// revenue 100 plus later revenue appeared in a January 2027 report and the
// P&L profit (120) disagreed with the cash-flow statement's movement-basis
// starting profit (20).

// bl14ReportingLines seeds the audit numbers: revenue 100 dated 2025-12-05,
// revenue 20 and expense 5 dated 2026-11-20, revenue 20 dated 2027-01-10.
// Every entry balances on cash.
func bl14ReportingLines() []ledger.Line {
	return []ledger.Line{
		tline("K1", 1, "1000", "OPERATIONAL", "2025-12-05", "100.0000", "0.0000"),
		tline("K1", 2, "4100", "OPERATIONAL", "2025-12-05", "0.0000", "100.0000"),
		tline("K2", 1, "1000", "OPERATIONAL", "2026-11-20", "15.0000", "0.0000"),
		tline("K2", 2, "4100", "OPERATIONAL", "2026-11-20", "0.0000", "20.0000"),
		tline("K2", 3, "6100", "OPERATIONAL", "2026-11-20", "5.0000", "0.0000"),
		tline("K3", 1, "4100", "OPERATIONAL", "2027-01-10", "0.0000", "20.0000"),
		tline("K3", 2, "1000", "OPERATIONAL", "2027-01-10", "20.0000", "0.0000"),
	}
}

// TestBL14_financial_statements_anchor_to_fiscal_window pins the decided
// semantics through the reporting consumption surface: a January 2027
// monthly financial report shows only January's activity (profit 15), the
// prior-year revenue never leaks into it, and the income statement and the
// cash-flow statement read the same window.
func TestBL14_financial_statements_anchor_to_fiscal_window(t *testing.T) {
	cal, err := ledger.NewFiscalCalendar(1)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := AnchorFinancialProjection(cal, ledger.FinancialReportSpec{
		Frequency: ledger.FrequencyMonthly, FiscalYear: 2027, Index: 1,
	}, nil, baseChart(), bl14ReportingLines())
	if err != nil {
		t.Fatal(err)
	}
	if projection.Window.Start != "2027-01-01" || projection.Window.End != "2027-01-31" {
		t.Fatalf("window = [%s, %s], want [2027-01-01, 2027-01-31]", projection.Window.Start, projection.Window.End)
	}
	f, err := DeriveFigures(projection.Rows)
	if err != nil {
		t.Fatal(err)
	}
	if f.TotalRevenue.String() != "20.0000" {
		t.Errorf("window revenue = %s, want 20.0000 (December 2025's 100 must stay out)", f.TotalRevenue.String())
	}
	if f.WindowNetProfit.String() != "20.0000" {
		t.Errorf("window profit = %s, want 20.0000", f.WindowNetProfit.String())
	}
	// The balance sheet keeps the all-time position as a balance-sheet
	// concept: equity carries the whole history (140 revenue - 5 expense =
	// 135), and the equation still holds.
	if f.AllTimeProfit.String() != "135.0000" {
		t.Errorf("all-time profit position = %s, want 135.0000", f.AllTimeProfit.String())
	}
	if !f.TotalAssets.Equal(f.TotalLiabAndEquity) {
		t.Errorf("A (%s) must equal L+E (%s)", f.TotalAssets.String(), f.TotalLiabAndEquity.String())
	}
	// The cash-flow statement starts from the same window's profit — the
	// reference disagreed with itself here (P&L 120 vs cash-flow 20).
	is, err := IncomeStatement(f, "2027-01", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	cf, err := CashFlowStatement(baseChart(), bl14ReportingLines(), projection.Window.Start, projection.Window.End, "2027-01", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	plNet := is.LineItems[len(is.LineItems)-1].Amount
	if !plNet.Equal(cf.IndirectMethodOperating[0].Amount) {
		t.Errorf("P&L net profit %s must equal the cash-flow starting profit %s",
			plNet.String(), cf.IndirectMethodOperating[0].Amount.String())
	}
}

// TestBL14_management_projection_is_read_only pins the management side of
// the decision: custom windows stay read-only projections over posted
// lines, report the lock state they overlap, and never bypass a lock.
func TestBL14_management_projection_is_read_only(t *testing.T) {
	w, err := ledger.ParseManagementWindow("2026-11-01", "2026-11-30")
	if err != nil {
		t.Fatal(err)
	}
	periods := []ledger.Period{
		{PeriodID: "DEMO:2026-11", EntityCode: "DEMO", PeriodCode: "2026-11",
			StartDate: "2026-11-01", EndDate: "2026-11-30", Status: "LOCKED"},
	}
	projection, err := AnchorManagementProjection(w, periods, baseChart(), bl14ReportingLines())
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.OverlappingPeriods) != 1 || projection.OverlappingPeriods[0].Status != "LOCKED" {
		t.Fatalf("overlapping periods = %+v, want the LOCKED 2026-11 row", projection.OverlappingPeriods)
	}
	if projection.OverlappingPeriods[0].IsWritable() {
		t.Error("the projection must present the locked period as non-writable")
	}
	f, err := DeriveFigures(projection.Rows)
	if err != nil {
		t.Fatal(err)
	}
	// November's own activity: revenue 20 - expense 5.
	if f.WindowNetProfit.String() != "15.0000" {
		t.Errorf("management window profit = %s, want 15.0000", f.WindowNetProfit.String())
	}
	// The window type carries no writable state; the projection returns the
	// stored period rows untouched (same status it read).
	if projection.OverlappingPeriods[0].Status != "LOCKED" {
		t.Error("the projection must not mutate period state")
	}
}

// TestBL14_annual_window_consumes_fiscal_calendar pins that the reporting
// package consumes the fiscal calendar's annual window (AU July-June) and
// not a calendar year.
func TestBL14_annual_window_consumes_fiscal_calendar(t *testing.T) {
	au, err := ledger.NewFiscalCalendar(7)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := AnchorFinancialProjection(au, ledger.FinancialReportSpec{
		Frequency: ledger.FrequencyAnnually, FiscalYear: 2026,
	}, nil, baseChart(), bl14ReportingLines())
	if err != nil {
		t.Fatal(err)
	}
	if projection.Window.Start != "2026-07-01" || projection.Window.End != "2027-06-30" {
		t.Fatalf("AU fiscal 2026 window = [%s, %s], want [2026-07-01, 2027-06-30]", projection.Window.Start, projection.Window.End)
	}
	f, err := DeriveFigures(projection.Rows)
	if err != nil {
		t.Fatal(err)
	}
	// The window holds November 2026 (revenue 20 - expense 5) and January
	// 2027 (revenue 20); December 2025 stays outside the fiscal year.
	if f.WindowNetProfit.String() != "35.0000" {
		t.Errorf("AU fiscal 2026 profit = %s, want 35.0000", f.WindowNetProfit.String())
	}
}
