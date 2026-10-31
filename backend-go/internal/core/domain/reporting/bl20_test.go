package reporting

import (
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// BL-20 regression: fail-closed tax.
//
// Audit scenario (reporting.py:368-430): a 1,000 prepayment with no GST
// yielded an Australian GST credit 600 (prepay x 0.60); the other regional
// input credits use similar fixed percentages; unknown jurisdictions fall
// back to AU. Required (interim rule until REQ-0014): unsupported
// jurisdictions rejected explicitly, never a fallback to AU, never a
// fabricated credit; the supported-jurisdiction calculations stay for
// parity where they are not defect scenarios, with explicit rounding.

// bl20Rows: prepayment 1,000 with no GST anywhere near it, revenue 1,200
// (cash sale), opex 200, opening cash 5,000 from equity 6,000 — balanced:
// debits 6,000 + 1,000 + 200 = credits 6,000 + 1,200.
func bl20Rows() []ledger.TrialBalanceReportRow {
	return []ledger.TrialBalanceReportRow{
		trow("1000", "銀行存款", "ASSET", "CASH", "5000.0000", "1200.0000", "200.0000", "0.0000", "0.0000"),
		trow("1410", "預付費用及進項稅額", "ASSET", "PREPAY_TAX", "1000.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
		trow("3100", "實收資本及期初留存", "EQUITY", "EQUITY", "-6000.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
		trow("4100", "主營業務收入", "REVENUE", "REVENUE", "0.0000", "0.0000", "1200.0000", "0.0000", "0.0000"),
		trow("6100", "管理及營運費用", "EXPENSE", "OPEX", "0.0000", "200.0000", "0.0000", "0.0000", "0.0000"),
	}
}

func bl20Figures(t *testing.T) *WindowFigures {
	t.Helper()
	f, err := DeriveFigures(bl20Rows())
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// TestBL20_unsupported_jurisdictions_rejected pins the fail-closed rule:
// CA, UK and any other jurisdiction without a filing branch return an
// explicit error — never the AU fallback, never a schedule shaped like one.
func TestBL20_unsupported_jurisdictions_rejected(t *testing.T) {
	f := bl20Figures(t)
	for _, j := range []string{"CA", "UK", "JP", "BR", ""} {
		report, warnings, err := StatutoryTaxSchedule(f, j)
		if !errors.Is(err, ErrFilingJurisdictionUnsupported) {
			t.Errorf("jurisdiction %q = err %v, want ErrFilingJurisdictionUnsupported", j, err)
		}
		if report != nil || warnings != nil {
			t.Errorf("jurisdiction %q must produce no schedule and no warnings, got %+v / %v", j, report, warnings)
		}
	}
}

// TestBL20_no_fabricated_input_credits pins the defect's exact numbers: the
// reference turned the 1,000 prepayment into an AU GST credit 600
// (prepay x 0.60). The Go schedule reports zero for the input-credit box —
// an input tax credit is a fact of transactions (REQ-0014), not of a
// balance.
func TestBL20_no_fabricated_input_credits(t *testing.T) {
	f := bl20Figures(t)
	report, warnings, err := StatutoryTaxSchedule(f, "AU")
	if err != nil {
		t.Fatal(err)
	}
	credit := report.FilingBoxes["1B GST Credits on Purchases (Input GST)"]
	if credit.String() != "0.0000" {
		t.Errorf("AU input GST credit = %s, want 0.0000 (the reference fabricated %s from prepay x 0.60)",
			credit.String(), mustParse("600.0000").String())
	}
	if len(warnings) == 0 {
		t.Error("the schedule must warn that input tax awaits transaction derivation")
	}
	// The same prohibition on every regional input-credit box.
	for jur, boxName := range map[string]string{
		"CN": "金稅四期已勾稽進項稅額",
		"SG": "Box 7 Input Tax Refund Claimed",
		"EU": "Recoverable Input VAT",
	} {
		report, _, err := StatutoryTaxSchedule(f, jur)
		if err != nil {
			t.Fatalf("%s: %v", jur, err)
		}
		if got := report.FilingBoxes[boxName].String(); got != "0.0000" {
			t.Errorf("%s %s = %s, want 0.0000 (the reference fabricated prepay x a fixed percentage)", jur, boxName, got)
		}
	}
}

// TestBL20_supported_jurisdiction_parity pins the non-defect derivations
// for supported jurisdictions over valid inputs: the fact-based boxes
// reproduce the reference's values, and the multiplier boxes round
// explicitly (q4, ROUND_HALF_UP).
func TestBL20_supported_jurisdiction_parity(t *testing.T) {
	f := bl20Figures(t)
	// Hong Kong: every box is a ledger fact, no multipliers anywhere.
	hk, _, err := StatutoryTaxSchedule(f, "HK")
	if err != nil {
		t.Fatal(err)
	}
	wantHK := map[string]string{
		"Onshore Assessable Revenue (香港來源應評稅收入)":   "1200.0000",
		"Deductible Operating & R&D Expenses":      "200.0000",
		"Statutory Depreciation Allowance (折舊免稅額)": "0.0000",
		"Estimated Two-Tier Profits Tax Payable":   "0.0000",
	}
	for box, want := range wantHK {
		if got := hk.FilingBoxes[box].String(); got != want {
			t.Errorf("HK %q = %s, want %s", box, got, want)
		}
	}
	if hk.SafeToSpendOperatingCash.String() != "6000.0000" {
		t.Errorf("HK safe to spend = %s, want 6000.0000 (cash 6000 - tax payable 0; the prepayment is not a tax liability)", hk.SafeToSpendOperatingCash.String())
	}
	// US: fact-based boxes including the tentative net profit.
	us, _, err := StatutoryTaxSchedule(f, "US")
	if err != nil {
		t.Fatal(err)
	}
	if got := us.FilingBoxes["Part II Line 31 Tentative Net Profit & Estimated SE/Income Tax"].String(); got != "1000.0000" {
		t.Errorf("US tentative net profit = %s, want 1000.0000", got)
	}
	// Explicit rounding: revenue 33.3335 x 0.10 = 3.33335 rounds half-up to
	// 3.3334; x 1.10 = 36.66685 rounds half-up to 36.6669. Rows balanced:
	// cash 66.6670 = equity 33.3335 + revenue 33.3335.
	roundRows := []ledger.TrialBalanceReportRow{
		trow("4100", "主營業務收入", "REVENUE", "REVENUE", "0.0000", "0.0000", "33.3335", "0.0000", "0.0000"),
		trow("1000", "銀行存款", "ASSET", "CASH", "66.6670", "0.0000", "0.0000", "0.0000", "0.0000"),
		trow("3100", "實收資本及期初留存", "EQUITY", "EQUITY", "-33.3335", "0.0000", "0.0000", "0.0000", "0.0000"),
	}
	rf, err := DeriveFigures(roundRows)
	if err != nil {
		t.Fatal(err)
	}
	au, _, err := StatutoryTaxSchedule(rf, "AU")
	if err != nil {
		t.Fatal(err)
	}
	if got := au.FilingBoxes["1A GST on Sales (Output GST)"].String(); got != "3.3334" {
		t.Errorf("AU 1A = %s, want 3.3334 (ROUND_HALF_UP at q4)", got)
	}
	if got := au.FilingBoxes["G1 Total Sales (incl. GST)"].String(); got != "36.6669" {
		t.Errorf("AU G1 = %s, want 36.6669 (ROUND_HALF_UP at q4)", got)
	}
}
