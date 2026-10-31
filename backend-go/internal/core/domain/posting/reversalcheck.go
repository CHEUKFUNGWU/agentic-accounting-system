package posting

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// This file ports posting._reversal_original's decision sequence. The value
// rules (link required, malformed draft lines, same-entity original, no
// reversal of a reversal, original still POSTED, currency/totals mirror)
// live in voucher.ValidateReversal — wired, not copied. What the reference
// adds around it:
//
//   - the no-link short circuit: with no reversal_of_journal_id the sequence
//     returns "not a reversal" (or refuses a REVERSAL-source voucher)
//     BEFORE any draft-line parsing, so the port does too;
//   - the effective-reversal existence check (the BL-03 uniqueness
//     enforcement) is a store query in the reference; its answer arrives as
//     EffectiveReversalOf and sits between the status check and the
//     mirror check, exactly where the reference raises it.

// ResolveReversalOriginal runs _reversal_original over values. original is
// the loaded original row (nil when the store found nothing for the link —
// the value rules cannot tell that from a cross-entity link, as in the
// reference). It returns the validated original, or nil without error when
// the voucher is not a reversal at all.
func ResolveReversalOriginal(current Journal, original *Journal, effectiveReversalOf map[string]bool) (*Journal, error) {
	link := current.ReversalOfJournalID
	if link == nil || *link == "" {
		// No link: the reference refuses a REVERSAL-source voucher or
		// reports "not a reversal" before parsing any draft lines. The
		// conversion to the voucher value type parses amounts, so it must
		// not run on this branch.
		if current.SourceModule == "REVERSAL" {
			return nil, &voucher.PostingError{
				Kind:    voucher.KindReversalInvalid,
				Message: "reversal must link an original voucher.",
			}
		}
		return nil, nil
	}
	// Reversal path: the reference parses and validates the draft's lines
	// here; an unparsable amount is the reference's malformed-lines refusal
	// (its except-clause around the line checks).
	cur, err := toVoucher(current)
	if err != nil {
		return nil, malformedReversalLines()
	}
	// voucher.ValidateReversal runs the mirror check (currency/totals) ahead
	// of the reference's effective-reversal check. Mask the totals on a copy
	// so the shared call cannot fire the mirror refusal, then compare in the
	// reference's position below. The mask is a value copy — no input
	// mutation.
	masked := cur
	if original != nil {
		masked.Currency = original.Currency
		masked.TotalDebit = original.TotalCredit
		masked.TotalCredit = original.TotalDebit
	}
	var origV *voucher.Voucher
	if original != nil {
		orig, err := toVoucher(*original)
		if err != nil {
			// The original is a persisted posted row; unparsable amounts are
			// corruption outside the value rules.
			return nil, err
		}
		origV = &orig
	}
	validated, err := voucher.ValidateReversal(masked, origV)
	if err != nil || validated == nil {
		return nil, err
	}
	if original == nil {
		// Unreachable: a linked draft without a loaded original is refused
		// above ("original not found in this entity").
		return nil, malformedReversalLines()
	}
	if effectiveReversalOf[*link] {
		return nil, &voucher.PostingError{
			Kind:    voucher.KindReversalConflict,
			Message: "original already has a posted reversal.",
		}
	}
	if current.Currency != original.Currency ||
		!current.TotalDebit.Equal(original.TotalCredit) ||
		!current.TotalCredit.Equal(original.TotalDebit) {
		return nil, &voucher.PostingError{
			Kind:    voucher.KindReversalInvalid,
			Message: "currency and totals must mirror the original.",
		}
	}
	return original, nil
}

func malformedReversalLines() error {
	return &voucher.PostingError{
		Kind:    voucher.KindReversalInvalid,
		Message: "malformed reversal lines.",
	}
}
