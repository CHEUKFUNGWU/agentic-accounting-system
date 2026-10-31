// Package workflow ports the pure rules of backend/app/core/monolith.py: the
// Monolith money workflows — bills, bank, assets, provisions.
//
// P1 (ADR-0002 §3). Absorbed findings (each pinned by a Go regression test;
// the defect scenarios are excluded from the golden fixture baseline
// entirely, so fixtures/divergences.yaml carries no entry for this module):
//
//   - BL-09: bank exception handling must match existing candidates, not
//     double-settle.
//   - BL-10: control-account postings respect subledger allocations or are
//     rejected.
//   - BL-11: depreciation requires a validated capitalization link.
//   - BL-21: provision inputs freeze after posting (or a linked adjustment
//     workflow).
//   - BL-32: duplicate bills rejected on vendor/invoice/amount/date, with a
//     recorded, reviewable override.
//   - BL-33: bills support a void transition that reverses through the
//     correction workflow with an audit link.
//   - BL-34: document date and accounting date are separate and validated
//     against open periods (control C04; late documents route to
//     correction, never the first-of-month default).
//   - BL-35: receivable aging derives from due date at query time, not a
//     stored static bucket.
//   - BL-27: exact decimal end to end — money crosses JSON as strings; the
//     float64 conversion bug does not exist here by construction.
//   - BL-31 (rules part, with SRC-0028 solo mode): bills record creator and
//     approver; non-solo companies reject creator self-approval and keep
//     payment/bank-reconciliation segregated; solo-mode self-approvals are
//     recorded and flagged. The enforcement wall sits in mcproles (P4).
//
// Not ported at P1 — the pure decisions above are the module; the storage
// lives at the P2 store seam:
//
//   - append_entry's state mutation, the ledger-cash-item derivation for 1010
//     movements and the CLS-03 reopen; execute_command's revision check,
//     idempotency receipts, authorization and audit hash chain (the entry ID
//     and actor arrive as arguments instead);
//   - apply_command's dispatch itself (close.checklist, close.amortize,
//     period.lock/unlock, agent.resolve, preferences, budget, forecast) and
//     monolith trial_balance: period close belongs to the ledger package
//     (ClosePeriod), balances to the ledger's TrialBalance, and the command
//     service is the P2 composition of this package's rules;
//   - the seeded workspace (monolith_seed.json): a store concern; the rules
//     read value types.
package workflow
