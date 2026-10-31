package posting

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// The invariant essence of the reference's own posting tests, re-expressed at
// the pure level. Reference sources (expected values come from them, never
// from this port):
//
//   - backend/tests/test_atomic_posting.py: failure rolls everything back
//     (the pure shadow: decision functions never mutate their inputs);
//     success and repeated approval; changed submitted snapshots; validation
//     refusals; the chain extending over a reversed head.
//   - backend/tests/test_journal_concurrency.py: stale writes conflict,
//     finalized fields are immutable, the status-only POSTED→REVERSED
//     transition preserves the seal.
//   - backend/tests/test_duplicate_reversal.py: one effective reversal,
//     reversing a posted reversal refused, the original's guarded commit.
//
// The world values mirror the reference tests: entity AU-OPC-01, accounts
// 6100/1110, totals 100.0000, date 2026-10-15 in period 2026-10.

func testDoc() voucher.Snapshot {
	doc := voucher.Snapshot{}
	set := func(k string, v any) {
		b, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		doc[k] = b
	}
	set("journal_id", "j-1")
	set("revision", 0)
	set("entity_code", "AU-OPC-01")
	set("source_module", "MANUAL")
	set("status", "PENDING_CHECKER")
	set("accounting_date", "2026-10-15")
	set("currency", "AUD")
	set("period", "2026-10")
	set("total_debit", "100.0000")
	set("total_credit", "100.0000")
	set("created_by_principal_id", "11111111-1111-1111-1111-111111111111")
	set("entry_layer", "OPERATIONAL")
	set("review_notes", "prior review")
	set("lines", []map[string]any{
		{"line_number": 1, "account_code": "6100", "debit": "100.0000", "credit": "0.0000"},
		{"line_number": 2, "account_code": "1110", "debit": "0.0000", "credit": "100.0000"},
	})
	return doc
}

// testChart seeds the two accounts the reference's posting tests create.
func testChart() []ledger.Account {
	return []ledger.Account{
		{AccountID: "AU-OPC-01:1110", AccountCode: "1110", AccountName: "1110",
			AccountType: "ASSET", NormalBalance: "DEBIT", FSCategory: "OPEX",
			StatementRef: "TB", CashFlowActivity: "OPERATING_WC",
			IsControlAccount: false, AllowManualJE: true, IsActive: true},
		{AccountID: "AU-OPC-01:6100", AccountCode: "6100", AccountName: "6100",
			AccountType: "EXPENSE", NormalBalance: "DEBIT", FSCategory: "OPEX",
			StatementRef: "TB", CashFlowActivity: "OPERATING_WC",
			IsControlAccount: false, AllowManualJE: true, IsActive: true},
	}
}

func testInput(t *testing.T) Input {
	t.Helper()
	doc := testDoc()
	journal, err := ParseJournal(doc)
	if err != nil {
		t.Fatalf("parse journal: %v", err)
	}
	return Input{
		Submitted:  cloneDoc(doc),
		CurrentDoc: doc,
		Current:    journal,
		Chart:      testChart(),
		Approver:   Approver{PrincipalID: "checker-id", PrincipalKey: "checker"},
		PostedAt:   "<POSTED_AT>",
	}
}

func cloneDoc(doc voucher.Snapshot) voucher.Snapshot {
	out := make(voucher.Snapshot, len(doc))
	for k, v := range doc {
		out[k] = append(json.RawMessage(nil), v...)
	}
	return out
}

// docSet returns a copy of doc with one field replaced.
func docSet(t *testing.T, doc voucher.Snapshot, field string, value any) voucher.Snapshot {
	t.Helper()
	out := cloneDoc(doc)
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal %s: %v", field, err)
	}
	out[field] = b
	return out
}

// reparse rebuilds the typed view after a document change, keeping the two
// views of the persisted row consistent.
func reparse(t *testing.T, in Input, doc voucher.Snapshot) Input {
	t.Helper()
	journal, err := ParseJournal(doc)
	if err != nil {
		t.Fatalf("parse journal: %v", err)
	}
	in.CurrentDoc = doc
	in.Submitted = cloneDoc(doc)
	in.Current = journal
	return in
}

func copyInput(t *testing.T, in Input) Input {
	t.Helper()
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	var out Input
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal input: %v", err)
	}
	return out
}

func wantKind(t *testing.T, err error, kind string) {
	t.Helper()
	if err == nil {
		t.Fatalf("want %s refusal, got success", kind)
	}
	// Classify through the replay's own mapping, so the tests assert the
	// kinds the harness pins.
	if got := fixture.ErrorKind(fixtureKind(err)); got != kind {
		t.Fatalf("refusal kind = %q, want %q (err: %v)", got, kind, err)
	}
}

