package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// This file is the two adapters' shared journal wire form: the mapping
// between the journal dict (the frozen reference's universal value currency,
// rendered by repository.journal_to_dict and written by _journal_model) and
// the journal_entries columns. It is adapter plumbing, not caller surface:
// the Store interface exchanges voucher.Snapshot values.
//
// The mapping is exact where the reference's behaviour is observable:
//
//   - _journal_model's defaults (source_module "MANUAL", status "POSTED",
//     ai_confidence_score "1.0000", evidence_uris "[]", lines "[]") apply to
//     absent keys on BOTH the insert and the update path (the reference
//     writes vars(model) of the fully defaulted model);
//   - block_index, posted_at and created_at are written only when the dict
//     carries the key (the reference's trailing setattr loop);
//   - str() renders values the way Python str() does ("None" for null) on
//     the fields the reference wraps in str();
//   - lines_json/evidence_uris re-encode their decoded values with Python
//     json.dumps' default form (", "/": " separators, ensure_ascii), so a
//     round-tripped row re-dumps exactly as the reference would.
//
// Timestamps cross the wire as ISO strings (journal_to_dict's isoformat
// forms) and reach the adapters as raw strings for dialect conversion.

// OptString is a three-state journal-dict field: absent from the dict,
// present but null, or present with a value. The reference distinguishes all
// three (entry.get defaults, NULL writes and values).
type OptString struct {
	Set   bool   // the key is present in the dict
	Null  bool   // present and null (JSON null)
	Value string // present and non-null
}

// OptInt64 is the integer form of OptString (block_index).
type OptInt64 struct {
	Set   bool
	Null  bool
	Value int64
}

// StringOpt builds a present OptString.
func StringOpt(s string) OptString { return OptString{Set: true, Value: s} }

// JournalDoc is one journal_entries row in the reference's wire vocabulary.
// Revision rides along for reads; the write paths take it as a parameter.
type JournalDoc struct {
	JournalID              string
	Revision               int64
	EntityCode             string
	SourceModule           string
	Status                 voucher.Status
	AccountingDate         string
	Currency               string
	TotalDebit             string
	TotalCredit            string
	CreatedByPrincipalKey  string
	CreatedByPrincipalID   string
	ApprovedByPrincipalKey OptString
	ApprovedByPrincipalID  OptString
	AIConfidenceScore      string
	AIReasoningSummary     string
	EvidenceURIs           string // JSON text (the reference's json.dumps form)
	EntryHash              OptString
	PrevEntryHash          OptString
	LinesJSON              string // JSON text
	VoucherNo              OptString
	Period                 OptString
	Memo                   OptString
	RejectReason           OptString
	SubmittedAt            OptString // ISO strings; timestamps per the wire form
	ReversalOfJournalID    OptString
	Basis                  OptString
	EntryLayer             OptString
	ReviewNotes            OptString
	ProposalJSON           OptString
	// Written only when the dict carried the key (three-state, like the
	// reference's trailing loop).
	BlockIndex OptInt64
	PostedAt   OptString
	CreatedAt  OptString
}

// strScalar renders a decoded JSON value the way the reference's str() does
// on the fields it wraps: strings pass through, numbers as their literal
// token, null as "None", booleans as True/False.
func strScalar(v any) (string, error) {
	switch t := v.(type) {
	case nil:
		return "None", nil
	case string:
		return t, nil
	case json.Number:
		return t.String(), nil
	case bool:
		if t {
			return "True", nil
		}
		return "False", nil
	default:
		return "", fmt.Errorf("store: journal field is not a scalar")
	}
}

// optStringOf reads a nullable string field: absent → not set, null → Null,
// string → value, other scalar → its str() form.
func optStringOf(doc voucher.Snapshot, field string) (OptString, error) {
	raw, present := doc[field]
	if !present || len(raw) == 0 {
		return OptString{}, nil
	}
	if string(raw) == "null" {
		return OptString{Set: true, Null: true}, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return OptString{}, fmt.Errorf("store: journal field %s undecodable", field)
	}
	s, err := strScalar(v)
	if err != nil {
		return OptString{}, fmt.Errorf("store: journal field %s: %w", field, err)
	}
	return OptString{Set: true, Value: s}, nil
}

