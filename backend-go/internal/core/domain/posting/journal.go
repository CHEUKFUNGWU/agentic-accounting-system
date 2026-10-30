package posting

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file carries the posting path's view of the journal dict (the
// reference's universal value currency) and its parse into typed values.
//
// The reference reads one dict everywhere; the port splits that dict into the
// two read-views its rules actually use:
//
//   - voucher.Snapshot, the raw wire document, for the submitted-snapshot
//     diff (voucher.CheckSnapshot) and for the save guards' field-level
//     comparison — both compare fields the typed rules never interpret
//     (basis, proposal_json, ai_confidence_score, evidence_uris, lines).
//   - Journal below, the typed view of the fields the posting sequence
//     branches on.
//
// Timestamps (posted_at, submitted_at, created_at) cross as ISO strings; the
// BL-29 normalization at the persistence boundary is store work.

// Journal is the persisted voucher row as the posting sequence reads it.
// Optional fields are pointers where the reference distinguishes None.
type Journal struct {
	JournalID string
	Revision  int64
	// EntityCode empty is the reference's missing entity_code (the sequence's
	// first refusal).
	EntityCode   string
	SourceModule string
	Status       voucher.Status
	// AccountingDate is the stored date string; the period rules validate it.
	AccountingDate string
	Currency       string
	// Period nil is the reference's None: validate_posting_date derives it
	// from the validated date's month.
	Period *string
	// VoucherNo nil is the reference's None (error messages render it as
	// "None", like Python str(None)).
	VoucherNo *string
	// Totals are the voucher totals; the hash and the reversal mirror read
	// them numerically, like the reference's Decimal(str(...)).
	TotalDebit  money.Money
	TotalCredit money.Money
	Lines       []Line
	// EntryLayer empty is the reference's None: posting defaults it to
	// OPERATIONAL before writing lines.
	EntryLayer string
	// ReversalOfJournalID nil is the reference's None.
	ReversalOfJournalID *string
	// CreatedByPrincipalID enters the entry hash verbatim.
	CreatedByPrincipalID string
	// ReviewNotes nil is the reference's None (mark_posted keeps the stored
	// notes when the submitted snapshot carries none).
	ReviewNotes *string
}

// Line is one stored line as the posting sequence reads it — the journal
// dict's line object. Amounts and optional fields keep the reference's
// or-falsy semantics: an empty string is absent-or-empty and falls back to
// the rule's default ("0", the voucher currency, the account's statement
// reference, ...). CounterpartyID and TaxCodeID are pointers because the
// reference passes them through to nullable columns, where an absent value
// (None → NULL) differs from an empty string.
type Line struct {
	// LineNumber is int(line["line_number"]); a stored line without one is
	// unrepresentable (the reference's KeyError — the store's NOT NULL).
	LineNumber     int64
	AccountCode    string
	Debit          string
	Credit         string
	FuncDebit      string
	FuncCredit     string
	TxCurrency     string
	ExchangeRate   string
	Counterparty   string
	FuncTaxAmount  string
	BusinessUsePct string
	StatementRef   string
	Memo           string

	CounterpartyID *string
	TaxCodeID      *string
}

// ParseJournal parses a journal dict (the wire form journal_to_dict renders)
// into the typed view. Amounts must be decimal strings; a non-decimal amount
// is persisted-row corruption that the reference either refuses downstream
// (the reversal malformed-lines check) or crashes on (an ArithmeticError the
// transaction rolls back) — no fixture pins it, so the parse error surfaces
// to the caller unclassified.
func ParseJournal(doc voucher.Snapshot) (Journal, error) {
	var j Journal
	j.JournalID = docString(doc, "journal_id")
	j.Revision = docIntOr(doc, "revision", 0)
	j.EntityCode = docString(doc, "entity_code")
	j.SourceModule = docString(doc, "source_module")
	j.Status = voucher.Status(docString(doc, "status"))
	j.AccountingDate = docString(doc, "accounting_date")
	j.Currency = docString(doc, "currency")
	if v, ok := docOptString(doc, "period"); ok {
		j.Period = &v
	}
	if v, ok := docOptString(doc, "voucher_no"); ok {
		j.VoucherNo = &v
	}
	var err error
	if j.TotalDebit, err = docMoneyOr(doc, "total_debit", "0"); err != nil {
		return Journal{}, err
	}
	if j.TotalCredit, err = docMoneyOr(doc, "total_credit", "0"); err != nil {
		return Journal{}, err
	}
	j.EntryLayer = docString(doc, "entry_layer")
	if v, ok := docOptString(doc, "reversal_of_journal_id"); ok {
		j.ReversalOfJournalID = &v
	}
	j.CreatedByPrincipalID = docString(doc, "created_by_principal_id")
	if v, ok := docOptString(doc, "review_notes"); ok {
		j.ReviewNotes = &v
	}
	raw, ok := doc["lines"]
	if ok && len(raw) > 0 && string(raw) != "null" {
		var lines []json.RawMessage
		if err := json.Unmarshal(raw, &lines); err != nil {
			return Journal{}, err
		}
		for _, rawLine := range lines {
			line, err := parseLine(rawLine)
			if err != nil {
				return Journal{}, err
			}
			j.Lines = append(j.Lines, line)
		}
	}
	return j, nil
}

