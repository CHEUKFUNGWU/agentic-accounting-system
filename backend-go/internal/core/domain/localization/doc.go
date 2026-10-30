// Package localization ports the pure rules of backend/app/core/localization.py:
// locale configuration and tax-identifier validation.
//
// P1 (ADR-0002 §3). Absorbs BL-22 (document length masquerading as tax
// verification): the Go implementation fails closed instead of granting
// recoverable VAT on string length alone. Golden fixtures come from the
// frozen Python reference; the BL-22 fix is an expected divergence with its
// own Go regression test.
package localization
