package localization

import (
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Every expected value in this file was computed by running the frozen
// Python reference (backend/app/core/localization.py) on the same inputs;
// none is read back from the Go implementation.

func mustParse(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := money.Parse(s)
	if err != nil {
		t.Fatalf("money.Parse(%q): %v", s, err)
	}
	return m
}

func mustQ4(t *testing.T, s string) money.Money {
	t.Helper()
	m, err := Q4(mustParse(t, s))
	if err != nil {
		t.Fatalf("Q4(%q): %v", s, err)
	}
	return m
}

func assertMoney(t *testing.T, name string, got money.Money, want string) {
	t.Helper()
	if got.String() != want {
		t.Errorf("%s = %q, want %q", name, got.String(), want)
	}
}

func evaluate(t *testing.T, in TaxInput) TaxCalculationResult {
	t.Helper()
	out, err := EvaluateIndirectAndWithholdingTax(in)
	if err != nil {
		t.Fatalf("evaluate %s %s: %v", in.Jurisdiction, in.TaxCode, err)
	}
	return out
}

// TestQ4 pins the q4 quantize: 4dp, ROUND_HALF_UP, sign of zero kept. All
// values from the reference's q4.
func TestQ4(t *testing.T) {
	cases := []struct{ in, want string }{
		{"1000", "1000.0000"},
		{"100.00005", "100.0001"}, // tie rounds away from zero
		{"-0.00001", "-0.0000"},   // signed zero
	}
	for _, c := range cases {
		assertMoney(t, "Q4("+c.in+")", mustQ4(t, c.in), c.want)
	}
	// The reference raises decimal.InvalidOperation when the quantized
	// coefficient would exceed the 28-digit context.
	_, err := Q4(mustParse(t, "99999999999999999999999999999"))
	if !errors.Is(err, money.ErrQuantize) {
		t.Errorf("Q4(29 digits) err = %v, want money.ErrQuantize", err)
	}
}

// TestParseJurisdiction pins the enum gate: unknown values are rejected at
// construction, as Jurisdiction("JP") raises ValueError in the reference.
func TestParseJurisdiction(t *testing.T) {
	for _, s := range []string{"CN", "HK", "SG", "AU", "US", "CA", "EU", "UK"} {
		j, err := ParseJurisdiction(s)
		if err != nil || j != Jurisdiction(s) {
			t.Errorf("ParseJurisdiction(%q) = %v, %v", s, j, err)
		}
	}
	if _, err := ParseJurisdiction("JP"); !errors.Is(err, ErrUnknownJurisdiction) {
		t.Errorf("ParseJurisdiction(\"JP\") err = %v, want ErrUnknownJurisdiction", err)
	}
}

// TestParseAccountingStandard pins the caller-vocabulary enum the reference
// declares.
func TestParseAccountingStandard(t *testing.T) {
	for _, s := range []string{"IFRS", "US_GAAP", "PRC_CAS", "HKFRS", "SFRS_I", "AASB", "TAX_BASIS"} {
		if _, err := ParseAccountingStandard(s); err != nil {
			t.Errorf("ParseAccountingStandard(%q): %v", s, err)
		}
	}
	if _, err := ParseAccountingStandard("GAAP"); err == nil {
		t.Error("ParseAccountingStandard(\"GAAP\") accepted an unknown standard")
	}
}

// TestEvaluateAustralia: GST 10%, BAS boxes, the 47% No-ABN withholding rule
// and its AUD 75 threshold. Expected values from the reference.
func TestEvaluateAustralia(t *testing.T) {
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "1000"), TaxCode: "AU_GST_10"})
	assertMoney(t, "net", r.NetAmount, "1000.0000")
	assertMoney(t, "tax", r.TaxAmount, "100.0000")
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "100.0000")
	assertMoney(t, "wht", r.WithholdingTaxAmount, "517.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "583.0000")
	assertMoney(t, "box W2", r.StatutoryReturnBoxes["BAS_W2_NO_ABN_WHT"], "517.0000")
	assertMoney(t, "box 1B", r.StatutoryReturnBoxes["BAS_1B_GST_CREDITS"], "100.0000")
	if len(r.ComplianceWarnings) != 1 {
		t.Errorf("warnings = %v, want the one No-ABN warning", r.ComplianceWarnings)
	}

	// A checksum-valid ABN avoids the withholding.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "1000"),
		TaxCode: "AU_GST_10", CounterpartyTaxID: "51 824 753 556"})
	assertMoney(t, "wht", r.WithholdingTaxAmount, "0.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1100.0000")

	// Unknown tax code: rate lookup misses to 0.00, withholding still applies.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "500"), TaxCode: "AU_GST_FREE"})
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	assertMoney(t, "wht", r.WithholdingTaxAmount, "235.0000")

	// Payments at or below AUD 75 are not withheld.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "50"), TaxCode: "AU_GST_10"})
	assertMoney(t, "wht", r.WithholdingTaxAmount, "0.0000")
	if len(r.ComplianceWarnings) != 0 {
		t.Errorf("warnings = %v, want none", r.ComplianceWarnings)
	}
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "75"), TaxCode: "AU_GST_10"})
	assertMoney(t, "wht at threshold", r.WithholdingTaxAmount, "0.0000")
	assertMoney(t, "payable at threshold", r.NetPayableToCounterparty, "82.5000")

	// A net that needs the ROUND_HALF_UP tie: q4(100.00005) = 100.0001.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "100.00005"),
		TaxCode: "AU_GST_10", CounterpartyTaxID: "51 824 753 556"})
	assertMoney(t, "net tie", r.NetAmount, "100.0001")
	assertMoney(t, "tax", r.TaxAmount, "10.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "110.0001")
}

