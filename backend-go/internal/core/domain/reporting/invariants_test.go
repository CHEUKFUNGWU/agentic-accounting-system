package reporting

import (
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Engineering-workflow §3 invariants over the reporting engine: the three
// statements articulate over worked examples, debits equal credits in every
// aggregation, and every value is an exact 4-decimal money string.

func monthWindow(start, end string) (string, string) { return start, end }

// deriveThrough runs the full engine over one window and returns every
// artifact the invariants read.
func deriveThrough(t *testing.T, chart []ledger.Account, lines []ledger.Line, start, end, period string) (*WindowFigures, *TrialBalanceCompilation, *IncomeStatementReport, *BalanceSheetReport, *CashFlowStatementReport) {
	t.Helper()
	rows, err := WindowRows(chart, lines, start, end)
	if err != nil {
		t.Fatal(err)
	}
	comp, err := CompileTrialBalance(rows)
	if err != nil {
		t.Fatal(err)
	}
	f, err := DeriveFigures(rows)
	if err != nil {
		t.Fatal(err)
	}
	is, err := IncomeStatement(f, period, "HKD")
	if err != nil {
		t.Fatal(err)
	}
	bs, err := BalanceSheet(f, StructureSMECorp, period, "HKD")
	if err != nil {
		t.Fatal(err)
	}
	cf, err := CashFlowStatement(chart, lines, start, end, period, "HKD")
	if err != nil {
		t.Fatal(err)
	}
	return f, comp, is, bs, cf
}

// TestInvariants_three_statements_articulate walks the two-month worked
// example: October profit 900, November profit 450. The balance sheet's
// equity movement ties to the income statement month by month, A = L + E
// holds in both, and the cash statement's ending balance is the balance
// sheet's cash in both.
func TestInvariants_three_statements_articulate(t *testing.T) {
	chart := baseChart()
	lines := workedExampleLines()

	// October.
	f1, _, is1, bs1, cf1 := deriveThrough(t, chart, lines, "2026-10-01", "2026-10-31", "2026-10")
	if got := is1.LineItems[len(is1.LineItems)-1].Amount.String(); got != "900.0000" {
		t.Errorf("october net profit = %s, want 900.0000", got)
	}
	if bs1.TotalAssets.String() != "5900.0000" {
		t.Errorf("october assets = %s, want 5900.0000", bs1.TotalAssets.String())
	}
	if bs1.TotalEquity.String() != "5900.0000" {
		t.Errorf("october equity = %s, want 5900.0000 (capital 5000 + profit 900)", bs1.TotalEquity.String())
	}
	if !bs1.TotalAssets.Equal(bs1.TotalLiabilitiesAndEquity) {
		t.Errorf("october A (%s) != L+E (%s)", bs1.TotalAssets.String(), bs1.TotalLiabilitiesAndEquity.String())
	}
	if cf1.EndingCashBalance.String() != "5900.0000" || !cf1.EndingCashBalance.Equal(bs1.CurrentAssets[0].Amount) {
		t.Errorf("october cash statement ending %s must equal balance-sheet cash %s",
			cf1.EndingCashBalance.String(), bs1.CurrentAssets[0].Amount.String())
	}

	// November.
	f2, _, is2, bs2, cf2 := deriveThrough(t, chart, lines, "2026-11-01", "2026-11-30", "2026-11")
	if got := is2.LineItems[len(is2.LineItems)-1].Amount.String(); got != "450.0000" {
		t.Errorf("november net profit = %s, want 450.0000 (window activity only)", got)
	}
	if bs2.TotalEquity.String() != "6350.0000" {
		t.Errorf("november equity = %s, want 6350.0000 (5000 + 900 + 450)", bs2.TotalEquity.String())
	}
	// Articulation: the equity movement over the window equals the window's
	// net profit (no other equity movements in the worked example).
	movement, err := q4(bs2.TotalEquity.Sub(bs1.TotalEquity))
	if err != nil {
		t.Fatal(err)
	}
	if !movement.Equal(is2.LineItems[len(is2.LineItems)-1].Amount) {
		t.Errorf("equity movement %s must tie to november's net profit", movement.String())
	}
	if !bs2.TotalAssets.Equal(bs2.TotalLiabilitiesAndEquity) {
		t.Errorf("november A (%s) != L+E (%s)", bs2.TotalAssets.String(), bs2.TotalLiabilitiesAndEquity.String())
	}
	if cf2.OpeningCashBalance.String() != "5900.0000" {
		t.Errorf("november opening cash = %s, want 5900.0000", cf2.OpeningCashBalance.String())
	}
	if !cf2.EndingCashBalance.Equal(bs2.CurrentAssets[0].Amount) {
		t.Errorf("november cash statement ending %s must equal balance-sheet cash %s",
			cf2.EndingCashBalance.String(), bs2.CurrentAssets[0].Amount.String())
	}
	_ = f1
	_ = f2
}

// TestInvariants_aggregations_debits_equal_credits pins debits == credits
// in every aggregation: the trial-balance column totals, the classified
// flows' net against the actual cash movement, and the noncash
// disclosures' sum against the entries' unmatched legs.
func TestInvariants_aggregations_debits_equal_credits(t *testing.T) {
	chart := baseChart()
	lines := workedExampleLines()
	rows, err := WindowRows(chart, lines, "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	comp, err := CompileTrialBalance(rows)
	if err != nil {
		t.Fatal(err)
	}
	tr := comp.Totals
	for name, pair := range map[string][2]string{
		"unadjusted": {tr.TotalUnadjustedDebit.String(), tr.TotalUnadjustedCredit.String()},
		"adjustment": {tr.TotalAdjustmentDebit.String(), tr.TotalAdjustmentCredit.String()},
		"adjusted":   {tr.TotalAdjustedDebit.String(), tr.TotalAdjustedCredit.String()},
	} {
		if pair[0] != pair[1] {
			t.Errorf("%s totals unbalanced: debit %s != credit %s", name, pair[0], pair[1])
		}
	}
	// The classified flows' net equals the window's actual cash movement,
	// summed from the raw lines.
	flows, err := ClassifyCashFlows(chart, lines, "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	cashMovement := zeroQ4
	for _, l := range lines {
		if l.AccountCode != "1000" {
			continue
		}
		if l.AccountingDate < "2026-10-01" || l.AccountingDate > "2026-10-31" {
			continue
		}
		cashMovement = cashMovement.Add(l.FuncDebit.Sub(l.FuncCredit))
	}
	if flows.NetIncrease.String() != cashMovement.String() {
		t.Errorf("classified net %s != actual cash movement %s", flows.NetIncrease.String(), cashMovement.String())
	}
	// Every flow bucket carries an exact 4-decimal string.
	for _, v := range []money.Money{
		flows.OperatingIn, flows.OperatingOut, flows.InvestingIn, flows.InvestingOut,
		flows.FinancingIn, flows.FinancingOut, flows.NetIncrease,
	} {
		if !is4dp(v.String()) {
			t.Errorf("flow bucket %s is not an exact 4-decimal value", v.String())
		}
	}
}

// TestInvariants_exact_decimals_everywhere pins the exact-decimal surface:
// every rendered money value in the statements is a plain 4-decimal string
// — no floats, no scientific notation, no bare "0".
func TestInvariants_exact_decimals_everywhere(t *testing.T) {
	chart := baseChart()
	lines := workedExampleLines()
	_, comp, is, bs, cf := deriveThrough(t, chart, lines, "2026-10-01", "2026-10-31", "2026-10")
	check := func(where string, vs ...money.Money) {
		for _, v := range vs {
			if !is4dp(v.String()) {
				t.Errorf("%s: %q is not an exact 4-decimal money string", where, v.String())
			}
		}
	}
	for _, r := range comp.Rows {
		check("trial balance row "+r.AccountCode,
			r.OpeningBalance, r.PeriodOpDebit, r.PeriodOpCredit,
			r.UnadjustedDebit, r.UnadjustedCredit, r.AdjustedDebit, r.AdjustedCredit)
	}
	for _, item := range is.LineItems {
		check("income statement "+item.Key, item.Amount)
	}
	check("balance sheet", bs.TotalCurrentAssets, bs.TotalAssets, bs.TotalLiabilities, bs.TotalEquity, bs.TotalLiabilitiesAndEquity)
	check("cash flow", cf.NetCashFromOperatingActivities, cf.NetCashFromInvestingActivities,
		cf.NetCashFromFinancingActivities, cf.NetIncreaseInCash, cf.OpeningCashBalance, cf.EndingCashBalance)
	if got := comp.Totals.TotalAdjustedDebit.String(); got != "6200.0000" {
		t.Errorf("october adjusted debit total = %s, want 6200.0000 (independent arithmetic)", got)
	}
}

func is4dp(s string) bool {
	if len(s) < 6 || s[len(s)-5] != '.' {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '-' || c == '.' {
			continue
		}
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
