package localization

import (
	"errors"
	"testing"
)

// TestBL22_tax_identifier_fail_closed reproduces the audit scenario of
// BL-22 (07-reviews/2026-10-21-business-logic-audit.md): "Twenty arbitrary
// characters granted recoverable VAT 130 on a 1,000 purchase" through
// localization.py:127–128's len(einvoice_code) == 20 check. The frozen
// Python reference returns recoverable_tax_amount 130.0000 for exactly this
// input (reproduced against the reference during this port); the Go engine
// must fail closed instead — an explicit error, never a granted benefit.
//
// Per ADR-0002 D3 this scenario is excluded from the golden baseline; the
// parent session registers it in fixtures/divergences.yaml pointing at this
// test.
func TestBL22_tax_identifier_fail_closed(t *testing.T) {
	// The audit scenario: CN VAT 13% on a 1,000 purchase, fapiao "verified"
	// by twenty arbitrary characters.
	_, err := EvaluateIndirectAndWithholdingTax(TaxInput{
		Jurisdiction: JurisdictionCN,
		NetAmount:    mustParse(t, "1000"),
		TaxCode:      "CN_VAT_13",
		EInvoiceCode: "ABCDEFGHIJKLMNOPQRST", // 20 arbitrary characters
	})
	if err == nil {
		t.Fatal("BL-22: 20 arbitrary characters granted recoverable VAT; want ErrInvalidTaxIdentifier")
	}
	if !errors.Is(err, ErrInvalidTaxIdentifier) {
		t.Fatalf("BL-22: err = %v, want ErrInvalidTaxIdentifier", err)
	}

	// The same defect class granted benefits through other jurisdictions'
	// length tests. Each must now fail closed:
	//   AU — eleven arbitrary digits avoided the 47% No-ABN withholding;
	//   US — any non-empty TIN avoided the 24% backup withholding;
	//   EU — any non-empty string silenced the VIES warning.
	for _, tc := range []struct {
		name    string
		in      TaxInput
		benefit string
	}{
		{
			name: "au_eleven_arbitrary_digits",
			in: TaxInput{
				Jurisdiction:      JurisdictionAU,
				NetAmount:         mustParse(t, "1000"),
				TaxCode:           "AU_GST_10",
				CounterpartyTaxID: "99999999999", // 11 digits, fails the ATO checksum
			},
			benefit: "47% No-ABN withholding avoided",
		},
		{
			name: "us_arbitrary_tin",
			in: TaxInput{
				Jurisdiction:      JurisdictionUS,
				NetAmount:         mustParse(t, "1000"),
				TaxCode:           "US_CONSUMER_USE_TAX_8_25",
				CounterpartyTaxID: "9999999999", // non-empty, not EIN/SSN shaped
			},
			benefit: "24% backup withholding avoided",
		},
		{
			name: "eu_arbitrary_vies_id",
			in: TaxInput{
				Jurisdiction:      JurisdictionEU,
				NetAmount:         mustParse(t, "1000"),
				TaxCode:           "EU_IC_REVERSE_CHARGE_20",
				CounterpartyTaxID: "NOTAVIESID", // no VIES member prefix
			},
			benefit: "VIES warning silenced",
		},
	} {
		_, err := EvaluateIndirectAndWithholdingTax(tc.in)
		if !errors.Is(err, ErrInvalidTaxIdentifier) {
			t.Errorf("%s: err = %v, want ErrInvalidTaxIdentifier (%s)", tc.name, err, tc.benefit)
		}
	}
}

