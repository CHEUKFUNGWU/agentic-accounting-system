package reporting

import (
	"errors"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// BL-12 regression: noncash acquisitions create no cash flows.
//
// Audit scenario (2026-10-21-business-logic-audit.md, reporting.py:309-318):
// a credit equipment purchase of 5,000 reported an operating inflow of
// 5,000 and an investing outflow of -5,000, with the consistency checks
// passing. The fix: cash flows classify only actual cash legs; the
// credit-funded acquisition is disclosed as a noncash movement.

func bl12Seed() []ledger.Line {
	return []ledger.Line{
		tline("J1", 1, "1000", "OPENING", "2026-09-30", "5000.0000", "0.0000"),
		tline("J1", 2, "3100", "OPENING", "2026-09-30", "0.0000", "5000.0000"),
		// The defect's entry: equipment 5,000 bought entirely on credit.
		tline("J2", 1, "1610", "OPERATIONAL", "2026-10-05", "5000.0000", "0.0000"),
		tline("J2", 2, "2110", "OPERATIONAL", "2026-10-05", "0.0000", "5000.0000"),
		// A cash-settled operating expense, so the window has one real flow.
		tline("J3", 1, "6100", "OPERATIONAL", "2026-10-10", "200.0000", "0.0000"),
		tline("J3", 2, "1000", "OPERATIONAL", "2026-10-10", "0.0000", "200.0000"),
	}
}

// TestBL12_noncash_acquisition_creates_no_cash_flow pins the corrected
// outcome: the credit purchase contributes nothing to any activity, the
// statement's cash ties to the balance sheet, and the acquisition is
// disclosed as noncash with both its legs.
func TestBL12_noncash_acquisition_creates_no_cash_flow(t *testing.T) {
	chart := baseChart()
	lines := bl12Seed()
	flows, err := ClassifyCashFlows(chart, lines, "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	// The defect reported operating inflow 5,000 and investing outflow
	// -5,000. The classification must report neither: no cash leg exists.
	if !flows.OperatingIn.IsZero() {
		t.Errorf("operating inflow = %s, want 0.0000 (the credit purchase must not become an operating inflow)", flows.OperatingIn.String())
	}
	if !flows.InvestingOut.IsZero() {
		t.Errorf("investing outflow = %s, want 0.0000 (the credit purchase must not become an investing outflow)", flows.InvestingOut.String())
	}
	if flows.NetIncrease.String() != "-200.0000" {
		t.Errorf("net increase = %s, want -200.0000 (only the cash-settled opex moves cash)", flows.NetIncrease.String())
	}
	// The noncash acquisition is distinguished, not hidden: both legs
	// disclosed on their own activities.
	byCategory := map[string]string{}
	for _, m := range flows.NonCash {
		byCategory[m.FSCategory] = string(m.Activity) + " " + m.Amount.String()
	}
	if got := byCategory["FIXED_ASSET"]; got != "INVESTING -5000.0000" {
		t.Errorf("noncash FIXED_ASSET disclosure = %q, want \"INVESTING -5000.0000\"", got)
	}
	if got := byCategory["AP_ACCRUAL"]; got != "OPERATING 5000.0000" {
		t.Errorf("noncash AP_ACCRUAL disclosure = %q, want \"OPERATING 5000.0000\"", got)
	}
	// The full statement ties: opening + net == the balance sheet's cash.
	cf, err := CashFlowStatement(chart, lines, "2026-10-01", "2026-10-31", "2026-10", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	if cf.OpeningCashBalance.String() != "5000.0000" || cf.EndingCashBalance.String() != "4800.0000" {
		t.Errorf("cash statement opening/ending = %s/%s, want 5000.0000/4800.0000 (opex 200 paid in cash)",
			cf.OpeningCashBalance.String(), cf.EndingCashBalance.String())
	}
	rows, err := WindowRows(chart, lines, "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	f, err := DeriveFigures(rows)
	if err != nil {
		t.Fatal(err)
	}
	if !cf.EndingCashBalance.Equal(f.EndingCash) {
		t.Errorf("classified ending cash %s disagrees with balance-sheet cash %s",
			cf.EndingCashBalance.String(), f.EndingCash.String())
	}
	if got := cf.NetCashFromOperatingActivities.String(); got != "-200.0000" {
		t.Errorf("operating net = %s, want -200.0000 (only the cash-settled opex)", got)
	}
}

// TestBL12_statement_checks_no_longer_pass_on_noncash_flows pins the check
// surface the defect hid behind: the consistency checks must hold for the
// RIGHT reason (actual cash), and an all-noncash month must produce a
// zero-flow statement rather than offsetting gross flows.
func TestBL12_statement_checks_no_longer_pass_on_noncash_flows(t *testing.T) {
	chart := baseChart()
	// Only the credit purchase: no cash movement at all in the window.
	lines := bl12Seed()[:4]
	cf, err := CashFlowStatement(chart, lines, "2026-10-01", "2026-10-31", "2026-10", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	if cf.NetIncreaseInCash.String() != "0.0000" {
		t.Errorf("net increase = %s, want 0.0000", cf.NetIncreaseInCash.String())
	}
	if cf.NetCashFromInvestingActivities.String() != "0.0000" {
		t.Errorf("investing net = %s, want 0.0000 (the reference reported -5000.0000 here)", cf.NetCashFromInvestingActivities.String())
	}
	if cf.OpeningCashBalance.String() != "5000.0000" || cf.EndingCashBalance.String() != "5000.0000" {
		t.Errorf("opening/ending = %s/%s, want 5000.0000/5000.0000", cf.OpeningCashBalance.String(), cf.EndingCashBalance.String())
	}
	// The refusal path: an entry whose cash legs cannot cancel is corruption,
	// refused rather than classified.
	broken := []ledger.Line{
		tline("JX", 1, "1000", "OPERATIONAL", "2026-10-01", "100.0000", "0.0000"),
		tline("JX", 2, "1610", "OPERATIONAL", "2026-10-01", "500.0000", "0.0000"),
		tline("JX", 3, "2110", "OPERATIONAL", "2026-10-01", "0.0000", "400.0000"),
	}
	if _, err := ClassifyCashFlows(chart, broken, "2026-10-01", "2026-10-31"); !errors.Is(err, ErrCashEntryUnbalanced) {
		t.Errorf("unbalanced entry = %v, want ErrCashEntryUnbalanced", err)
	} else if !strings.Contains(err.Error(), "JX") {
		t.Errorf("refusal should name the entry, got %v", err)
	}
}
