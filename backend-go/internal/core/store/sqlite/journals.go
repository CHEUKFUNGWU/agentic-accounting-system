package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/posting"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// This file ports the journal flows of the frozen reference on SQLite:
// repository.save_journal / get_journal / get_journals (the guards' pure
// logic is posting.PlanSave, enforced here with conditional writes),
// posting.post_voucher (the one-transaction seal), ledger.get_lines, and the
// chart/period/entity reads the flows assemble their pure inputs from.

// renderTS converts a stored SQLite timestamp to the ISO wire form.
func renderTS(stored string) (string, error) { return store.SQLiteToISO(stored) }

func toTS(iso string) (string, error) { return store.SQLiteTS(iso) }

// chartSelect is the chart_of_accounts read list: the column alias the
// ledger.Account value type reads (default_statement_ref → statement_ref).
const chartSelect = `account_id, parent_account_id, account_code, account_name,
		account_type, normal_balance, fs_category, default_statement_ref AS statement_ref,
		cash_flow_activity, is_control_account, allow_manual_je, tax_code_default,
		is_active, effective_from, effective_to, created_at`

// newUUID generates the line_id / journal_id values (the reference's uuid4).
func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

func (s *Store) Entity(ctx context.Context, entityCode string) (store.Entity, error) {
	var e store.Entity
	err := s.db.QueryRowContext(ctx, `SELECT entity_code, legal_name, entity_structure,
		jurisdiction, currency, accounting_standard, tax_id, reporting_status
		FROM entities WHERE entity_code = ?`, entityCode).
		Scan(&e.EntityCode, &e.LegalName, &e.EntityStructure, &e.Jurisdiction,
			&e.Currency, &e.AccountingStandard, &e.TaxID, &e.ReportingStatus)
	if err == sql.ErrNoRows {
		return store.Entity{}, store.NotFound(store.KindEntityNotFound, "Entity '"+entityCode+"'")
	}
	if err != nil {
		return store.Entity{}, fmt.Errorf("sqlite: entity: %w", err)
	}
	return e, nil
}

func (s *Store) Chart(ctx context.Context, entityCode string, includeInactive bool) ([]ledger.Account, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+chartSelect+`
		FROM chart_of_accounts WHERE entity_code = ? ORDER BY account_code`, entityCode)
	if err != nil {
		return nil, fmt.Errorf("sqlite: chart: %w", err)
	}
	defer rows.Close()
	out := []ledger.Account{}
	for rows.Next() {
		a, err := store.ScanAccount(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlite: chart: %w", err)
	}
	if !includeInactive {
		out = ledger.ActiveAccounts(out)
	}
	return out, nil
}