// TestBL22_conforming_identifiers_still_work shows the fix did not close the
// legitimate paths: format-conforming identifiers keep the reference's
// outcomes (expected values from the reference run), and absent identifiers
// keep its conservative branches.
func TestBL22_conforming_identifiers_still_work(t *testing.T) {
	// A 20-digit fapiao code (the documented numeric format) still verifies.
	r := evaluate(t, TaxInput{Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "1000"),
		TaxCode: "CN_VAT_13", EInvoiceCode: "12345678901234567890"})
	assertMoney(t, "recoverable", r.RecoverableTaxAmount, "130.0000")

	// A checksum-valid ABN still avoids withholding.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "1000"),
		TaxCode: "AU_GST_10", CounterpartyTaxID: "51 824 753 556"})
	assertMoney(t, "wht", r.WithholdingTaxAmount, "0.0000")
	assertMoney(t, "payable", r.NetPayableToCounterparty, "1100.0000")

	// Absent identifiers keep the reference's conservative branches.
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionAU, NetAmount: mustParse(t, "1000"), TaxCode: "AU_GST_10"})
	assertMoney(t, "wht absent ABN", r.WithholdingTaxAmount, "517.0000")
	r = evaluate(t, TaxInput{Jurisdiction: JurisdictionCN, NetAmount: mustParse(t, "1000"), TaxCode: "CN_VAT_13"})
	assertMoney(t, "recoverable absent fapiao", r.RecoverableTaxAmount, "0.0000")
	if len(r.ComplianceWarnings) != 1 {
		t.Errorf("warnings = %v, want the unverified-fapiao warning", r.ComplianceWarnings)
	}
}

// TestValidateTaxIdentifier walks each jurisdiction's structured check.
func TestValidateTaxIdentifier(t *testing.T) {
	cases := []struct {
		j    Jurisdiction
		id   string
		want bool
	}{
		// AU: 11 digits plus the ATO checksum (weights sum mod 89 == 0).
		{JurisdictionAU, "51824753556", true},
		{JurisdictionAU, "53004085616", true},
		{JurisdictionAU, "51 824 753 556", true}, // spaces stripped, as the reference did
		{JurisdictionAU, "11111111111", false},   // length ok, checksum fails
		{JurisdictionAU, "51824753557", false},   // one digit off
		{JurisdictionAU, "5182475355", false},    // 10 digits
		{JurisdictionAU, "51824A75355", false},   // letter

		// CN: exactly 20 digits (Golden Tax IV fully digitalized e-invoice).
		{JurisdictionCN, "12345678901234567890", true},
		{JurisdictionCN, "ABCDEFGHIJKLMNOPQRST", false}, // the BL-22 scenario shape
		{JurisdictionCN, "1234567890123456789", false},  // 19 digits
		{JurisdictionCN, "123456789012345678901", false},

		// US: EIN or SSN shape.
		{JurisdictionUS, "12-3456789", true},
		{JurisdictionUS, "123-45-6789", true},
		{JurisdictionUS, "123456789", false},
		{JurisdictionUS, "12-345678", false},
		{JurisdictionUS, "123-456-7890", false},

		// EU/UK: VIES member prefix + uppercase alphanumeric national part.
		{JurisdictionEU, "DE123456789", true},
		{JurisdictionEU, "FR40303265045", true},
		{JurisdictionUK, "GB123456789", true},
		{JurisdictionUK, "XI123456789", true},
		{JurisdictionEU, "DE12", false},
		{JurisdictionEU, "US123456789", false}, // not a VIES member prefix
		{JurisdictionEU, "de123456789", false}, // lowercase prefix
		{JurisdictionEU, "DE1234567890123456", false},

		// HK/SG/CA branches read no identifiers; anything passes.
		{JurisdictionHK, "", true},
		{JurisdictionSG, "", true},
		{JurisdictionCA, "", true},
	}
	for _, c := range cases {
		err := validateTaxIdentifier(c.j, c.id)
		if c.want && err != nil {
			t.Errorf("validate(%s, %q) = %v, want valid", c.j, c.id, err)
		}
		if !c.want && !errors.Is(err, ErrInvalidTaxIdentifier) {
			t.Errorf("validate(%s, %q) = %v, want ErrInvalidTaxIdentifier", c.j, c.id, err)
		}
	}
}