// requiredString reads a required key, mirroring the reference's entry[key]
// KeyError as an error.
func requiredString(doc voucher.Snapshot, field string) (string, error) {
	raw, present := doc[field]
	if !present || len(raw) == 0 || string(raw) == "null" {
		return "", fmt.Errorf("store: journal dict missing %s", field)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return "", fmt.Errorf("store: journal field %s undecodable", field)
	}
	s, err := strScalar(v)
	if err != nil {
		return "", fmt.Errorf("store: journal field %s: %w", field, err)
	}
	return s, nil
}

// jsonDumpOf mirrors json.dumps(entry.get(key, fallback)): absent → the
// fallback encoded, present → the decoded value re-encoded Python-style
// (null dumps as "null", exactly as json.dumps(None) does).
func jsonDumpOf(doc voucher.Snapshot, field, fallback string) (string, error) {
	raw, present := doc[field]
	if !present || len(raw) == 0 {
		raw = json.RawMessage(fallback)
	}
	v, err := DecodeOrdered(raw)
	if err != nil {
		return "", fmt.Errorf("store: journal field %s: %w", field, err)
	}
	return PyEncode(v), nil
}

// JournalDocFromSnapshot mirrors repository._journal_model: the wire dict in,
// the row values out (defaults applied, three-state optionals preserved).
func JournalDocFromSnapshot(doc voucher.Snapshot) (JournalDoc, error) {
	var d JournalDoc
	var err error
	if d.JournalID, err = requiredString(doc, "journal_id"); err != nil {
		return JournalDoc{}, err
	}
	if d.EntityCode, err = requiredString(doc, "entity_code"); err != nil {
		return JournalDoc{}, err
	}
	if d.AccountingDate, err = requiredString(doc, "accounting_date"); err != nil {
		return JournalDoc{}, err
	}
	if d.Currency, err = requiredString(doc, "currency"); err != nil {
		return JournalDoc{}, err
	}
	if d.TotalDebit, err = requiredString(doc, "total_debit"); err != nil {
		return JournalDoc{}, err
	}
	if d.TotalCredit, err = requiredString(doc, "total_credit"); err != nil {
		return JournalDoc{}, err
	}
	if d.CreatedByPrincipalKey, err = requiredString(doc, "created_by_principal_key"); err != nil {
		return JournalDoc{}, err
	}
	if d.CreatedByPrincipalID, err = requiredString(doc, "created_by_principal_id"); err != nil {
		return JournalDoc{}, err
	}
	// Defaults of _journal_model's .get calls: an absent key falls back,
	// a present-null key stays null (Python's .get returns None then).
	if d.SourceModule, err = stringWithDefault(doc, "source_module", "MANUAL"); err != nil {
		return JournalDoc{}, err
	}
	status, err := stringWithDefault(doc, "status", "POSTED")
	if err != nil {
		return JournalDoc{}, err
	}
	d.Status = voucher.Status(status)
	if d.AIConfidenceScore, err = stringWithDefault(doc, "ai_confidence_score", "1.0000"); err != nil {
		return JournalDoc{}, err
	}
	if d.AIReasoningSummary, err = stringWithDefault(doc, "ai_reasoning_summary", ""); err != nil {
		return JournalDoc{}, err
	}
	if d.EvidenceURIs, err = jsonDumpOf(doc, "evidence_uris", "[]"); err != nil {
		return JournalDoc{}, err
	}
	if d.LinesJSON, err = jsonDumpOf(doc, "lines", "[]"); err != nil {
		return JournalDoc{}, err
	}
	if d.ApprovedByPrincipalKey, err = optStringOf(doc, "approved_by_principal_key"); err != nil {
		return JournalDoc{}, err
	}
	// str(entry.get(...)) if entry.get(...) else None: falsy renders None.
	approvedID, err := optStringOf(doc, "approved_by_principal_id")
	if err != nil {
		return JournalDoc{}, err
	}
	if !approvedID.Set || approvedID.Null || approvedID.Value == "" {
		d.ApprovedByPrincipalID = OptString{Set: true, Null: true}
	} else {
		d.ApprovedByPrincipalID = approvedID
	}
	if d.EntryHash, err = optStringOf(doc, "entry_hash"); err != nil {
		return JournalDoc{}, err
	}
	if d.PrevEntryHash, err = optStringOf(doc, "prev_entry_hash"); err != nil {
		return JournalDoc{}, err
	}
	if d.VoucherNo, err = optStringOf(doc, "voucher_no"); err != nil {
		return JournalDoc{}, err
	}
	if d.Period, err = optStringOf(doc, "period"); err != nil {
		return JournalDoc{}, err
	}
	if d.Memo, err = optStringOf(doc, "memo"); err != nil {
		return JournalDoc{}, err
	}
	if d.RejectReason, err = optStringOf(doc, "reject_reason"); err != nil {
		return JournalDoc{}, err
	}
	if d.ReversalOfJournalID, err = optStringOf(doc, "reversal_of_journal_id"); err != nil {
		return JournalDoc{}, err
	}
	if d.Basis, err = optStringOf(doc, "basis"); err != nil {
		return JournalDoc{}, err
	}
	if d.EntryLayer, err = optStringOf(doc, "entry_layer"); err != nil {
		return JournalDoc{}, err
	}
	if d.ReviewNotes, err = optStringOf(doc, "review_notes"); err != nil {
		return JournalDoc{}, err
	}
	if d.ProposalJSON, err = optStringOf(doc, "proposal_json"); err != nil {
		return JournalDoc{}, err
	}
	if d.SubmittedAt, err = optStringOf(doc, "submitted_at"); err != nil {
		return JournalDoc{}, err
	}
	// The trailing loop: block_index, posted_at, created_at only when the
	// dict carries the key.
	if raw, present := doc["block_index"]; present && len(raw) > 0 {
		if string(raw) == "null" {
			d.BlockIndex = OptInt64{Set: true, Null: true}
		} else {
			var n json.Number
			if err := json.Unmarshal(raw, &n); err != nil {
				return JournalDoc{}, fmt.Errorf("store: journal field block_index not an integer")
			}
			i, err := n.Int64()
			if err != nil {
				return JournalDoc{}, fmt.Errorf("store: journal field block_index not an integer")
			}
			d.BlockIndex = OptInt64{Set: true, Value: i}
		}
	}
	if d.PostedAt, err = optStringOf(doc, "posted_at"); err != nil {
		return JournalDoc{}, err
	}
	if d.CreatedAt, err = optStringOf(doc, "created_at"); err != nil {
		return JournalDoc{}, err
	}
	d.Revision = revisionOf(doc)
	return d, nil
}

