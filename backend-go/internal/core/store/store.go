// Package store is the single storage seam for the accounting backend
// (REQ-0035 design.md §store): one Store interface with exactly two adapters
// — sqlite (WAL, TEXT money, BEGIN IMMEDIATE, file backup) and pgx
// (PostgreSQL, entity row locks, SET LOCAL tenant hook). Only store adapters
// own transactions: every command below opens and holds its one transaction
// here and nowhere else (design rule 5, ADR-0001 D1 single write path).
//
// # Interface shaping (design.md deferred this to P2)
//
// design.md's sketch named PostVoucher, ReverseVoucher, Review, ClaimDocument,
// VoucherView, LedgerView, Receipt and an embedded chain store. P1 shaped the
// pure rules first, and the final interface follows the pure split:
//
//   - Reversal and review are not store commands. A reversal is a voucher
//     draft linked to its original (reversal_of_journal_id); posting it seals
//     it and marks the original REVERSED in the same transaction (BL-03), so
//     PostVoucher carries both. Review decisions are position policy (P4,
//     mcproles) that lands as SaveJournal state transitions; the guards' pure
//     logic is posting.PlanSave and the store enforces it with conditional
//     writes.
//   - The posting sequence is posting.Plan over store-assembled Input; the
//     store's PostVoucher is the transaction that loads the inputs, runs the
//     plan and applies it under the reference's serialization discipline.
//   - VoucherView and LedgerView from the sketch became the raw feeds
//     Journal/Journals/LedgerLines: the view assemblies are pure P1
//     projections (reporting.ProjectAccountLedger, ledger.AccountLedger) that
//     consume exactly these rows; a store-side view would duplicate pure
//     logic behind I/O. Journal itself returns the voucher.Snapshot wire form,
//     which is the voucher view the frozen reference serves.
//   - VerifyChain is the store's read over the journal_entries chain fields;
//     positions.VerifyHashChain stays the pure rule (design.md's chain.ChainStore
//     is realized by it — the chain's bytes live in journal_entries columns and
//     Append is part of the PostVoucher transaction).
//
// # Accounting discipline carried here
//
//   - Money is TEXT/VARCHAR on BOTH databases (the effective schema of
//     backend/app/core/db.py): money strings cross the store byte-identical
//     and are parsed only at the domain boundary (money.Parse). No float64
//     ever touches a money value.
//   - Posted entries are immutable: the only write that touches a finalized
//     row is the status-only POSTED→REVERSED transition (SaveJournal) and the
//     posting engine's seal (PostVoucher). Corrections are reversals.
//   - Commands serialize per entity: SQLite opens every write transaction
//     with BEGIN IMMEDIATE before any read (the reference's discipline); the
//     pgx adapter takes SELECT ... FOR UPDATE on the entity row first, so the
//     chain head read and the seal commit are serialized (BL-25).
//   - The audit trail and chain are append-only: nothing in this interface
//     updates or deletes a posted row, an audit log row or a chain field.
//
// # BL-05 interpretation (duplicate economic-event detection)
//
// The audit finding requires "atomic document claims plus duplicate
// economic-event detection; file hashes alone are insufficient". This package
// implements DETECTION, not a new blocking rule: ClaimDocument's result
// carries DuplicateOf — the entity's other documents with the same normalized
// counterparty (case- and whitespace-insensitive name), the same amount
// (exact decimal equality) and the same doc_date but a DIFFERENT sha256. They
// are candidates for a human to review as one economic event uploaded twice.
// The exact-byte claim stays the hard atomic guarantee: one document_sources
// row per (entity, sha256), one canonical document per source identity, and
// ClaimDocumentForVoucher is require_unused + insert-draft + link-source in
// one transaction, so two concurrent conversions of one NEW document produce
// exactly one voucher and one link (the BL-05 reproduction refused).
//
// # BL-28 receipts (idempotency)
//
// ReceiptKey = principal + entity + payload hash (the canonical JSON of the
// command payload; hashing is the caller's). PutReceipt is insert-if-absent
// and returns the stored receipt either way, so a timed-out command resolves
// by querying with the same key — never by posting twice (engineering
// workflow §3). The frozen Python schema has NO receipts table: the
// command_receipts table is NEW behaviour and its DDL belongs in a goose
// migration (migrations/** is another work package). Both adapters implement
// the methods against that table; until the migration lands, the methods
// return ErrReceiptsTableMissing and the shared suite skips its receipts
// tests with a pointer to the required DDL.
package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/posting"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// Store is the whole persistence surface of the accounting backend. Adapters
// own transaction boundaries and the per-dialect disciplines; callers see
// commands and wire forms only.
type Store interface {
	// Lifecycle. Migrate applies the embedded goose set on a fresh database
	// and adopts an existing Python-created ledger exactly as
	// backend-go/migrations/README.md documents (shape detection + version
	// stamping). It must run before any other method.
	Migrate(ctx context.Context) error
	Close() error

	// Reference reads the posting and conversion flows assemble their pure
	// inputs from. Missing rows are ErrNotFound-carrying *Error values.
	Entity(ctx context.Context, entityCode string) (Entity, error)
	Chart(ctx context.Context, entityCode string, includeInactive bool) ([]ledger.Account, error)
	Periods(ctx context.Context, entityCode string) ([]ledger.Period, error)

	// Journal commands — one transaction each.
	SaveJournal(ctx context.Context, cmd SaveJournalCommand) (SaveJournalResult, error)
	PostVoucher(ctx context.Context, cmd PostVoucherCommand) (PostResult, error)

	// Journal queries — the raw feeds the pure projections assemble views
	// from. Journal returns the voucher.Snapshot wire form (the reference's
	// journal_to_dict), Journals orders by created_at DESC, LedgerLines
	// mirrors ledger.get_lines (accounting_date, then line_number).
	Journal(ctx context.Context, journalID string) (voucher.Snapshot, error)
	Journals(ctx context.Context, q JournalsQuery) ([]voucher.Snapshot, error)
	LedgerLines(ctx context.Context, q LedgerLinesQuery) ([]voucher.LedgerLine, error)

	// Evidence — atomic claim + duplicate economic-event detection (BL-05).
	ClaimDocument(ctx context.Context, cmd ClaimDocumentCommand) (ClaimResult, error)
	ClaimDocumentForVoucher(ctx context.Context, cmd ClaimDocumentForVoucherCommand) (ConversionResult, error)
	Documents(ctx context.Context, q DocumentsQuery) ([]Document, error)
	Document(ctx context.Context, documentID string) (Document, error)
	VoidDocument(ctx context.Context, cmd VoidDocumentCommand) (Document, error)

	// Idempotency receipts (BL-28). PutReceipt is insert-if-absent and
	// returns the stored receipt either way, with existed reporting whether
	// the key was already present.
	PutReceipt(ctx context.Context, cmd PutReceiptCommand) (Receipt, bool, error)
	Receipt(ctx context.Context, key ReceiptKey) (Receipt, error)

	// Audit — append-only tool-call trail (mcp_audit_logs).
	AppendAudit(ctx context.Context, rec AuditRecord) error
	AuditLogs(ctx context.Context, q AuditQuery) ([]AuditRecord, error)

	// Chain — verification over the journal_entries chain fields via the
	// pure positions.VerifyHashChain rule.
	VerifyChain(ctx context.Context, entityCode string) (positions.ChainReport, error)

	// Backup — consistent DB-and-evidence backup and restoration
	// verification (BL-23). The sqlite adapter implements the full round
	// trip; the pgx adapter reports ErrBackupUnsupported (the reference has
	// no PostgreSQL backup either — operators snapshot with pg_dump).
	Backup(ctx context.Context, targetDir string) (BackupReport, error)
	Restore(ctx context.Context, backup BackupRef, target RestoreTarget) (RestoreReport, error)
}

