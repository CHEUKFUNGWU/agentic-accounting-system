package posting

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// This file ports the persisted-state transition guards of
// repository.save_journal and posting._mark_original_reversed — the BL-02
// remediation state. In the reference they guard conditional UPDATE
// statements inside row locks; here they are the pure decisions a P2 store
// adapter must apply as those same conditional writes:
//
//   - stale-write detection: the caller's revision must equal the persisted
//     row's (a missing revision is never an unconditional overwrite);
//   - finalized-field immutability: a POSTED/REVERSED/VOID row accepts only
//     a status-only write, and the sole status transition is POSTED→REVERSED;
//   - the save transition map for non-finalized rows, and the rule that only
//     posting may seal the hash fields;
//   - the original's revision-checked POSTED→REVERSED commit, which is part
//     of the posting transaction (BL-03).
//
// Both documents are journal-dict wire forms; the field comparison is the
// deep JSON equality of changedFields.

// SavePlan is the save guards' outcome: what the store writes and the row's
// next revision.
type SavePlan struct {
	// Insert marks a new row: the store adds it with revision 0. The
	// reference's insert path applies no status or field guard (that is
	// insert_draft's contract, a store-side helper).
	Insert bool `json:"insert"`
	// NextRevision is the row's revision after the write. Only the caller's
	// revision advances after commit.
	NextRevision int64 `json:"next_revision"`
	// StatusOnly marks the finalized branch: the store writes the status
	// column only, never any other field.
	StatusOnly bool           `json:"status_only"`
	Status     voucher.Status `json:"status"`
}

// sealFields are the columns only the posting engine may write
// (save_journal's guard tuple).
var sealFields = []string{"entry_hash", "prev_entry_hash", "block_index", "posted_at"}

// PlanSave ports save_journal's guards. current nil means the row does not
// exist: the write is an insert, refused when the submitted dict carries a
// revision key (the voucher the caller held no longer exists). Otherwise the
// submitted revision must equal the persisted one, and the status branch
// applies. The caller's dict is never mutated — the reference updates the
// caller's revision only after commit.
func PlanSave(current, submitted voucher.Snapshot) (SavePlan, error) {
	if current == nil {
		if docHasRevision(submitted) {
			return SavePlan{}, refusal(KindVoucherRevisionConflict,
				"Voucher no longer exists.")
		}
		return SavePlan{Insert: true, Status: docStatus(submitted)}, nil
	}
	currentRevision := docRevision(current)
	submittedRevision := docRevision(submitted)
	// Stale-write detection: a missing revision is None, which never equals
	// a persisted integer revision — never an unconditional overwrite.
	if currentRevision == nil || submittedRevision == nil || *submittedRevision != *currentRevision {
		return SavePlan{}, refusal(KindVoucherRevisionConflict,
			"Reload before saving.")
	}
	currentStatus := docStatus(current)
	proposedStatus := docStatus(submitted)
	if voucher.IsFinalized(currentStatus) {
		// The only finalized transition is a status-only reversal; any other
		// drift refuses with the same kind.
		if changed := changedFields(current, submitted, "status"); len(changed) > 0 {
			return SavePlan{}, refusal(KindVoucherImmutable,
				"Finalized fields cannot change.")
		}
		if proposedStatus == currentStatus ||
			(currentStatus == voucher.StatusPosted && proposedStatus == voucher.StatusReversed) {
			return SavePlan{
				NextRevision: *currentRevision + 1, StatusOnly: true, Status: proposedStatus,
			}, nil
		}
		return SavePlan{}, refusal(KindVoucherImmutable,
			"Finalized fields cannot change.")
	}
	if !voucher.CanSaveTransition(currentStatus, proposedStatus) {
		return SavePlan{}, refusal(KindVoucherStateConflict,
			"Use the posting engine to finalize.")
	}
	for _, key := range sealFields {
		a, aOK := docGet(current, key)
		b, bOK := docGet(submitted, key)
		if !aOK || !bOK || !jsonEqual(a, b) {
			return SavePlan{}, refusal(KindVoucherImmutable,
				"Only posting may seal a voucher.")
		}
	}
	return SavePlan{NextRevision: *currentRevision + 1, Status: proposedStatus}, nil
}

// MarkOriginalReversed ports posting._mark_original_reversed: the original
// leaves POSTED for REVERSED and takes the next revision, committed in the
// same transaction as the reversal's own seal (BL-03). The store applies it
// as the reference's conditional UPDATE (WHERE journal_id, entity_code,
// status='POSTED', revision=<read>); a zero-row update — the original moved
// under the caller — is this refusal.
func MarkOriginalReversed(original voucher.Voucher) (voucher.Voucher, error) {
	if original.Status != voucher.StatusPosted {
		return voucher.Voucher{}, &voucher.PostingError{
			Kind:    voucher.KindReversalConflict,
			Message: "original changed during approval. Reload before approval.",
		}
	}
	reversed := original
	reversed.Status = voucher.StatusReversed
	reversed.Revision = original.Revision + 1
	return reversed, nil
}
