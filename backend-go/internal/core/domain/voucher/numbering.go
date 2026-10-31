package voucher

import (
	"fmt"
)

// This file is the BL-36 numbering rules. There is no Python implementation:
// this is the owner-decided NEW behaviour, recorded in
// 07-reviews/2026-10-21-ais-textbook-gap-review.md (BL-36, owner decision
// 2026-10-21, SRC-0017) and 01-inputs/2026-10-24-bl14-bl31-bl36-decisions.md
// (SRC-0027, direction confirmed 2026-10-24).
//
// The defected reference behaviour is NOT ported: vouchers.next_voucher_no
// (and its voucher_prefix helper) allocated the number at draft creation by
// scanning for the lowest unused number — three concurrent drafts all drew
// 記-2026-10-0001, rejected drafts left permanent gaps in the posted
// sequence, nothing reported the gaps, and voucher_no carried an index but
// no unique constraint. The owner replaced it: drafts use a separate draft
// ID (the journal_id), the voucher number is allocated only at posting under
// a unique constraint per entity and period, posted vouchers are numbered
// continuously, and gaps are reportable. Golden fixtures deliberately
// exclude next_voucher_no scenarios.
//
// The allocation mechanics (the row lock inside the posting transaction, the
// unique index) are store work (P2). What is pure and lives here: the number
// format, the allocation stamp that refuses double allocation, and the gap
// report.

// Voucher-number refusal kinds of this port's new behaviour.
const (
	// KindVoucherNumberInvalid — no number can be derived (malformed period,
	// non-positive sequence, wrong status for allocation).
	KindVoucherNumberInvalid = "VOUCHER_NUMBER_INVALID"
	// KindVoucherNumberAlreadyAllocated — a number is being stamped onto a
	// voucher that already carries one; the pure shadow of the per-entity
	// and-period unique constraint (P2 store).
	KindVoucherNumberAlreadyAllocated = "VOUCHER_NUMBER_ALREADY_ALLOCATED"
	// KindGapReportInvalid — the posted-number list violates its contract
	// (unsorted, duplicated, non-positive); corrupted state, never silently
	// reported around.
	KindGapReportInvalid = "VOUCHER_GAP_REPORT_INVALID"
)

// NumberError is a BL-36 refusal (no Python exception mirrors it).
type NumberError struct {
	Kind    string
	Message string
}

func (e *NumberError) Error() string { return e.Kind + ": " + e.Message }

// FormatVoucherNumber renders the voucher number for a posted voucher.
//
// NEUTRAL DEFAULT (SRC-0027): "JV-<year>-<sequence>", sequence zero-padded
// to four digits — a prefix-year-sequence form with no jurisdictional
// connotation. The Mainland 記-XXX monthly-continuous styles and the other
// jurisdiction formats ship as per-jurisdiction defaults in the rule packs
// (REQ-0014 onward), which REPLACE this function; nothing else may special-
// case the format.
//
// entityCode is part of the signature because jurisdiction packs may embed
// it and because uniqueness is scoped per entity and period; the neutral
// default does not render it. period is the fiscal period ("YYYY-MM"
// monthly or "YYYY-Qn" quarterly, as the posting rules guarantee); the
// neutral default renders the year it starts with.
func FormatVoucherNumber(entityCode, period string, sequence int64) (string, error) {
	if sequence < 1 {
		return "", &NumberError{Kind: KindVoucherNumberInvalid,
			Message: "voucher number sequence must be positive"}
	}
	if !periodHasYear(period) {
		return "", &NumberError{Kind: KindVoucherNumberInvalid,
			Message: "voucher number needs a period starting YYYY-MM or YYYY-Qn"}
	}
	return fmt.Sprintf("JV-%s-%04d", period[:4], sequence), nil
}

// periodHasYear checks the fiscal-period forms the posting rules guarantee:
// a four-digit year followed by "-MM" or "-Qn".
func periodHasYear(period string) bool {
	if len(period) <= 5 || period[4] != '-' {
		return false
	}
	for i := 0; i < 4; i++ {
		if period[i] < '0' || period[i] > '9' {
			return false
		}
	}
	return true
}

// AllocateVoucherNumber stamps the posted voucher with its number: the pure
// step the posting transaction performs after the store assigns the next
// continuous sequence for (entity, period) under its unique constraint. It
// refuses a second allocation (the pure shadow of that constraint) and an
// unposted voucher (numbers exist only on posted vouchers, so rejected and
// voided drafts cannot leave gaps).
func AllocateVoucherNumber(v Voucher, sequence int64) (Voucher, error) {
	if v.VoucherNo != nil {
		return Voucher{}, &NumberError{Kind: KindVoucherNumberAlreadyAllocated,
			Message: "voucher already carries a voucher number"}
	}
	if v.Status != StatusPosted {
		return Voucher{}, &NumberError{Kind: KindVoucherNumberInvalid,
			Message: "voucher numbers are allocated only at posting"}
	}
	no, err := FormatVoucherNumber(v.EntityCode, v.Period, sequence)
	if err != nil {
		return Voucher{}, err
	}
	v.VoucherNo = &no
	return v, nil
}

// ReportGaps is the BL-36 gap report: given the sorted posted sequence
// numbers of ONE entity and period, it returns the sequences missing from
// 1..max — the audit finding the reference never produced ("chapter 10
// sequence checks"). Posted vouchers are numbered continuously under the
// owner decision, so a non-empty gap list means corrupted or manually
// altered history: report it, never renumber around it.
//
// The input must be sorted ascending, free of duplicates, and positive; the
// store's unique constraint (P2) upholds the first two for honest data, and
// a violation fails closed instead of producing a misleading report.
func ReportGaps(posted []int64) ([]int64, error) {
	prev := int64(0)
	for _, n := range posted {
		if n <= prev {
			return nil, &NumberError{Kind: KindGapReportInvalid,
				Message: "posted numbers must be sorted, distinct and positive"}
		}
		prev = n
	}
	gaps := []int64{}
	next := int64(1)
	for _, n := range posted {
		for next < n {
			gaps = append(gaps, next)
			next++
		}
		next = n + 1
	}
	return gaps, nil
}