// stringWithDefault reads a defaulted scalar: absent → the default, present →
// its str() form (null renders "None", exactly like Python's .get returning
// None into a str() context).
func stringWithDefault(doc voucher.Snapshot, field, fallback string) (string, error) {
	raw, present := doc[field]
	if !present || len(raw) == 0 {
		return fallback, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return "", fmt.Errorf("store: journal field %s undecodable", field)
	}
	return strScalar(v)
}

// revisionOf reads the revision key: absent or null → 0 (the BL-02 additive
// convention), a number → its value.
func revisionOf(doc voucher.Snapshot) int64 {
	raw, present := doc["revision"]
	if !present || len(raw) == 0 || string(raw) == "null" {
		return 0
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0
	}
	i, err := n.Int64()
	if err != nil {
		return 0
	}
	return i
}

// SnapshotFromJournalDoc mirrors repository.journal_to_dict: every key
// present, NULL columns as null, timestamps in ISO form, lines and evidence
// URIs decoded.
func SnapshotFromJournalDoc(d JournalDoc, renderTS func(string) (string, error)) (voucher.Snapshot, error) {
	snap := voucher.Snapshot{
		"journal_id":               mustRaw(d.JournalID),
		"revision":                 mustRaw(d.Revision),
		"entity_code":              mustRaw(d.EntityCode),
		"source_module":            mustRaw(d.SourceModule),
		"status":                   mustRaw(string(d.Status)),
		"accounting_date":          mustRaw(d.AccountingDate),
		"currency":                 mustRaw(d.Currency),
		"total_debit":              mustRaw(d.TotalDebit),
		"total_credit":             mustRaw(d.TotalCredit),
		"created_by_principal_key": mustRaw(d.CreatedByPrincipalKey),
		"created_by_principal_id":  mustRaw(d.CreatedByPrincipalID),
		"ai_confidence_score":      mustRaw(d.AIConfidenceScore),
		"ai_reasoning_summary":     mustRaw(d.AIReasoningSummary),
		"block_index":              mustRaw(d.BlockIndex.Value),
		"lines":                    json.RawMessage(d.LinesJSON),
		"evidence_uris":            json.RawMessage(d.EvidenceURIs),
	}
	// block_index is NOT NULL in the effective schema; a NULL read is store
	// corruption and renders as the row's 0 default rather than a wire null.
	if d.BlockIndex.Null {
		snap["block_index"] = mustRaw(int64(0))
	}
	putOpt := func(key string, o OptString) error {
		if !o.Set || o.Null {
			snap[key] = json.RawMessage("null")
			return nil
		}
		snap[key] = mustRaw(o.Value)
		return nil
	}
	putTS := func(key string, o OptString) error {
		if !o.Set || o.Null {
			snap[key] = json.RawMessage("null")
			return nil
		}
		iso, err := renderTS(o.Value)
		if err != nil {
			return err
		}
		snap[key] = mustRaw(iso)
		return nil
	}
	for key, o := range map[string]OptString{
		"approved_by_principal_key": d.ApprovedByPrincipalKey,
		"approved_by_principal_id":  d.ApprovedByPrincipalID,
		"entry_hash":                d.EntryHash,
		"prev_entry_hash":           d.PrevEntryHash,
		"voucher_no":                d.VoucherNo,
		"period":                    d.Period,
		"memo":                      d.Memo,
		"reject_reason":             d.RejectReason,
		"reversal_of_journal_id":    d.ReversalOfJournalID,
		"basis":                     d.Basis,
		"entry_layer":               d.EntryLayer,
		"review_notes":              d.ReviewNotes,
		"proposal_json":             d.ProposalJSON,
	} {
		if err := putOpt(key, o); err != nil {
			return nil, err
		}
	}
	for key, o := range map[string]OptString{
		"posted_at":    d.PostedAt,
		"created_at":   d.CreatedAt,
		"submitted_at": d.SubmittedAt,
	} {
		if err := putTS(key, o); err != nil {
			return nil, err
		}
	}
	return snap, nil
}

