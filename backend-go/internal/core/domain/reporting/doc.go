// Package reporting ports the pure rules of backend/app/core/reporting.py:
// the three statements, period anchoring, cash-flow classification and tax
// derivation.
//
// P1 rules with golden parity in P3 (ADR-0002 §3). Absorbed findings:
//
//   - BL-12: cash flows classify only actual cash legs; noncash movements
//     are excluded from the cash statement.
//   - BL-13: unmapped statement categories block reporting instead of
//     silently disappearing.
//   - BL-17: reversals preserve both the original and the reversing amounts
//     in their respective periods.
//   - BL-18: compound entries allocate only the actual cash legs, never the
//     gross of the other side.
//   - BL-20 (interim fail-closed rule until REQ-0014): unsupported
//     jurisdictions are rejected explicitly — never a fabricated credit,
//     never a fallback to AU. The real transaction-derived tax engine stays
//     with REQ-0014.
//
// Period semantics follow BL-14 as decided (SRC-0027), implemented in the
// ledger package and consumed here.
package reporting
