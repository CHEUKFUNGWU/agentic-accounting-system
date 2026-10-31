// Package storetest is the shared behavioral suite of the storage seam: one
// set of assertions, run against both adapters (ADR-0001 §6's dual-database
// matrix). An adapter joins the matrix by calling RunSuite from its own
// test file with a constructor that yields a fresh, migrated Store on
// disposable storage.
//
// The suite drives the Store interface only — the same surface the MCP and
// REST layers will learn. Three things the interface deliberately does not
// expose need adapter cooperation, collected in SuiteHooks (test-only
// methods on the concrete adapter types, never on the Store interface):
//
//   - SeedEntity / SeedLockedPeriod: bootstrap rows (an entity and its chart,
//     a locked period) that the pure domain has no command for yet — the
//     reference seeds them in repository.init_seed_data_if_needed, which is
//     composition-root work in the Go port.
//   - EvidenceRoot: where the adapter expects evidence files, so the suite
//     can play save_attachment's role (the reference writes evidence bytes
//     next to the ledger file before capture).
//   - TamperChain: one out-of-band UPDATE of a persisted chain field,
//     simulating an attacker with raw disk access. Agents and callers never
//     get this path; only the test does, which is exactly the threat the
//     chain verification must catch.
package storetest

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/posting"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// SuiteHooks is the test-only adapter capability set (see the package doc).
type SuiteHooks interface {
	SeedEntity(ctx context.Context, entityCode string) error
	SeedLockedPeriod(ctx context.Context, entityCode, periodCode string) error
	EvidenceRoot() string
	TamperChain(ctx context.Context) error
}

// RunSuite runs every behavioral assertion against one adapter. newStore
// must return a fresh Store on disposable storage; RunSuite migrates it and
// closes it.
func RunSuite(t *testing.T, newStore func(t *testing.T) store.Store) {
	t.Run("MigrationsFreshDB", func(t *testing.T) { testMigrationsFreshDB(t, newStore) })
	t.Run("SaveJournalGuards", func(t *testing.T) { testSaveJournalGuards(t, newStore) })
	t.Run("PostVoucherHappyPath", func(t *testing.T) { testPostVoucherHappyPath(t, newStore) })
	t.Run("PostVoucherRefusals", func(t *testing.T) { testPostVoucherRefusals(t, newStore) })
	t.Run("ReversalAtomic", func(t *testing.T) { testReversalAtomic(t, newStore) })
	t.Run("ChainProgression", func(t *testing.T) { testChainProgression(t, newStore) })
	t.Run("TamperedChainFails", func(t *testing.T) { testTamperedChainFails(t, newStore) })
	t.Run("ConcurrentPostingSerializes", func(t *testing.T) { testConcurrentPosting(t, newStore) })
	t.Run("ClaimDocumentCapture", func(t *testing.T) { testClaimDocument(t, newStore) })
	t.Run("ClaimDocumentForVoucherAtomic", func(t *testing.T) { testConversionAtomicity(t, newStore) })
	t.Run("ConvertRoundingParity", func(t *testing.T) { testConvertRoundingParity(t, newStore) })
	t.Run("DuplicateEconomicsDetected", func(t *testing.T) { testDuplicateEconomics(t, newStore) })
	t.Run("ReceiptsIdempotent", func(t *testing.T) { testReceipts(t, newStore) })
	t.Run("AuditAppendQuery", func(t *testing.T) { testAudit(t, newStore) })
	t.Run("BackupRestoreRoundTrip", func(t *testing.T) { testBackupRestore(t, newStore) })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// open migrates a fresh store, asserts the adapter implements SuiteHooks and
// registers cleanup.
func open(t *testing.T, newStore func(t *testing.T) store.Store) (store.Store, SuiteHooks) {
	t.Helper()
	st := newStore(t)
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	hooks, ok := st.(SuiteHooks)
	if !ok {
		t.Fatalf("adapter %T does not implement storetest.SuiteHooks", st)
	}
	return st, hooks
}

func mustSeed(t *testing.T, hooks SuiteHooks, entity string) {
	t.Helper()
	if err := hooks.SeedEntity(context.Background(), entity); err != nil {
		t.Fatalf("SeedEntity(%s): %v", entity, err)
	}
}

func rawOf(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// draftSnapshot builds a pending-checker voucher dict in the wire form, two
// balanced lines by default.
func draftSnapshot(journalID, entity, date, currency, amount string) voucher.Snapshot {
	return voucher.Snapshot{
		"journal_id":               rawOf(journalID),
		"entity_code":              rawOf(entity),
		"source_module":            rawOf("MANUAL"),
		"status":                   rawOf("PENDING_CHECKER"),
		"accounting_date":          rawOf(date),
		"currency":                 rawOf(currency),
		"total_debit":              rawOf(amount),
		"total_credit":             rawOf(amount),
		"created_by_principal_key": rawOf("human-boss"),
		"created_by_principal_id":  rawOf("human-boss"),
		"lines": rawOf([]any{
			map[string]any{"line_number": 1, "account_code": "1110", "debit": amount, "credit": "0.0000", "memo": "probe"},
			map[string]any{"line_number": 2, "account_code": "4100", "debit": "0.0000", "credit": amount, "memo": "probe"},
		}),
	}
}

// approver is the human principal the suite posts under (agents never
// approve — engineering workflow §3).
var approver = posting.Approver{PrincipalID: "human-cpa", PrincipalKey: "cpa-griffin"}

// SuiteAt is the suite's fixed clock: every command timestamp argument.
const SuiteAt = "2026-10-31T00:00:00Z"
