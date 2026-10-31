// Package posting ports the pure rules of backend/app/core/posting.py: the
// posting transition and its invariants (balance, period validation,
// reversal uniqueness).
//
// P1 (ADR-0002 §3). BL-01..04, BL-25 and BL-29 were already fixed in the
// Python reference and port as-is: one transaction for the persisted voucher
// snapshot, guarded persisted-state transitions with stale-write detection,
// atomic reversal relationships, and accounting-date/period cutoff
// validation. The P2 store adapter owns the transaction mechanics.
package posting