// TestEvaluateAustraliaExactDecimal pins the exact-decimal invariant on the
// audit BL-27 amount (999999999999.9997), which lost precision through
// float64 in the finding: every tax amount here is the exact decimal result.
func TestEvaluateAustraliaExactDecimal(t *testing.T) {
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "999999999999.9997"), TaxCode: "AU_GST_10"})
	assertMoney(t, "net", r.NetAmount, "999999999999.9997")
	assertMoney(t, "tax", r.TaxAmount, "100000000000.0000")
	assertMoney(t, "wht", r.WithholdingTaxAmount, "516999999999.9999")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "582999999999.9998")
}

// TestEvaluateChina: VAT rates, the 20-digit fapiao gating of input-VAT
// credit and the small-scale exclusion. Valid-format codes only here; the
// length-granting defect is the BL-22 regression test.
func TestEvaluateChina(t *testing.T) {
	// No fapiao: input VAT routes to non-creditable with the warning.
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "1000"), TaxCode: "CN_VAT_13"})
	assertMoney(t, "tax", r.TaxAmount, "130.0000")
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "0.0000")
	assertMoney(t, "non-recoverable", r.NonRecoverableTaxAmount, "130.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1130.0000")
	assertMoney(t, "box", r.StatutoryReturnBoxes["CN_VAT_INPUT_CREDIT"], "0.0000")
	if len(r.ComplianceWarnings) != 1 {
		t.Errorf("warnings = %v, want the unverified-fapiao warning", r.ComplianceWarnings)
	}

	// A format-valid 20-digit code verifies the fapiao.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "1000"),
		TaxCode: "CN_VAT_13", EInvoiceCode: "12345678901234567890"})
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "130.0000")
	assertMoney(t, "non-recoverable", r.NonRecoverableTaxAmount, "0.0000")
	if len(r.ComplianceWarnings) != 0 {
		t.Errorf("warnings = %v, want none", r.ComplianceWarnings)
	}

	// Small-scale VAT is never creditable, verified fapiao or not.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "500"),
		TaxCode: "CN_VAT_3_SMALL", EInvoiceCode: "12345678901234567890"})
	assertMoney(t, "tax", r.TaxAmount, "15.0000")
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "0.0000")
	assertMoney(t, "non-recoverable", r.NonRecoverableTaxAmount, "15.0000")

	// Unknown tax code: zero rate, and no warning because no tax arose.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "1000"), TaxCode: "CN_UNKNOWN"})
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	if len(r.ComplianceWarnings) != 0 {
		t.Errorf("warnings = %v, want none", r.ComplianceWarnings)
	}

	// A 28-digit net overflows the context when the payable is quantized —
	// the reference raises decimal.InvalidOperation there.
	_, err := EvaluateIndirectAndWithholdingTax(TaxInput{
		Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "999999999999999999999999.9999"), TaxCode: "CN_VAT_13"})
	if !errors.Is(err, money.ErrQuantize) {
		t.Errorf("28-digit net err = %v, want money.ErrQuantize", err)
	}
}