// ErrBackupUnsupported reports an adapter without a store-side backup
// mechanism (PostgreSQL: pg_dump is the operator's tool).
var ErrBackupUnsupported = errors.New("store: backup not supported by this adapter")

// ErrReceiptsTableMissing reports that the command_receipts table does not
// exist yet — the BL-28 receipts table is new behaviour whose DDL must land
// as a goose migration (see the package doc).
var ErrReceiptsTableMissing = errors.New("store: command_receipts table missing (needs a goose migration)")

// Error is a classified store refusal. Kind mirrors the frozen reference's
// message prefixes (VOUCHER_REVISION_CONFLICT, DOCUMENT_ALREADY_USED, ...)
// and the pure packages' refusal kinds; fixtures pin kinds, not messages.
type Error struct {
	Kind    string
	Message string
}

func (e *Error) Error() string { return e.Kind + ": " + e.Message }

// Store refusal kinds not owned by a pure package.
const (
	KindEntityNotFound          = "ENTITY_NOT_FOUND"
	KindVoucherNotFound         = "VOUCHER_NOT_FOUND"
	KindDocumentNotFound        = "DOCUMENT_NOT_FOUND"
	KindDocumentAlreadyUsed     = "DOCUMENT_ALREADY_USED"
	KindDocumentLinked          = "DOCUMENT_LINKED"
	KindDocumentHashRequired    = "DOCUMENT_HASH_REQUIRED"
	KindDocumentHashMismatch    = "DOCUMENT_HASH_MISMATCH"
	KindDocumentHistoryConflict = "DOCUMENT_HISTORY_CONFLICT"
	KindAttachmentNotFound      = "ATTACHMENT_NOT_FOUND"
	KindVoucherCreateConflict   = "VOUCHER_CREATE_CONFLICT"
	KindCOAMissingAccount       = "COA_MISSING_ACCOUNT"
	KindAccountsRequired        = "ACCOUNTS_REQUIRED"
	KindAmountRequired          = "AMOUNT_REQUIRED"
	KindReasonRequired          = "REASON_REQUIRED"
	// KindUnbalancedEntry is the store's posting-gate enforcement of the
	// §3 invariant "every posted entry balances". The frozen reference
	// balanced at draft creation only; the store is the last gate before
	// the chain and refuses what slipped through.
	KindUnbalancedEntry = "UNBALANCED_ENTRY"
)