func (s *Store) Periods(ctx context.Context, entityCode string) ([]ledger.Period, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT period_id, entity_code, period_code,
		fiscal_year, period_number, start_date, end_date, status,
		closed_by_principal_key, closed_at, created_at
		FROM fiscal_periods WHERE entity_code = ? ORDER BY period_code`, entityCode)
	if err != nil {
		return nil, fmt.Errorf("sqlite: periods: %w", err)
	}
	defer rows.Close()
	out := []ledger.Period{}
	for rows.Next() {
		p, err := store.ScanPeriod(rows.Scan, renderTS)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// loadJournalTx reads one journal row inside a transaction (the reference's
// get_journal with FOR UPDATE — a no-op under BEGIN IMMEDIATE on SQLite).
func loadJournalTx(tx *writeTx, journalID string) (store.JournalDoc, bool, error) {
	row := tx.queryRow(`SELECT `+strings.Join(store.JournalReadColumns, ", ")+`
		FROM journal_entries WHERE journal_id = ?`, journalID)
	doc, err := store.ScanJournal(row.Scan, renderTS)
	if err == sql.ErrNoRows {
		return store.JournalDoc{}, false, nil
	}
	if err != nil {
		return store.JournalDoc{}, false, fmt.Errorf("sqlite: journal read: %w", err)
	}
	return doc, true, nil
}

func scanJournalDoc(row *sql.Row) (store.JournalDoc, bool, error) {
	doc, err := store.ScanJournal(row.Scan, renderTS)
	if err == sql.ErrNoRows {
		return store.JournalDoc{}, false, nil
	}
	if err != nil {
		return store.JournalDoc{}, false, fmt.Errorf("sqlite: journal read: %w", err)
	}
	return doc, true, nil
}

func (s *Store) Journal(ctx context.Context, journalID string) (voucher.Snapshot, error) {
	doc, ok, err := scanJournalDoc(s.db.QueryRowContext(ctx,
		`SELECT `+strings.Join(store.JournalReadColumns, ", ")+` FROM journal_entries WHERE journal_id = ?`, journalID))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, store.NotFound(store.KindVoucherNotFound, "Voucher '"+journalID+"'")
	}
	return store.SnapshotFromJournalDoc(doc, renderTS)
}

func (s *Store) Journals(ctx context.Context, q store.JournalsQuery) ([]voucher.Snapshot, error) {
	sqlStr := `SELECT ` + strings.Join(store.JournalReadColumns, ", ") + ` FROM journal_entries`
	var conds []string
	var args []any
	if q.EntityCode != "" {
		conds = append(conds, "entity_code = ?")
		args = append(args, q.EntityCode)
	}
	if q.Status != "" {
		conds = append(conds, "status = ?")
		args = append(args, q.Status)
	}
	if len(conds) > 0 {
		sqlStr += " WHERE " + strings.Join(conds, " AND ")
	}
	sqlStr += " ORDER BY created_at DESC"
	rows, err := s.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: journals: %w", err)
	}
	defer rows.Close()
	out := []voucher.Snapshot{}
	for rows.Next() {
		doc, err := store.ScanJournal(rows.Scan, renderTS)
		if err != nil {
			return nil, err
		}
		snap, err := store.SnapshotFromJournalDoc(doc, renderTS)
		if err != nil {
			return nil, err
		}
		out = append(out, snap)
	}
	return out, rows.Err()
}

func (s *Store) LedgerLines(ctx context.Context, q store.LedgerLinesQuery) ([]voucher.LedgerLine, error) {
	sqlStr := `SELECT line_id, journal_id, entity_code, line_number, account_id,
		account_code, account_name, period_code, entry_layer, accounting_date,
		tx_currency, exchange_rate, tx_debit, tx_credit, func_debit, func_credit,
		counterparty_id, counterparty_name, tax_code_id, func_tax_amount,
		business_use_pct, statement_ref, memo, created_at
		FROM journal_lines WHERE entity_code = ?`
	args := []any{q.EntityCode}
	if q.AccountCode != "" {
		sqlStr += " AND account_code = ?"
		args = append(args, q.AccountCode)
	}
	if q.PeriodCode != "" {
		span, err := ledger.PeriodBounds(q.PeriodCode)
		if err != nil {
			return nil, err
		}
		sqlStr += " AND accounting_date >= ? AND accounting_date <= ?"
		args = append(args, span.Start, span.End)
	}
	if q.CounterpartyID != "" {
		sqlStr += " AND counterparty_id = ?"
		args = append(args, q.CounterpartyID)
	}
	sqlStr += " ORDER BY accounting_date, line_number"
	if q.Limit > 0 {
		sqlStr += fmt.Sprintf(" LIMIT %d", q.Limit)
	}
	rows, err := s.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: ledger lines: %w", err)
	}
	defer rows.Close()
	out := []voucher.LedgerLine{}
	for rows.Next() {
		l, err := store.ScanLine(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// SaveJournal — repository.save_journal with conditional writes
// ---------------------------------------------------------------------------

func (s *Store) SaveJournal(ctx context.Context, cmd store.SaveJournalCommand) (store.SaveJournalResult, error) {
	var result store.SaveJournalResult
	err := withWrite(ctx, s, func(tx *writeTx) error {
		entry := cmd.Entry
		journalID, err := journalIDOf(entry)
		if err != nil {
			return err
		}
		current, ok, err := loadJournalTx(tx, journalID)
		if err != nil {
			return err
		}
		// The reference checks the revision conflicts before it builds the
		// model, so a stale caller gets VOUCHER_REVISION_CONFLICT even when
		// the dict would also fail to parse. The precheck keeps that order;
		// PlanSave re-checks canonically below.
		if err := revisionPrecheck(current, ok, entry); err != nil {
			return err
		}
		doc, err := store.JournalDocFromSnapshot(entry)
		if err != nil {
			return err
		}
		var currentSnap voucher.Snapshot
		if ok {
			if currentSnap, err = store.SnapshotFromJournalDoc(current, renderTS); err != nil {
				return err
			}
		}
		plan, err := posting.PlanSave(currentSnap, entry)
		if err != nil {
			return err
		}
		if plan.Insert {
			if err := insertJournal(tx, doc, cmd.At); err != nil {
				return err
			}
			result = store.SaveJournalResult{Inserted: true, Revision: 0}
			return nil
		}
		revision := current.Revision + 1
		if err := updateJournal(tx, current, doc, plan, revision); err != nil {
			return err
		}
		result = store.SaveJournalResult{Revision: revision}
		return nil
	})
	return result, err
}

func journalIDOf(entry voucher.Snapshot) (string, error) {
	if v, ok := entry["journal_id"]; ok && len(v) > 0 && string(v) != "null" {
		var s string
		if err := json.Unmarshal(v, &s); err == nil {
			return s, nil
		}
	}
	return "", &store.Error{Kind: store.KindVoucherCreateConflict, Message: "Journal ID already exists or is invalid."}
}

// revisionPrecheck mirrors save_journal's two revision refusals, which run
// before the model build.
func revisionPrecheck(current store.JournalDoc, ok bool, entry voucher.Snapshot) error {
	if !ok {
		if _, present := entry["revision"]; present {
			return &store.Error{Kind: posting.KindVoucherRevisionConflict, Message: "Voucher no longer exists."}
		}
		return nil
	}
	submittedRev := optRevision(entry)
	if submittedRev == nil || *submittedRev != current.Revision {
		return &store.Error{Kind: posting.KindVoucherRevisionConflict, Message: "Reload before saving."}
	}
	return nil
}

func optRevision(entry voucher.Snapshot) *int64 {
	raw, present := entry["revision"]
	if !present || len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil
	}
	i, err := n.Int64()
	if err != nil {
		return nil
	}
	return &i
}

func insertJournal(tx *writeTx, doc store.JournalDoc, at string) error {
	pairs, err := store.JournalDocPairs(doc, toTS)
	if err != nil {
		return err
	}
	// The model's created_at default (datetime.now in the reference): when
	// the dict carries no created_at, the command's timestamp fills the NOT
	// NULL column. A dict-carried created_at was already joined by
	// JournalDocPairs.
	if !doc.CreatedAt.Set {
		ts, err := toTS(at)
		if err != nil {
			return fmt.Errorf("sqlite: created_at: %w", err)
		}
		pairs = append(pairs, store.ColVal{Col: "created_at", Val: ts})
	}
	// block_index's model default is 0 (a Python-side default the ORM
	// applies at flush); an insert without the key writes 0. A present-null
	// key writes NULL and hits the NOT NULL constraint, as in the reference.
	if !doc.BlockIndex.Set {
		pairs = append(pairs, store.ColVal{Col: "block_index", Val: int64(0)})
	}
	cols := make([]string, 0, len(pairs)+1)
	ph := make([]string, 0, len(pairs)+1)
	args := make([]any, 0, len(pairs)+1)
	for _, p := range pairs {
		cols = append(cols, p.Col)
		ph = append(ph, "?")
		args = append(args, p.Val)
	}
	// The insert path always writes revision 0.
	cols = append(cols, "revision")
	ph = append(ph, "?")
	args = append(args, 0)
	_, err = tx.exec(`INSERT INTO journal_entries (`+strings.Join(cols, ", ")+`) VALUES (`+strings.Join(ph, ", ")+`)`, args...)
	if err != nil {
		if constraintErr(err) {
			return &store.Error{Kind: store.KindVoucherCreateConflict, Message: "Journal ID already exists or is invalid."}
		}
		return fmt.Errorf("sqlite: journal insert: %w", err)
	}
	return nil
}

func updateJournal(tx *writeTx, current store.JournalDoc, doc store.JournalDoc, plan posting.SavePlan, revision int64) error {
	var pairs []store.ColVal
	var err error
	if plan.StatusOnly {
		// The finalized branch writes the status column only.
		pairs = []store.ColVal{{Col: "status", Val: string(plan.Status)}}
	} else {
		pairs, err = store.JournalDocPairs(doc, toTS)
		if err != nil {
			return err
		}
	}
	sets := make([]string, 0, len(pairs)+1)
	args := make([]any, 0, len(pairs)+3)
	for _, p := range pairs {
		sets = append(sets, p.Col+" = ?")
		args = append(args, p.Val)
	}
	sets = append(sets, "revision = ?")
	args = append(args, revision)
	args = append(args, current.JournalID, current.Revision, string(current.Status))
	res, err := tx.exec(`UPDATE journal_entries SET `+strings.Join(sets, ", ")+`
		WHERE journal_id = ? AND revision = ? AND status = ?`, args...)
	if err != nil {
		return fmt.Errorf("sqlite: journal update: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("sqlite: journal update: %w", err)
	}
	if n != 1 {
		return &store.Error{Kind: posting.KindVoucherRevisionConflict, Message: "Reload before saving."}
	}
	return nil
}

// ---------------------------------------------------------------------------
// PostVoucher — posting.post_voucher as one BEGIN IMMEDIATE transaction
// ---------------------------------------------------------------------------

func (s *Store) PostVoucher(ctx context.Context, cmd store.PostVoucherCommand) (store.PostResult, error) {
	var result store.PostResult
	err := withWrite(ctx, s, func(tx *writeTx) error {
		// 1. The entity lock serializes postings per entity, including the
		// first chain block (SQLite reserves the writer via BEGIN IMMEDIATE;
		// the FOR UPDATE form is kept for parity and is a no-op here). The
		// entity comes from the caller's dict, like the reference's
		// post_voucher reads journal.get("entity_code").
		entityCode := snapshotString(cmd.Submitted, "entity_code")
		if entityCode != "" {
			var one int
			err := tx.queryRow(`SELECT 1 FROM entities WHERE entity_code = ?`, entityCode).Scan(&one)
			if err == sql.ErrNoRows {
				return &store.Error{Kind: store.KindEntityNotFound,
					Message: fmt.Sprintf("ENTITY_NOT_FOUND: '%s'", entityCode)}
			}
			if err != nil {
				return fmt.Errorf("sqlite: entity lock: %w", err)
			}
		}

		// 2. The persisted row (the reference's get_journal).
		current, ok, err := loadJournalTx(tx, cmd.JournalID)
		if err != nil {
			return err
		}
		if !ok {
			return &store.Error{Kind: store.KindVoucherNotFound,
				Message: fmt.Sprintf("VOUCHER_NOT_FOUND: '%s'", cmd.JournalID)}
		}
		curSnap, err := store.SnapshotFromJournalDoc(current, renderTS)
		if err != nil {
			return err
		}
		journal, err := posting.ParseJournal(curSnap)
		if err != nil {
			return err
		}

		// 3. The posting inputs, loaded inside the write transaction.
		chart, err := loadChartTx(tx, journal.EntityCode)
		if err != nil {
			return err
		}
		periods, err := loadPeriodsTx(tx, journal.EntityCode)
		if err != nil {
			return err
		}
		chain, err := loadChainTx(tx, journal.EntityCode)
		if err != nil {
			return err
		}
		var original *posting.Journal
		var originalRows []voucher.LedgerLine
		effective := map[string]bool{}
		if journal.ReversalOfJournalID != nil {
			link := *journal.ReversalOfJournalID
			if err := effectiveReversalTx(tx, link, effective); err != nil {
				return err
			}
			original, err = loadOriginalTx(tx, link, journal.EntityCode)
			if err != nil {
				return err
			}
			if original != nil {
				if originalRows, err = loadLinesTx(tx, original.JournalID); err != nil {
					return err
				}
			}
		}

		// 4. The pure decision sequence, in the reference's order.
		plan, err := posting.Plan(posting.Input{
			Submitted:           cmd.Submitted,
			CurrentDoc:          curSnap,
			Current:             journal,
			Chart:               chart,
			Periods:             periods,
			Original:            original,
			OriginalRows:        originalRows,
			EffectiveReversalOf: effective,
			Chain:               chain,
			Approver:            cmd.Approver,
			PostedAt:            cmd.PostedAt,
		})
		if err != nil {
			return err
		}

		// 5. The store's posting-gate balance invariant: every posted entry
		// balances in exact decimals (engineering workflow §3). The
		// reference balanced at draft creation only; the seal is the last
		// gate before the chain.
		if !journal.TotalDebit.Equal(journal.TotalCredit) {
			return &store.Error{Kind: store.KindUnbalancedEntry,
				Message: fmt.Sprintf("借貸不平衡：借方 %s，貸方 %s。",
					journal.TotalDebit.String(), journal.TotalCredit.String())}
		}

		// 6. Apply: ledger lines, seal, the original's reversal — commit or
		// roll back together (BL-01/BL-03). The seal timestamp argument is
		// the transaction's clock for the rows' created_at (the store has
		// none of its own).
		if err := writeLines(tx, journal.JournalID, plan.Rows, cmd.PostedAt); err != nil {
			return err
		}
		if err := sealVoucher(tx, journal, plan); err != nil {
			return err
		}
		if plan.Original != nil {
			if err := markOriginalReversed(tx, original, plan.Original); err != nil {
				return err
			}
		}
		// 7. ensure_period's auto-create: the posting materializes the
		// period row the reference's get_period inserts on first use.
		if err := ensurePeriod(tx, journal.EntityCode, plan.PeriodCode, cmd.PostedAt); err != nil {
			return err
		}

		// 8. The committed state back to the caller (the reference's final
		// get_journal).
		sealed, ok, err := loadJournalTx(tx, cmd.JournalID)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("sqlite: sealed voucher vanished inside its own transaction")
		}
		snap, err := store.SnapshotFromJournalDoc(sealed, renderTS)
		if err != nil {
			return err
		}
		result = store.PostResult{
			EntryHash:     plan.Result.EntryHash,
			PrevEntryHash: plan.Result.PrevEntryHash,
			BlockIndex:    plan.Result.BlockIndex,
			Columns:       plan.Result.Columns,
			LinesWritten:  plan.Result.LinesWritten,
			Voucher:       snap,
		}
		return nil
	})
	return result, err
}

// snapshotString reads one string field of a snapshot, "" when absent or
// null (the reference's falsy read).
func snapshotString(snap voucher.Snapshot, field string) string {
	raw, ok := snap[field]
	if !ok || len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return ""
	}
	return s
}

func loadChartTx(tx *writeTx, entityCode string) ([]ledger.Account, error) {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT `+chartSelect+`
		FROM chart_of_accounts WHERE entity_code = ? ORDER BY account_code`, entityCode)
	if err != nil {
		return nil, fmt.Errorf("sqlite: chart: %w", err)
	}
	defer rows.Close()
	out := []ledger.Account{}
	for rows.Next() {
		a, err := store.ScanAccount(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func loadPeriodsTx(tx *writeTx, entityCode string) ([]ledger.Period, error) {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT period_id, entity_code, period_code,
		fiscal_year, period_number, start_date, end_date, status,
		closed_by_principal_key, closed_at, created_at
		FROM fiscal_periods WHERE entity_code = ? ORDER BY period_code`, entityCode)
	if err != nil {
		return nil, fmt.Errorf("sqlite: periods: %w", err)
	}
	defer rows.Close()
	out := []ledger.Period{}
	for rows.Next() {
		p, err := store.ScanPeriod(rows.Scan, renderTS)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// loadChainTx reads the entity's chain fields for the BL-25 allocation
// decision (the reference's get_latest_posted_hash/get_next_block_index
// queries; posting.ChainHead picks the head).
func loadChainTx(tx *writeTx, entityCode string) ([]posting.ChainEntry, error) {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT journal_id, status, entry_hash,
		block_index, posted_at, created_at FROM journal_entries
		WHERE entity_code = ? AND status IN ('POSTED', 'REVERSED') AND entry_hash IS NOT NULL
		ORDER BY block_index DESC, posted_at DESC, created_at DESC`, entityCode)
	if err != nil {
		return nil, fmt.Errorf("sqlite: chain: %w", err)
	}
	defer rows.Close()
	out := []posting.ChainEntry{}
	for rows.Next() {
		var e posting.ChainEntry
		var postedAt, createdAt sql.NullString
		var blockIndex sql.NullInt64
		if err := rows.Scan(&e.JournalID, &e.Status, &e.EntryHash, &blockIndex, &postedAt, &createdAt); err != nil {
			return nil, fmt.Errorf("sqlite: chain scan: %w", err)
		}
		e.BlockIndex = blockIndex.Int64
		e.PostedAt = postedAt.String
		e.CreatedAt = createdAt.String
		out = append(out, e)
	}
	return out, rows.Err()
}

// effectiveReversalTx answers the BL-03 uniqueness query: the journal IDs
// that already have an effective posted or reversed reversal.
func effectiveReversalTx(tx *writeTx, originalID string, into map[string]bool) error {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT journal_id FROM journal_entries
		WHERE reversal_of_journal_id = ? AND status IN ('POSTED', 'REVERSED')`, originalID)
	if err != nil {
		return fmt.Errorf("sqlite: effective reversal: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		into[id] = true
	}
	return rows.Err()
}

// loadOriginalTx loads the linked original; nil when no row exists for the
// link or when the row belongs to another entity (the value rules treat both
// as "original not found in this entity").
func loadOriginalTx(tx *writeTx, link, entityCode string) (*posting.Journal, error) {
	row := tx.queryRow(`SELECT `+strings.Join(store.JournalReadColumns, ", ")+`
		FROM journal_entries WHERE journal_id = ?`, link)
	doc, ok, err := scanJournalDoc(row)
	if err != nil {
		return nil, err
	}
	if !ok || doc.EntityCode != entityCode {
		return nil, nil
	}
	snap, err := store.SnapshotFromJournalDoc(doc, renderTS)
	if err != nil {
		return nil, err
	}
	j, err := posting.ParseJournal(snap)
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func loadLinesTx(tx *writeTx, journalID string) ([]voucher.LedgerLine, error) {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT line_id, journal_id, entity_code,
		line_number, account_id, account_code, account_name, period_code,
		entry_layer, accounting_date, tx_currency, exchange_rate, tx_debit,
		tx_credit, func_debit, func_credit, counterparty_id, counterparty_name,
		tax_code_id, func_tax_amount, business_use_pct, statement_ref, memo, created_at
		FROM journal_lines WHERE journal_id = ? ORDER BY line_number`, journalID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: lines: %w", err)
	}
	defer rows.Close()
	out := []voucher.LedgerLine{}
	for rows.Next() {
		l, err := store.ScanLine(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// writeLines ports write_lines_for_entry's write: replace, not append — a
// retry after a partial failure cannot double-post the same voucher. Line IDs
// are generated here (the reference's uuid4); created_at takes the
// transaction's timestamp argument (no hidden clock).
func writeLines(tx *writeTx, journalID string, rows []posting.Row, at string) error {
	if _, err := tx.exec(`DELETE FROM journal_lines WHERE journal_id = ?`, journalID); err != nil {
		return fmt.Errorf("sqlite: lines delete: %w", err)
	}
	createdAt, err := toTS(at)
	if err != nil {
		return fmt.Errorf("sqlite: line created_at: %w", err)
	}
	for _, r := range rows {
		lineID, err := newUUID()
		if err != nil {
			return fmt.Errorf("sqlite: line id: %w", err)
		}
		_, err = tx.exec(`INSERT INTO journal_lines (line_id, journal_id, entity_code,
			line_number, account_id, account_code, account_name, period_code,
			entry_layer, accounting_date, tx_currency, exchange_rate, tx_debit,
			tx_credit, func_debit, func_credit, counterparty_id, counterparty_name,
			tax_code_id, func_tax_amount, business_use_pct, statement_ref, memo, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			lineID, r.JournalID, r.EntityCode, r.LineNumber, r.AccountID,
			r.AccountCode, r.AccountName, r.PeriodCode, r.EntryLayer,
			r.AccountingDate, r.TxCurrency, r.ExchangeRate, r.TxDebit,
			r.TxCredit, r.FuncDebit, r.FuncCredit, r.CounterpartyID,
			r.CounterpartyName, r.TaxCodeID, r.FuncTaxAmount, r.BusinessUsePct,
			r.StatementRef, r.Memo, createdAt)
		if err != nil {
			return fmt.Errorf("sqlite: line insert: %w", err)
		}
	}
	return nil
}

// sealVoucher applies mark_posted's guarded transition to POSTED with a
// conditional write (the plan's seal patch; the plan computed the hash and
// chain position under the write lock).
func sealVoucher(tx *writeTx, journal posting.Journal, plan posting.PostingPlan) error {
	seal := plan.Voucher
	var reviewNotes any
	if seal.ReviewNotes != nil {
		reviewNotes = *seal.ReviewNotes
	}
	postedAt, err := toTS(seal.PostedAt)
	if err != nil {
		return fmt.Errorf("sqlite: posted_at: %w", err)
	}
	res, err := tx.exec(`UPDATE journal_entries SET status = 'POSTED', revision = ?,
		entry_hash = ?, prev_entry_hash = ?, block_index = ?, posted_at = ?,
		approved_by_principal_key = ?, approved_by_principal_id = ?, review_notes = ?
		WHERE journal_id = ? AND revision = ? AND status IN ('PENDING_CHECKER', 'AWAITING_CPA')`,
		seal.Revision, seal.EntryHash, seal.PrevEntryHash, seal.BlockIndex,
		postedAt, seal.ApproverKey, seal.ApproverID, reviewNotes,
		journal.JournalID, journal.Revision)
	if err != nil {
		return fmt.Errorf("sqlite: seal: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("sqlite: seal: %w", err)
	}
	if n != 1 {
		// mark_posted's defense-in-depth: the row moved under the caller
		// between the locked read and the write.
		return &voucher.PostingError{Kind: posting.KindCannotPostFinalized,
			Message: fmt.Sprintf("憑證 '%s' 目前狀態已變更，不可重複過賬或過賬已結案的分錄。", journal.JournalID)}
	}
	return nil
}

// markOriginalReversed applies _mark_original_reversed's conditional UPDATE:
// the original leaves POSTED for REVERSED in the same transaction (BL-03).
func markOriginalReversed(tx *writeTx, original *posting.Journal, seal *posting.OriginalSeal) error {
	res, err := tx.exec(`UPDATE journal_entries SET status = 'REVERSED', revision = ?
		WHERE journal_id = ? AND entity_code = ? AND status = 'POSTED' AND revision = ?`,
		seal.Revision, original.JournalID, original.EntityCode, original.Revision)
	if err != nil {
		return fmt.Errorf("sqlite: mark reversed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("sqlite: mark reversed: %w", err)
	}
	if n != 1 {
		return &voucher.PostingError{Kind: voucher.KindReversalConflict,
			Message: "original changed during approval. Reload before approval."}
	}
	return nil
}

// ensurePeriod materializes the fiscal_periods row the reference's
// get_period auto-creates on first use (ResolvePeriod's auto-create branch,
// whose insert is store work).
func ensurePeriod(tx *writeTx, entityCode, periodCode, at string) error {
	var one int
	err := tx.queryRow(`SELECT 1 FROM fiscal_periods WHERE period_id = ?`,
		entityCode+":"+periodCode).Scan(&one)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("sqlite: period lookup: %w", err)
	}
	span, err := ledger.PeriodBounds(periodCode)
	if err != nil {
		return err
	}
	ts, err := toTS(at)
	if err != nil {
		return fmt.Errorf("sqlite: period created_at: %w", err)
	}
	_, err = tx.exec(`INSERT INTO fiscal_periods (period_id, entity_code, period_code,
		fiscal_year, period_number, start_date, end_date, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
		entityCode+":"+periodCode, entityCode, periodCode, span.FiscalYear,
		span.PeriodNumber, span.Start, span.End, ts)
	if err != nil {
		return fmt.Errorf("sqlite: period insert: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// VerifyChain — the pure rule over the persisted chain fields
// ---------------------------------------------------------------------------

func (s *Store) VerifyChain(ctx context.Context, entityCode string) (positions.ChainReport, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT status, entry_hash, prev_entry_hash,
		created_at, journal_id, entity_code, accounting_date, total_debit,
		total_credit, created_by_principal_id, approved_by_principal_id, lines_json
		FROM journal_entries WHERE entity_code = ?`, entityCode)
	if err != nil {
		return positions.ChainReport{}, fmt.Errorf("sqlite: chain read: %w", err)
	}
	defer rows.Close()
	records := []positions.JournalRecord{}
	for rows.Next() {
		var r positions.JournalRecord
		var status, createdAt, approvedBy sql.NullString
		var linesJSON string
		if err := rows.Scan(&status, &r.EntryHash, &r.PrevEntryHash, &createdAt,
			&r.JournalID, &r.EntityCode, &r.AccountingDate, &r.TotalDebit,
			&r.TotalCredit, &r.CreatedByPrincipalID, &approvedBy, &linesJSON); err != nil {
			return positions.ChainReport{}, fmt.Errorf("sqlite: chain scan: %w", err)
		}
		r.Status = status.String
		r.CreatedAt = createdAt.String
		if approvedBy.Valid {
			r.ApprovedByPrincipalID = approvedBy.String
		}
		lines, err := store.ParseHashLines(linesJSON)
		if err != nil {
			return positions.ChainReport{}, err
		}
		r.Lines = lines
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		return positions.ChainReport{}, fmt.Errorf("sqlite: chain read: %w", err)
	}
	report, err := positions.VerifyHashChain(records)
	if err != nil {
		return positions.ChainReport{}, err
	}
	// The wire form renders timestamps in ISO; the pure rule sorts on the
	// created_at strings, so normalize them first for a chronological order
	// across mixed storage forms.
	return report, nil
}
