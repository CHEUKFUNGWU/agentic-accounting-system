package storetest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/posting"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// freshTables lists the effective schema's tables (the Python fixture is the
// full set); Migrate on a fresh database must produce them.
var freshTables = []string{
	"monolith_workspaces", "entities", "mcp_audit_logs", "exceptions_log",
	"personal_splits_log", "custom_aje_log", "trial_balance_accounts",
	"journal_entries", "documents", "document_sources", "chart_of_accounts",
	"fiscal_periods", "counterparties", "tax_codes", "journal_lines",
}

func testMigrationsFreshDB(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, _ := open(t, newStore)
	// Migrate ran in open; every table the effective schema carries must
	// answer through the interface — a miss is classified NOT_FOUND, never a
	// missing-table error. (Full schema equality with the fixture lives in
	// the migrations package's tests.)
	if _, err := st.Journal(ctx, "no-such-voucher"); store.KindOf(err) != store.KindVoucherNotFound {
		t.Fatalf("journal_entries probe = %v, want %q", err, store.KindVoucherNotFound)
	}
	if _, err := st.Document(ctx, "no-such-document"); store.KindOf(err) != store.KindDocumentNotFound {
		t.Fatalf("documents probe = %v, want %q", err, store.KindDocumentNotFound)
	}
	logs, err := st.AuditLogs(ctx, store.AuditQuery{Limit: 1})
	if err != nil || logs == nil {
		t.Fatalf("mcp_audit_logs probe = %v", err)
	}
	docs, err := st.Documents(ctx, store.DocumentsQuery{EntityCode: "E1"})
	if err != nil || docs == nil {
		t.Fatalf("documents query probe = %v", err)
	}
}

func testSaveJournalGuards(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	draft := draftSnapshot("JV-SAVE", "E1", "2026-10-15", "AUD", "100.0000")

	// Create: no revision key on a new dict — insert with revision 0.
	res, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: draft, At: SuiteAt})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !res.Inserted || res.Revision != 0 {
		t.Fatalf("create result = %+v, want inserted revision 0", res)
	}

	// A revision key on a dict whose row does not exist: stale write.
	ghost := draftSnapshot("JV-GONE", "E1", "2026-10-15", "AUD", "100.0000")
	ghost["revision"] = rawOf(0)
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: ghost, At: SuiteAt}); store.KindOf(err) != posting.KindVoucherRevisionConflict {
		t.Fatalf("ghost insert kind = %q (%v), want %q", store.KindOf(err), err, posting.KindVoucherRevisionConflict)
	}

	// Revision conflict: the caller's revision no longer matches.
	stale := draftSnapshot("JV-SAVE", "E1", "2026-10-15", "AUD", "100.0000")
	stale["revision"] = rawOf(7)
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: stale, At: SuiteAt}); store.KindOf(err) != posting.KindVoucherRevisionConflict {
		t.Fatalf("stale save kind = %q (%v), want %q", store.KindOf(err), err, posting.KindVoucherRevisionConflict)
	}

	// State transition: the loaded dict moves DRAFT-equivalent states. Start
	// from a fresh draft, submit it, then accept the state map's move.
	d2 := draftSnapshot("JV-FLOW", "E1", "2026-10-15", "AUD", "10.0000")
	d2["status"] = rawOf("DRAFT")
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: d2, At: SuiteAt}); err != nil {
		t.Fatalf("draft create: %v", err)
	}
	loaded, err := st.Journal(ctx, "JV-FLOW")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	submitted := voucher.Snapshot{}
	for k, v := range loaded {
		submitted[k] = v
	}
	submitted["status"] = rawOf("PENDING_CHECKER")
	res, err = st.SaveJournal(ctx, store.SaveJournalCommand{Entry: submitted, At: SuiteAt})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if res.Revision != 1 {
		t.Fatalf("submit revision = %d, want 1", res.Revision)
	}

	// An out-of-map transition refuses (use the posting engine).
	loaded, err = st.Journal(ctx, "JV-FLOW")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	illegal := voucher.Snapshot{}
	for k, v := range loaded {
		illegal[k] = v
	}
	illegal["status"] = rawOf("POSTED")
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: illegal, At: SuiteAt}); store.KindOf(err) != voucher.KindVoucherStateConflict {
		t.Fatalf("illegal transition kind = %q (%v), want %q", store.KindOf(err), err, voucher.KindVoucherStateConflict)
	}

	// Only posting may seal a voucher: a non-finalized save carrying a
	// different entry_hash refuses.
	loaded, err = st.Journal(ctx, "JV-FLOW")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	seal := voucher.Snapshot{}
	for k, v := range loaded {
		seal[k] = v
	}
	seal["entry_hash"] = rawOf("deadbeef")
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: seal, At: SuiteAt}); store.KindOf(err) != voucher.KindVoucherImmutable {
		t.Fatalf("seal save kind = %q (%v), want %q", store.KindOf(err), err, voucher.KindVoucherImmutable)
	}
}

// clock counts the suite's save commands: each voucher gets its own
// created_at second, because the frozen chain rule sorts by created_at and
// sequential tests create vouchers in posting order.
var clock atomic.Int64

func nextAt() string {
	n := clock.Add(1)
	return fmt.Sprintf("2026-10-31T00:%02d:%02dZ", n/60, n%60)
}