// NotFound builds the miss error of a single-row lookup.
func NotFound(kind, what string) *Error {
	return &Error{Kind: kind, Message: what + " not found."}
}

// KindOf returns the classified kind of err ("" when unclassified). Kinds
// surface on three shapes: the store's *Error, the posting/voucher packages'
// *voucher.PostingError and the ledger package's sentinel-wrapped
// LedgerError ("kind: message") — the frozen reference raised all of them as
// prefixed message strings, and fixtures pin the kind.
func KindOf(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	var pe *voucher.PostingError
	if errors.As(err, &pe) {
		return pe.Kind
	}
	if err == nil {
		return ""
	}
	// Ledger kinds wrap a lowercase sentinel with fmt.Errorf("%w: msg") and
	// the message itself opens with the reference's UPPER_SNAKE prefix
	// ("period_locked: PERIOD_LOCKED: 期間 ..."), so scan the leading
	// segments for the upper-snake kind.
	text := err.Error()
	for i := 0; i < 2; i++ {
		j := strings.Index(text, ": ")
		if j < 0 {
			break
		}
		head := text[:j]
		if head != "" && strings.ToUpper(head) == head && !strings.Contains(head, " ") &&
			!strings.Contains(head, "\n") {
			return head
		}
		text = text[j+2:]
	}
	return ""
}

// ---------------------------------------------------------------------------
// Tenant scope (the RLS hook)
// ---------------------------------------------------------------------------

// tenantKey carries the row-level-security scope through a context. The
// reference has no RLS policies yet (ADR-0002 is forward-looking); the pgx
// adapter preserves the mechanism by issuing SET LOCAL app.tenant_id at
// transaction start when a scope is present. The sqlite adapter ignores it.
type tenantKey struct{}

// WithTenant returns a context scoped to one tenant for the pgx adapter's
// SET LOCAL app.tenant_id hook.
func WithTenant(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, tenantKey{}, tenantID)
}