// parseLine reads one stored-line object. line_number and account_code are
// required reads in the reference (int(line["line_number"]),
// line["account_code"] — a KeyError, not an optional); the wire rows always
// carry them.
func parseLine(raw json.RawMessage) (Line, error) {
	var doc voucher.Snapshot
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Line{}, err
	}
	var l Line
	l.LineNumber = int64(docIntOr(doc, "line_number", 0))
	l.AccountCode = docString(doc, "account_code")
	l.Debit = docString(doc, "debit")
	l.Credit = docString(doc, "credit")
	l.FuncDebit = docString(doc, "func_debit")
	l.FuncCredit = docString(doc, "func_credit")
	l.TxCurrency = docString(doc, "tx_currency")
	l.ExchangeRate = docString(doc, "exchange_rate")
	l.Counterparty = docString(doc, "counterparty")
	l.FuncTaxAmount = docString(doc, "func_tax_amount")
	l.BusinessUsePct = docString(doc, "business_use_pct")
	l.StatementRef = docString(doc, "statement_ref")
	l.Memo = docString(doc, "memo")
	if v, ok := docOptString(doc, "counterparty_id"); ok {
		l.CounterpartyID = &v
	}
	if v, ok := docOptString(doc, "tax_code_id"); ok {
		l.TaxCodeID = &v
	}
	return l, nil
}

// toVoucher adapts the typed view to the voucher package's value type, the
// signature voucher.ValidateReversal takes. Amounts parse with the
// get-or-zero semantics the reversal rules use (`Decimal(str(line.get(key)
// or 0))`); an unparsable amount errors — ResolveReversalOriginal maps that
// onto the reference's malformed-reversal-lines refusal.
func toVoucher(j Journal) (voucher.Voucher, error) {
	v := voucher.Voucher{
		JournalID:           j.JournalID,
		Revision:            j.Revision,
		EntityCode:          j.EntityCode,
		SourceModule:        j.SourceModule,
		Status:              j.Status,
		AccountingDate:      j.AccountingDate,
		Currency:            j.Currency,
		VoucherNo:           j.VoucherNo,
		TotalDebit:          j.TotalDebit,
		TotalCredit:         j.TotalCredit,
		EntryLayer:          j.EntryLayer,
		ReversalOfJournalID: j.ReversalOfJournalID,
	}
	if j.Period != nil {
		v.Period = *j.Period
	}
	for _, l := range j.Lines {
		debit, err := orZero(l.Debit)
		if err != nil {
			return voucher.Voucher{}, err
		}
		credit, err := orZero(l.Credit)
		if err != nil {
			return voucher.Voucher{}, err
		}
		funcDebit, err := orZero(l.FuncDebit)
		if err != nil {
			return voucher.Voucher{}, err
		}
		funcCredit, err := orZero(l.FuncCredit)
		if err != nil {
			return voucher.Voucher{}, err
		}
		v.Lines = append(v.Lines, voucher.StoredLine{
			LineNumber: l.LineNumber, AccountCode: l.AccountCode,
			Debit: debit, Credit: credit, FuncDebit: funcDebit, FuncCredit: funcCredit,
		})
	}
	return v, nil
}

// orZero parses an or-falsy amount: "" is the reference's absent-or-empty
// and reads as zero.
func orZero(s string) (money.Money, error) {
	if s == "" {
		s = "0"
	}
	return money.Parse(s)
}