// TestPlanNeverMutatesInputs pins the pure-level consequence of the
// reference's transactional rollback (test_atomic_posting's
// test_failure_rolls_back_everything): the decision functions return the new
// state and never touch their inputs — a failed posting has no partial
// effects because nothing is applied until the store commits the whole plan.
func TestPlanNeverMutatesInputs(t *testing.T) {
	in := testInput(t)
	before := copyInput(t, in)
	if _, err := Plan(in); err != nil {
		t.Fatalf("plan: %v", err)
	}
	if !reflect.DeepEqual(in, before) {
		t.Fatal("successful Plan mutated its input")
	}

	// The refusal path too: a drifted submitted snapshot refuses and the
	// world stays exactly as the caller left it.
	refused := testInput(t)
	refused.Submitted = docSet(t, refused.Submitted, "memo", "changed")
	refusedBefore := copyInput(t, refused)
	if _, err := Plan(refused); err == nil {
		t.Fatal("want snapshot-changed refusal")
	}
	if !reflect.DeepEqual(refused, refusedBefore) {
		t.Fatal("refused Plan mutated its input")
	}
}

// TestRepeatApprovalIsNoOpConflict ports test_success_and_repeated_approval:
// a POSTED voucher refuses with CANNOT_POST and nothing else moves.
func TestRepeatApprovalIsNoOpConflict(t *testing.T) {
	in := testInput(t)
	in = reparse(t, in, docSet(t, in.CurrentDoc, "status", "POSTED"))
	before := copyInput(t, in)
	_, err := Plan(in)
	wantKind(t, err, "CANNOT_POST")
	if !reflect.DeepEqual(in, before) {
		t.Fatal("repeat approval mutated the input state")
	}
}

// TestChangedSubmittedSnapshotRefuses ports
// test_rejects_changed_submitted_snapshot: any drift in a snapshot field
// refuses the approval with VOUCHER_SNAPSHOT_CHANGED before any effect.
func TestChangedSubmittedSnapshotRefuses(t *testing.T) {
	for _, field := range []string{"entity_code", "total_debit", "period",
		"created_by_principal_id", "revision", "memo"} {
		t.Run(field, func(t *testing.T) {
			in := testInput(t)
			submitted := cloneDoc(in.Submitted)
			value := any("changed")
			if field == "revision" {
				value = 99
			}
			submitted[field] = marshalFor(t, value)
			in.Submitted = submitted
			_, err := Plan(in)
			wantKind(t, err, voucher.KindVoucherSnapshotChanged)
		})
	}
	// A changed line amount is a snapshot change too (the reference mutates
	// lines[0].debit).
	in := testInput(t)
	submitted := cloneDoc(in.Submitted)
	var lines []map[string]any
	if err := json.Unmarshal(submitted["lines"], &lines); err != nil {
		t.Fatal(err)
	}
	lines[0]["debit"] = "200.0000"
	submitted["lines"] = marshalFor(t, lines)
	in.Submitted = submitted
	_, err := Plan(in)
	wantKind(t, err, voucher.KindVoucherSnapshotChanged)
}

