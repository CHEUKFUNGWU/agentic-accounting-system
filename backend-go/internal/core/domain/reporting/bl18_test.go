package reporting

import (
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// BL-18 regression: compound entries allocate only the actual cash legs.
//
// Audit scenario (ledger.py:1055-1067): cash debit 100 and equipment debit
// 500 against a loan credit 600 yielded cash inflow 600 and outflow 500
// while tying net cash. Required: allocate only actual cash legs. The
// ledger package's cash_flow_breakdown keeps the reference behaviour for
// parity; this package's cash classification is the fix.

// bl18Lines seeds the defect's compound entry (plus the opening so the
// running cash is meaningful).
func bl18Lines() []ledger.Line {
	return []ledger.Line{
		tline("J1", 1, "1000", "OPENING", "2026-09-30", "5000.0000", "0.0000"),
		tline("J1", 2, "3100", "OPENING", "2026-09-30", "0.0000", "5000.0000"),
		tline("J2", 1, "1000", "OPERATIONAL", "2026-10-05", "100.0000", "0.0000"),
		tline("J2", 2, "1610", "OPERATIONAL", "2026-10-05", "500.0000", "0.0000"),
		tline("J2", 3, "2190", "OPERATIONAL", "2026-10-05", "0.0000", "600.0000"),
	}
}

// TestBL18_compound_entry_allocates_actual_cash_legs pins the corrected
// outcome: the entry's actual cash leg is 100 in — not 600 in / 500 out —
// the equipment bought on the same loan is disclosed as noncash, and the
// classified net equals the actual cash movement.
func TestBL18_compound_entry_allocates_actual_cash_legs(t *testing.T) {
	flows, err := ClassifyCashFlows(baseChart(), bl18Lines(), "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	if flows.FinancingIn.String() != "100.0000" {
		t.Errorf("financing inflow = %s, want 100.0000 (the actual cash leg; the defect reported 600.0000)", flows.FinancingIn.String())
	}
	if flows.InvestingOut.String() != "0.0000" {
		t.Errorf("investing outflow = %s, want 0.0000 (the defect reported 500.0000)", flows.InvestingOut.String())
	}
	if flows.OperatingIn.String() != "0.0000" || flows.OperatingOut.String() != "0.0000" {
		t.Errorf("operating flows = %s/%s, want 0.0000/0.0000", flows.OperatingIn.String(), flows.OperatingOut.String())
	}
	if flows.NetIncrease.String() != "100.0000" {
		t.Errorf("net increase = %s, want 100.0000", flows.NetIncrease.String())
	}
	// The unmatched noncash legs are the acquisition: equipment 500
	// (investing) funded by the loan 500 (financing), disclosed not flowed.
	byCategory := map[string]string{}
	for _, m := range flows.NonCash {
		byCategory[m.FSCategory] = string(m.Activity) + " " + m.Amount.String()
	}
	if got := byCategory["FIXED_ASSET"]; got != "INVESTING -500.0000" {
		t.Errorf("noncash equipment disclosure = %q, want \"INVESTING -500.0000\"", got)
	}
	if got := byCategory["DIRECTOR_LOAN"]; got != "FINANCING 500.0000" {
		t.Errorf("noncash loan disclosure = %q, want \"FINANCING 500.0000\"", got)
	}
	// The statement renders the classified amounts.
	cf, err := CashFlowStatement(baseChart(), bl18Lines(), "2026-10-01", "2026-10-31", "2026-10", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	if cf.NetCashFromFinancingActivities.String() != "100.0000" {
		t.Errorf("financing net = %s, want 100.0000", cf.NetCashFromFinancingActivities.String())
	}
	if cf.NetCashFromInvestingActivities.String() != "0.0000" {
		t.Errorf("investing net = %s, want 0.0000", cf.NetCashFromInvestingActivities.String())
	}
	if cf.EndingCashBalance.String() != "5100.0000" {
		t.Errorf("ending cash = %s, want 5100.0000 (5000 opening + the actual 100)", cf.EndingCashBalance.String())
	}
}

// TestBL18_partial_cash_legs_match_in_order pins the matching rule on a
// compound collection: cash 150 collected against a 200 credit sale leaves
// AR 50 outstanding — the operating inflow is 150 and the uncollected 50 is
// noncash, exactly the indirect method's own answer.
func TestBL18_partial_cash_legs_match_in_order(t *testing.T) {
	lines := []ledger.Line{
		tline("J1", 1, "1210", "OPERATIONAL", "2026-10-01", "200.0000", "0.0000"),
		tline("J1", 2, "4100", "OPERATIONAL", "2026-10-01", "0.0000", "200.0000"),
		tline("J2", 1, "1000", "OPERATIONAL", "2026-10-02", "150.0000", "0.0000"),
		tline("J2", 2, "1210", "OPERATIONAL", "2026-10-02", "0.0000", "150.0000"),
	}
	flows, err := ClassifyCashFlows(baseChart(), lines, "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	if flows.MemoCustomers.String() != "150.0000" || flows.OperatingIn.String() != "150.0000" {
		t.Errorf("customers/operating in = %s/%s, want 150.0000/150.0000",
			flows.MemoCustomers.String(), flows.OperatingIn.String())
	}
	byCategory := map[string]string{}
	for _, m := range flows.NonCash {
		byCategory[m.FSCategory] = m.Amount.String()
	}
	// J1 (the credit sale) has no cash leg: its AR debit 200 and revenue
	// credit 200 are noncash. J2's AR credit 150 is fully matched by its
	// own cash leg, so nothing of it is disclosed.
	if got := byCategory["AR"]; got != "-200.0000" {
		t.Errorf("noncash AR disclosure = %q, want \"-200.0000\"", got)
	}
	if got := byCategory["REVENUE"]; got != "200.0000" {
		t.Errorf("noncash REVENUE disclosure = %q, want \"200.0000\"", got)
	}
}
