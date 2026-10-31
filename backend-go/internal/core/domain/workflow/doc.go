// Package workflow ports the pure rules of backend/app/core/monolith.py: the
// Monolith money workflows — bills, bank, assets, provisions.
//
// P1 (ADR-0002 §3). Absorbed findings (each with a Go regression test, its
// scenario an expected divergence from the golden baseline):
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
package workflow
