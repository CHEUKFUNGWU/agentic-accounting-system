// Package posting ports the pure rules of backend/app/core/posting.py: the
// posting transition and its invariants (balance, period validation,
// reversal uniqueness).
//
// P1 (ADR-0002 §3). BL-01..04, BL-25 and BL-29 were already fixed in the
// Python reference and port as-is: one transaction for the persisted voucher
// snapshot, guarded persisted-state transitions with stale-write detection,
// atomic reversal relationships, and accounting-date/period cutoff
// validation. The P2 store adapter owns the transaction mechanics.
//
// # P1/P2 boundary
//
// post_voucher is one database transaction: chart/period validation, ledger
// line writes, review metadata, sealing, chain allocation and the original's
// reversal commit commit or roll back together (BL-01). The transaction
// itself is P2 store work. What is pure and lives here:
//
//   - Plan (sequence.go) runs post_voucher's decision sequence over values
//     in the reference's order and returns the Plan the store applies inside
//     that one transaction. It computes everything the transaction writes —
//     the projected ledger rows, the seal patch, the original's REVERSED
//     patch, the chain position — and refuses before any of it when the
//     reference refuses.
//   - Every decision function is all-or-nothing at the value level: it
//     returns the new state, never mutates its inputs, and has no partial
//     effects. A failed posting leaves no partial state because nothing is
//     applied until the store commits the whole plan.
//   - ChainHead (chain.go) is the BL-25 allocation decision: the next block
//     index and parent hash derive from the entity's current head, INCLUDING
//     sealed reversed vouchers. The store serializes it per entity (the
//     reference's BEGIN IMMEDIATE / entity row lock).
//   - PlanSave and MarkOriginalReversed (transition.go) are the BL-02
//     persisted-state guards: revision-checked conditional transitions,
//     finalized-field immutability, the status-only POSTED→REVERSED
//     transition, and stale-write detection (revision mismatch = conflict).
//
// What stays with the P2 store adapter (queries and locks in the reference):
// the entity and voucher existence lookups (ENTITY_NOT_FOUND,
// VOUCHER_NOT_FOUND — the sequence receives the loaded row), the row locks,
// BEGIN IMMEDIATE, the effective-reversal existence query (its answer
// arrives as Input.EffectiveReversalOf), line_id generation, and the BL-36
// voucher-number allocation (voucher.AllocateVoucherNumber, an owner-decided
// rule with no reference behaviour to mirror).
//
// Excluded on purpose: unpost_voucher (the legacy compensating-deletion
// helper — atomic posting never uses it) and BL-29 datetime normalization
// (a persistence-boundary concern; timestamps cross as strings).
package posting