func marshalFor(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestStaleWriteConflicts ports test_journal_concurrency's stale-write
// cases: a revision mismatch is a conflict even with no state change to
// make, a missing revision is never an unconditional overwrite, and a new
// row whose dict carries a revision means the voucher no longer exists.
func TestStaleWriteConflicts(t *testing.T) {
	current := docSet(t, testDoc(), "revision", 1)
	stale := docSet(t, current, "revision", 0)
	stale = docSet(t, stale, "memo", "another edit")
	if _, err := PlanSave(current, stale); err == nil {
		t.Fatal("want revision conflict")
	} else {
		wantKind(t, err, KindVoucherRevisionConflict)
	}

	missing := cloneDoc(current)
	delete(missing, "revision")
	_, err := PlanSave(current, missing)
	wantKind(t, err, KindVoucherRevisionConflict)

	_, err = PlanSave(nil, docSet(t, testDoc(), "revision", 0))
	wantKind(t, err, KindVoucherRevisionConflict)
}

// TestFinalizedFieldsImmutable ports
// test_finalized_fields_are_immutable_even_during_reversal: no field of a
// POSTED row may change except the status, and the only status move is the
// status-only POSTED→REVERSED reversal.
func TestFinalizedFieldsImmutable(t *testing.T) {
	posted := testDoc()
	posted = docSet(t, posted, "status", "POSTED")
	posted = docSet(t, posted, "revision", 2)
	posted = docSet(t, posted, "entry_hash", strings.Repeat("a", 64))
	posted = docSet(t, posted, "prev_entry_hash", "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000")
	posted = docSet(t, posted, "block_index", 1)
	posted = docSet(t, posted, "posted_at", "2026-10-31T00:00:00+00:00")

	// (A drifted revision is the stale-write path, refused as
	// VOUCHER_REVISION_CONFLICT before the finalized branch — covered by
	// TestStaleWriteConflicts.)
	for _, field := range []string{"total_debit", "total_credit", "memo",
		"evidence_uris", "review_notes", "created_by_principal_id",
		"entry_hash", "block_index", "posted_at"} {
		t.Run(field, func(t *testing.T) {
			submitted := cloneDoc(posted)
			value := any("changed")
			if field == "block_index" {
				value = 999
			}
			if field == "posted_at" {
				value = "2026-11-01T00:00:00+00:00"
			}
			submitted[field] = marshalFor(t, value)
			_, err := PlanSave(posted, submitted)
			wantKind(t, err, KindVoucherImmutable)
		})
	}
	// The status change to REJECTED is refused with the same kind: the only
	// finalized transition is the status-only reversal.
	submitted := docSet(t, posted, "status", "REJECTED")
	_, err := PlanSave(posted, submitted)
	wantKind(t, err, KindVoucherImmutable)
}

// TestStatusOnlyReversalAllowed ports
// test_status_only_reversal_preserves_seal_and_financial_fields: the
// legitimate POSTED→REVERSED move is a status-only write that advances the
// revision and keeps the seal.
func TestStatusOnlyReversalAllowed(t *testing.T) {
	posted := testDoc()
	posted = docSet(t, posted, "status", "POSTED")
	posted = docSet(t, posted, "revision", 2)
	submitted := docSet(t, posted, "status", "REVERSED")
	plan, err := PlanSave(posted, submitted)
	if err != nil {
		t.Fatalf("status-only reversal: %v", err)
	}
	if !plan.StatusOnly || plan.Status != voucher.StatusReversed || plan.NextRevision != 3 {
		t.Fatalf("plan = %+v, want status-only REVERSED at revision 3", plan)
	}
}

// TestReversalOfReversalRefused ports the "nested" case of
// test_invalid_original_or_lines_refused: reversing a posted reversal is
// refused, not silently reopened.
func TestReversalOfReversalRefused(t *testing.T) {
	currentDoc := testDoc()
	currentDoc = docSet(t, currentDoc, "source_module", "REVERSAL")
	currentDoc = docSet(t, currentDoc, "reversal_of_journal_id", "j-rev-1")
	current, err := ParseJournal(currentDoc)
	if err != nil {
		t.Fatal(err)
	}
	originalDoc := docSet(t, testDoc(), "source_module", "REVERSAL")
	originalDoc = docSet(t, originalDoc, "status", "POSTED")
	originalDoc = docSet(t, originalDoc, "reversal_of_journal_id", "j-orig")
	originalDoc = docSet(t, originalDoc, "journal_id", "j-rev-1")
	original, err := ParseJournal(originalDoc)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ResolveReversalOriginal(current, &original, nil)
	wantKind(t, err, voucher.KindReversalInvalid)
}

// TestChainHeadIncludesSealedReversed ports
// test_concurrent_vouchers_extend_reversed_chain_head and the BL-25
// remediation: the head query includes sealed reversed vouchers, so the next
// posting extends the chain, and an unsealed row never becomes the parent.
func TestChainHeadIncludesSealedReversed(t *testing.T) {
	headHash := strings.Repeat("a", 64)
	head := ChainEntry{JournalID: "j-head", Status: "REVERSED",
		EntryHash: headHash, BlockIndex: 1,
		PostedAt: "2026-10-31T00:00:00+00:00", CreatedAt: "2026-10-01T09:00:00"}
	prevHash, nextIndex := ChainHead([]ChainEntry{head})
	if prevHash != headHash || nextIndex != 2 {
		t.Fatalf("head = (%q, %d), want (head hash, 2)", prevHash, nextIndex)
	}

	// Unsealed rows never parent a block, whatever they carry.
	pending := ChainEntry{JournalID: "j-2", Status: "PENDING_CHECKER",
		EntryHash: strings.Repeat("f", 64), BlockIndex: 5}
	prevHash, nextIndex = ChainHead([]ChainEntry{head, pending})
	if prevHash != headHash || nextIndex != 2 {
		t.Fatalf("head with pending = (%q, %d), want (head hash, 2)", prevHash, nextIndex)
	}

	// The first chain block hangs off the reference's genesis constant
	// (repository.get_latest_posted_hash's fallback).
	const genesis = "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"
	prevHash, nextIndex = ChainHead(nil)
	if prevHash != genesis || nextIndex != 1 {
		t.Fatalf("empty chain = (%q, %d), want (genesis, 1)", prevHash, nextIndex)
	}
}

// TestMarkOriginalReversedRevisionGuard ports
// test_duplicate_reversal's original-guard cases: the original must be
// POSTED to leave that state, the move takes the next revision, and the
// caller's original value is untouched.
func TestMarkOriginalReversedRevisionGuard(t *testing.T) {
	original := voucher.Voucher{JournalID: "j-orig", EntityCode: "AU-OPC-01",
		Status: voucher.StatusPosted, Revision: 1}
	reversed, err := MarkOriginalReversed(original)
	if err != nil {
		t.Fatalf("mark reversed: %v", err)
	}
	if reversed.Status != voucher.StatusReversed || reversed.Revision != 2 {
		t.Fatalf("reversed = %+v, want REVERSED at revision 2", reversed)
	}
	if original.Status != voucher.StatusPosted || original.Revision != 1 {
		t.Fatal("MarkOriginalReversed mutated the original value")
	}

	pending := voucher.Voucher{JournalID: "j-orig", Status: voucher.StatusPendingChecker, Revision: 1}
	_, err = MarkOriginalReversed(pending)
	wantKind(t, err, voucher.KindReversalConflict)
}

// TestReviewMetadataGuards ports the review-decision rules the reference
// enforces before writing metadata: reviewable state only, a known verdict,
// a checklist on approval, a reason on rejection, and the payload carrying
// the reviewer and reviewed_at verbatim.
func TestReviewMetadataGuards(t *testing.T) {
	current := Journal{Status: voucher.StatusPendingChecker, VoucherNo: strPtr("記-2026-10-0001")}

	outcome, err := ApplyReview(current, ReviewDecision{
		Verdict: "approve", ReviewerPosition: "GL_ACCOUNTANT",
		ReviewerPrincipalKey: "controller-checker-01",
		Checked:              []string{"金額與發票相符"},
		Reason:               "", ReviewedAt: "2026-10-31T00:00:00+00:00",
	})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if !outcome.ProceedToPost || outcome.Status != voucher.StatusPendingChecker {
		t.Fatalf("approve outcome = %+v, want proceed-to-post", outcome)
	}
	// The payload is the reference's json.dumps: insertion-order keys,
	// ensure_ascii=False (literal Chinese), default separators.
	want := `{"verdict": "APPROVE", "reviewer_position": "GL_ACCOUNTANT", ` +
		`"reviewer_principal_key": "controller-checker-01", "checked": ["金額與發票相符"], ` +
		`"reason": "", "reviewed_at": "2026-10-31T00:00:00+00:00"}`
	if outcome.ReviewNotes != want {
		t.Fatalf("review notes = %q, want %q", outcome.ReviewNotes, want)
	}

	rejected, err := ApplyReview(current, ReviewDecision{
		Verdict: "REJECT", ReviewerPosition: "GL_ACCOUNTANT",
		ReviewerPrincipalKey: "controller-checker-01",
		Reason:               "  receipt unclear  ",
		ReviewedAt:           "2026-10-31T00:00:00+00:00",
	})
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if rejected.Status != voucher.StatusRejected || rejected.RejectReason == nil ||
		*rejected.RejectReason != "receipt unclear" || rejected.ProceedToPost {
		t.Fatalf("reject outcome = %+v", rejected)
	}

	escalated, err := ApplyReview(current, ReviewDecision{
		Verdict: "ESCALATE", Reason: "scope不足", ReviewedAt: "2026-10-31T00:00:00+00:00",
	})
	if err != nil {
		t.Fatalf("escalate: %v", err)
	}
	if escalated.Status != voucher.StatusAwaitingCPA {
		t.Fatalf("escalate outcome = %+v", escalated)
	}

	if _, err := ApplyReview(Journal{Status: voucher.StatusPosted,
		VoucherNo: strPtr("記-2026-10-0001")},
		ReviewDecision{Verdict: "APPROVE", Checked: []string{"x"}}); err == nil {
		t.Fatal("want INVALID_STATE on a posted voucher")
	} else {
		wantKind(t, err, KindInvalidState)
	}
	if _, err := ApplyReview(current, ReviewDecision{Verdict: "MAYBE",
		Checked: []string{"x"}}); err == nil {
		t.Fatal("want INVALID_VERDICT")
	} else {
		wantKind(t, err, KindInvalidVerdict)
	}
	if _, err := ApplyReview(current, ReviewDecision{Verdict: "APPROVE"}); err == nil {
		t.Fatal("want REVIEW_CHECKLIST_REQUIRED")
	} else {
		wantKind(t, err, KindReviewChecklistRequired)
	}
	if _, err := ApplyReview(current, ReviewDecision{Verdict: "REJECT",
		Reason: "   "}); err == nil {
		t.Fatal("want REASON_REQUIRED")
	} else {
		wantKind(t, err, KindReasonRequired)
	}
}

func strPtr(s string) *string { return &s }
