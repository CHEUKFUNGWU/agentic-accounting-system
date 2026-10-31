// Package voucher ports the pure rules of backend/app/core/vouchers.py: the
// voucher state machine and numbering.
//
// P1 (ADR-0002 §3). Absorbs BL-36 (owner decision SRC-0017, direction
// confirmed in SRC-0027): drafts get a separate draft ID; the voucher number
// is allocated only at posting under a unique constraint per entity and
// period, posted vouchers are numbered continuously, and gaps are
// reportable. The initial number format is the neutral default until the
// jurisdiction rule packs (REQ-0014 onward).
package voucher
