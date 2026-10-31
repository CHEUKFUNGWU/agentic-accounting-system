package localization

import (
	"errors"
	"fmt"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Q4 is the reference's q4 helper (localization.py): quantize to four decimal
// places with ROUND_HALF_UP. The mode is named at this one site; the Go port
// has no global rounding default.
func Q4(value money.Money) (money.Money, error) {
	return value.Round(4, money.RoundHalfUp)
}

// Jurisdiction mirrors the Jurisdiction str enum. The wire form is the string
// value. ParseJurisdiction is the constructing entry point and rejects
// anything outside the enum, exactly as Jurisdiction("XX") raises ValueError
// in Python.
type Jurisdiction string

const (
	JurisdictionCN Jurisdiction = "CN" // Mainland China
	JurisdictionHK Jurisdiction = "HK" // Hong Kong SAR
	JurisdictionSG Jurisdiction = "SG" // Singapore
	JurisdictionAU Jurisdiction = "AU" // Australia
	JurisdictionUS Jurisdiction = "US" // United States
	JurisdictionCA Jurisdiction = "CA" // Canada
	JurisdictionEU Jurisdiction = "EU" // European Union
	JurisdictionUK Jurisdiction = "UK" // United Kingdom
)

// ErrUnknownJurisdiction reports a jurisdiction string outside the enum.
var ErrUnknownJurisdiction = errors.New("localization: unknown jurisdiction")

// ParseJurisdiction validates a jurisdiction string against the enum.
func ParseJurisdiction(s string) (Jurisdiction, error) {
	switch Jurisdiction(s) {
	case JurisdictionCN, JurisdictionHK, JurisdictionSG, JurisdictionAU,
		JurisdictionUS, JurisdictionCA, JurisdictionEU, JurisdictionUK:
		return Jurisdiction(s), nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnknownJurisdiction, s)
	}
}

// AccountingStandard mirrors the AccountingStandard str enum. The reference
// engine never reads it: it is caller-side vocabulary for book tagging,
// ported so the module surface matches one for one.
type AccountingStandard string

const (
	StandardIFRS     AccountingStandard = "IFRS"
	StandardUSGAAP   AccountingStandard = "US_GAAP"
	StandardPRCCAS   AccountingStandard = "PRC_CAS"
	StandardHKFRS    AccountingStandard = "HKFRS"
	StandardSFRSI    AccountingStandard = "SFRS_I"
	StandardAASB     AccountingStandard = "AASB"
	StandardTAXBASIS AccountingStandard = "TAX_BASIS"
)

// ParseAccountingStandard validates a standard string against the enum.
func ParseAccountingStandard(s string) (AccountingStandard, error) {
	switch AccountingStandard(s) {
	case StandardIFRS, StandardUSGAAP, StandardPRCCAS, StandardHKFRS,
		StandardSFRSI, StandardAASB, StandardTAXBASIS:
		return AccountingStandard(s), nil
	default:
		return "", fmt.Errorf("localization: unknown accounting standard %q", s)
	}
}

// zero4 is Decimal("0.0000") — the reference's zero literal keeps the 4dp
// form in outputs.
var zero4 = mustMoney("0.0000")

// Statutory rates and thresholds of the engine, as written in the reference.
// rate00 is the reference's Decimal("0.00") miss value for unknown tax codes.
var (
	rate00        = mustMoney("0.00")
	rateAU10      = mustMoney("0.10")
	rateCN13      = mustMoney("0.13")
	rateCN9       = mustMoney("0.09")
	rateCN6       = mustMoney("0.06")
	rateCN3       = mustMoney("0.03")
	rateSG9       = mustMoney("0.09")
	rateUS825     = mustMoney("0.0825")
	rateEU20      = mustMoney("0.20")
	rateAUWHT47   = mustMoney("0.47")
	rateUSWHT24   = mustMoney("0.24")
	thresholdAU75 = mustMoney("75.0000")
)

func mustMoney(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("localization: bad constant " + s)
	}
	return m
}

