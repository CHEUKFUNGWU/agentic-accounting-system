package posting

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// This file ports post_voucher's decision sequence as pure decisions over
// values, in the reference's order. Each step refuses before the next one
// runs, so the first failure is the reference's failure; nothing here has
// side effects — the returned Plan is what the store applies inside its one
// transaction (see doc.go).

// Approver is the human principal the approval runs under. Posting never
// approves: it records the approval it is given, and the maker-checker and
// authority rules run upstream (positions, reviewer).
type Approver struct {
	PrincipalID  string `json:"principal_id"`
	PrincipalKey string `json:"principal_key"`
}

// Input is everything the posting decision sequence reads, as values.
// Submitted and CurrentDoc are the reviewer's snapshot and the persisted row
// in the journal-dict wire form — the two views of one state that the
// snapshot guard diffs; Current is CurrentDoc typed for the rest of the
// sequence. The caller parses CurrentDoc once and keeps the two views
// consistent (the store loads both from the same row, as the reference's
// single journal dict serves both uses).
type Input struct {
	Submitted, CurrentDoc voucher.Snapshot
	Current               Journal

	// Chart is the entity's full chart including inactive accounts, in the
	// store's account-code order (get_chart include_inactive=True).
	Chart []ledger.Account
	// Periods are the entity's fiscal-period rows (assert_writable's query).
	Periods []ledger.Period

	// Original is the loaded original of a reversal draft; nil when the
	// draft links nothing, or the store found no row for the link (the
	// value rules cannot tell the two apart, as in the reference).
	Original *Journal
	// OriginalRows are the original's persisted ledger rows (the authoritative
	// facts the reversal must mirror).
	OriginalRows []voucher.LedgerLine
	// EffectiveReversalOf answers the store query behind the BL-03 uniqueness
	// enforcement: the journal IDs that already have an effective posted or
	// reversed reversal.
	EffectiveReversalOf map[string]bool
	// Chain is the entity's sealed entries (status POSTED or REVERSED with a
	// hash), the allocator's input.
	Chain []ChainEntry

	// Approver and PostedAt arrive as arguments: posting has no clock and no
	// identity of its own.
	Approver Approver
	PostedAt string
}

// Seal is the patch the store writes for the posted voucher itself
// (repository.mark_posted's guarded transition to POSTED). Everything else
// about the row stays exactly as it was.
type Seal struct {
	Status        voucher.Status `json:"status"`
	Revision      int64          `json:"revision"`
	EntryHash     string         `json:"entry_hash"`
	PrevEntryHash string         `json:"prev_entry_hash"`
	BlockIndex    int64          `json:"block_index"`
	// PostedAt is the caller-supplied seal timestamp (the reference's
	// datetime.now(UTC)).
	PostedAt    string `json:"posted_at"`
	ApproverKey string `json:"approved_by_principal_key"`
	ApproverID  string `json:"approved_by_principal_id"`
	// ReviewNotes is written only when the submitted snapshot carries one
	// (mark_posted's `if review_notes is not None`); nil keeps the stored
	// value.
	ReviewNotes *string `json:"review_notes"`
}

// OriginalSeal is the patch _mark_original_reversed writes for the
// reversed original: the status and the next revision, nothing else.
type OriginalSeal struct {
	Status   voucher.Status `json:"status"`
	Revision int64          `json:"revision"`
}

// Result mirrors post_voucher's return dict.
type Result struct {
	EntryHash     string `json:"entry_hash"`
	PrevEntryHash string `json:"prev_entry_hash"`
	BlockIndex    int64  `json:"block_index"`
	Columns       string `json:"columns"`
	LinesWritten  int    `json:"lines_written"`
}

// Plan is the posting decision's outcome: the period the entry lands in, the
// entry layer the rows carry, the seal patch, the original's reversal patch,
// the projected ledger rows, and the caller-facing result. The store applies
// all of it in one transaction — commit or roll back together (BL-01).
type PostingPlan struct {
	PeriodCode string `json:"period_code"`
	EntryLayer string `json:"entry_layer"`
	Voucher    Seal   `json:"voucher"`
	// Original is nil unless the posting commits a reversal relationship;
	// _mark_original_reversed writes the status and revision columns only.
	Original *OriginalSeal `json:"original"`
	Rows     []Row         `json:"rows"`
	Result   Result        `json:"result"`
}

