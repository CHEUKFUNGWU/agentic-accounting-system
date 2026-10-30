package posting

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// Refusal kinds of the posting path. The frozen reference embeds them as
// message-prefixes on PostingError / JournalConflict strings; fixtures pin
// the kind, not the message text. The reversal kinds live in the voucher
// package (KindReversalInvalid, KindReversalConflict) and the snapshot kind
// is voucher.KindVoucherSnapshotChanged.
const (
	// KindPostingError — the generic posting refusal ("voucher has no
	// entity_code.", "voucher has no lines.").
	KindPostingError = "POSTING_ERROR"
	// KindCannotPost — the voucher is not in a postable state
	// (post_voucher's precondition).
	KindCannotPost = "CANNOT_POST"
	// KindCannotPostFinalized — repository.mark_posted's defense-in-depth
	// precondition on the seal itself.
	KindCannotPostFinalized = "CANNOT_POST_FINALIZED_JOURNAL"
	// KindVoucherRevisionConflict — stale-write detection (BL-02): the
	// revision the caller read no longer matches the persisted row.
	KindVoucherRevisionConflict = "VOUCHER_REVISION_CONFLICT"
	// KindVoucherImmutable — a finalized voucher's fields cannot change and
	// only posting may seal the hash fields.
	KindVoucherImmutable = "VOUCHER_IMMUTABLE"
	// KindVoucherStateConflict — the proposed transition is not in the save
	// map; "use the posting engine to finalize".
	KindVoucherStateConflict = "VOUCHER_STATE_CONFLICT"
	// KindCOAMissingAccount — a line's account is not on the chart.
	KindCOAMissingAccount = "COA_MISSING_ACCOUNT"
	// KindControlAccountIsolation — a sub-ledger control account touched by a
	// general journal entry.
	KindControlAccountIsolation = "CONTROL_ACCOUNT_ISOLATION_VIOLATION"
	// Review-decision kinds (mcp_roles._review_voucher's guards; verdict
	// validation is reviewer.validate_verdict).
	KindInvalidState            = "INVALID_STATE"
	KindInvalidVerdict          = "INVALID_VERDICT"
	KindReviewChecklistRequired = "REVIEW_CHECKLIST_REQUIRED"
	KindReasonRequired          = "REASON_REQUIRED"
)

// refusal builds a classified PostingError. The reference raises
// posting.PostingError and repository.JournalConflict on this path and the
// store adapter maps both the same way, so the port reuses the voucher
// package's PostingError type (its doc records that mapping). The message is
// the reference's user-facing text WITHOUT the kind prefix — Error() renders
// the prefix once, reproducing the reference's exception strings.
func refusal(kind, message string) error {
	return &voucher.PostingError{Kind: kind, Message: message}
}