// TaxCalculationResult mirrors the frozen dataclass field for field; the JSON
// tags are the Python field names so fixture bytes match the reference.
type TaxCalculationResult struct {
	Jurisdiction             Jurisdiction           `json:"jurisdiction"`
	TaxCode                  string                 `json:"tax_code"`
	NetAmount                money.Money            `json:"net_amount"`
	TaxAmount                money.Money            `json:"tax_amount"`
	RecoverableTaxAmount     money.Money            `json:"recoverable_tax_amount"`
	NonRecoverableTaxAmount  money.Money            `json:"non_recoverable_tax_amount"`
	WithholdingTaxAmount     money.Money            `json:"withholding_tax_amount"`
	ReverseChargeOutputTax   money.Money            `json:"reverse_charge_output_tax"`
	NetPayableToCounterparty money.Money            `json:"net_payable_to_counterparty"`
	StatutoryReturnBoxes     map[string]money.Money `json:"statutory_return_boxes"`
	ComplianceWarnings       []string               `json:"compliance_warnings"`
}

// BookEntry is one parallel-book journal line.
type BookEntry struct {
	Account string      `json:"account"`
	Debit   money.Money `json:"debit"`
	Credit  money.Money `json:"credit"`
}

// ParallelBookDelta mirrors the frozen dataclass field for field.
type ParallelBookDelta struct {
	Topic              string      `json:"topic"`
	IfrsBookEntries    []BookEntry `json:"ifrs_book_entries"`
	UsGaapDeltaEntries []BookEntry `json:"us_gaap_delta_entries"`
	Rationale          string      `json:"rationale"`
}

// TaxInput carries EvaluateIndirectAndWithholdingTax's arguments. The
// reference's keyword defaults map as: empty string = absent identifier
// (Python None and "" are falsy on every path that reads these),
// HKProfitSource empty = "ONSHORE", IsCrossBorderB2B false.
type TaxInput struct {
	Jurisdiction      Jurisdiction
	NetAmount         money.Money
	TaxCode           string
	CounterpartyTaxID string
	EInvoiceCode      string
	IsCrossBorderB2B  bool
	HKProfitSource    string
}

// rateTax computes q4(net * rate) — the engine's recurring tax product.
func rateTax(net, rate money.Money) (money.Money, error) {
	return Q4(net.Mul(rate))
}