// saveAndPost creates and seals one voucher, returning the posted wire form.
func saveAndPost(t *testing.T, st store.Store, draft voucher.Snapshot) store.PostResult {
	t.Helper()
	if _, err := st.SaveJournal(context.Background(), store.SaveJournalCommand{Entry: draft, At: nextAt()}); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := st.Journal(context.Background(), mustID(t, draft))
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	res, err := st.PostVoucher(context.Background(), store.PostVoucherCommand{
		JournalID: mustID(t, draft), Submitted: loaded,
		Approver: approver, PostedAt: SuiteAt,
	})
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	return res
}

func mustID(t *testing.T, snap voucher.Snapshot) string {
	t.Helper()
	var id string
	if err := json.Unmarshal(snap["journal_id"], &id); err != nil {
		t.Fatalf("journal_id: %v", err)
	}
	return id
}

func testPostVoucherHappyPath(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	draft := draftSnapshot("JV-OK", "E1", "2026-10-15", "AUD", "100.0000")
	res := saveAndPost(t, st, draft)

	// The result mirrors post_voucher's return dict, sealed at block 1.
	if res.BlockIndex != 1 || res.LinesWritten != 2 || res.Columns != "period_op" {
		t.Fatalf("post result = %+v", res)
	}
	if len(res.EntryHash) != 64 || res.PrevEntryHash != "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000" {
		t.Fatalf("seal fields: hash=%q prev=%q", res.EntryHash, res.PrevEntryHash)
	}
	// The committed wire form carries the seal: revision incremented,
	// posted_at set, approver recorded.
	if got := intOf(t, res.Voucher["revision"]); got != 1 {
		t.Fatalf("committed revision = %d, want 1", got)
	}
	if res.Voucher["posted_at"] == nil || string(res.Voucher["posted_at"]) == "null" {
		t.Fatalf("committed posted_at missing: %v", res.Voucher["posted_at"])
	}
	if strOf(t, res.Voucher["approved_by_principal_id"]) != "human-cpa" {
		t.Fatalf("approved_by_principal_id = %q", strOf(t, res.Voucher["approved_by_principal_id"]))
	}
	// BL-36: the number is allocated at posting, first of the period, and
	// the pre-posting draft carried none (drafts keep only their draft ID).
	if got := strOf(t, res.Voucher["voucher_no"]); got != "JV-2026-0001" {
		t.Fatalf("committed voucher_no = %q, want %q (neutral format, allocated at posting)", got, "JV-2026-0001")
	}

	// The ledger lines carry the snapshot's money strings byte-identical —
	// TEXT money crosses the store untouched (never float).
	lines, err := st.LedgerLines(ctx, store.LedgerLinesQuery{EntityCode: "E1"})
	if err != nil {
		t.Fatalf("ledger lines: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(lines))
	}
	if lines[0].AccountCode != "1110" || lines[0].TxDebit != "100.0000" || lines[0].TxCredit != "0.0000" ||
		lines[0].FuncDebit != "100.0000" || lines[0].ExchangeRate != "1.00000000" ||
		lines[0].EntryLayer != "OPERATIONAL" || lines[0].PeriodCode != "2026-10" {
		t.Fatalf("line 1 = %+v", lines[0])
	}
	if lines[1].AccountCode != "4100" || lines[1].TxCredit != "100.0000" || lines[1].TxDebit != "0.0000" {
		t.Fatalf("line 2 = %+v", lines[1])
	}

	// Audit-proof: the chain recomputes from the persisted lines and
	// verifies — the seal's entry hash is exactly the pure rule's value.
	rep, err := st.VerifyChain(ctx, "E1")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !rep.Valid || rep.VerifiedBlocksCount != 1 {
		t.Fatalf("chain = %+v, want valid with 1 block", rep)
	}
}

func testPostVoucherRefusals(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	// Double-post refuses (the approval precondition is also the double-
	// approval guard).
	draft := draftSnapshot("JV-DP", "E1", "2026-10-15", "AUD", "100.0000")
	saveAndPost(t, st, draft)
	loaded, err := st.Journal(ctx, "JV-DP")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if _, err := st.PostVoucher(ctx, store.PostVoucherCommand{JournalID: "JV-DP", Submitted: loaded,
		Approver: approver, PostedAt: SuiteAt}); store.KindOf(err) != posting.KindCannotPost {
		t.Fatalf("double post kind = %q (%v), want %q", store.KindOf(err), err, posting.KindCannotPost)
	}

	// Snapshot changed: the reviewer's copy drifted from the persisted row.
	d2 := draftSnapshot("JV-SNAP", "E1", "2026-10-15", "AUD", "20.0000")
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: d2, At: SuiteAt}); err != nil {
		t.Fatalf("save: %v", err)
	}
	drifted, err := st.Journal(ctx, "JV-SNAP")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	drifted["memo"] = rawOf("changed by someone else")
	if _, err := st.PostVoucher(ctx, store.PostVoucherCommand{JournalID: "JV-SNAP", Submitted: drifted,
		Approver: approver, PostedAt: SuiteAt}); store.KindOf(err) != voucher.KindVoucherSnapshotChanged {
		t.Fatalf("snapshot kind = %q (%v), want %q", store.KindOf(err), err, voucher.KindVoucherSnapshotChanged)
	}

	// Unbalanced: the store's posting gate refuses what upstream missed
	// (every posted entry balances — engineering workflow §3).
	bad := draftSnapshot("JV-UNBAL", "E1", "2026-10-15", "AUD", "100.0000")
	bad["total_credit"] = rawOf("50.0000")
	bad["lines"] = rawOf([]any{
		map[string]any{"line_number": 1, "account_code": "1110", "debit": "100.0000", "credit": "0.0000"},
		map[string]any{"line_number": 2, "account_code": "4100", "debit": "0.0000", "credit": "50.0000"},
	})
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: bad, At: SuiteAt}); err != nil {
		t.Fatalf("save unbalanced: %v", err)
	}
	if _, err := st.PostVoucher(ctx, store.PostVoucherCommand{JournalID: "JV-UNBAL",
		Submitted: mustReload(t, st, "JV-UNBAL"), Approver: approver, PostedAt: SuiteAt}); store.KindOf(err) != store.KindUnbalancedEntry {
		t.Fatalf("unbalanced kind = %q (%v), want %q", store.KindOf(err), err, store.KindUnbalancedEntry)
	}

	// Locked period: a LOCKED period containing the accounting date blocks
	// the posting (BL-04).
	if err := hooks.SeedLockedPeriod(ctx, "E1", "2026-09"); err != nil {
		t.Fatalf("SeedLockedPeriod: %v", err)
	}
	locked := draftSnapshot("JV-LOCK", "E1", "2026-09-15", "AUD", "30.0000")
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: locked, At: SuiteAt}); err != nil {
		t.Fatalf("save locked: %v", err)
	}
	if _, err := st.PostVoucher(ctx, store.PostVoucherCommand{JournalID: "JV-LOCK",
		Submitted: mustReload(t, st, "JV-LOCK"), Approver: approver, PostedAt: SuiteAt}); store.KindOf(err) != "PERIOD_LOCKED" {
		t.Fatalf("locked period kind = %q (%v), want PERIOD_LOCKED", store.KindOf(err), err)
	}

	// Nothing refled wrote state: the locked voucher is still unposted.
	got, err := st.Journal(ctx, "JV-LOCK")
	if err != nil {
		t.Fatalf("reload locked: %v", err)
	}
	if strOf(t, got["status"]) != "PENDING_CHECKER" {
		t.Fatalf("refused post changed status to %q", strOf(t, got["status"]))
	}
}

