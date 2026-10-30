package reporting

import (
	"fmt"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Statutory tax schedule (CC-TAX) — the BL-20 interim rule.
//
// The reference's tax_meta_map fell back to AU for every unknown
// jurisdiction and fabricated input-tax credits from fixed percentages of
// the prepayment balance ("1B GST Credits on Purchases (Input GST)" =
// prepay × 0.60 — the audit's 1,000 prepayment with no GST yielding an AU
// GST credit 600). The interim rule until REQ-0014 delivers the
// transaction-derived tax engine:
//
//   - unsupported jurisdictions are rejected explicitly — never a fallback
//     to AU, never a fabricated credit;
//   - supported jurisdictions keep the reference's box derivations where
//     they are not defect scenarios, every rounding mode explicit (q4,
//     ROUND_HALF_UP, as the reference's q4);
//   - the fabricated input-credit boxes report zero: an input tax credit is
//     a fact of transactions, not of a balance, and the warnings channel
//     says so.
//
// The existing output is not filing-ready — this schedule states ledger
// facts only and says what is missing.

// supportedFilingJurisdictions are the jurisdictions the reference's
// schedule has a form for. Anything else — including CA and UK, which ride
// other engines in localization but have no filing branch here — refuses.
var supportedFilingJurisdictions = map[string]bool{
	"AU": true, "CN": true, "HK": true, "SG": true, "US": true, "EU": true,
}

// StatutoryTaxReport is the reference's statutory_tax_schedule dict.
type StatutoryTaxReport struct {
	StatementRef               string                 `json:"statement_ref"` // "TAX"
	Jurisdiction               string                 `json:"jurisdiction"`
	ReturnFormName             string                 `json:"return_form_name"`
	ReliefApplied              string                 `json:"relief_applied"`
	FilingBoxes                map[string]money.Money `json:"filing_boxes"`
	TotalStatutoryTaxPayable   money.Money            `json:"total_statutory_tax_payable"`
	EndingCashBalance          money.Money            `json:"ending_cash_balance"`
	RecommendedTaxVaultReserve money.Money            `json:"recommended_tax_vault_reserve"`
	SafeToSpendOperatingCash   money.Money            `json:"safe_to_spend_operating_cash"`
}

// StatutoryTaxSchedule compiles the schedule for one jurisdiction over the
// window figures. The filing bands read the window's activity (a return
// covers its filing period). Unsupported jurisdictions return
// ErrFilingJurisdictionUnsupported — never the AU fallback. The returned
// warnings carry the BL-20 disclosure about the pending transaction-derived
// input-tax engine; they are not part of the schedule's parity surface.
func StatutoryTaxSchedule(f *WindowFigures, jurisdiction string) (*StatutoryTaxReport, []string, error) {
	if !supportedFilingJurisdictions[jurisdiction] {
		return nil, nil, fail(ErrFilingJurisdictionUnsupported,
			fmt.Sprintf("FILING_JURISDICTION_UNSUPPORTED: '%s' 沒有已支援的申報格位計算，報稅表拒絕產出（不回退 AU、不虛構抵免）。交易衍生稅額引擎依 REQ-0014 提供。",
				jurisdiction))
	}
	safeToSpend, err := q4(f.EndingCash.Sub(f.EndingTaxPayable))
	if err != nil {
		return nil, nil, err
	}
	report := &StatutoryTaxReport{
		StatementRef:               "TAX",
		Jurisdiction:               jurisdiction,
		FilingBoxes:                map[string]money.Money{},
		TotalStatutoryTaxPayable:   f.EndingTaxPayable,
		EndingCashBalance:          f.EndingCash,
		RecommendedTaxVaultReserve: f.EndingTaxPayable,
		SafeToSpendOperatingCash:   safeToSpend,
	}
	var warnings []string
	box := func(name string, value money.Money) error {
		v, err := q4(value)
		if err != nil {
			return err
		}
		report.FilingBoxes[name] = v
		return nil
	}
	zeroCredit := func(boxName string) error {
		// BL-20: an input-tax credit is a fact of transactions. The
		// reference multiplied the prepayment balance by a fixed percentage;
		// the Go schedule reports zero and says why.
		if err := box(boxName, zeroQ4); err != nil {
			return err
		}
		return nil
	}
	inputPending := "INPUT_TAX_PENDING_TRANSACTION_DERIVATION: 進項稅額抵免須由交易稅額推導（REQ-0014）；申報表不從預付餘額按固定百分比虛構。"

	switch jurisdiction {
	case "AU":
		report.ReturnFormName = "ATO Business Activity Statement (BAS) & Company Tax Estimate"
		report.ReliefApplied = "Small Business Entity (25% Base Rate Entity Tax + $20k Instant Asset Write-Off eligible)"
		if err := box("G1 Total Sales (incl. GST)", f.TotalRevenue.Mul(mustParse("1.10"))); err != nil {
			return nil, nil, err
		}
		if err := box("1A GST on Sales (Output GST)", f.TotalRevenue.Mul(mustParse("0.10"))); err != nil {
			return nil, nil, err
		}
		if err := zeroCredit("1B GST Credits on Purchases (Input GST)"); err != nil {
			return nil, nil, err
		}
		if err := box("PAYG Income Tax Provision", f.TaxExpense); err != nil {
			return nil, nil, err
		}
		warnings = append(warnings, inputPending)
	case "CN":
		report.ReturnFormName = "金稅四期增值稅及小微企業所得稅申報"
		report.ReliefApplied = "小型微利企業所得稅優惠（應納稅所得額 ≤ 300萬，實際稅負 5%）"
		if err := box("第1欄 應稅貨物及勞務銷售額", f.TotalRevenue); err != nil {
			return nil, nil, err
		}
		if err := box("本期銷項稅額 / 應納增值稅", f.EndingTaxPayable.Sub(f.TaxExpense)); err != nil {
			return nil, nil, err
		}
		if err := zeroCredit("金稅四期已勾稽進項稅額"); err != nil {
			return nil, nil, err
		}
		if err := box("本期預提企業所得稅 (CIT)", f.TaxExpense); err != nil {
			return nil, nil, err
		}
		warnings = append(warnings, inputPending)
	case "HK":
		report.ReturnFormName = "IRD Profits Tax Computation (兩級制利得稅計算 BIR51/52)"
		report.ReliefApplied = "Two-Tiered Profits Tax (8.25% on first HKD 2,000,000; Offshore claims tracked separately)"
		if err := box("Onshore Assessable Revenue (香港來源應評稅收入)", f.TotalRevenue); err != nil {
			return nil, nil, err
		}
		if err := box("Deductible Operating & R&D Expenses", f.TotalCOGS.Add(f.TotalOpex)); err != nil {
			return nil, nil, err
		}
		if err := box("Statutory Depreciation Allowance (折舊免稅額)", f.TotalDep); err != nil {
			return nil, nil, err
		}
		if err := box("Estimated Two-Tier Profits Tax Payable", f.TaxExpense); err != nil {
			return nil, nil, err
		}
	case "SG":
		report.ReturnFormName = "IRAS GST F5 Return & Corporate Tax (CS / C-S Lite) Computation"
		report.ReliefApplied = "Start-Up Tax Exemption (SUTE: 75% off first SGD 100k, 50% off next SGD 100k)"
		if err := box("Box 1 Total Value of Standard-Rated Supplies", f.TotalRevenue); err != nil {
			return nil, nil, err
		}
		if err := box("Box 6 Output Tax Due (9% GST)", f.EndingTaxPayable.Sub(f.TaxExpense)); err != nil {
			return nil, nil, err
		}
		if err := zeroCredit("Box 7 Input Tax Refund Claimed"); err != nil {
			return nil, nil, err
		}
		if err := box("Estimated Corporate Income Tax (after SUTE)", f.TaxExpense); err != nil {
			return nil, nil, err
		}
		warnings = append(warnings, inputPending)
	case "US":
		report.ReturnFormName = "IRS Schedule C (Form 1040) / State Sales & Use Tax Summary"
		report.ReliefApplied = "IRC Sec. 199A QBI 20% Pass-Through Deduction & Home Office Apportionment"
		if err := box("Part I Line 1 Gross Receipts or Sales", f.TotalRevenue); err != nil {
			return nil, nil, err
		}
		if err := box("Part II Line 4 Cost of Goods Sold", f.TotalCOGS); err != nil {
			return nil, nil, err
		}
		if err := box("Part II Line 28 Total Deductible Expenses", f.TotalOpex.Add(f.TotalDep)); err != nil {
			return nil, nil, err
		}
		if err := box("Part II Line 31 Tentative Net Profit & Estimated SE/Income Tax", f.WindowNetProfit); err != nil {
			return nil, nil, err
		}
	case "EU":
		report.ReturnFormName = "EU VAT Return, VIES Reverse Charge & Corporate Tax Schedule"
		report.ReliefApplied = "SME Digital & R&D Allowance + Intra-Community Reverse Charge Netting"
		if err := box("Net Taxable Supplies", f.TotalRevenue); err != nil {
			return nil, nil, err
		}
		if err := box("Output VAT & Reverse Charge Self-Assessment", f.EndingTaxPayable.Sub(f.TaxExpense)); err != nil {
			return nil, nil, err
		}
		if err := zeroCredit("Recoverable Input VAT"); err != nil {
			return nil, nil, err
		}
		if err := box("Corporate Tax Provision", f.TaxExpense); err != nil {
			return nil, nil, err
		}
		warnings = append(warnings, inputPending)
	}
	return report, warnings, nil
}