func mustRaw(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		// Every value here is a string, int or pre-encoded JSON; Marshal
		// cannot fail on them.
		panic(fmt.Sprintf("store: wire render: %v", err))
	}
	return b
}

// ---------------------------------------------------------------------------
// Column mapping shared by the adapters
// ---------------------------------------------------------------------------

// ColVal is one column/value binding of the adapters' shared write path.
type ColVal struct {
	Col string
	Val any
}

// journalWriteColumns lists the columns _journal_model always sets, in the
// model's declaration order. block_index/posted_at/created_at join only when
// the dict carried them; revision is written separately by both paths.
var journalWriteColumns = []string{
	"journal_id", "entity_code", "source_module", "status", "accounting_date",
	"currency", "total_debit", "total_credit", "created_by_principal_key",
	"created_by_principal_id", "approved_by_principal_key", "approved_by_principal_id",
	"ai_confidence_score", "ai_reasoning_summary", "evidence_uris",
	"entry_hash", "prev_entry_hash", "lines_json", "voucher_no", "period",
	"memo", "reject_reason", "submitted_at", "reversal_of_journal_id",
	"basis", "entry_layer", "review_notes", "proposal_json",
}

// journalDocPairs renders the write bindings. toTS converts an ISO wire
// timestamp to the dialect's storage form (SQLite: SQLAlchemy's DATETIME
// text form; PostgreSQL: the string passes into timestamptz).
func JournalDocPairs(d JournalDoc, toTS func(string) (string, error)) ([]ColVal, error) {
	strOrNull := func(o OptString) any {
		if !o.Set || o.Null {
			return nil
		}
		return o.Value
	}
	pairs := make([]ColVal, 0, len(journalWriteColumns)+3)
	add := func(col string, v any) { pairs = append(pairs, ColVal{col, v}) }
	add("journal_id", d.JournalID)
	add("entity_code", d.EntityCode)
	add("source_module", d.SourceModule)
	add("status", string(d.Status))
	add("accounting_date", d.AccountingDate)
	add("currency", d.Currency)
	add("total_debit", d.TotalDebit)
	add("total_credit", d.TotalCredit)
	add("created_by_principal_key", d.CreatedByPrincipalKey)
	add("created_by_principal_id", d.CreatedByPrincipalID)
	add("approved_by_principal_key", strOrNull(d.ApprovedByPrincipalKey))
	add("approved_by_principal_id", strOrNull(d.ApprovedByPrincipalID))
	add("ai_confidence_score", d.AIConfidenceScore)
	add("ai_reasoning_summary", d.AIReasoningSummary)
	add("evidence_uris", d.EvidenceURIs)
	add("entry_hash", strOrNull(d.EntryHash))
	add("prev_entry_hash", strOrNull(d.PrevEntryHash))
	add("lines_json", d.LinesJSON)
	add("voucher_no", strOrNull(d.VoucherNo))
	add("period", strOrNull(d.Period))
	add("memo", strOrNull(d.Memo))
	add("reject_reason", strOrNull(d.RejectReason))
	if d.SubmittedAt.Set && !d.SubmittedAt.Null {
		ts, err := toTS(d.SubmittedAt.Value)
		if err != nil {
			return nil, fmt.Errorf("store: submitted_at: %w", err)
		}
		add("submitted_at", ts)
	} else {
		add("submitted_at", nil)
	}
	add("reversal_of_journal_id", strOrNull(d.ReversalOfJournalID))
	add("basis", strOrNull(d.Basis))
	add("entry_layer", strOrNull(d.EntryLayer))
	add("review_notes", strOrNull(d.ReviewNotes))
	add("proposal_json", strOrNull(d.ProposalJSON))
	// The trailing loop: present keys only.
	if d.BlockIndex.Set {
		if d.BlockIndex.Null {
			add("block_index", nil)
		} else {
			add("block_index", d.BlockIndex.Value)
		}
	}
	if d.PostedAt.Set {
		if d.PostedAt.Null {
			add("posted_at", nil)
		} else {
			ts, err := toTS(d.PostedAt.Value)
			if err != nil {
				return nil, fmt.Errorf("store: posted_at: %w", err)
			}
			add("posted_at", ts)
		}
	}
	if d.CreatedAt.Set {
		if d.CreatedAt.Null {
			add("created_at", nil)
		} else {
			ts, err := toTS(d.CreatedAt.Value)
			if err != nil {
				return nil, fmt.Errorf("store: created_at: %w", err)
			}
			add("created_at", ts)
		}
	}
	return pairs, nil
}