func mustReload(t *testing.T, st store.Store, id string) voucher.Snapshot {
	t.Helper()
	snap, err := st.Journal(context.Background(), id)
	if err != nil {
		t.Fatalf("reload %s: %v", id, err)
	}
	return snap
}

func testReversalAtomic(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	original := draftSnapshot("JV-ORIG", "E1", "2026-10-15", "AUD", "100.0000")
	postRes := saveAndPost(t, st, original)

	// The reversal mirrors the original's persisted rows, swapped.
	reversal := draftSnapshot("JV-REV", "E1", "2026-10-16", "AUD", "100.0000")
	reversal["source_module"] = rawOf("REVERSAL")
	reversal["reversal_of_journal_id"] = rawOf("JV-ORIG")
	reversal["total_debit"] = rawOf("100.0000")
	reversal["total_credit"] = rawOf("100.0000")
	reversal["lines"] = rawOf([]any{
		map[string]any{"line_number": 1, "account_code": "1110", "debit": "0.0000", "credit": "100.0000"},
		map[string]any{"line_number": 2, "account_code": "4100", "debit": "100.0000", "credit": "0.0000"},
	})
	revRes := saveAndPost(t, st, reversal)

	// Block 2 chains after block 1 and the original left POSTED in the same
	// transaction (BL-03: the reversal commits with the reversal's seal).
	if revRes.BlockIndex != 2 || revRes.PrevEntryHash != postRes.EntryHash {
		t.Fatalf("reversal chain position = %d/%s, want 2/%s", revRes.BlockIndex, revRes.PrevEntryHash, postRes.EntryHash)
	}
	orig := mustReload(t, st, "JV-ORIG")
	if strOf(t, orig["status"]) != "REVERSED" {
		t.Fatalf("original status = %q, want REVERSED", strOf(t, orig["status"]))
	}
	// The original's own revision advanced by exactly one in the same
	// transaction: it was %d after its own posting (the reversal's
	// predecessor state), and _mark_original_reversed adds one.
	if want := intOf(t, postRes.Voucher["revision"]) + 1; intOf(t, orig["revision"]) != want {
		t.Fatalf("original revision = %d, want %d", intOf(t, orig["revision"]), want)
	}
	// The chain itself is intact (block 2 chains on the original's hash,
	// asserted above). The frozen verifier's report after a reversal is
	// pinned too: verify_hash_chain filters to status POSTED, so the
	// excluded original makes it report the chain broken at the reversal —
	// exactly what the frozen Python rule does. Parity, not a defect to
	// silently fix here.
	rep, err := st.VerifyChain(ctx, "E1")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if rep.Valid {
		t.Fatalf("frozen verifier reported %+v; want the POSTED-only filter's broken report", rep)
	}

	// A second reversal of the same original refuses (BL-03 uniqueness).
	second := draftSnapshot("JV-REV2", "E1", "2026-10-17", "AUD", "100.0000")
	second["source_module"] = rawOf("REVERSAL")
	second["reversal_of_journal_id"] = rawOf("JV-ORIG")
	second["lines"] = rawOf([]any{
		map[string]any{"line_number": 1, "account_code": "1110", "debit": "0.0000", "credit": "100.0000"},
		map[string]any{"line_number": 2, "account_code": "4100", "debit": "100.0000", "credit": "0.0000"},
	})
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: second, At: SuiteAt}); err != nil {
		t.Fatalf("save second reversal: %v", err)
	}
	if _, err := st.PostVoucher(ctx, store.PostVoucherCommand{JournalID: "JV-REV2",
		Submitted: mustReload(t, st, "JV-REV2"), Approver: approver, PostedAt: SuiteAt}); store.KindOf(err) != voucher.KindReversalConflict {
		t.Fatalf("second reversal kind = %q (%v), want %q", store.KindOf(err), err, voucher.KindReversalConflict)
	}
}

