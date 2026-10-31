// Package ledger ports the pure rules of backend/app/core/ledger.py: chart
// of accounts, fiscal periods, balances and carry-forward.
//
// P1 (ADR-0002 §3). Absorbs BL-14 (owner-confirmed period semantics,
// SRC-0027): management reports take custom periods as read-only projections
// that never bypass period locks; financial reports are limited to
// monthly/quarterly/semi-annually/annually and anchor to fiscal_periods
// state, with "annually" meaning the entity's fiscal year. Also absorbs
// BL-30 (no implicit counterparty creation from document intake; creation is
// explicit and authorized).
package ledger