// JournalReadColumns is the SELECT column list shared by the adapters. The
// adapters cast timestamp columns to text in their dialect so every column
// scans as a string, then renderTS converts to the wire ISO form.
var JournalReadColumns = []string{
	"journal_id", "revision", "entity_code", "source_module", "status",
	"accounting_date", "currency", "total_debit", "total_credit",
	"created_by_principal_key", "created_by_principal_id",
	"approved_by_principal_key", "approved_by_principal_id",
	"ai_confidence_score", "ai_reasoning_summary", "evidence_uris",
	"entry_hash", "prev_entry_hash", "block_index", "posted_at", "lines_json",
	"voucher_no", "period", "memo", "reject_reason", "submitted_at",
	"reversal_of_journal_id", "basis", "entry_layer", "review_notes",
	"proposal_json", "created_at",
}

// ScanJournal scans one journal_entries row (columns in JournalReadColumns
// order) into the wire form. renderTS converts a raw stored timestamp string
// to the ISO wire form.
func ScanJournal(scan func(dest ...any) error, renderTS func(string) (string, error)) (JournalDoc, error) {
	var d JournalDoc
	var revision, blockIndex sql.NullInt64
	var journalID, entityCode, sourceModule, status, accountingDate, currency sql.NullString
	var totalDebit, totalCredit, createdByKey, createdByID sql.NullString
	var approvedKey, approvedID, aiScore, aiSummary, evidenceURIs sql.NullString
	var entryHash, prevEntryHash, linesJSON, voucherNo, period, memo sql.NullString
	var rejectReason, submittedAt, reversalOf, basis, entryLayer sql.NullString
	var reviewNotes, proposalJSON, postedAt, createdAt sql.NullString
	if err := scan(&journalID, &revision, &entityCode, &sourceModule, &status,
		&accountingDate, &currency, &totalDebit, &totalCredit,
		&createdByKey, &createdByID, &approvedKey, &approvedID,
		&aiScore, &aiSummary, &evidenceURIs, &entryHash, &prevEntryHash,
		&blockIndex, &postedAt, &linesJSON, &voucherNo, &period, &memo,
		&rejectReason, &submittedAt, &reversalOf, &basis, &entryLayer,
		&reviewNotes, &proposalJSON, &createdAt); err != nil {
		return JournalDoc{}, err
	}
	d.JournalID = journalID.String
	d.Revision = revision.Int64
	d.EntityCode = entityCode.String
	d.SourceModule = sourceModule.String
	d.Status = voucher.Status(status.String)
	d.AccountingDate = accountingDate.String
	d.Currency = currency.String
	d.TotalDebit = totalDebit.String
	d.TotalCredit = totalCredit.String
	d.CreatedByPrincipalKey = createdByKey.String
	d.CreatedByPrincipalID = createdByID.String
	d.ApprovedByPrincipalKey = optFromScan(approvedKey)
	d.ApprovedByPrincipalID = optFromScan(approvedID)
	d.AIConfidenceScore = aiScore.String
	d.AIReasoningSummary = aiSummary.String
	d.EvidenceURIs = evidenceURIs.String
	d.EntryHash = optFromScan(entryHash)
	d.PrevEntryHash = optFromScan(prevEntryHash)
	d.LinesJSON = linesJSON.String
	d.VoucherNo = optFromScan(voucherNo)
	d.Period = optFromScan(period)
	d.Memo = optFromScan(memo)
	d.RejectReason = optFromScan(rejectReason)
	d.ReversalOfJournalID = optFromScan(reversalOf)
	d.Basis = optFromScan(basis)
	d.EntryLayer = optFromScan(entryLayer)
	d.ReviewNotes = optFromScan(reviewNotes)
	d.ProposalJSON = optFromScan(proposalJSON)
	var err error
	d.SubmittedAt, err = tsOptFromScan(submittedAt, renderTS)
	if err != nil {
		return JournalDoc{}, err
	}
	d.PostedAt, err = tsOptFromScan(postedAt, renderTS)
	if err != nil {
		return JournalDoc{}, err
	}
	d.CreatedAt, err = tsOptFromScan(createdAt, renderTS)
	if err != nil {
		return JournalDoc{}, err
	}
	if blockIndex.Valid {
		d.BlockIndex = OptInt64{Set: true, Value: blockIndex.Int64}
	}
	return d, nil
}