func testChainProgression(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	first := saveAndPost(t, st, draftSnapshot("JV-C1", "E1", "2026-10-15", "AUD", "100.0000"))
	second := saveAndPost(t, st, draftSnapshot("JV-C2", "E1", "2026-10-16", "AUD", "40.0000"))

	if second.BlockIndex != 2 || second.PrevEntryHash != first.EntryHash {
		t.Fatalf("block 2 = %d prev %s, want 2 prev %s", second.BlockIndex, second.PrevEntryHash, first.EntryHash)
	}
	// BL-36 continuity: posted vouchers of one entity and period are numbered
	// continuously (both drafts are 2026-10; a draft refusal would never
	// have consumed a number to skip).
	if no1, no2 := strOf(t, first.Voucher["voucher_no"]), strOf(t, second.Voucher["voucher_no"]); no1 != "JV-2026-0001" || no2 != "JV-2026-0002" {
		t.Fatalf("voucher numbers = (%q, %q), want (JV-2026-0001, JV-2026-0002)", no1, no2)
	}
	rep, err := st.VerifyChain(ctx, "E1")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !rep.Valid || rep.VerifiedBlocksCount != 2 {
		t.Fatalf("chain = %+v, want valid with 2 blocks", rep)
	}
}

func testTamperedChainFails(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	saveAndPost(t, st, draftSnapshot("JV-T1", "E1", "2026-10-15", "AUD", "100.0000"))
	rep, err := st.VerifyChain(ctx, "E1")
	if err != nil || !rep.Valid {
		t.Fatalf("pre-tamper chain = %+v err=%v", rep, err)
	}

	// The attacker writes raw storage (the suite's TamperChain hook); the
	// recomputed hash must refuse to verify.
	if err := hooks.TamperChain(ctx); err != nil {
		t.Fatalf("TamperChain: %v", err)
	}
	rep, err = st.VerifyChain(ctx, "E1")
	if err != nil {
		t.Fatalf("verify after tamper: %v", err)
	}
	if rep.Valid {
		t.Fatal("tampered chain verified ok")
	}
	if rep.Error == "" {
		t.Fatal("tampered chain reported no error")
	}
}

// testConcurrentPosting pins the BL-25 serialization: two concurrent posts
// of two vouchers on one entity wait for each other (SQLite BEGIN IMMEDIATE
// / PG entity row lock), both commit, and the chain stays linear with no
// fork. A concurrent double-post of the SAME voucher yields exactly one
// success and one classified CANNOT_POST conflict.
func testConcurrentPosting(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	for _, id := range []string{"JV-P1", "JV-P2"} {
		if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: draftSnapshot(id, "E1", "2026-10-15", "AUD", "10.0000"), At: SuiteAt}); err != nil {
			t.Fatalf("save %s: %v", id, err)
		}
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]store.PostResult, 2)
	errs := make([]error, 2)
	for i, id := range []string{"JV-P1", "JV-P2"} {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			<-start
			submitted := mustReload(t, st, id)
			results[i], errs[i] = st.PostVoucher(ctx, store.PostVoucherCommand{
				JournalID: id, Submitted: submitted, Approver: approver, PostedAt: SuiteAt})
		}(i, id)
	}
	close(start)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent post %d failed: %v", i, err)
		}
	}
	// Serialized allocation: block indexes 1 and 2, the second chaining on
	// the first's hash — no fork. VerifyChain's validity is asserted in the
	// sequential tests: the frozen rule sorts by created_at (the row's
	// creation time), so under a race where posting order inverts creation
	// order it reports "chain broken" for a cryptographically intact chain —
	// exactly what the frozen Python rule does. The control under test here
	// is the allocation serialization, pinned by the linkage below.
	blocks := map[int64]string{}
	for _, r := range results {
		blocks[r.BlockIndex] = r.EntryHash
	}
	if len(blocks) != 2 || blocks[1] == "" || blocks[2] == "" {
		t.Fatalf("block indexes = %v, want {1, 2}", blocks)
	}
	// BL-36 under the same race: the entity lock serializes the allocation
	// too — two distinct numbers, 0001 and 0002, never one number twice.
	numbers := map[string]bool{}
	for _, r := range results {
		numbers[strOf(t, r.Voucher["voucher_no"])] = true
	}
	if !numbers["JV-2026-0001"] || !numbers["JV-2026-0002"] || len(numbers) != 2 {
		t.Fatalf("concurrent voucher numbers = %v, want {JV-2026-0001, JV-2026-0002}", numbers)
	}
	for _, id := range []string{"JV-P1", "JV-P2"} {
		snap := mustReload(t, st, id)
		if intOf64(t, snap["block_index"]) == 2 &&
			strOf(t, snap["prev_entry_hash"]) != blocks[1] {
			t.Fatalf("block 2 prev = %s, want block 1's hash %s",
				strOf(t, snap["prev_entry_hash"]), blocks[1])
		}
	}

	// Concurrent double-post of one voucher: exactly one wins.
	same := draftSnapshot("JV-RACE", "E1", "2026-10-15", "AUD", "5.0000")
	if _, err := st.SaveJournal(ctx, store.SaveJournalCommand{Entry: same, At: SuiteAt}); err != nil {
		t.Fatalf("save: %v", err)
	}
	wg = sync.WaitGroup{}
	start = make(chan struct{})
	postErrs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, postErrs[i] = st.PostVoucher(ctx, store.PostVoucherCommand{
				JournalID: "JV-RACE", Submitted: mustReload(t, st, "JV-RACE"),
				Approver: approver, PostedAt: SuiteAt})
		}(i)
	}
	close(start)
	wg.Wait()
	wins, conflicts := 0, 0
	for _, err := range postErrs {
		switch {
		case err == nil:
			wins++
		case store.KindOf(err) == posting.KindCannotPost:
			conflicts++
		default:
			t.Fatalf("double-post error kind = %q (%v)", store.KindOf(err), err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("double-post outcomes = %d wins, %d conflicts, want 1/1", wins, conflicts)
	}
}

// evidenceFor writes the evidence bytes the capture expects (the suite plays
// save_attachment's role).
func evidenceFor(t *testing.T, st store.Store, entity, storedName string, content []byte) string {
	t.Helper()
	hooks := st.(SuiteHooks)
	dir := filepath.Join(hooks.EvidenceRoot(), entity)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("evidence dir: %v", err)
	}
	path := filepath.Join(dir, storedName)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("evidence write: %v", err)
	}
	return path
}