// Plan runs the sequence. The reference's entity and voucher existence
// lookups (ENTITY_NOT_FOUND, VOUCHER_NOT_FOUND) are store refusals that
// happen before this function — the sequence receives the loaded row.
func Plan(in Input) (PostingPlan, error) {
	// 1. post_voucher refuses a voucher without an entity first.
	if in.Current.EntityCode == "" {
		return PostingPlan{}, refusal(KindPostingError, "voucher has no entity_code.")
	}
	// 2. The posting precondition: only a pending decision can be sealed.
	if !voucher.CanPost(in.Current.Status) {
		return PostingPlan{}, refusal(KindCannotPost,
			"憑證 "+pyVoucherNo(in.Current.VoucherNo)+
				" 狀態為 "+string(in.Current.Status)+"，不在待過賬狀態。")
	}
	// 3. Reviewers may change review metadata, but not the submitted
	// accounting snapshot (the BL-02/BL-29 remediation state).
	if err := voucher.CheckSnapshot(in.Submitted, in.CurrentDoc); err != nil {
		return PostingPlan{}, err
	}
	// 4. The reversal's linked original must qualify (BL-03).
	original, err := ResolveReversalOriginal(in.Current, in.Original, in.EffectiveReversalOf)
	if err != nil {
		return PostingPlan{}, err
	}
	// 5. A voucher without lines has nothing to post.
	if len(in.Current.Lines) == 0 {
		return PostingPlan{}, refusal(KindPostingError, "voucher has no lines.")
	}
	// 6. The date/period cutoff (BL-04): a real date inside the period's
	// bounds; an absent period derives from the date, an explicit one is
	// never rewritten to fit.
	periodCode, err := ledger.ValidatePostingDate(in.Current.AccountingDate, in.Current.Period)
	if err != nil {
		return PostingPlan{}, err
	}
	// 7. Chart: every line's account must exist (including inactive
	// accounts), and sub-ledger control accounts refuse general entries.
	if err := checkChart(in.Chart, in.Current.Lines); err != nil {
		return PostingPlan{}, err
	}
	// 8. The period must be writable, with every overlapping lock refusing
	// (BL-04's overlap rule).
	date := in.Current.AccountingDate
	if _, err := ledger.AssertWritable(in.Current.EntityCode, periodCode, &date, in.Periods); err != nil {
		return PostingPlan{}, err
	}
	// 9. The entry layer defaults to OPERATIONAL on the written rows.
	entryLayer := in.Current.EntryLayer
	if entryLayer == "" {
		entryLayer = "OPERATIONAL"
	}
	// 10. The ledger rows the transaction writes (write_lines_for_entry's
	// content; the write itself is store work).
	rows, err := projectRows(in.Current, in.Chart, periodCode, entryLayer)
	if err != nil {
		return PostingPlan{}, err
	}
	// 11. The posted reversal's rows must exactly mirror the original's
	// persisted rows (the net-to-zero guarantee in its reference form).
	if original != nil {
		reversalRows := make([]voucher.LedgerLine, 0, len(rows))
		for _, r := range rows {
			reversalRows = append(reversalRows, rowAsLedgerLine(r))
		}
		if err := voucher.ValidateReversalMirror(in.OriginalRows, reversalRows); err != nil {
			return PostingPlan{}, err
		}
	}
	// 12. The chain position: parent hash and next block index from the
	// entity's current head, including sealed reversed vouchers (BL-25).
	prevHash, nextIndex := ChainHead(in.Chain)
	// 13. The seal hash links the entry to its parent and its lines.
	linesSHA := positions.ComputeLinesSHA256(hashLines(in.Current.Lines))
	entryHash := positions.ComputeEntrySHA256Hash(
		prevHash,
		in.Current.JournalID,
		in.Current.EntityCode,
		in.Current.AccountingDate,
		in.Current.TotalDebit,
		in.Current.TotalCredit,
		linesSHA,
		in.Current.CreatedByPrincipalID,
		in.Approver.PrincipalID,
	)
	// 14. mark_posted's own precondition. Shadowed by step 2 at the value
	// level (no interleaving between pure steps), it documents the store's
	// defense-in-depth under the lock.
	if !voucher.CanPost(in.Current.Status) {
		return PostingPlan{}, refusal(KindCannotPostFinalized,
			"憑證 '"+in.Current.JournalID+
				"' 目前狀態為 '"+string(in.Current.Status)+"'，不可重複過賬或過賬已結案的分錄。")
	}
	seal := Seal{
		Status:        voucher.StatusPosted,
		Revision:      in.Current.Revision + 1,
		EntryHash:     entryHash,
		PrevEntryHash: prevHash,
		BlockIndex:    nextIndex,
		PostedAt:      in.PostedAt,
		ApproverKey:   in.Approver.PrincipalKey,
		ApproverID:    in.Approver.PrincipalID,
	}
	if notes, ok := docOptString(in.Submitted, "review_notes"); ok {
		seal.ReviewNotes = &notes
	}
	plan := PostingPlan{
		PeriodCode: periodCode,
		EntryLayer: entryLayer,
		Voucher:    seal,
		Rows:       rows,
		Result: Result{
			EntryHash:     entryHash,
			PrevEntryHash: prevHash,
			BlockIndex:    nextIndex,
			Columns:       DestinationColumns(entryLayer),
			LinesWritten:  len(rows),
		},
	}
	// 15. The original's reversal commits with the reversal's own seal
	// (BL-03): status, revision, lines, hash and approval roll back together.
	if original != nil {
		reversed, err := MarkOriginalReversed(toVoucherMust(*original))
		if err != nil {
			return PostingPlan{}, err
		}
		plan.Original = &OriginalSeal{
			Status:   reversed.Status,
			Revision: reversed.Revision,
		}
	}
	return plan, nil
}