// tsOptFromScan renders a nullable stored timestamp to the ISO wire form.
func tsOptFromScan(v sql.NullString, renderTS func(string) (string, error)) (OptString, error) {
	if !v.Valid {
		return OptString{Set: true, Null: true}, nil
	}
	iso, err := renderTS(v.String)
	if err != nil {
		return OptString{}, err
	}
	return OptString{Set: true, Value: iso}, nil
}

func optFromScan(v sql.NullString) OptString {
	if !v.Valid {
		return OptString{Set: true, Null: true}
	}
	return OptString{Set: true, Value: v.String}
}

// ---------------------------------------------------------------------------
// Python-JSON forms
// ---------------------------------------------------------------------------

// DecodeOrdered decodes JSON preserving object key order (the reference's
// json.dumps re-dumps in insertion order, so re-encoding must keep it).
func DecodeOrdered(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	v, err := decodeValue(dec)
	if err != nil {
		return nil, err
	}
	// Reject trailing content like a strict decoder would.
	if _, err := dec.Token(); err == nil {
		return nil, fmt.Errorf("store: trailing JSON content")
	}
	return v, nil
}

func decodeValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	return decodeFromToken(dec, tok)
}

func decodeFromToken(dec *json.Decoder, tok json.Token) (any, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := pyObject{}
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyTok.(string)
				if !ok {
					return nil, fmt.Errorf("store: object key is not a string")
				}
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				obj = append(obj, pyKV{key, v})
			}
			if _, err := dec.Token(); err != nil { // closing }
				return nil, err
			}
			return obj, nil
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			if _, err := dec.Token(); err != nil { // closing ]
				return nil, err
			}
			return arr, nil
		default:
			return nil, fmt.Errorf("store: unexpected JSON delim %v", t)
		}
	default:
		return tok, nil // string, json.Number, bool, nil
	}
}

// pyKV/pyObject preserve object key order through a decode.
type pyKV struct {
	Key   string
	Value any
}
type pyObject []pyKV

// PyEncode renders a decoded value exactly as Python json.dumps does with
// its defaults: (", ", ": ") separators and ensure_ascii escaping.
func PyEncode(v any) string {
	var b strings.Builder
	encodeValue(&b, v)
	return b.String()
}