func testClaimDocument(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	content := []byte("invoice bytes v1")
	digest := sha256Hex(content)
	stored := digest[:16] + "-invoice.pdf"
	evidenceFor(t, st, "E1", stored, content)

	rec := store.Document{
		DocumentID: "DOC-1", EntityCode: "E1", DocType: "INVOICE",
		DocDate: "2026-10-15", CounterpartyName: "Acme Corp",
		Amount: "89.0000", Currency: "AUD", Status: "NEW",
		Filename: "invoice.pdf", StoredName: stored, Mime: "application/pdf",
		Size: int64(len(content)), SHA256: digest, UploadedBy: "human-boss",
	}
	res, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: rec, Content: content, At: SuiteAt})
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if res.Document.DocumentID != "DOC-1" || res.Document.Status != "NEW" {
		t.Fatalf("claim result = %+v", res.Document)
	}

	// Re-upload of the same bytes adopts the same canonical document —
	// no second row.
	res2, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: store.Document{
		DocumentID: "DOC-2", EntityCode: "E1", DocType: "INVOICE",
		DocDate: "2026-10-15", CounterpartyName: "Acme Corp",
		Amount: "89.0000", Currency: "AUD", Status: "NEW",
		Filename: "invoice-re upload.pdf", StoredName: stored, Mime: "application/pdf",
		Size: int64(len(content)), SHA256: digest, UploadedBy: "human-boss",
	}, Content: content, At: SuiteAt})
	if err != nil {
		t.Fatalf("re-claim: %v", err)
	}
	if res2.Document.DocumentID != "DOC-1" {
		t.Fatalf("re-upload produced document %q, want adoption of DOC-1", res2.Document.DocumentID)
	}
	docs, err := st.Documents(ctx, store.DocumentsQuery{EntityCode: "E1"})
	if err != nil {
		t.Fatalf("documents: %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("documents = %d rows, want 1 (no second row for the same bytes)", len(docs))
	}

	// Different bytes for the same claim refuse: the exact-byte claim is
	// the hard atomic guarantee.
	if _, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: store.Document{
		DocumentID: "DOC-3", EntityCode: "E1", SHA256: digest, StoredName: stored,
	}, Content: []byte("tampered bytes"), At: SuiteAt}); store.KindOf(err) != store.KindDocumentHashMismatch {
		t.Fatalf("bytes mismatch kind = %q (%v), want %q", store.KindOf(err), err, store.KindDocumentHashMismatch)
	}
}

