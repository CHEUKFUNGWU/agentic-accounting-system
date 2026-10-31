// Package voucher ports the pure rules of backend/app/core/vouchers.py: the
// voucher state machine and numbering.
//
// Ported here, one file per concern (the sections of the Python module and
// the lifecycle rules the reference carries next to it):
//
//   - validation.go — vouchers.py money helper (q4), account
//     classification (normal_balance, contra-credit and control categories),
//     structural line validation (parse_lines), balance (assert_balanced)
//     and the adaptation to the SoD guard's ProposedLine
//     (to_proposed_lines, with the guard types living in the positions
//     package).
//   - voucher.go — the voucher lifecycle state machine: the save-transition
//     map of repository.save_journal, the finalized-state rule above it, the
//     posting precondition of post_voucher/mark_posted, and the value types
//     (Voucher, StoredLine) the rules read.
//   - reversal.go — posting.build_reversal_lines as a pure function over
//     persisted ledger rows, plus the value rules of posting._reversal_original
//     and posting._validate_reversal_lines (the BL-03 mirror semantics).
//   - snapshot.go — the submitted-snapshot guard of post_voucher: reviewers
//     may change review metadata, never the submitted accounting snapshot.
//   - numbering.go — BL-36 (owner decision SRC-0017, direction confirmed in
//     SRC-0027): drafts get a separate draft ID; the voucher number is
//     allocated only at posting under a unique constraint per entity and
//     period; the neutral default number format and the pure gap report.
//
// Deliberately NOT ported here:
//
//   - vouchers.next_voucher_no — the defected behaviour (BL-36): numbers
//     allocated at draft creation leave gaps when drafts are rejected or
//     voided, and the lowest-unused scan races under concurrency. Ported
//     nowhere; see numbering.go for the owner decision that replaces it.
//   - attachments (save_attachment, attachment_file) — content-addressed
//     file I/O; a store-adapter concern (P2).
//   - chart_of_accounts / account_map / account_ledger / trial_balance —
//     repository I/O; the derived-ledger rules belong to
//     internal/core/domain/reporting per the REQ-0035 module map.
//   - summarise — API response shaping, not a rule; stays with the REST/MCP
//     adapters.
//   - new_journal_id (uuid4) and today (clock) — I/O; IDs and time arrive as
//     arguments.
//   - transactions.py is a 13-line SQLAlchemy session helper — nothing pure
//     to port: transaction session joining is a P2 store-adapter concern.
//
// P1 (ADR-0002 §3). Absorbs BL-36 (owner decision SRC-0017, direction
// confirmed in SRC-0027): drafts get a separate draft ID; the voucher number
// is allocated only at posting under a unique constraint per entity and
// period, posted vouchers are numbered continuously, and gaps are
// reportable. The initial number format is the neutral default until the
// jurisdiction rule packs (REQ-0014 onward).
package voucher