// TenantFromContext returns the scoped tenant ID, "" when unscoped.
func TenantFromContext(ctx context.Context) string {
	v, _ := ctx.Value(tenantKey{}).(string)
	return v
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

// Entity mirrors one entities row as the flows read it.
type Entity struct {
	EntityCode         string `json:"entity_code"`
	LegalName          string `json:"legal_name"`
	EntityStructure    string `json:"entity_structure"`
	Jurisdiction       string `json:"jurisdiction"`
	Currency           string `json:"currency"`
	AccountingStandard string `json:"accounting_standard"`
	TaxID              string `json:"tax_id"`
	ReportingStatus    string `json:"reporting_status"`
}

// SaveJournalCommand carries the journal dict wire form (the reference's
// save_journal entry argument). The store loads the persisted row, runs
// posting.PlanSave and applies the plan with conditional writes.
type SaveJournalCommand struct {
	// Entry is the submitted journal dict. A caller holding a loaded
	// voucher passes it back with its revision; the store never infers one.
	Entry voucher.Snapshot
	// At is the caller's clock for the row's created_at on an insert whose
	// dict carries no created_at (the reference's model default evaluates
	// datetime.now; the store takes time as an argument). ISO 8601.
	At string
}

// SaveJournalResult reports the row's revision after the commit, so the
// caller updates its dict only after success (the reference's contract).
type SaveJournalResult struct {
	// Inserted is true when the entry created a new row (revision 0).
	Inserted bool
	// Revision is the row's revision after the write.
	Revision int64
}

// PostVoucherCommand is the whole posting transaction's input: the voucher to
// seal, the reviewer's submitted snapshot and the approval. The store loads
// everything else (persisted row, chart, periods, original, chain) inside the
// transaction.
type PostVoucherCommand struct {
	// JournalID is the voucher to post.
	JournalID string
	// Submitted is the reviewer's snapshot of the voucher (the posting
	// snapshot guard diffs it against the persisted row).
	Submitted voucher.Snapshot
	// Approver is the human principal the seal records. Posting never
	// approves; the maker-checker and authority rules run upstream.
	Approver posting.Approver
	// PostedAt is the seal timestamp, supplied as an argument (the domain
	// has no clock). ISO 8601.
	PostedAt string
}

// PostResult mirrors post_voucher's return dict plus the sealed wire form so
// the caller updates its state only from committed facts.
type PostResult struct {
	EntryHash     string `json:"entry_hash"`
	PrevEntryHash string `json:"prev_entry_hash"`
	BlockIndex    int64  `json:"block_index"`
	Columns       string `json:"columns"`
	LinesWritten  int    `json:"lines_written"`
	// Voucher is the sealed journal dict as committed.
	Voucher voucher.Snapshot `json:"voucher"`
}

// JournalsQuery filters get_journals. Empty strings mean "no filter".
type JournalsQuery struct {
	EntityCode string
	Status     string
}

// LedgerLinesQuery filters ledger.get_lines. Empty strings mean "no filter";
// Limit 0 means unlimited.
type LedgerLinesQuery struct {
	EntityCode     string
	AccountCode    string
	PeriodCode     string
	CounterpartyID string
	Limit          int
}

// ---------------------------------------------------------------------------
// Documents (BL-05)
// ---------------------------------------------------------------------------

// Document mirrors one documents row (the reference's _document_dict).
type Document struct {
	DocumentID       string  `json:"document_id"`
	EntityCode       string  `json:"entity_code"`
	DocType          string  `json:"doc_type"`
	DocDate          string  `json:"doc_date"`
	CounterpartyID   *string `json:"counterparty_id"`
	CounterpartyName string  `json:"counterparty_name"`
	Amount           string  `json:"amount"`
	Currency         string  `json:"currency"`
	Status           string  `json:"status"`
	JournalID        *string `json:"journal_id"`
	Filename         string  `json:"filename"`
	StoredName       string  `json:"stored_name"`
	Mime             string  `json:"mime"`
	Size             int64   `json:"size"`
	SHA256           string  `json:"sha256"`
	UploadedBy       string  `json:"uploaded_by"`
	Note             string  `json:"note"`
	CreatedAt        string  `json:"created_at"`
	PostedAt         *string `json:"posted_at"`
}

// DocumentsQuery filters get_documents. Empty strings mean "no filter".
type DocumentsQuery struct {
	EntityCode string
	Status     string
}

// ClaimDocumentCommand is document_sources.capture's input: the document
// record and the exact bytes behind record.SHA256. The evidence file for the
// record must already sit in the adapter's evidence directory (the reference's
// save_attachment writes it before capture); the store verifies it.
type ClaimDocumentCommand struct {
	Record Document
	// Content is the exact uploaded bytes; sha256(content) must equal
	// Record.SHA256.
	Content []byte
	// At is the command's timestamp (ISO) for created_at and an adoption's
	// posted_at. The store has no clock.
	At string
}

// ClaimResult is capture's result plus the BL-05 duplicate detection.
type ClaimResult struct {
	Document Document
	// DuplicateOf lists the entity's other documents with the same
	// normalized counterparty, amount and doc_date but a different sha256 —
	// candidates for human review as one economic event. Detection only:
	// the claim itself succeeds.
	DuplicateOf []string
}

// ClaimDocumentForVoucherCommand is the document→draft conversion
// (require_unused + insert-draft + link-source, one transaction — the BL-05
// atomicity fix). The reference's position-scope policy stays upstream.
type ClaimDocumentForVoucherCommand struct {
	DocumentID        string
	DebitAccountCode  string
	CreditAccountCode string
	Memo              string
	// Maker is the converting principal (the draft's creator).
	MakerPrincipalKey string
	MakerPrincipalID  string
	// At is the command's timestamp (ISO) for the document's posted_at and
	// the draft's created_at. The store has no clock.
	At string
}

// ConversionResult is the committed conversion: the new draft's ID and the
// document as it now stands (status POSTED — the reference's link_source
// marks conversion, the linked voucher is a DRAFT until posting).
type ConversionResult struct {
	JournalID string
	Document  Document
}

// VoidDocumentCommand is the void endpoint's store half: reason is required
// and a linked document refuses.
type VoidDocumentCommand struct {
	DocumentID string
	Reason     string
}

// ---------------------------------------------------------------------------
// Receipts (BL-28)
// ---------------------------------------------------------------------------

// ReceiptKey identifies one command execution: the principal that issued it,
// the entity it acted on and the hash of the canonical JSON command payload.
type ReceiptKey struct {
	PrincipalKey string
	EntityCode   string
	PayloadHash  string // sha256 hex of the canonical payload JSON
}

// String renders the unique receipt key stored in command_receipts.
func (k ReceiptKey) String() string {
	return fmt.Sprintf("%s\n%s\n%s", k.PrincipalKey, k.EntityCode, k.PayloadHash)
}

// PutReceiptCommand records one command outcome under its key.
type PutReceiptCommand struct {
	Key       ReceiptKey
	CommandID string
	// Outcome is the command's outcome snapshot as JSON.
	Outcome string
	// At is the receipt timestamp (ISO). The store has no clock.
	At string
}

// Receipt is one stored command receipt (BL-28): the record a retried
// command resolves with instead of executing again.
type Receipt struct {
	Key       ReceiptKey `json:"key"`
	CommandID string     `json:"command_id"`
	Outcome   string     `json:"outcome"`
	CreatedAt string     `json:"created_at"`
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

// AuditRecord mirrors one mcp_audit_logs row (save_audit_log's record).
type AuditRecord struct {
	LogID           string  `json:"log_id"`
	Position        string  `json:"position"`
	PrincipalKey    string  `json:"principal_key"`
	Tool            string  `json:"tool"`
	Outcome         string  `json:"outcome"` // OK | REFUSED | DENIED
	ErrorCode       *string `json:"error_code"`
	ErrorMessage    *string `json:"error_message"`
	EntityCode      *string `json:"entity_code"`
	JournalID       *string `json:"journal_id"`
	ParamsJSON      string  `json:"params"`           // redacted; "{}" default
	DocumentSHA256s string  `json:"document_sha256s"` // JSON array; "[]" default
	DurationMs      *int64  `json:"duration_ms"`
	// CreatedAt is the record's timestamp (ISO). The store has no clock.
	CreatedAt string `json:"created_at"`
}

// AuditQuery filters get_audit_logs. Empty strings mean "no filter";
// Limit 0 means the reference's default (200).
type AuditQuery struct {
	EntityCode   string
	Tool         string
	PrincipalKey string
	Limit        int
}
