package localization

import (
	"errors"
	"fmt"
	"strings"
)

// Tax-identifier validation — the BL-22 fail-closed fix.
//
// The 2026-10-21 business-logic audit (BL-22) recorded that the reference
// verified tax identifiers by string length: twenty arbitrary characters
// verified a Golden Tax fapiao and granted recoverable VAT 130 on a 1,000
// purchase. The reference's length tests also let eleven arbitrary digits
// avoid Australian 47% withholding and any non-empty string avoid US 24%
// backup withholding. This file is the Go-side fix per ADR-0002 D3: every
// identifier the engine reads must pass the structured offline check its
// jurisdiction genuinely supports, and a provided identifier that fails is
// an explicit error — never a silently granted benefit. Absent identifiers
// are not validated here; the engine routes absence to the reference's
// conservative branch (withholding applies, input VAT stays non-creditable).
//
// These are format/shape checks only. Live verification (Golden Tax
// registry, ATO ABN lookup, IRS TIN matching, VIES) is I/O and belongs to a
// later phase; until it exists, nothing beyond the checks below counts as
// verified.

// ErrInvalidTaxIdentifier reports a provided tax identifier that fails its
// jurisdiction's structured validation.
var ErrInvalidTaxIdentifier = errors.New("localization: tax identifier fails jurisdiction validation")

// validateTaxIdentifier checks a provided identifier against its
// jurisdiction's structured format. An empty identifier is absence, not
// failure — callers route absence to the conservative branch. HK, SG and CA
// branches read no identifiers in the reference, so they validate nothing.
func validateTaxIdentifier(j Jurisdiction, id string) error {
	if id == "" {
		return nil
	}
	switch j {
	case JurisdictionAU:
		return validateABN(id)
	case JurisdictionCN:
		return validateGoldenTaxFapiao(id)
	case JurisdictionUS:
		return validateUSTIN(id)
	case JurisdictionEU, JurisdictionUK:
		return validateVIESVATID(id)
	default:
		return nil
	}
}

// allDigits checks a plain ASCII digit run (possibly empty).
func allDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// abnWeights is the ATO ABN verification algorithm: subtract one from the
// first digit, weight all eleven digits, and the sum must be divisible by 89.
var abnWeights = [11]int64{10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19}

// validateABN checks an Australian Business Number: 11 digits passing the
// published ATO checksum. Spaces are stripped first, as the reference's
// length test did, so space-formatted ABNs keep working.
func validateABN(id string) error {
	digits := strings.ReplaceAll(id, " ", "")
	if len(digits) != 11 || !allDigits(digits) {
		return fmt.Errorf("%w: ABN must be 11 digits", ErrInvalidTaxIdentifier)
	}
	var sum int64
	for i := 0; i < 11; i++ {
		d := int64(digits[i] - '0')
		if i == 0 {
			d--
		}
		sum += d * abnWeights[i]
	}
	if sum%89 != 0 {
		return fmt.Errorf("%w: ABN fails the ATO checksum", ErrInvalidTaxIdentifier)
	}
	return nil
}

// validateGoldenTaxFapiao checks the fully digitalized e-invoice (Fapiao)
// number format: exactly 20 digits. This is the documented number shape the
// reference's length-20 test approximated; anything else fails closed.
func validateGoldenTaxFapiao(id string) error {
	if len(id) != 20 || !allDigits(id) {
		return fmt.Errorf("%w: Golden Tax IV fapiao code must be exactly 20 digits", ErrInvalidTaxIdentifier)
	}
	return nil
}

// validateUSTIN checks W-9 TIN shape: an EIN (NN-NNNNNNN) or an SSN
// (NNN-NN-NNNN). The reference exempted 24% backup withholding on any
// non-empty string; the TIN shape is the strongest offline check here.
func validateUSTIN(id string) error {
	if isEIN(id) || isSSN(id) {
		return nil
	}
	return fmt.Errorf("%w: TIN must be an EIN (NN-NNNNNNN) or SSN (NNN-NN-NNNN)", ErrInvalidTaxIdentifier)
}

func isEIN(s string) bool {
	if len(s) != 10 || s[2] != '-' {
		return false
	}
	return allDigits(s[:2]) && allDigits(s[3:])
}

func isSSN(s string) bool {
	if len(s) != 11 || s[3] != '-' || s[6] != '-' {
		return false
	}
	return allDigits(s[:3]) && allDigits(s[4:6]) && allDigits(s[7:])
}

// viesCountryPrefixes are the VAT identification prefixes VIES recognises:
// the EU-27 member codes, Greece's EL (with its GR legacy form), and the
// United Kingdom's GB and post-Brexit XI prefixes.
var viesCountryPrefixes = map[string]bool{
	"AT": true, "BE": true, "BG": true, "CY": true, "CZ": true,
	"DE": true, "DK": true, "EE": true, "EL": true, "ES": true,
	"FI": true, "FR": true, "GB": true, "GR": true, "HR": true,
	"HU": true, "IE": true, "IT": true, "LT": true, "LU": true,
	"LV": true, "MT": true, "NL": true, "PL": true, "PT": true,
	"RO": true, "SE": true, "SI": true, "SK": true, "XI": true,
}

// validateVIESVATID checks the offline shape of a VIES VAT registration: a
// member-country prefix plus an uppercase alphanumeric national part of 5 to
// 13 characters. Per-country national formats and the live VIES lookup are
// jurisdiction rule-pack work beyond the shape check possible offline.
func validateVIESVATID(id string) error {
	if len(id) < 7 || len(id) > 15 {
		return fmt.Errorf("%w: VAT ID length out of range", ErrInvalidTaxIdentifier)
	}
	if !viesCountryPrefixes[id[:2]] {
		return fmt.Errorf("%w: VAT ID prefix is not a VIES member code", ErrInvalidTaxIdentifier)
	}
	for i := 2; i < len(id); i++ {
		c := id[i]
		if !(c >= '0' && c <= '9' || c >= 'A' && c <= 'Z') {
			return fmt.Errorf("%w: VAT ID national part must be uppercase alphanumeric", ErrInvalidTaxIdentifier)
		}
	}
	return nil
}