func encodeValue(b *strings.Builder, v any) {
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case json.Number:
		b.WriteString(t.String())
	case string:
		pyEncodeString(b, t)
	case pyObject:
		b.WriteByte('{')
		for i, kv := range t {
			if i > 0 {
				b.WriteString(", ")
			}
			pyEncodeString(b, kv.Key)
			b.WriteString(": ")
			encodeValue(b, kv.Value)
		}
		b.WriteByte('}')
	case []any:
		b.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				b.WriteString(", ")
			}
			encodeValue(b, item)
		}
		b.WriteByte(']')
	default:
		panic(fmt.Sprintf("store: pyEncode: unhandled value type %T", v))
	}
}

// pyEncodeString renders a JSON string the way json.dumps(ensure_ascii=True)
// does: control characters, quote and backslash escaped, every rune above
// U+007E as \uXXXX (surrogate pairs for astral runes).
func pyEncodeString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r < 0x20:
			fmt.Fprintf(b, `\u%04x`, r)
		case r <= 0x7E:
			b.WriteRune(r)
		case r <= 0xFFFF:
			fmt.Fprintf(b, `\u%04x`, r)
		default:
			hi, lo := utf16Encode(r)
			fmt.Fprintf(b, `\u%04x\u%04x`, hi, lo)
		}
	}
	b.WriteByte('"')
}

func utf16Encode(r rune) (uint16, uint16) {
	v := uint32(r - 0x10000)
	return uint16(0xD800 + (v >> 10)), uint16(0xDC00 + (v & 0x3FF))
}

// ---------------------------------------------------------------------------
// Timestamp rendering shared helpers
// ---------------------------------------------------------------------------

// ParseISOTime parses an ISO 8601 wire timestamp (with or without a zone)
// into UTC. The store's no-clock discipline takes timestamps as strings; the
// adapters need them in storage form.
func ParseISOTime(s string) (time.Time, error) {
	layouts := []string{
		"2006-01-02T15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02T15:04:05.999999999",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("store: not an ISO timestamp: %q", s)
}

// SQLiteTS converts an ISO wire timestamp to SQLAlchemy's SQLite DATETIME
// storage form (space separator, always six fractional digits, naive UTC) —
// the form the fixture and every Python-written row carries.
func SQLiteTS(iso string) (string, error) {
	t, err := ParseISOTime(iso)
	if err != nil {
		return "", err
	}
	return t.Format("2006-01-02 15:04:05.000000"), nil
}

// SQLiteToISO renders a stored SQLite timestamp in Python's isoformat form
// (T separator, microseconds only when nonzero).
func SQLiteToISO(stored string) (string, error) {
	t, err := time.Parse("2006-01-02 15:04:05.999999", stored)
	if err != nil {
		// Tolerate the ISO form already (rows the store wrote and read back
		// through a caller's dict keep their original wire form).
		t2, err2 := ParseISOTime(stored)
		if err2 != nil {
			return "", fmt.Errorf("store: stored timestamp %q: %w", stored, err)
		}
		t = t2
	}
	return pyISOFormat(t), nil
}

// pyISOFormat renders t in Python datetime.isoformat form for a UTC
// tz-aware datetime: microseconds only when nonzero, "+00:00" suffix.
func pyISOFormat(t time.Time) string {
	base := t.Format("2006-01-02T15:04:05")
	if t.Nanosecond() != 0 {
		base += fmt.Sprintf(".%06d", t.Nanosecond()/1000)
	}
	return base + "+00:00"
}

// PGToISO renders a PostgreSQL timestamptz::text value ("2026-10-31
// 00:14:55.969746+00") in the ISO wire form.
func PGToISO(stored string) (string, error) {
	t, err := time.Parse("2006-01-02 15:04:05.999999-07", stored)
	if err != nil {
		t2, err2 := ParseISOTime(stored)
		if err2 != nil {
			return "", fmt.Errorf("store: stored timestamp %q: %w", stored, err)
		}
		t = t2
	}
	return pyISOFormat(t.UTC()), nil
}

// PGTS converts an ISO wire timestamp to a form PostgreSQL accepts for a
// timestamptz parameter (UTC ISO with offset).
func PGTS(iso string) (string, error) {
	t, err := ParseISOTime(iso)
	if err != nil {
		return "", err
	}
	return t.Format("2006-01-02T15:04:05.999999Z07:00"), nil
}