func testConversionAtomicity(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	content := []byte("receipt bytes")
	digest := sha256Hex(content)
	stored := digest[:16] + "-receipt.pdf"
	evidenceFor(t, st, "E1", stored, content)
	rec := store.Document{
		DocumentID: "DOC-CONV", EntityCode: "E1", DocType: "RECEIPT",
		DocDate: "2026-10-15", CounterpartyName: "Acme Corp",
		Amount: "42.0000", Currency: "AUD", Status: "NEW",
		Filename: "receipt.pdf", StoredName: stored, Mime: "application/pdf",
		Size: int64(len(content)), SHA256: digest, UploadedBy: "human-boss",
	}
	if _, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: rec, Content: content, At: SuiteAt}); err != nil {
		t.Fatalf("claim: %v", err)
	}

	// Two concurrent conversions of one NEW document: the BL-05 fix. The
	// entity lock serializes them; exactly one voucher and one link result,
	// and the loser is refused with the DOCUMENT_ALREADY_USED class.
	cmd := store.ClaimDocumentForVoucherCommand{
		DocumentID: "DOC-CONV", DebitAccountCode: "1110", CreditAccountCode: "4100",
		MakerPrincipalKey: "human-boss", MakerPrincipalID: "human-boss", At: SuiteAt,
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	ids := make([]string, 2)
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			res, err := st.ClaimDocumentForVoucher(ctx, cmd)
			if err == nil {
				ids[i] = res.JournalID
			}
			errs[i] = err
		}(i)
	}
	close(start)
	wg.Wait()
	winners := 0
	for i, err := range errs {
		if err == nil {
			winners++
			continue
		}
		if store.KindOf(err) != store.KindDocumentAlreadyUsed {
			t.Fatalf("loser kind = %q (%v), want %q", store.KindOf(err), err, store.KindDocumentAlreadyUsed)
		}
		if ids[i] != "" {
			t.Fatalf("loser produced a voucher %q", ids[i])
		}
	}
	if winners != 1 {
		t.Fatalf("conversions won = %d, want exactly 1", winners)
	}
	linked := 0
	docs, err := st.Documents(ctx, store.DocumentsQuery{EntityCode: "E1", Status: "POSTED"})
	if err != nil {
		t.Fatalf("documents: %v", err)
	}
	for _, d := range docs {
		if d.JournalID != nil {
			linked++
		}
	}
	if linked != 1 {
		t.Fatalf("linked documents = %d, want 1", linked)
	}
	journals, err := st.Journals(ctx, store.JournalsQuery{EntityCode: "E1", Status: "DRAFT"})
	if err != nil {
		t.Fatalf("journals: %v", err)
	}
	if len(journals) != 1 {
		t.Fatalf("draft vouchers = %d, want 1", len(journals))
	}

	// A third conversion of the used document refuses.
	if _, err := st.ClaimDocumentForVoucher(ctx, cmd); store.KindOf(err) != store.KindDocumentAlreadyUsed {
		t.Fatalf("third conversion kind = %q (%v), want %q", store.KindOf(err), err, store.KindDocumentAlreadyUsed)
	}
}

func testDuplicateEconomics(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	// Same economic event captured twice with different bytes: the
	// exact-byte claim admits both (different sha256 = different source
	// identity), and the detection names the earlier one for review.
	content1 := []byte("invoice original scan")
	content2 := []byte("invoice re-scan, different bytes")
	for i, content := range [][]byte{content1, content2} {
		digest := sha256Hex(content)
		stored := digest[:16] + "-invoice.pdf"
		evidenceFor(t, st, "E1", stored, content)
		rec := store.Document{
			DocumentID: fmt.Sprintf("DOC-DUP-%d", i),
			EntityCode: "E1", DocType: "INVOICE", DocDate: "2026-10-15",
			CounterpartyName: "acme  corp", // normalization: same as "Acme Corp"
			Amount:           "89.0000", Currency: "AUD", Status: "NEW",
			Filename: "invoice.pdf", StoredName: stored, Mime: "application/pdf",
			Size: int64(len(content)), SHA256: digest, UploadedBy: "human-boss",
		}
		res, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: rec, Content: content, At: SuiteAt})
		if err != nil {
			t.Fatalf("claim %d: %v", i, err)
		}
		if i == 0 && len(res.DuplicateOf) != 0 {
			t.Fatalf("first claim duplicates = %v, want none", res.DuplicateOf)
		}
		if i == 1 {
			if len(res.DuplicateOf) != 1 || res.DuplicateOf[0] != "DOC-DUP-0" {
				t.Fatalf("second claim duplicates = %v, want [DOC-DUP-0]", res.DuplicateOf)
			}
		}
	}

	// A different economic event (different amount) is not a duplicate.
	content3 := []byte("a different invoice entirely")
	digest := sha256Hex(content3)
	stored := digest[:16] + "-invoice.pdf"
	evidenceFor(t, st, "E1", stored, content3)
	res, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: store.Document{
		DocumentID: "DOC-OTHER", EntityCode: "E1", DocType: "INVOICE", DocDate: "2026-10-15",
		CounterpartyName: "Acme Corp", Amount: "99.0000", Currency: "AUD", Status: "NEW",
		Filename: "invoice.pdf", StoredName: stored, Mime: "application/pdf",
		Size: int64(len(content3)), SHA256: digest, UploadedBy: "human-boss",
	}, Content: content3, At: SuiteAt})
	if err != nil {
		t.Fatalf("claim other: %v", err)
	}
	if len(res.DuplicateOf) != 0 {
		t.Fatalf("different amount flagged as duplicate: %v", res.DuplicateOf)
	}
}