// docString reads a string field: absent, null and non-string all read as
// the empty string, the reference's falsy.
func docString(doc voucher.Snapshot, field string) string {
	v, ok := docGet(doc, field)
	if !ok {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

// docOptString reads a nullable string field: present and non-null yields
// (value, true); absent or null yields ("", false) — the reference's None.
func docOptString(doc voucher.Snapshot, field string) (string, bool) {
	v, ok := docGet(doc, field)
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	if !ok {
		return "", false
	}
	return s, true
}

// docIntOr reads an integer field with a fallback.
func docIntOr(doc voucher.Snapshot, field string, fallback int64) int64 {
	v, ok := docGet(doc, field)
	if !ok {
		return fallback
	}
	n, ok := v.(json.Number)
	if !ok {
		return fallback
	}
	i, err := n.Int64()
	if err != nil {
		return fallback
	}
	return i
}

// docMoneyOr parses a money field, falling back when absent, null or empty
// (the reference's `or 0`).
func docMoneyOr(doc voucher.Snapshot, field, fallback string) (money.Money, error) {
	v := docString(doc, field)
	if v == "" {
		v = fallback
	}
	return money.Parse(v)
}

// docGet decodes one field; a missing key or JSON null is (nil, true), the
// reference's None. Undecodable bytes are store corruption: (nil, false),
// which never compares equal to anything — the same convention the voucher
// package's snapshot guard uses.
func docGet(doc voucher.Snapshot, field string) (value any, ok bool) {
	raw, present := doc[field]
	if !present || len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, false
	}
	return v, true
}

// docStatus reads the status field of a save-path document.
func docStatus(doc voucher.Snapshot) voucher.Status {
	return voucher.Status(docString(doc, "status"))
}

// docHasRevision reports whether the document carries a revision key at all
// (`"revision" in entry`): save_journal refuses a new row whose dict carries
// the key even when the value is null.
func docHasRevision(doc voucher.Snapshot) bool {
	raw, present := doc["revision"]
	return present && len(raw) > 0
}

// docRevision reads a non-null revision: nil covers the reference's
// entry.get("revision") returning None (absent or null).
func docRevision(doc voucher.Snapshot) *int64 {
	raw, present := doc["revision"]
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

// changedFields mirrors save_journal's finalized-branch diff:
// `[key for key, value in values.items() if key != "status" and value !=
// getattr(current, key)]` over every journal column. The port diffs the two
// wire documents over their key union minus status. Fields the reference
// normalizes on the way in (evidence_uris and lines as JSON strings,
// timestamps as datetimes) compare identically after the round-trip the
// reference's own journal_to_dict performs.
func changedFields(current, submitted voucher.Snapshot, exclude string) []string {
	keys := map[string]bool{}
	for k := range current {
		keys[k] = true
	}
	for k := range submitted {
		keys[k] = true
	}
	changed := []string{}
	for _, k := range sortedKeys(keys) {
		if k == exclude {
			continue
		}
		a, aOK := docGet(current, k)
		b, bOK := docGet(submitted, k)
		if !aOK || !bOK || !jsonEqual(a, b) {
			changed = append(changed, k)
		}
	}
	return changed
}

// jsonEqual compares two decoded JSON values. Numbers compare as literal
// tokens (json.Number), which is exact for the integer fields the journal
// dict carries; amounts cross as strings.
func jsonEqual(a, b any) bool {
	if an, ok := a.(json.Number); ok {
		bn, ok2 := b.(json.Number)
		return ok2 && an.String() == bn.String()
	}
	if _, ok := a.(json.Number); ok {
		return false
	}
	if _, ok := b.(json.Number); ok {
		return false
	}
	return equalValue(a, b)
}

func equalValue(a, b any) bool {
	switch av := a.(type) {
	case nil:
		return b == nil
	case bool:
		bv, ok := b.(bool)
		return ok && av == bv
	case string:
		bv, ok := b.(string)
		return ok && av == bv
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !jsonEqual(av[i], bv[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for k, v := range av {
			bvv, ok := bv[k]
			if !ok || !jsonEqual(v, bvv) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func sortedKeys(keys map[string]bool) []string {
	out := make([]string, 0, len(keys))
	for k := range keys {
		out = append(out, k)
	}
	// Insertion order of the reference's model fields is the changed-list
	// order; the wire keys are snake_case column names and the reference's
	// vars(model) yields declaration order. The port sorts for determinism;
	// the order only shows in refusal messages, which fixtures do not pin.
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// pyVoucherNo renders voucher_no the way the reference's f-strings do:
// str(None) when absent.
func pyVoucherNo(v *string) string {
	if v == nil {
		return "None"
	}
	return *v
}

// trimSpace mirrors Python str.strip(): unicode whitespace, both ends
// (strings.TrimSpace's set matches str.isspace()).
func trimSpace(s string) string {
	return strings.TrimSpace(s)
}
