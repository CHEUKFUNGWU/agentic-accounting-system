package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/localization"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store"
)

// This file ports backend/app/core/document_sources.py on SQLite: the
// entity-locked document transactions (the same lock order as posting:
// entity, then documents/journals/period), the exact-byte source registry
// with its legacy-identity adoption, the atomic capture, and the
// require_unused + insert-draft + link-source conversion whose atomicity is
// the BL-05 fix. File hashes alone stay insufficient for duplicate economic
// events: ClaimDocument's DuplicateOf carries the same-economics candidates
// (normalized counterparty + amount + doc_date, different sha256) for human
// review — detection, not a new blocking rule.

var hashRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// sourceHash mirrors document_sources.source_hash: lowercase, full SHA256.
func sourceHash(value string) (string, error) {
	value = strings.ToLower(value)
	if !hashRe.MatchString(value) {
		return "", &store.Error{Kind: store.KindDocumentHashRequired, Message: "A full SHA256 is required."}
	}
	return value, nil
}

func contentDigest(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// sourceRow is one document_sources row.
type sourceRow struct {
	EntityCode string
	SHA256     string
	DocumentID *string
	JournalID  *string
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

func (s *Store) Documents(ctx context.Context, q store.DocumentsQuery) ([]store.Document, error) {
	sqlStr := `SELECT ` + strings.Join(store.DocumentColumns, ", ") + ` FROM documents`
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
	sqlStr += " ORDER BY doc_date DESC, created_at DESC"
	rows, err := s.db.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlite: documents: %w", err)
	}
	defer rows.Close()
	out := []store.Document{}
	for rows.Next() {
		d, err := store.ScanDocument(rows.Scan, renderTS)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) Document(ctx context.Context, documentID string) (store.Document, error) {
	d, ok, err := s.document(ctx, documentID)
	if err != nil {
		return store.Document{}, err
	}
	if !ok {
		return store.Document{}, store.NotFound(store.KindDocumentNotFound, "Document '"+documentID+"'")
	}
	return d, nil
}

func (s *Store) document(ctx context.Context, documentID string) (store.Document, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+strings.Join(store.DocumentColumns, ", ")+`
		FROM documents WHERE document_id = ?`, documentID)
	return scanDocumentRow(row)
}

func scanDocumentRow(row *sql.Row) (store.Document, bool, error) {
	d, err := store.ScanDocument(row.Scan, renderTS)
	if err == sql.ErrNoRows {
		return store.Document{}, false, nil
	}
	if err != nil {
		return store.Document{}, false, fmt.Errorf("sqlite: document read: %w", err)
	}
	return d, true, nil
}

// ---------------------------------------------------------------------------
// ClaimDocument — document_sources.capture
// ---------------------------------------------------------------------------

func (s *Store) ClaimDocument(ctx context.Context, cmd store.ClaimDocumentCommand) (store.ClaimResult, error) {
	digest, err := sourceHash(cmd.Record.SHA256)
	if err != nil {
		return store.ClaimResult{}, err
	}
	if contentDigest(cmd.Content) != digest {
		return store.ClaimResult{}, &store.Error{Kind: store.KindDocumentHashMismatch, Message: "DOCUMENT_HASH_MISMATCH"}
	}
	var doc store.Document
	err = withWrite(ctx, s, func(tx *writeTx) error {
		// Same lock order as posting: entity first.
		if err := lockEntity(tx, cmd.Record.EntityCode); err != nil {
			return err
		}
		source, err := registryTx(tx, cmd.Record.EntityCode, digest)
		if err != nil {
			return err
		}
		if err := writeSource(tx, source); err != nil {
			return err
		}
		if source.DocumentID != nil {
			// Adoption: the canonical document must exist and its evidence
			// must match these exact bytes.
			d, ok, err := documentTx(tx, *source.DocumentID)
			if err != nil {
				return err
			}
			if !ok {
				return &store.Error{Kind: store.KindDocumentHistoryConflict,
					Message: "Canonical source is missing; manual review required."}
			}
			if err := s.verifyEvidence(d.EntityCode, d.StoredName, digest, cmd.Content); err != nil {
				return err
			}
			doc = d
		} else {
			// New canonical document. A source identity that already carries
			// a journal (adopted from history) marks the document POSTED.
			d := cmd.Record
			d.SHA256 = digest
			if source.JournalID != nil {
				d.Status = "POSTED"
				d.JournalID = source.JournalID
				postedAt, err := toTS(cmd.At)
				if err != nil {
					return fmt.Errorf("sqlite: posted_at: %w", err)
				}
				d.PostedAt = &postedAt
			}
			if err := s.verifyEvidence(d.EntityCode, d.StoredName, digest, cmd.Content); err != nil {
				return err
			}
			if err := insertDocument(tx, d, cmd.At); err != nil {
				return err
			}
			source.DocumentID = &d.DocumentID
			doc = d
		}
		if err := writeSource(tx, source); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return store.ClaimResult{}, err
	}
	dupes, err := s.duplicateEconomics(ctx, doc)
	if err != nil {
		return store.ClaimResult{}, err
	}
	return store.ClaimResult{Document: doc, DuplicateOf: dupes}, nil
}

// duplicateEconomics is the BL-05 detection: other documents of the entity
// with the same normalized counterparty, amount and doc_date but a different
// sha256.
func (s *Store) duplicateEconomics(ctx context.Context, doc store.Document) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT document_id, sha256, counterparty_name, amount, doc_date
		FROM documents WHERE entity_code = ? AND document_id <> ?`, doc.EntityCode, doc.DocumentID)
	if err != nil {
		return nil, fmt.Errorf("sqlite: duplicate scan: %w", err)
	}
	defer rows.Close()
	amount, err := money.Parse(doc.Amount)
	if err != nil {
		// The caller's amount was not a decimal: no comparison basis.
		return []string{}, nil
	}
	out := []string{}
	for rows.Next() {
		var id, sha, counterparty, amountStr, docDate string
		if err := rows.Scan(&id, &sha, &counterparty, &amountStr, &docDate); err != nil {
			return nil, fmt.Errorf("sqlite: duplicate scan: %w", err)
		}
		if strings.ToLower(sha) == strings.ToLower(doc.SHA256) {
			continue // same bytes: the exact-byte identity, not a duplicate
		}
		if normalizeCounterparty(counterparty) != normalizeCounterparty(doc.CounterpartyName) {
			continue
		}
		if docDate != doc.DocDate {
			continue
		}
		other, err := money.Parse(amountStr)
		if err != nil || !other.Equal(amount) {
			continue
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// normalizeCounterparty is the BL-05 normalization: case- and
// whitespace-insensitive counterparty name.
func normalizeCounterparty(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(name)), " "))
}

// lockEntity mirrors document_sources._lock_entity.
func lockEntity(tx *writeTx, entityCode string) error {
	var one int
	err := tx.queryRow(`SELECT 1 FROM entities WHERE entity_code = ?`, entityCode).Scan(&one)
	if err == sql.ErrNoRows {
		return &store.Error{Kind: store.KindEntityNotFound, Message: fmt.Sprintf("ENTITY_NOT_FOUND: '%s'", entityCode)}
	}
	if err != nil {
		return fmt.Errorf("sqlite: entity lock: %w", err)
	}
	return nil
}

// registryTx ports document_sources.registry: adopt legacy identities
// without rewriting any financial history.
func registryTx(tx *writeTx, entityCode, digest string) (sourceRow, error) {
	source, err := readSource(tx, entityCode, digest)
	if err != nil {
		return sourceRow{}, err
	}
	// Siblings: the entity's documents carrying these bytes (case-
	// insensitive sha256), oldest first — the canonical candidate order.
	siblings, err := siblingDocuments(tx, entityCode, digest)
	if err != nil {
		return sourceRow{}, err
	}
	journals := map[string]bool{}
	for _, d := range siblings {
		if d.JournalID != nil {
			journals[*d.JournalID] = true
		}
	}
	if source.JournalID != nil {
		journals[*source.JournalID] = true
	}
	// Supporting attachments intentionally do not count as source
	// provenance: only proposal_json's document_sha256 binds a journal.
	proposals, err := proposalJournals(tx, entityCode, digest)
	if err != nil {
		return sourceRow{}, err
	}
	for id := range proposals {
		journals[id] = true
	}
	if len(journals) > 1 {
		return sourceRow{}, &store.Error{Kind: store.KindDocumentHistoryConflict,
			Message: "Multiple historic journals; manual review required."}
	}
	for _, d := range siblings {
		if d.Status == "POSTED" && d.JournalID == nil {
			return sourceRow{}, &store.Error{Kind: store.KindDocumentHistoryConflict,
				Message: "Linked source lacks a journal; manual review required."}
		}
	}
	if source == (sourceRow{}) {
		source = sourceRow{EntityCode: entityCode, SHA256: digest}
	}
	if source.DocumentID == nil && len(siblings) > 0 {
		source.DocumentID = &siblings[0].DocumentID
	}
	for id := range journals {
		id := id
		source.JournalID = &id
	}
	return source, nil
}

func readSource(tx *writeTx, entityCode, digest string) (sourceRow, error) {
	var s sourceRow
	var documentID, journalID sql.NullString
	err := tx.queryRow(`SELECT entity_code, sha256, document_id, journal_id
		FROM document_sources WHERE entity_code = ? AND sha256 = ?`, entityCode, digest).
		Scan(&s.EntityCode, &s.SHA256, &documentID, &journalID)
	if err == sql.ErrNoRows {
		return sourceRow{}, nil
	}
	if err != nil {
		return sourceRow{}, fmt.Errorf("sqlite: source read: %w", err)
	}
	if documentID.Valid {
		s.DocumentID = &documentID.String
	}
	if journalID.Valid {
		s.JournalID = &journalID.String
	}
	return s, nil
}

func siblingDocuments(tx *writeTx, entityCode, digest string) ([]store.Document, error) {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT `+strings.Join(store.DocumentColumns, ", ")+`
		FROM documents WHERE entity_code = ? AND lower(sha256) = ?
		ORDER BY created_at, document_id`, entityCode, digest)
	if err != nil {
		return nil, fmt.Errorf("sqlite: sibling documents: %w", err)
	}
	defer rows.Close()
	out := []store.Document{}
	for rows.Next() {
		d, err := store.ScanDocument(rows.Scan, renderTS)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// proposalJournals mirrors the registry's proposal scan: journals whose
// proposal_json names this digest as its document.
func proposalJournals(tx *writeTx, entityCode, digest string) (map[string]bool, error) {
	rows, err := tx.conn.QueryContext(tx.ctx, `SELECT journal_id, proposal_json
		FROM journal_entries WHERE entity_code = ? AND proposal_json IS NOT NULL`, entityCode)
	if err != nil {
		return nil, fmt.Errorf("sqlite: proposals: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id, proposalJSON string
		if err := rows.Scan(&id, &proposalJSON); err != nil {
			return nil, err
		}
		var proposal map[string]json.RawMessage
		if err := json.Unmarshal([]byte(proposalJSON), &proposal); err != nil {
			continue // the reference skips undecodable proposals
		}
		var docSHA string
		if err := json.Unmarshal(proposal["document_sha256"], &docSHA); err != nil {
			continue
		}
		if strings.ToLower(docSHA) == digest {
			out[id] = true
		}
	}
	return out, rows.Err()
}

func writeSource(tx *writeTx, s sourceRow) error {
	res, err := tx.exec(`UPDATE document_sources SET document_id = ?, journal_id = ?
		WHERE entity_code = ? AND sha256 = ?`,
		s.DocumentID, s.JournalID, s.EntityCode, s.SHA256)
	if err != nil {
		return fmt.Errorf("sqlite: source write: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 1 {
		return nil
	}
	if _, err := tx.exec(`INSERT INTO document_sources (entity_code, sha256, document_id, journal_id)
		VALUES (?, ?, ?, ?)`, s.EntityCode, s.SHA256, s.DocumentID, s.JournalID); err != nil {
		return fmt.Errorf("sqlite: source insert: %w", err)
	}
	return nil
}

func insertDocument(tx *writeTx, d store.Document, at string) error {
	createdAt, err := toTS(at)
	if err != nil {
		return fmt.Errorf("sqlite: created_at: %w", err)
	}
	var postedAt any
	if d.PostedAt != nil {
		ts, err := toTS(*d.PostedAt)
		if err != nil {
			return fmt.Errorf("sqlite: posted_at: %w", err)
		}
		postedAt = ts
	}
	_, err = tx.exec(`INSERT INTO documents (document_id, entity_code, doc_type, doc_date,
		counterparty_id, counterparty_name, amount, currency, status, journal_id,
		filename, stored_name, mime, size, sha256, uploaded_by, note, created_at, posted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.DocumentID, d.EntityCode, d.DocType, d.DocDate, d.CounterpartyID,
		d.CounterpartyName, d.Amount, d.Currency, d.Status, d.JournalID,
		d.Filename, d.StoredName, d.Mime, d.Size, d.SHA256, d.UploadedBy,
		d.Note, createdAt, postedAt)
	if err != nil {
		if constraintErr(err) {
			return &store.Error{Kind: store.KindDocumentHistoryConflict,
				Message: "Document identity conflict; manual review required."}
		}
		return fmt.Errorf("sqlite: document insert: %w", err)
	}
	return nil
}

// documentTx loads one document inside a transaction.
func documentTx(tx *writeTx, documentID string) (store.Document, bool, error) {
	row := tx.queryRow(`SELECT `+strings.Join(store.DocumentColumns, ", ")+`
		FROM documents WHERE document_id = ?`, documentID)
	return scanDocumentRow(row)
}

// verifyEvidence ports verify_document's file half: the stored evidence file
// must exist (ATTACHMENT_NOT_FOUND) and hash to the digest, and when
// expected content is given the bytes must match exactly
// (DOCUMENT_HASH_MISMATCH). Evidence lives in the attachments directory next
// to the ledger file, as vouchers.attachment_root places it.
func (s *Store) verifyEvidence(entityCode, storedName, digest string, content []byte) error {
	if storedName == "" || strings.ContainsAny(storedName, "/\\") || strings.HasPrefix(storedName, ".") {
		return &store.Error{Kind: store.KindAttachmentNotFound, Message: "Source evidence is missing."}
	}
	path := filepath.Join(s.evidenceDir, entityCode, storedName)
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &store.Error{Kind: store.KindAttachmentNotFound, Message: "Source evidence is missing."}
		}
		return fmt.Errorf("sqlite: evidence read: %w", err)
	}
	if contentDigest(raw) != digest {
		return &store.Error{Kind: store.KindDocumentHashMismatch,
			Message: "Stored evidence does not match source bytes."}
	}
	if content != nil && string(raw) != string(content) {
		return &store.Error{Kind: store.KindDocumentHashMismatch,
			Message: "Stored evidence does not match source bytes."}
	}
	return nil
}

// ---------------------------------------------------------------------------
// ClaimDocumentForVoucher — require_unused + insert-draft + link-source
// ---------------------------------------------------------------------------

func (s *Store) ClaimDocumentForVoucher(ctx context.Context, cmd store.ClaimDocumentForVoucherCommand) (store.ConversionResult, error) {
	var result store.ConversionResult
	err := withWrite(ctx, s, func(tx *writeTx) error {
		// document_transaction: an unlocked locator read finds the entity,
		// then the entity lock precedes any state read.
		var entityCode string
		err := tx.queryRow(`SELECT entity_code FROM documents WHERE document_id = ?`, cmd.DocumentID).Scan(&entityCode)
		if err == sql.ErrNoRows {
			return store.NotFound(store.KindDocumentNotFound, "Document '"+cmd.DocumentID+"'")
		}
		if err != nil {
			return fmt.Errorf("sqlite: document locator: %w", err)
		}
		if err := lockEntity(tx, entityCode); err != nil {
			return err
		}
		doc, ok, err := documentTx(tx, cmd.DocumentID)
		if err != nil {
			return err
		}
		if !ok {
			return store.NotFound(store.KindDocumentNotFound, "Document '"+cmd.DocumentID+"'")
		}
		digest, err := sourceHash(doc.SHA256)
		if err != nil {
			return err
		}
		// The document's own evidence must exist and match its digest.
		if err := s.verifyEvidence(doc.EntityCode, doc.StoredName, digest, nil); err != nil {
			return err
		}
		source, err := registryTx(tx, doc.EntityCode, digest)
		if err != nil {
			return err
		}
		// registry's flush: the adopted identity persists even when a later
		// check refuses, exactly as the reference's session flush does.
		if err := writeSource(tx, source); err != nil {
			return err
		}
		if source.JournalID != nil {
			return &store.Error{Kind: store.KindDocumentAlreadyUsed,
				Message: "Exact source already has a journal."}
		}
		if source.DocumentID != nil {
			canonical, ok, err := documentTx(tx, *source.DocumentID)
			if err != nil {
				return err
			}
			if ok {
				if err := s.verifyEvidence(canonical.EntityCode, canonical.StoredName, digest, nil); err != nil {
					return err
				}
				if canonical.Status != "NEW" {
					return &store.Error{Kind: store.KindDocumentAlreadyUsed,
						Message: "Canonical document is not NEW."}
				}
			}
		}
		if doc.Status != "NEW" {
			return &store.Error{Kind: store.KindDocumentAlreadyUsed,
				Message: fmt.Sprintf("單據狀態為 %s，已轉成憑證或已作廢。", doc.Status)}
		}
		if cmd.DebitAccountCode == "" || cmd.CreditAccountCode == "" {
			return &store.Error{Kind: store.KindAccountsRequired, Message: "需要借方與貸方科目。"}
		}
		chart, err := loadChartTx(tx, doc.EntityCode)
		if err != nil {
			return err
		}
		debit := ledger.AccountByCode(chart, cmd.DebitAccountCode)
		credit := ledger.AccountByCode(chart, cmd.CreditAccountCode)
		if debit == nil || credit == nil {
			return &store.Error{Kind: store.KindCOAMissingAccount, Message: "科目不存在於科目表。"}
		}
		amount, err := money.Parse(orZero(doc.Amount))
		if err != nil {
			return fmt.Errorf("sqlite: document amount: %w", err)
		}
		// The reference's conversion order (api_documents.py:166-171): q4 —
		// ROUND_HALF_UP to four places (localization.Q4) — runs FIRST, and
		// the zero gate reads the ROUNDED value, so a 5th-decimal tie drafts
		// 0.0001 and 0.00004 refuses.
		amountQ4, err := localization.Q4(amount)
		if err != nil {
			return fmt.Errorf("sqlite: document amount: %w", err)
		}
		zero, _ := money.Parse("0")
		if amountQ4.Cmp(zero) <= 0 {
			return &store.Error{Kind: store.KindAmountRequired,
				Message: "單據金額為零，無法產生分錄。請先補上金額。"}
		}
		period, err := ledger.ValidatePostingDate(doc.DocDate, nil)
		if err != nil {
			return err
		}
		periods, err := loadPeriodsTx(tx, doc.EntityCode)
		if err != nil {
			return err
		}
		date := doc.DocDate
		if _, err := ledger.AssertWritable(doc.EntityCode, period, &date, periods); err != nil {
			return err
		}

		// The draft (insert_draft's contract): a new draft ID, no revision,
		// no seal fields, two balanced lines from the document.
		draftID, err := newUUID()
		if err != nil {
			return fmt.Errorf("sqlite: draft id: %w", err)
		}
		// amountQ4 was rounded (localization.Q4, ROUND_HALF_UP) at the gate
		// above, matching the reference's conversion order.
		amountStr := amountQ4.String()
		label := doc.CounterpartyName
		if label == "" {
			label = doc.Filename
		}
		memo := cmd.Memo
		if memo == "" {
			memo = doc.DocType + " · " + label
		}
		draft := store.JournalDoc{
			JournalID:             draftID,
			EntityCode:            doc.EntityCode,
			SourceModule:          "GL_MANUAL",
			Status:                voucher.StatusDraft,
			AccountingDate:        doc.DocDate,
			Currency:              doc.Currency,
			TotalDebit:            amountStr,
			TotalCredit:           amountStr,
			CreatedByPrincipalKey: cmd.MakerPrincipalKey,
			CreatedByPrincipalID:  cmd.MakerPrincipalID,
			AIConfidenceScore:     "1.0000",
			Period:                store.StringOpt(period),
			EntryLayer:            store.StringOpt("OPERATIONAL"),
			Basis:                 store.StringOpt("EXTRACTED"),
			Memo:                  store.StringOpt(memo),
		}
		draft.LinesJSON, draft.EvidenceURIs, err = draftLinesJSON(debit, credit, amountStr, memo, doc, cmd.At)
		if err != nil {
			return err
		}
		if err := insertJournal(tx, draft, cmd.At); err != nil {
			return err
		}
		// link_source: the source identity and the document move together
		// with the draft insert, in this one transaction (BL-05).
		source.DocumentID = &doc.DocumentID
		source.JournalID = &draftID
		if err := writeSource(tx, source); err != nil {
			return err
		}
		postedAt, err := toTS(cmd.At)
		if err != nil {
			return fmt.Errorf("sqlite: posted_at: %w", err)
		}
		if _, err := tx.exec(`UPDATE documents SET status = 'POSTED', journal_id = ?, posted_at = ?
			WHERE document_id = ?`, draftID, postedAt, doc.DocumentID); err != nil {
			return fmt.Errorf("sqlite: document link: %w", err)
		}
		updated, ok, err := documentTx(tx, doc.DocumentID)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("sqlite: linked document vanished inside its own transaction")
		}
		result = store.ConversionResult{JournalID: draftID, Document: updated}
		return nil
	})
	return result, err
}

// orZero is the reference's `document["amount"] or 0`.
func orZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

// draftLinesJSON renders the draft's lines and evidence record in the
// Python-json.dumps form the reference's _convert_document builds.
func draftLinesJSON(debit, credit *ledger.Account, amountStr, memo string, doc store.Document, at string) (linesJSON, evidenceJSON string, err error) {
	counterpartyID := any(nil)
	if doc.CounterpartyID != nil {
		counterpartyID = *doc.CounterpartyID
	}
	evidence := []any{
		map[string]any{
			"kind":        "voucher_attachment",
			"name":        doc.Filename,
			"stored_name": doc.StoredName,
			"mime":        doc.Mime,
			"size":        doc.Size,
			"sha256":      doc.SHA256,
			"uploaded_by": doc.UploadedBy,
			"uploaded_at": secondsOf(at),
		},
	}
	lines := []any{
		map[string]any{
			"line_number":     int64(1),
			"account_code":    debit.AccountCode,
			"account_name":    debit.AccountName,
			"debit":           amountStr,
			"credit":          "0.0000",
			"memo":            memo,
			"counterparty":    doc.CounterpartyName,
			"counterparty_id": counterpartyID,
			"tax_code":        "",
		},
		map[string]any{
			"line_number":     int64(2),
			"account_code":    credit.AccountCode,
			"account_name":    credit.AccountName,
			"debit":           "0.0000",
			"credit":          amountStr,
			"memo":            memo,
			"counterparty":    doc.CounterpartyName,
			"counterparty_id": counterpartyID,
			"tax_code":        "",
		},
	}
	// Encode through the ordered decoder/encoder for the Python dumps form.
	linesRaw, err := json.Marshal(lines)
	if err != nil {
		return "", "", err
	}
	linesVal, err := store.DecodeOrdered(linesRaw)
	if err != nil {
		return "", "", err
	}
	evidenceRaw, err := json.Marshal(evidence)
	if err != nil {
		return "", "", err
	}
	evidenceVal, err := store.DecodeOrdered(evidenceRaw)
	if err != nil {
		return "", "", err
	}
	return store.PyEncode(linesVal), store.PyEncode(evidenceVal), nil
}

// secondsOf renders an ISO timestamp like Python isoformat(timespec="seconds").
func secondsOf(iso string) string {
	t, err := store.ParseISOTime(iso)
	if err != nil {
		return iso
	}
	return t.Format("2006-01-02T15:04:05") + "+00:00"
}

// ---------------------------------------------------------------------------
// VoidDocument
// ---------------------------------------------------------------------------

func (s *Store) VoidDocument(ctx context.Context, cmd store.VoidDocumentCommand) (store.Document, error) {
	var result store.Document
	err := withWrite(ctx, s, func(tx *writeTx) error {
		if strings.TrimSpace(cmd.Reason) == "" {
			return &store.Error{Kind: store.KindReasonRequired, Message: "作廢必須填寫理由。"}
		}
		var entityCode string
		err := tx.queryRow(`SELECT entity_code FROM documents WHERE document_id = ?`, cmd.DocumentID).Scan(&entityCode)
		if err == sql.ErrNoRows {
			return store.NotFound(store.KindDocumentNotFound, "Document '"+cmd.DocumentID+"'")
		}
		if err != nil {
			return fmt.Errorf("sqlite: document locator: %w", err)
		}
		if err := lockEntity(tx, entityCode); err != nil {
			return err
		}
		doc, ok, err := documentTx(tx, cmd.DocumentID)
		if err != nil {
			return err
		}
		if !ok {
			return store.NotFound(store.KindDocumentNotFound, "Document '"+cmd.DocumentID+"'")
		}
		digest, err := sourceHash(doc.SHA256)
		if err != nil {
			return err
		}
		source, err := registryTx(tx, doc.EntityCode, digest)
		if err != nil {
			return err
		}
		if err := writeSource(tx, source); err != nil {
			return err
		}
		if doc.JournalID != nil || doc.Status == "POSTED" || source.JournalID != nil {
			return &store.Error{Kind: store.KindDocumentLinked, Message: "Source already has a journal."}
		}
		if _, err := tx.exec(`UPDATE documents SET status = 'VOID', note = ? WHERE document_id = ?`,
			strings.TrimSpace(cmd.Reason), cmd.DocumentID); err != nil {
			return fmt.Errorf("sqlite: void: %w", err)
		}
		updated, ok, err := documentTx(tx, cmd.DocumentID)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("sqlite: voided document vanished inside its own transaction")
		}
		result = updated
		return nil
	})
	return result, err
}