// TestEvaluateSingapore: reverse charge by code or cross-border flag (the
// forced SG_GST_9_RC result code), standard-rated GST and F5 boxes.
func TestEvaluateSingapore(t *testing.T) {
	// The cross-border flag routes to reverse charge even with an SR code.
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionSG, NetAmount: mustParse(t, "1000"),
		TaxCode: "SG_GST_9_SR", IsCrossBorderB2B: true})
	if r.TaxCode != "SG_GST_9_RC" {
		t.Errorf("tax_code = %q, want SG_GST_9_RC", r.TaxCode)
	}
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	assertMoney(t, "rc output", r.ReverseChargeOutputTax, "90.0000")
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "90.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1000.0000")
	assertMoney(t, "box 1", r.StatutoryReturnBoxes["IRAS_F5_BOX_1_OUTPUT_RC"], "90.0000")
	assertMoney(t, "box 7", r.StatutoryReturnBoxes["IRAS_F5_BOX_7_INPUT_CLAIM"], "90.0000")

	// The RC code alone routes the same way.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionSG, NetAmount: mustParse(t, "2000"), TaxCode: "SG_GST_9_RC"})
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "180.0000")

	// Standard-rated purchases.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionSG, NetAmount: mustParse(t, "1000"), TaxCode: "SG_GST_9_SR"})
	assertMoney(t, "tax", r.TaxAmount, "90.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1090.0000")
	assertMoney(t, "box 5", r.StatutoryReturnBoxes["IRAS_F5_BOX_5_TAXABLE_PURCHASES"], "1000.0000")
	assertMoney(t, "box 7", r.StatutoryReturnBoxes["IRAS_F5_BOX_7_INPUT_GST"], "90.0000")

	// Unknown code: zero-rated amounts, empty GST.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionSG, NetAmount: mustParse(t, "1000"), TaxCode: "SG_GST_ZR"})
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	assertMoney(t, "box 7", r.StatutoryReturnBoxes["IRAS_F5_BOX_7_INPUT_GST"], "0.0000")
}

// TestEvaluateHongKong: no indirect tax, the territorial source tag and the
// signed-zero quantize the reference's q4 produces for tiny negative nets.
func TestEvaluateHongKong(t *testing.T) {
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionHK, NetAmount: mustParse(t, "1000")})
	if r.TaxCode != "HK_NO_INDIRECT_TAX" {
		t.Errorf("tax_code = %q, want HK_NO_INDIRECT_TAX", r.TaxCode)
	}
	assertMoney(t, "box", r.StatutoryReturnBoxes["HK_IRD_ASSESSABLE_ONSHORE"], "1000.0000")

	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionHK, NetAmount: mustParse(t, "2500"), HKProfitSource: "OFFSHORE"})
	if _, ok := r.StatutoryReturnBoxes["HK_IRD_ASSESSABLE_OFFSHORE"]; !ok {
		t.Errorf("boxes = %v, want the OFFSHORE key", r.StatutoryReturnBoxes)
	}

	// q4(-0.00001) = -0.0000 in the reference: the sign of zero survives.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionHK, NetAmount: mustParse(t, "-0.00001")})
	assertMoney(t, "net", r.NetAmount, "-0.0000")
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "-0.0000")
	assertMoney(t, "box", r.StatutoryReturnBoxes["HK_IRD_ASSESSABLE_ONSHORE"], "-0.0000")
}