// EvaluateIndirectAndWithholdingTax ports
// GlobalLocalizationEngine.evaluate_indirect_and_withholding_tax: a
// deterministic multi-jurisdiction tax computation over exact decimals.
//
// BL-22 fail-closed: wherever the reference granted a tax benefit from
// identifier length alone, a provided identifier must first pass its
// jurisdiction's structured validation (tax_identifier.go) or the evaluation
// fails with ErrInvalidTaxIdentifier. An absent identifier keeps the
// reference's conservative branch.
func EvaluateIndirectAndWithholdingTax(in TaxInput) (TaxCalculationResult, error) {
	net, err := Q4(in.NetAmount)
	if err != nil {
		return TaxCalculationResult{}, fmt.Errorf("localization: q4 net_amount: %w", err)
	}
	warnings := []string{}
	boxes := map[string]money.Money{}

	switch in.Jurisdiction {
	case JurisdictionAU:
		// 1. AUSTRALIA (AASB + ATO GST 10% + BAS G1/1A/1B + 47% No-ABN PAYG
		// Withholding)
		rate := rate00
		if in.TaxCode == "AU_GST_10" {
			rate = rateAU10
		}
		tax, err := rateTax(net, rate)
		if err != nil {
			return TaxCalculationResult{}, err
		}
		wht := zero4
		// Reference branch: `not counterparty_tax_id or len(...) != 11`
		// routed to the No-ABN withholding rule, so any 11 characters
		// avoided the 47% levy. Fail closed: a provided ABN must pass the
		// ATO checksum, an absent one keeps the withholding branch.
		if err := validateTaxIdentifier(in.Jurisdiction, in.CounterpartyTaxID); err != nil {
			return TaxCalculationResult{}, err
		}
		if in.CounterpartyTaxID == "" && net.Cmp(thresholdAU75) > 0 {
			// ATO No-ABN Withholding Rule (47% on payments > AUD 75 excl. GST)
			wht, err = rateTax(net.Add(tax), rateAUWHT47)
			if err != nil {
				return TaxCalculationResult{}, err
			}
			warnings = append(warnings,
				"AU_ATO_NO_ABN_WITHHOLDING: Supplier ABN missing/invalid; 47% PAYG withholding applied (BAS Box W2).")
			boxes["BAS_W2_NO_ABN_WHT"] = wht
		}
		boxes["BAS_1B_GST_CREDITS"] = tax
		netPayable, err := Q4(net.Add(tax).Sub(wht))
		if err != nil {
			return TaxCalculationResult{}, err
		}
		return TaxCalculationResult{
			Jurisdiction:             in.Jurisdiction,
			TaxCode:                  in.TaxCode,
			NetAmount:                net,
			TaxAmount:                tax,
			RecoverableTaxAmount:     tax,
			NonRecoverableTaxAmount:  zero4,
			WithholdingTaxAmount:     wht,
			ReverseChargeOutputTax:   zero4,
			NetPayableToCounterparty: netPayable,
			StatutoryReturnBoxes:     boxes,
			ComplianceWarnings:       warnings,
		}, nil

	case JurisdictionCN:
		// 2. MAINLAND CHINA (PRC CAS + Golden Tax Phase IV E-Fapiao + VAT
		// 13%/9%/6%/3%)
		rate := rate00
		switch in.TaxCode {
		case "CN_VAT_13":
			rate = rateCN13
		case "CN_VAT_9":
			rate = rateCN9
		case "CN_VAT_6":
			rate = rateCN6
		case "CN_VAT_3_SMALL":
			rate = rateCN3
		}
		tax, err := rateTax(net, rate)
		if err != nil {
			return TaxCalculationResult{}, err
		}
		// Input VAT is only creditable if a Golden Tax Phase IV 20-digit
		// Digital Fapiao is verified. The reference accepted any 20
		// characters (BL-22); the Go check is the documented 20-digit numeric
		// format and a non-conforming code is an explicit error, never
		// recoverable VAT.
		if err := validateTaxIdentifier(in.Jurisdiction, in.EInvoiceCode); err != nil {
			return TaxCalculationResult{}, err
		}
		verified := in.EInvoiceCode != ""
		recoverable := zero4
		if verified && in.TaxCode != "CN_VAT_3_SMALL" {
			recoverable = tax
		}
		nonRecoverable, err := Q4(tax.Sub(recoverable))
		if err != nil {
			return TaxCalculationResult{}, err
		}
		if !verified && tax.Cmp(zero4) > 0 {
			warnings = append(warnings,
				"CN_GOLDEN_TAX_UNVERIFIED: Missing 20-digit Golden Tax IV Fapiao code; Input VAT routed to Pending Verification / Non-Creditable.")
		}
		boxes["CN_VAT_INPUT_CREDIT"] = recoverable
		netPayable, err := Q4(net.Add(tax))
		if err != nil {
			return TaxCalculationResult{}, err
		}
		return TaxCalculationResult{
			Jurisdiction:             in.Jurisdiction,
			TaxCode:                  in.TaxCode,
			NetAmount:                net,
			TaxAmount:                tax,
			RecoverableTaxAmount:     recoverable,
			NonRecoverableTaxAmount:  nonRecoverable,
			WithholdingTaxAmount:     zero4,
			ReverseChargeOutputTax:   zero4,
			NetPayableToCounterparty: netPayable,
			StatutoryReturnBoxes:     boxes,
			ComplianceWarnings:       warnings,
		}, nil

	case JurisdictionSG:
		// 3. SINGAPORE (SFRS(I) + IRAS 9% GST + Reverse Charge + GST F5
		// Return)
		if in.TaxCode == "SG_GST_9_RC" || in.IsCrossBorderB2B {
			// Imported services under IRAS Reverse Charge
			rcTax, err := rateTax(net, rateSG9)
			if err != nil {
				return TaxCalculationResult{}, err
			}
			boxes["IRAS_F5_BOX_1_OUTPUT_RC"] = rcTax
			boxes["IRAS_F5_BOX_7_INPUT_CLAIM"] = rcTax
			return TaxCalculationResult{
				Jurisdiction:             in.Jurisdiction,
				TaxCode:                  "SG_GST_9_RC",
				NetAmount:                net,
				TaxAmount:                zero4,
				RecoverableTaxAmount:     rcTax,
				NonRecoverableTaxAmount:  zero4,
				WithholdingTaxAmount:     zero4,
				ReverseChargeOutputTax:   rcTax,
				NetPayableToCounterparty: net,
				StatutoryReturnBoxes:     boxes,
				ComplianceWarnings:       warnings,
			}, nil
		}
		rate := rate00
		if in.TaxCode == "SG_GST_9_SR" {
			rate = rateSG9
		}
		tax, err := rateTax(net, rate)
		if err != nil {
			return TaxCalculationResult{}, err
		}
		boxes["IRAS_F5_BOX_5_TAXABLE_PURCHASES"] = net
		boxes["IRAS_F5_BOX_7_INPUT_GST"] = tax
		netPayable, err := Q4(net.Add(tax))
		if err != nil {
			return TaxCalculationResult{}, err
		}
		return TaxCalculationResult{
			Jurisdiction:             in.Jurisdiction,
			TaxCode:                  in.TaxCode,
			NetAmount:                net,
			TaxAmount:                tax,
			RecoverableTaxAmount:     tax,
			NonRecoverableTaxAmount:  zero4,
			WithholdingTaxAmount:     zero4,
			ReverseChargeOutputTax:   zero4,
			NetPayableToCounterparty: netPayable,
			StatutoryReturnBoxes:     boxes,
			ComplianceWarnings:       warnings,
		}, nil

	case JurisdictionHK:
		// 4. HONG KONG (HKFRS + No GST/VAT + Territorial Source Tagging)
		source := in.HKProfitSource
		if source == "" {
			source = "ONSHORE"
		}
		boxes["HK_IRD_ASSESSABLE_"+source] = net
		return TaxCalculationResult{
			Jurisdiction:             in.Jurisdiction,
			TaxCode:                  "HK_NO_INDIRECT_TAX",
			NetAmount:                net,
			TaxAmount:                zero4,
			RecoverableTaxAmount:     zero4,
			NonRecoverableTaxAmount:  zero4,
			WithholdingTaxAmount:     zero4,
			ReverseChargeOutputTax:   zero4,
			NetPayableToCounterparty: net,
			StatutoryReturnBoxes:     boxes,
			ComplianceWarnings:       warnings,
		}, nil

	case JurisdictionUS:
		// 5. NORTH AMERICA (US Multi-State Sales & Consumer Use Tax + 1099
		// Backup WHT / Canada GST/HST)
		if in.TaxCode == "US_CONSUMER_USE_TAX_8_25" {
			// US Sales/Use Tax is a final cost to the business
			// (non-recoverable input tax)
			useTax, err := rateTax(net, rateUS825)
			if err != nil {
				return TaxCalculationResult{}, err
			}
			warnings = append(warnings,
				"US_USE_TAX_SELF_ACCRUAL: Vendor did not charge state sales tax; self-assessed 8.25% Consumer Use Tax.")
			// Fail closed: the reference exempted backup withholding on any
			// non-empty TIN string; a provided TIN must pass EIN/SSN shape
			// validation, an absent one keeps the 24% withholding branch.
			if err := validateTaxIdentifier(in.Jurisdiction, in.CounterpartyTaxID); err != nil {
				return TaxCalculationResult{}, err
			}
			wht := zero4
			if in.CounterpartyTaxID == "" {
				wht, err = rateTax(net, rateUSWHT24)
				if err != nil {
					return TaxCalculationResult{}, err
				}
				if wht.Cmp(zero4) > 0 {
					warnings = append(warnings, "US_IRS_BACKUP_WHT_24: Missing W-9 TIN; 24% IRS backup withholding applied.")
				}
			}
			boxes["US_STATE_USE_TAX_PAYABLE"] = useTax
			boxes["IRS_1099_WHT"] = wht
			netPayable, err := Q4(net.Sub(wht))
			if err != nil {
				return TaxCalculationResult{}, err
			}
			return TaxCalculationResult{
				Jurisdiction:             in.Jurisdiction,
				TaxCode:                  in.TaxCode,
				NetAmount:                net,
				TaxAmount:                zero4,
				RecoverableTaxAmount:     zero4,
				NonRecoverableTaxAmount:  useTax,
				WithholdingTaxAmount:     wht,
				ReverseChargeOutputTax:   useTax,
				NetPayableToCounterparty: netPayable,
				StatutoryReturnBoxes:     boxes,
				ComplianceWarnings:       warnings,
			}, nil
		}
		salesTax := zero4
		if in.TaxCode == "US_SALES_TAX_8_25" {
			salesTax, err = rateTax(net, rateUS825)
			if err != nil {
				return TaxCalculationResult{}, err
			}
		}
		boxes["US_EXPENSED_SALES_TAX"] = salesTax
		netPayable, err := Q4(net.Add(salesTax))
		if err != nil {
			return TaxCalculationResult{}, err
		}
		return TaxCalculationResult{
			Jurisdiction:             in.Jurisdiction,
			TaxCode:                  in.TaxCode,
			NetAmount:                net,
			TaxAmount:                salesTax,
			RecoverableTaxAmount:     zero4,
			NonRecoverableTaxAmount:  salesTax,
			WithholdingTaxAmount:     zero4,
			ReverseChargeOutputTax:   zero4,
			NetPayableToCounterparty: netPayable,
			StatutoryReturnBoxes:     boxes,
			ComplianceWarnings:       warnings,
		}, nil

	case JurisdictionEU, JurisdictionUK:
		// 6. EUROPE (EU Intra-Community Acquisition Reverse Charge &
		// Standard VAT)
		if in.IsCrossBorderB2B || in.TaxCode == "EU_IC_REVERSE_CHARGE_20" {
			rcVat, err := rateTax(net, rateEU20)
			if err != nil {
				return TaxCalculationResult{}, err
			}
			// Reference: warns only when the VIES VAT ID is absent; the
			// acquisition grant itself is parity (it nets to zero either
			// way). Fail closed: a provided ID must pass the VIES shape
			// check instead of silencing the warning on any characters.
			if err := validateTaxIdentifier(in.Jurisdiction, in.CounterpartyTaxID); err != nil {
				return TaxCalculationResult{}, err
			}
			if in.CounterpartyTaxID == "" {
				warnings = append(warnings,
					"EU_VIES_VAT_MISSING: Intra-Community reverse charge requires valid VIES VAT ID.")
			}
			boxes["EU_VAT_ACQUISITION_OUTPUT"] = rcVat
			boxes["EU_VAT_ACQUISITION_INPUT"] = rcVat
			return TaxCalculationResult{
				Jurisdiction:             in.Jurisdiction,
				TaxCode:                  "EU_IC_REVERSE_CHARGE_20",
				NetAmount:                net,
				TaxAmount:                zero4,
				RecoverableTaxAmount:     rcVat,
				NonRecoverableTaxAmount:  zero4,
				WithholdingTaxAmount:     zero4,
				ReverseChargeOutputTax:   rcVat,
				NetPayableToCounterparty: net,
				StatutoryReturnBoxes:     boxes,
				ComplianceWarnings:       warnings,
			}, nil
		}
		vat, err := rateTax(net, rateEU20)
		if err != nil {
			return TaxCalculationResult{}, err
		}
		boxes["EU_INPUT_VAT_RECOVERABLE"] = vat
		netPayable, err := Q4(net.Add(vat))
		if err != nil {
			return TaxCalculationResult{}, err
		}
		return TaxCalculationResult{
			Jurisdiction:             in.Jurisdiction,
			TaxCode:                  in.TaxCode,
			NetAmount:                net,
			TaxAmount:                vat,
			RecoverableTaxAmount:     vat,
			NonRecoverableTaxAmount:  zero4,
			WithholdingTaxAmount:     zero4,
			ReverseChargeOutputTax:   zero4,
			NetPayableToCounterparty: netPayable,
			StatutoryReturnBoxes:     boxes,
			ComplianceWarnings:       warnings,
		}, nil
	}

	// Enum members without an engine branch (CA) get the zeroed result, not
	// an error — the reference's fallthrough.
	return TaxCalculationResult{
		Jurisdiction:             in.Jurisdiction,
		TaxCode:                  in.TaxCode,
		NetAmount:                net,
		TaxAmount:                zero4,
		RecoverableTaxAmount:     zero4,
		NonRecoverableTaxAmount:  zero4,
		WithholdingTaxAmount:     zero4,
		ReverseChargeOutputTax:   zero4,
		NetPayableToCounterparty: net,
		StatutoryReturnBoxes:     boxes,
		ComplianceWarnings:       warnings,
	}, nil
}