func testReceipts(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	key := store.ReceiptKey{PrincipalKey: "human-boss", EntityCode: "E1", PayloadHash: sha256Hex([]byte(`{"amount":1}`))}
	first, existed, err := st.PutReceipt(ctx, store.PutReceiptCommand{
		Key: key, CommandID: "CMD-1", Outcome: `{"status":"ok"}`, At: SuiteAt})
	if err != nil {
		if errors.Is(err, store.ErrReceiptsTableMissing) {
			t.Skipf("command_receipts table missing: a database predating migration 0007 that was never migrated (%v)", err)
		}
		t.Fatalf("put: %v", err)
	}
	if existed {
		t.Fatal("first put reported existed")
	}
	if first.CommandID != "CMD-1" {
		t.Fatalf("receipt = %+v", first)
	}

	// The timeout rule: the same key returns the stored receipt unchanged,
	// so a retried command resolves instead of posting twice.
	second, existed, err := st.PutReceipt(ctx, store.PutReceiptCommand{
		Key: key, CommandID: "CMD-2-retry", Outcome: `{"status":"different"}`, At: SuiteAt})
	if err != nil {
		t.Fatalf("second put: %v", err)
	}
	if !existed {
		t.Fatal("second put did not report existed")
	}
	if second.CommandID != "CMD-1" || second.Outcome != `{"status":"ok"}` {
		t.Fatalf("second put returned %+v, want the first receipt unchanged", second)
	}

	// Concurrent same-key puts both succeed with the same stored receipt.
	var wg sync.WaitGroup
	start := make(chan struct{})
	got := make([]store.Receipt, 2)
	putErrs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			r, _, err := st.PutReceipt(ctx, store.PutReceiptCommand{
				Key: key, CommandID: fmt.Sprintf("CMD-CONC-%d", i), Outcome: `{}`, At: SuiteAt})
			got[i], putErrs[i] = r, err
		}(i)
	}
	close(start)
	wg.Wait()
	for i, err := range putErrs {
		if err != nil {
			t.Fatalf("concurrent put %d: %v", i, err)
		}
		if got[i].CommandID != "CMD-1" {
			t.Fatalf("concurrent put %d returned %+v, want CMD-1's receipt", i, got[i])
		}
	}

	// Lookup by key.
	r, err := st.Receipt(ctx, key)
	if err != nil {
		t.Fatalf("receipt: %v", err)
	}
	if r.CommandID != "CMD-1" {
		t.Fatalf("receipt lookup = %+v", r)
	}
	if _, err := st.Receipt(ctx, store.ReceiptKey{PrincipalKey: "x", EntityCode: "E1", PayloadHash: "ff"}); store.KindOf(err) != "RECEIPT_NOT_FOUND" {
		t.Fatalf("missing receipt kind = %q (%v)", store.KindOf(err), err)
	}
}

func testAudit(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	errCode := "CANNOT_POST"
	rec := store.AuditRecord{
		LogID: "LOG-1", Position: "GL_ACCOUNTANT", PrincipalKey: "gl-chief-01",
		Tool: "journal.post", Outcome: "REFUSED", ErrorCode: &errCode,
		EntityCode: strPtr("E1"), ParamsJSON: `{"journal_id":"JV-A"}`,
		DocumentSHA256s: `[]`, CreatedAt: SuiteAt,
	}
	older := "2026-10-30T00:00:00Z"
	rec.CreatedAt = older
	if err := st.AppendAudit(ctx, rec); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := st.AppendAudit(ctx, store.AuditRecord{
		LogID: "LOG-2", Position: "CASHIER", PrincipalKey: "cashier-01",
		Tool: "journal.create", Outcome: "OK", EntityCode: strPtr("E1"), CreatedAt: SuiteAt,
	}); err != nil {
		t.Fatalf("append 2: %v", err)
	}

	logs, err := st.AuditLogs(ctx, store.AuditQuery{EntityCode: "E1"})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("logs = %d, want 2", len(logs))
	}
	if logs[0].LogID != "LOG-2" || logs[1].LogID != "LOG-1" {
		t.Fatalf("logs order = [%s, %s], want newest first", logs[0].LogID, logs[1].LogID)
	}
	if logs[1].Outcome != "REFUSED" || logs[1].ErrorCode == nil || *logs[1].ErrorCode != "CANNOT_POST" {
		t.Fatalf("LOG-1 = %+v", logs[1])
	}

	byTool, err := st.AuditLogs(ctx, store.AuditQuery{EntityCode: "E1", Tool: "journal.post"})
	if err != nil {
		t.Fatalf("query by tool: %v", err)
	}
	if len(byTool) != 1 || byTool[0].LogID != "LOG-1" {
		t.Fatalf("tool filter = %+v", byTool)
	}

	// Append-only: no update path exists on the interface; re-appending the
	// same log ID is refused by the primary key, not overwritten.
	if err := st.AppendAudit(ctx, rec); err == nil {
		t.Fatal("duplicate log_id accepted — the audit trail must be append-only")
	}
}

func testBackupRestore(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	// State worth backing up: a posted voucher and a captured document with
	// its evidence file.
	saveAndPost(t, st, draftSnapshot("JV-BK", "E1", "2026-10-15", "AUD", "100.0000"))
	content := []byte("backup evidence bytes")
	digest := sha256Hex(content)
	stored := digest[:16] + "-evidence.pdf"
	evidenceFor(t, st, "E1", stored, content)
	if _, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: store.Document{
		DocumentID: "DOC-BK", EntityCode: "E1", DocType: "INVOICE", DocDate: "2026-10-15",
		CounterpartyName: "Acme Corp", Amount: "10.0000", Currency: "AUD", Status: "NEW",
		Filename: "evidence.pdf", StoredName: stored, Mime: "application/pdf",
		Size: int64(len(content)), SHA256: digest, UploadedBy: "human-boss",
	}, Content: content, At: SuiteAt}); err != nil {
		t.Fatalf("claim: %v", err)
	}

	target := t.TempDir()
	report, err := st.Backup(ctx, target)
	if err != nil {
		if errors.Is(err, store.ErrBackupUnsupported) {
			t.Skip("adapter reports ErrBackupUnsupported (PostgreSQL snapshots are the operator's pg_dump job)")
		}
		t.Fatalf("backup: %v", err)
	}
	if report.DBFile == "" || report.EvidenceFiles < 1 {
		t.Fatalf("backup report = %+v", report)
	}
	if _, err := os.Stat(report.DBFile); err != nil {
		t.Fatalf("backup db missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(report.EvidenceDir, "E1", stored)); err != nil {
		t.Fatalf("backup evidence missing: %v", err)
	}

	restoreTarget := store.RestoreTarget{
		DBFile:      filepath.Join(t.TempDir(), "restored.db"),
		EvidenceDir: filepath.Join(t.TempDir(), "restored-attachments"),
	}
	res, err := st.Restore(ctx, store.BackupRef{DBFile: report.DBFile, EvidenceDir: report.EvidenceDir}, restoreTarget)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if res.DocumentsVerified != 1 || res.EvidenceFiles != report.EvidenceFiles {
		t.Fatalf("restore report = %+v, want 1 document verified, %d evidence files", res, report.EvidenceFiles)
	}

	// A backup missing its evidence must fail the restoration verification,
	// not restore a ledger pointing at nothing (the BL-23 defect).
	brokenTarget := store.RestoreTarget{
		DBFile:      filepath.Join(t.TempDir(), "broken.db"),
		EvidenceDir: filepath.Join(t.TempDir(), "broken-attachments"),
	}
	if _, err := st.Restore(ctx, store.BackupRef{DBFile: report.DBFile, EvidenceDir: t.TempDir()}, brokenTarget); err == nil {
		t.Fatal("restore accepted a backup whose evidence set is empty")
	}
}

