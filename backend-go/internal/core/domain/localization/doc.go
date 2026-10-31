// Package localization ports the pure rules of backend/app/core/localization.py:
// the six-region indirect/withholding tax engine (AU, CN, SG, HK, US, EU/UK,
// with CA as the documented zeroed fallthrough) and the IFRS 16 vs. ASC 842
// parallel-book lease entries.
//
// Port map, module for module (localization.py → this package):
//
//	q4                                        → Q4 (explicit money.RoundHalfUp; no global default)
//	Jurisdiction, AccountingStandard          → Jurisdiction, AccountingStandard + Parse functions
//	TaxCalculationResult                      → TaxCalculationResult (Python field names as JSON tags)
//	ParallelBookDelta                         → ParallelBookDelta, BookEntry
//	GlobalLocalizationEngine.evaluate_…       → EvaluateIndirectAndWithholdingTax(TaxInput)
//	GlobalLocalizationEngine.compute_lease_…  → ComputeLeaseIFRS16VsASC842Delta
//	(none — Python inherits decimal-context   → money.Mul / money.Div carry the 28-significant-digit
//	  multiply rounding from the interpreter)   context arithmetic
//	(none — the reference trusted identifier  → tax_identifier.go: validateTaxIdentifier, the BL-22
//	  length as verification)                  fail-closed fix
//
// BL-22 (2026-10-21 business-logic audit, fixed test-first per ADR-0002 D3):
// the reference "verified" tax identifiers by string length — twenty
// arbitrary characters granted recoverable VAT 130 on a 1,000 purchase. The
// Go engine fails closed: a provided identifier must pass its jurisdiction's
// structured format check or evaluation returns ErrInvalidTaxIdentifier; an
// absent identifier keeps the reference's conservative branch (withholding
// applies, input VAT stays non-creditable). Live registry verification
// (Golden Tax, ATO ABN lookup, IRS TIN matching, VIES) is I/O and belongs to
// a later phase; the format checks here are the strongest offline validation,
// not a claim of registry verification. BL-22 scenarios are excluded from the
// golden baseline and carry the TestBL22_tax_identifier_fail_closed
// regression test instead.
//
// Pure functions only: no I/O, no clocks, no randomness. Every amount is
// internal/core/money.Money; money crosses JSON as strings. The I/O-coupled
// callers of the reference module (MCP tools, ledger tax-code seeds) belong
// to later phases. Golden fixtures are generated from the frozen Python
// reference by backend-go/tools/gen_localization.py.
package localization
