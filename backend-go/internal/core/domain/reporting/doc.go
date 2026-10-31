// Package reporting ports the pure rules of backend/app/core/reporting.py:
// the three statements, period anchoring, cash-flow classification and tax
// derivation.
//
// P1 rules with golden parity in P3 (ADR-0002 §3). Absorbed findings:
//
//   - BL-12: cash flows classify only actual cash legs; noncash movements
//     are excluded from the cash statement and disclosed instead.
//   - BL-13: unmapped statement categories block reporting instead of
//     silently disappearing (categories.go, versioned mapping).
//   - BL-17: the account-ledger projection preserves original and reversing
//     amounts in their respective periods (ledgerprojection.go); the ledger
//     package's parity version stays for P2 callers to choose.
//   - BL-18: compound entries allocate only the actual cash legs, never the
//     gross of the other side.
//   - BL-20 (interim fail-closed rule until REQ-0014): unsupported
//     jurisdictions are rejected explicitly — never a fabricated credit,
//     never a fallback to AU. The real transaction-derived tax engine stays
//     with REQ-0014.
//
// Period semantics follow BL-14 as decided (SRC-0027), implemented in the
// ledger package and consumed here (window.go): financial reports anchor to
// the fiscal calendar's monthly/quarterly/semi-annual/annual windows,
// management reports keep custom windows as read-only projections, and the
// income statement's P&L bands aggregate the window's activity — never the
// all-time openings the reference read. The balance sheet keeps positions.
//
// Surface, mirroring the module's sections:
//
//   - categories.go: the versioned fs-category mapping and the BL-13 gate.
//   - window.go: WindowRows over a date window; FinancialProjection and
//     ManagementProjection consuming ledger/fiscal.go.
//   - statements.go: the extended trial balance, the window figures, the
//     income statement, the balance sheet, the consistency checks.
//   - cashflow.go: entry-level cash classification and statement 3.
//   - ledgerprojection.go: the corrected account-ledger projection.
//   - tax.go: the statutory tax schedule, fail-closed by jurisdiction.
//   - decimal.go: the engine's exact-decimal helpers (28-digit division for
//     the margins, the display negation, the one-decimal percent render).
//
// Not ported at P1: the drill-down detail schedules, the close checklist,
// the compliance checks and the KPI summary — presentation scaffolding
// around hardcoded principal names, not accounting rules; P3 decides their
// shape with the golden parity of full statement output.
package reporting