// testConvertRoundingParity pins the reference's conversion rounding: q4
// (ROUND_HALF_UP to four places) runs BEFORE the zero gate
// (api_documents.py:166-171), so a 5th-decimal tie drafts the rounded-UP
// value and an amount that rounds to zero refuses. A wrong mode (the decimal
// context's default HALF_EVEN) or a gate on the unrounded parse would write
// different money on exactly these ties — store territory the golden
// fixtures cannot reach (no pure rule to fixture).
func testConvertRoundingParity(t *testing.T, newStore func(t *testing.T) store.Store) {
	ctx := context.Background()
	st, hooks := open(t, newStore)
	mustSeed(t, hooks, "E1")

	convert := func(docID, amount string) (string, error) {
		t.Helper()
		content := []byte("rounding bytes " + docID)
		digest := sha256Hex(content)
		stored := digest[:16] + "-slip.pdf"
		evidenceFor(t, st, "E1", stored, content)
		rec := store.Document{
			DocumentID: docID, EntityCode: "E1", DocType: "BANK_SLIP",
			DocDate: "2026-10-15", CounterpartyName: "Acme Corp",
			Amount: amount, Currency: "AUD", Status: "NEW",
			Filename: "slip.pdf", StoredName: stored, Mime: "application/pdf",
			Size: int64(len(content)), SHA256: digest, UploadedBy: "human-boss",
		}
		if _, err := st.ClaimDocument(ctx, store.ClaimDocumentCommand{Record: rec, Content: content, At: SuiteAt}); err != nil {
			t.Fatalf("claim %s: %v", docID, err)
		}
		res, err := st.ClaimDocumentForVoucher(ctx, store.ClaimDocumentForVoucherCommand{
			DocumentID: docID, DebitAccountCode: "1110", CreditAccountCode: "4100",
			MakerPrincipalKey: "human-boss", MakerPrincipalID: "human-boss", At: SuiteAt,
		})
		if err != nil {
			return "", err
		}
		snap, err := st.Journal(ctx, res.JournalID)
		if err != nil {
			t.Fatalf("reload %s: %v", docID, err)
		}
		return strOf(t, snap["total_debit"]), nil
	}

	// HALF_UP ties round UP where HALF_EVEN would round to even (down):
	// the distinguishing cases against the wrong mode.
	for _, tc := range []struct{ amount, want string }{
		{"1.00005", "1.0001"}, // tie; HALF_EVEN would draft 1.0000
		{"1.00025", "1.0003"}, // tie over an even digit; HALF_EVEN would draft 1.0002
		{"0.00005", "0.0001"}, // tiny tie; HALF_EVEN would draft 0.0000
	} {
		got, err := convert("DOC-ROUND-"+tc.want, tc.amount)
		if err != nil {
			t.Fatalf("convert %s: %v", tc.amount, err)
		}
		if got != tc.want {
			t.Fatalf("convert %s total_debit = %q, want %q (reference q4 ROUND_HALF_UP)", tc.amount, got, tc.want)
		}
	}
	// The gate reads the ROUNDED value: 0.00004 rounds to 0.0000 and refuses,
	// though the unrounded amount is positive.
	if _, err := convert("DOC-ROUND-ZERO", "0.00004"); store.KindOf(err) != store.KindAmountRequired {
		t.Fatalf("convert 0.00004 kind = %q (%v), want %q (gate after q4)", store.KindOf(err), err, store.KindAmountRequired)
	}
}

// ---------------------------------------------------------------------------
// tiny local helpers
// ---------------------------------------------------------------------------

func strOf(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("string field: %v", err)
	}
	return s
}

func intOf(t *testing.T, raw json.RawMessage) int {
	t.Helper()
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		t.Fatalf("int field: %v", err)
	}
	return n
}

func intOf64(t *testing.T, raw json.RawMessage) int64 {
	t.Helper()
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		t.Fatalf("int field: %v", err)
	}
	return n
}

func strPtr(s string) *string { return &s }

// sha256Hex is the suite's content digest (the callers hash payloads the
// same way before ReceiptKey and document records).
func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