// ComputeLeaseIFRS16VsASC842Delta ports
// GlobalLocalizationEngine.compute_lease_ifrs16_vs_asc842_delta: monthly
// parallel entries for an operating lease under IFRS 16 (front-loaded
// interest + straight-line ROU amortization) and US GAAP ASC 842 (single
// straight-line lease cost).
func ComputeLeaseIFRS16VsASC842Delta(
	monthlyLeasePayment money.Money,
	openingLeaseLiability money.Money,
	monthlyDiscountRate money.Money,
	straightLineIfrsRouAmortization money.Money,
	straightLineAsc842SingleLeaseCost money.Money,
) (ParallelBookDelta, error) {
	interestIfrs, err := rateTax(openingLeaseLiability, monthlyDiscountRate)
	if err != nil {
		return ParallelBookDelta{}, err
	}
	rouAmortIfrs, err := Q4(straightLineIfrsRouAmortization)
	if err != nil {
		return ParallelBookDelta{}, err
	}
	singleCostUs, err := Q4(straightLineAsc842SingleLeaseCost)
	if err != nil {
		return ParallelBookDelta{}, err
	}
	rouAmortUs, err := Q4(singleCostUs.Sub(interestIfrs))
	if err != nil {
		return ParallelBookDelta{}, err
	}
	paymentLessInterest, err := Q4(monthlyLeasePayment.Sub(interestIfrs))
	if err != nil {
		return ParallelBookDelta{}, err
	}
	payment, err := Q4(monthlyLeasePayment)
	if err != nil {
		return ParallelBookDelta{}, err
	}
	return ParallelBookDelta{
		Topic: "IFRS 16 vs. US GAAP ASC 842 Operating Lease Monthly Recognition",
		IfrsBookEntries: []BookEntry{
			{Account: "6410_ROU_Depreciation_Expense", Debit: rouAmortIfrs, Credit: zero4},
			{Account: "7120_Lease_Interest_Expense", Debit: interestIfrs, Credit: zero4},
			{Account: "2410_Lease_Liability", Debit: paymentLessInterest, Credit: zero4},
			{Account: "1650_Accumulated_ROU_Amortization", Debit: zero4, Credit: rouAmortIfrs},
			{Account: "1110_Cash_at_Bank", Debit: zero4, Credit: payment},
		},
		UsGaapDeltaEntries: []BookEntry{
			{Account: "6400_ASC842_Operating_Lease_Cost", Debit: singleCostUs, Credit: zero4},
			{Account: "1650_Accumulated_ROU_Amortization", Debit: rouAmortIfrs, Credit: rouAmortUs},
			{Account: "6410_ROU_Depreciation_Expense", Debit: zero4, Credit: rouAmortIfrs},
			{Account: "7120_Lease_Interest_Expense", Debit: zero4, Credit: interestIfrs},
		},
		Rationale: "Under IFRS 16, all leases separate ROU depreciation and interest expense (front-loaded P&L profile). " +
			"Under US GAAP ASC 842, operating leases recognize a single straight-line lease cost by adjusting ROU amortization.",
	}, nil
}