// TestEvaluateNorthAmerica: use-tax self-accrual, 24% backup withholding on
// a missing TIN and the expensed sales-tax path.
func TestEvaluateNorthAmerica(t *testing.T) {
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionUS, NetAmount: mustParse(t, "1000"), TaxCode: "US_CONSUMER_USE_TAX_8_25"})
	assertMoney(t, "use tax", r.NonRecoverableTaxAmount, "82.5000")
	assertMoney(t, "rc output", r.ReverseChargeOutputTax, "82.5000")
	assertMoney(t, "wht", r.WithholdingTaxAmount, "240.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "760.0000")
	assertMoney(t, "box use", r.StatutoryReturnBoxes["US_STATE_USE_TAX_PAYABLE"], "82.5000")
	assertMoney(t, "box wht", r.StatutoryReturnBoxes["IRS_1099_WHT"], "240.0000")
	if len(r.ComplianceWarnings) != 2 {
		t.Errorf("warnings = %v, want use-tax + backup-WHT", r.ComplianceWarnings)
	}

	// A shape-valid EIN avoids the withholding; only the use-tax warning stays.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionUS, NetAmount: mustParse(t, "1000"),
		TaxCode: "US_CONSUMER_USE_TAX_8_25", CounterpartyTaxID: "12-3456789"})
	assertMoney(t, "wht", r.WithholdingTaxAmount, "0.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1000.0000")
	if len(r.ComplianceWarnings) != 1 {
		t.Errorf("warnings = %v, want only the use-tax warning", r.ComplianceWarnings)
	}

	// Sales tax is a final cost.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionUS, NetAmount: mustParse(t, "1000"), TaxCode: "US_SALES_TAX_8_25"})
	assertMoney(t, "tax", r.TaxAmount, "82.5000")
	assertMoney(t, "non-recoverable", r.NonRecoverableTaxAmount, "82.5000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1082.5000")

	// Unknown code: no tax.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionUS, NetAmount: mustParse(t, "1000"), TaxCode: "US_EXEMPT"})
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1000.0000")
}

// TestEvaluateEuropeAndUK: standard VAT, reverse charge with and without a
// VIES ID, and the UK sharing the EU branch.
func TestEvaluateEuropeAndUK(t *testing.T) {
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionEU, NetAmount: mustParse(t, "1000"), TaxCode: "EU_VAT_20_STD"})
	assertMoney(t, "vat", r.TaxAmount, "200.0000")
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "200.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1200.0000")

	// A format-valid VIES ID takes the reverse charge without the warning.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionEU, NetAmount: mustParse(t, "1000"),
		TaxCode: "EU_IC_REVERSE_CHARGE_20", CounterpartyTaxID: "DE123456789"})
	if r.TaxCode != "EU_IC_REVERSE_CHARGE_20" {
		t.Errorf("tax_code = %q", r.TaxCode)
	}
	assertMoney(t, "rc output", r.ReverseChargeOutputTax, "200.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1000.0000")
	if len(r.ComplianceWarnings) != 0 {
		t.Errorf("warnings = %v, want none", r.ComplianceWarnings)
	}

	// Missing VIES ID: the reference keeps the grant and warns.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionEU, NetAmount: mustParse(t, "1000"), TaxCode: "EU_IC_REVERSE_CHARGE_20"})
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "200.0000")
	if len(r.ComplianceWarnings) != 1 {
		t.Errorf("warnings = %v, want the VIES warning", r.ComplianceWarnings)
	}

	// The UK rides the EU branch through the cross-border flag.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionUK, NetAmount: mustParse(t, "500"), IsCrossBorderB2B: true})
	if r.TaxCode != "EU_IC_REVERSE_CHARGE_20" {
		t.Errorf("tax_code = %q, want EU_IC_REVERSE_CHARGE_20", r.TaxCode)
	}
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "100.0000")
	if len(r.ComplianceWarnings) != 1 {
		t.Errorf("warnings = %v, want the VIES warning", r.ComplianceWarnings)
	}
}

// TestEvaluateCanadaFallthrough pins the reference's zeroed result for the
// enum member without an engine branch.
func TestEvaluateCanadaFallthrough(t *testing.T) {
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionCA, NetAmount: mustParse(t, "1000"), TaxCode: "CA_GST_5"})
	if r.TaxCode != "CA_GST_5" {
		t.Errorf("tax_code = %q", r.TaxCode)
	}
	assertMoney(t, "tax", r.TaxAmount, "0.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1000.0000")
	if len(r.StatutoryReturnBoxes) != 0 || len(r.ComplianceWarnings) != 0 {
		t.Errorf("boxes/warnings = %v/%v, want empty", r.StatutoryReturnBoxes, r.ComplianceWarnings)
	}
}