// toVoucherMust adapts an already-validated original to the voucher value
// type. The original's amounts parsed without error when
// ResolveReversalOriginal validated it, so the parse cannot fail here.
func toVoucherMust(j Journal) voucher.Voucher {
	v, err := toVoucher(j)
	if err != nil {
		panic("posting: original amounts failed to parse after validation: " + err.Error())
	}
	return v
}

// checkChart ports post_voucher's two chart refusals in order: missing
// accounts (line order, duplicates kept, like the reference's list
// comprehension), then control-account isolation over the sorted distinct
// blocked codes.
func checkChart(chart []ledger.Account, lines []Line) error {
	missing := []string{}
	for _, line := range lines {
		if ledger.AccountByCode(chart, line.AccountCode) == nil {
			missing = append(missing, line.AccountCode)
		}
	}
	if len(missing) > 0 {
		return refusal(KindCOAMissingAccount,
			"科目 "+joinComma(missing)+" 不存在於科目表。")
	}
	blocked := []string{}
	for _, line := range lines {
		account := ledger.AccountByCode(chart, line.AccountCode)
		if account != nil && account.IsControlAccount && !account.AllowManualJE {
			blocked = append(blocked, line.AccountCode)
		}
	}
	if len(blocked) > 0 {
		return refusal(KindControlAccountIsolation,
			"科目 "+joinComma(sortedDistinct(blocked))+
				" 是子帳控制科目，不可用一般分錄過賬；分錄必須來自維護該子帳的流程。")
	}
	return nil
}

func joinComma(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += ", "
		}
		out += item
	}
	return out
}

func sortedDistinct(items []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	sortStrings(out)
	return out
}

// DestinationColumns ports posting.destination_columns as its consumed form:
// the trial-balance column family an entry layer writes to (the reference
// returns ("adjustment_debit", "adjustment_credit") for the adjustment
// layers and ("period_op_debit", "period_op_credit") otherwise, and
// post_voucher renders the result minus the "_debit" suffix).
func DestinationColumns(entryLayer string) string {
	if entryLayer == "AJE_MONTH_END" || entryLayer == "RJE_RECLASS" {
		return "adjustment"
	}
	return "period_op"
}
