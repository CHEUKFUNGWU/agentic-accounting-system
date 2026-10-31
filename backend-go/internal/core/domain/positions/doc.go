// Package positions ports the pure rules of backend/app/core/positions.py:
// position definitions, separation-of-duties boundaries and the one-person
// company mode (一人公司模式).
//
// P1 rules (ADR-0002 §3). Solo-mode qualification follows SRC-0028
// (confirmed 2026-10-30): a company is in solo mode while it has exactly one
// human principal; a second human principal automatically returns the
// company to maker-checker. Jurisdiction packs may tighten qualification,
// never relax it. The legacy auto-approve depth thresholds and confidence
// gating of the SoD guard port unchanged, labelled legacy pending REQ-0007
// (spec: golden parity is not control endorsement).
package positions
