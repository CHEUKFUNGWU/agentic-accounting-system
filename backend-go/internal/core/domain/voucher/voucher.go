package voucher

import (
	"sort"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file carries the voucher value types and the lifecycle state machine.
//
// The transition map is ported verbatim from repository.save_journal
// (backend/app/core/repository.py:404–409); the finalized-state rule above it
// is the same function's POSTED/REVERSED/VOID branch (lines 395–402), and the
// posting precondition is post_voucher (posting.py:208) plus
// repository.mark_posted (repository.py:818). Those guards live inside I/O
// functions in the frozen reference; here they are the pure rules a P2 store
// adapter must call before writing.

// Status is the voucher lifecycle state (sod_guard.JournalStatus, which the
// positions package ports) plus the terminal VOID state that
// repository.save_journal's transition map and api_vouchers' void endpoint
// add at the storage layer.
type Status = positions.JournalStatus

const (
	StatusDraft          = positions.JournalDraft
	StatusPendingChecker = positions.JournalPendingChecker
	StatusAwaitingCPA    = positions.JournalAwaitingCPA
	StatusPosted         = positions.JournalPosted
	StatusReversed       = positions.JournalReversed
	StatusRejected       = positions.JournalRejected

	// StatusVoid (作廢) is terminal: only a draft or rejected voucher can be
	// voided (api_vouchers.void_voucher), and a voided voucher has no way out
	// (save_journal's finalized branch accepts no transition away from VOID).
	StatusVoid Status = "VOID"
)

// Refusal kinds of the save path. The frozen reference embeds them as
// message-prefixes on JournalConflict/PostingError strings; fixtures pin the
// kind, not the message text.
const (
	// KindVoucherImmutable — a finalized voucher's fields cannot change;
	// only the status-only POSTED→REVERSED reversal may touch it.
	KindVoucherImmutable = "VOUCHER_IMMUTABLE"
	// KindVoucherStateConflict — the proposed transition is not in the map;
	// "use the posting engine to finalize".
	KindVoucherStateConflict = "VOUCHER_STATE_CONFLICT"
)

// saveTransitions mirrors repository.save_journal's transition map verbatim.
// POSTED is reachable only through the posting engine, never through a save.
var saveTransitions = map[Status][]Status{
	StatusDraft:          {StatusDraft, StatusPendingChecker, StatusVoid},
	StatusRejected:       {StatusRejected, StatusDraft, StatusPendingChecker, StatusVoid},
	StatusPendingChecker: {StatusPendingChecker, StatusAwaitingCPA, StatusRejected},
	StatusAwaitingCPA:    {StatusAwaitingCPA, StatusRejected},
}

// IsFinalized mirrors save_journal's finalized set: POSTED, REVERSED and VOID
// vouchers are immutable except for the status-only reversal.
func IsFinalized(s Status) bool {
	return s == StatusPosted || s == StatusReversed || s == StatusVoid
}

// AllowedSaveTransitions lists the statuses a save may move a voucher to,
// sorted (Python returns an unordered set; the sorted slice is the form the
// fixtures pin). Finalized states accept standing still, and POSTED accepts
// the status-only reversal; anything else is refused by CheckSave.
func AllowedSaveTransitions(current Status) []Status {
	out := []Status{}
	if IsFinalized(current) {
		out = append(out, current)
		if current == StatusPosted {
			out = append(out, StatusReversed)
		}
		return out
	}
	out = append(out, saveTransitions[current]...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// CanSaveTransition reports whether a save may move the voucher from current
// to proposed, ignoring field content. Use CheckSave for the full rule
// including the finalized content-freeze.
func CanSaveTransition(current, proposed Status) bool {
	if IsFinalized(current) {
		return proposed == current || (current == StatusPosted && proposed == StatusReversed)
	}
	for _, s := range saveTransitions[current] {
		if s == proposed {
			return true
		}
	}
	return false
}

// CheckSave mirrors save_journal's status guards: "" when the save may
// proceed, otherwise the refusal kind. contentChanged reports whether any
// non-status field differs from the persisted voucher; it is consulted only
// for finalized states (the reference computes it always but checks it only
// in the finalized branch) — a posted voucher that is edited in any way is
// refused with VOUCHER_IMMUTABLE; corrections go through a reversal.
func CheckSave(current, proposed Status, contentChanged bool) string {
	if IsFinalized(current) {
		if contentChanged {
			return KindVoucherImmutable
		}
		if proposed == current || (current == StatusPosted && proposed == StatusReversed) {
			return ""
		}
		return KindVoucherImmutable
	}
	if CanSaveTransition(current, proposed) {
		return ""
	}
	return KindVoucherStateConflict
}

// CanPost mirrors the posting precondition of post_voucher and
// mark_posted: only PENDING_CHECKER and AWAITING_CPA vouchers may be sealed
// by the posting engine.
func CanPost(current Status) bool {
	return current == StatusPendingChecker || current == StatusAwaitingCPA
}

// Voucher is the value type the pure rules read out of a voucher record (the
// journal dict of the reference). Fields mirror the Python code's reads;
// optional fields are pointers where the reference distinguishes None from a
// value. It is the draft record too: under BL-36 JournalID is the draft ID
// and VoucherNo stays nil until posting allocates the number.
type Voucher struct {
	JournalID  string // the draft ID (BL-36); the reference's journal_id
	Revision   int64
	EntityCode string
	// SourceModule is the producing flow ("AP", "GL_MANUAL", "REVERSAL", ...).
	SourceModule   string
	Status         Status
	AccountingDate string
	Currency       string
	Period         string
	// VoucherNo is nil until the posting transaction allocates it (BL-36).
	VoucherNo *string
	Memo      string
	// TotalDebit/TotalCredit are the voucher totals; the reversal rules
	// compare them numerically, like the reference's Decimal(str(...)).
	TotalDebit  money.Money
	TotalCredit money.Money
	Lines       []StoredLine
	// EntryLayer is OPENING/OPERATIONAL/AJE_MONTH_END/RJE_RECLASS/REVERSAL.
	// Empty means the reference's None: post_voucher defaults it to
	// OPERATIONAL before writing lines, and build_reversal_lines refuses an
	// original without one.
	EntryLayer string
	// ReversalOfJournalID is the linked original of a reversal draft; nil is
	// the reference's None.
	ReversalOfJournalID *string
}

// StoredLine is the canonical stored line shape of vouchers.parse_lines,
// plus the two functional amounts the reversal rules read from a reversal
// draft's lines (the reference reads them with .get-or-zero semantics, so
// they are zero for plain voucher lines). Amounts are exact decimals.
type StoredLine struct {
	LineNumber     int64
	AccountCode    string
	AccountName    string
	Debit          money.Money
	Credit         money.Money
	FuncDebit      money.Money
	FuncCredit     money.Money
	Memo           string
	Counterparty   string
	TaxCode        string
	BusinessUsePct string
}

// NewDraft starts a voucher under the BL-36 owner decision (SRC-0017): the
// draft carries only its draft ID and never a voucher number — the number is
// allocated at posting (AllocateVoucherNumber), so rejected or voided drafts
// cannot leave gaps in the posted sequence.
func NewDraft(draftID, entityCode string) Voucher {
	return Voucher{JournalID: draftID, EntityCode: entityCode, Status: StatusDraft}
}