// TestLeaseDelta pins the IFRS 16 vs. ASC 842 parallel entries. Expected
// values from the reference, including the ROUND_HALF_UP tie in the interest
// product (100 × 0.1234565 = 12.34565 → 12.3457).
func TestLeaseDelta(t *testing.T) {
	d, err := ComputeLeaseIFRS16VsASC842Delta(
		mustParse(t, "25000"), mustParse(t, "4850000"), mustParse(t, "0.0035"),
		mustParse(t, "18500"), mustParse(t, "19750"))
	if err != nil {
		t.Fatal(err)
	}
	wantIfrs := []BookEntry{
		{Account: "6410_ROU_Depreciation_Expense", Debit: mustParse(t, "18500.0000"), Credit: mustParse(t, "0.0000")},
		{Account: "7120_Lease_Interest_Expense", Debit: mustParse(t, "16975.0000"), Credit: mustParse(t, "0.0000")},
		{Account: "2410_Lease_Liability", Debit: mustParse(t, "8025.0000"), Credit: mustParse(t, "0.0000")},
		{Account: "1650_Accumulated_ROU_Amortization", Debit: mustParse(t, "0.0000"), Credit: mustParse(t, "18500.0000")},
		{Account: "1110_Cash_at_Bank", Debit: mustParse(t, "0.0000"), Credit: mustParse(t, "25000.0000")},
	}
	if len(d.IfrsBookEntries) != len(wantIfrs) {
		t.Fatalf("ifrs entries = %d, want %d", len(d.IfrsBookEntries), len(wantIfrs))
	}
	for i, want := range wantIfrs {
		got := d.IfrsBookEntries[i]
		if got.Account != want.Account || got.Debit.String() != want.Debit.String() || got.Credit.String() != want.Credit.String() {
			t.Errorf("ifrs[%d] = %+v, want account %s debit %s credit %s", i, got, want.Account, want.Debit, want.Credit)
		}
	}
	wantUs := []BookEntry{
		{Account: "6400_ASC842_Operating_Lease_Cost", Debit: mustParse(t, "19750.0000"), Credit: mustParse(t, "0.0000")},
		{Account: "1650_Accumulated_ROU_Amortization", Debit: mustParse(t, "18500.0000"), Credit: mustParse(t, "2775.0000")},
		{Account: "6410_ROU_Depreciation_Expense", Debit: mustParse(t, "0.0000"), Credit: mustParse(t, "18500.0000")},
		{Account: "7120_Lease_Interest_Expense", Debit: mustParse(t, "0.0000"), Credit: mustParse(t, "16975.0000")},
	}
	if len(d.UsGaapDeltaEntries) != len(wantUs) {
		t.Fatalf("us-gaap entries = %d, want %d", len(d.UsGaapDeltaEntries), len(wantUs))
	}
	for i, want := range wantUs {
		got := d.UsGaapDeltaEntries[i]
		if got.Account != want.Account || got.Debit.String() != want.Debit.String() || got.Credit.String() != want.Credit.String() {
			t.Errorf("us-gaap[%d] = %+v, want account %s debit %s credit %s", i, got, want.Account, want.Debit, want.Credit)
		}
	}

	d, err = ComputeLeaseIFRS16VsASC842Delta(
		mustParse(t, "80"), mustParse(t, "100"), mustParse(t, "0.1234565"),
		mustParse(t, "50"), mustParse(t, "60"))
	if err != nil {
		t.Fatal(err)
	}
	assertMoney(t, "interest tie", d.IfrsBookEntries[1].Debit, "12.3457")
	assertMoney(t, "liability debit", d.IfrsBookEntries[2].Debit, "67.6543")
	assertMoney(t, "rou amortization us", d.UsGaapDeltaEntries[1].Credit, "47.6543")
}

// TestMulDecimalContextCap pins the 28-significant-digit context rounding of
// Python's `*` that the reference's rate products run under: the exact
// product 129999999999999999999999.999987 rounds half-even, with the carry
// running all the way over, to 130000000000000000000000.0000.
func TestMulDecimalContextCap(t *testing.T) {
	prod := mustParse(t, "999999999999999999999999.9999").Mul(mustParse(t, "0.13"))
	assertMoney(t, "capped product", prod, "130000000000000000000000.0000")

	// A product inside the context stays exact, ideal exponent and all.
	prod = mustParse(t, "1000.0000").Mul(mustParse(t, "0.13"))
	assertMoney(t, "exact product", prod, "130.000000")
}
