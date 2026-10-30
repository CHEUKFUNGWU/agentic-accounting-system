package voucher

import (
	"sort"
	"strconv"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the reversal rules of posting.py as pure functions over
// value types:
//
//   - BuildReversalLines mirrors posting.build_reversal_lines: reversal
//     lines are built from the persisted ledger rows (the authoritative
//     facts), never reconstructed from voucher JSON — the BL-03 remediation
//     semantics (07-reviews/2026-10-21-business-logic-audit.md).
//   - ValidateReversal mirrors the value rules of posting._reversal_original.
//   - ValidateReversalMirror mirrors posting._validate_reversal_lines: the
//     posted reversal's persisted rows must be an exact multiset mirror of
//     the original's.
//
// What stays with the P2 store adapter (queries and locks in the reference):
// fetching the rows ordered by line_number, the existence check for another
// effective posted reversal of the original (the BL-03 uniqueness
// enforcement), and the row-lock/revision guards.

// PostingError mirrors posting.PostingError (and, for the save-path kinds,
// repository.JournalConflict — the store adapter maps both the same way): a
// refusal whose message is user-facing.
type PostingError struct {
	Kind    string
	Message string
}

func (e *PostingError) Error() string { return e.Kind + ": " + e.Message }

// Reversal and post-path refusal kinds: the message prefixes the reference
// embeds on its exception strings; fixtures pin the kind, not the text.
const (
	KindReversalInvalid  = "REVERSAL_INVALID"
	KindReversalConflict = "REVERSAL_CONFLICT"
)

// LedgerLine is the persisted ledger row (db.JournalLineModel) as the
// reversal rules read it: amounts and rates as the stored strings, exactly
// as the reference feeds them to Decimal(). Nullable columns are pointers.
type LedgerLine struct {
	LineID         string `json:"line_id"`
	JournalID      string `json:"journal_id"`
	EntityCode     string `json:"entity_code"`
	LineNumber     int64  `json:"line_number"`
	AccountID      string `json:"account_id"`
	AccountCode    string `json:"account_code"`
	AccountName    string `json:"account_name"`
	PeriodCode     string `json:"period_code"`
	EntryLayer     string `json:"entry_layer"`
	AccountingDate string `json:"accounting_date"`

	TxCurrency   string `json:"tx_currency"`
	ExchangeRate string `json:"exchange_rate"`
	TxDebit      string `json:"tx_debit"`
	TxCredit     string `json:"tx_credit"`
	FuncDebit    string `json:"func_debit"`
	FuncCredit   string `json:"func_credit"`

	CounterpartyID   *string `json:"counterparty_id"`
	CounterpartyName string  `json:"counterparty_name"`
	TaxCodeID        *string `json:"tax_code_id"`
	FuncTaxAmount    string  `json:"func_tax_amount"`
	BusinessUsePct   string  `json:"business_use_pct"`
	StatementRef     string  `json:"statement_ref"`
	Memo             string  `json:"memo"`
}

// ReversalLine is one line of a reversal draft: the original voucher line's
// metadata with the mirrored amounts and the persisted-row fields layered on
// top (build_reversal_lines' deepcopy(metadata) + update). The passthrough
// strings are the persisted row's verbatim column values — the reference
// assigns them without re-quantizing.
type ReversalLine struct {
	LineNumber   int64  `json:"line_number"`
	AccountCode  string `json:"account_code"`
	AccountName  string `json:"account_name"`
	Debit        string `json:"debit"`       // row.tx_credit — the sides swap
	Credit       string `json:"credit"`      // row.tx_debit
	FuncDebit    string `json:"func_debit"`  // row.func_credit
	FuncCredit   string `json:"func_credit"` // row.func_debit
	TxCurrency   string `json:"tx_currency"`
	ExchangeRate string `json:"exchange_rate"`

	CounterpartyID *string `json:"counterparty_id"`
	// Counterparty carries the row's counterparty_name under the voucher
	// line's key name, as the reference's update does.
	Counterparty string `json:"counterparty"`
	// TaxCode is the one field that survives from the matched voucher-line
	// metadata; the reference never overwrites it. When no metadata line
	// matches (the reference starts from an empty dict), the key is absent
	// from the output — nil here, not the empty string.
	TaxCode        *string `json:"tax_code,omitempty"`
	TaxCodeID      *string `json:"tax_code_id"`
	FuncTaxAmount  string  `json:"func_tax_amount"`
	BusinessUsePct string  `json:"business_use_pct"`
	StatementRef   string  `json:"statement_ref"`
	Memo           string  `json:"memo"`
}

// mustMoney parses a compile-time constant; the panic is unreachable.
func mustMoney(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("voucher: constant money literal failed to parse: " + s)
	}
	return m
}

// one is Decimal("1"), the upper bound of business_use_pct.
var one = mustMoney("1")

// quantizedNonNegative validates one persisted amount the way
// build_reversal_lines does: finite (money.Parse rejects the non-finite
// specials, classifying identically), non-negative, and quantized to 0.0001.
func quantizedNonNegative(value string) (money.Money, error) {
	m, err := money.Parse(value)
	if err != nil {
		return money.Money{}, err
	}
	q, err := m.Round(4, money.RoundHalfEven)
	if err != nil {
		return money.Money{}, err
	}
	if !m.Equal(q) {
		return money.Money{}, errNotQuantized
	}
	var zero money.Money
	if m.Cmp(zero) < 0 {
		return money.Money{}, errNegative
	}
	return m, nil
}

type reversalRuleError string

const (
	errNotQuantized reversalRuleError = "not quantized to 0.0001"
	errNegative     reversalRuleError = "negative amount"
)

func (e reversalRuleError) Error() string { return string(e) }

// BuildReversalLines mirrors posting.build_reversal_lines over value types.
// original is the posted voucher; rows are its persisted ledger lines (the
// store fetches them ordered by line_number — the port re-sorts a copy to
// reproduce the reference's ORDER BY). reason is the reviewer's reason; the
// memo carries 沖銷 <voucher_no>：<reason or row memo>, trailing full-width
// colons trimmed exactly like the reference's str.strip("：").
func BuildReversalLines(original Voucher, rows []LedgerLine, reason string) ([]ReversalLine, error) {
	if len(rows) == 0 {
		return nil, &PostingError{
			Kind:    KindReversalInvalid,
			Message: "REVERSAL_INVALID: original has no persisted ledger lines.",
		}
	}
	sorted := append([]LedgerLine{}, rows...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].LineNumber < sorted[j].LineNumber })

	out := make([]ReversalLine, 0, len(sorted))
	seen := map[int64]bool{}
	for _, row := range sorted {
		// (The reference also refuses a NULL line_number here; the column is
		// NOT NULL, so the typed row cannot carry one.)
		if row.EntityCode != original.EntityCode ||
			original.EntryLayer == "" ||
			row.EntryLayer != original.EntryLayer ||
			row.AccountCode == "" || row.AccountID == "" ||
			row.TxCurrency == "" || row.ExchangeRate == "" ||
			seen[row.LineNumber] {
			return nil, &PostingError{
				Kind:    KindReversalInvalid,
				Message: "REVERSAL_INVALID: missing or inconsistent persisted line metadata.",
			}
		}
		seen[row.LineNumber] = true
		for _, raw := range []string{row.TxDebit, row.TxCredit, row.FuncDebit, row.FuncCredit} {
			if _, err := quantizedNonNegative(raw); err != nil {
				return nil, &PostingError{
					Kind:    KindReversalInvalid,
					Message: "REVERSAL_INVALID: invalid persisted line amounts.",
				}
			}
		}
		var zero money.Money
		rate, err := money.Parse(row.ExchangeRate)
		if err != nil || rate.Cmp(zero) <= 0 {
			return nil, reversalRateError()
		}
		businessUse, err := money.Parse(row.BusinessUsePct)
		if err != nil || businessUse.Cmp(zero) < 0 || businessUse.Cmp(one) > 0 {
			return nil, reversalRateError()
		}
		// No signed-tax reversal policy is defined. Do not silently retain,
		// drop, or negate a nonzero tax amount (fail closed, BL-03).
		tax, err := money.Parse(row.FuncTaxAmount)
		if err != nil || !tax.IsZero() {
			return nil, reversalTaxError()
		}
		var metadata StoredLine
		metadataMatched := false
		for _, l := range original.Lines {
			if l.LineNumber == row.LineNumber && l.AccountCode == row.AccountCode {
				metadata = l
				metadataMatched = true
				break
			}
		}
		var taxCode *string
		if metadataMatched {
			code := metadata.TaxCode
			taxCode = &code
		}
		out = append(out, ReversalLine{
			LineNumber:     row.LineNumber,
			AccountCode:    row.AccountCode,
			AccountName:    row.AccountName,
			Debit:          row.TxCredit,
			Credit:         row.TxDebit,
			FuncDebit:      row.FuncCredit,
			FuncCredit:     row.FuncDebit,
			TxCurrency:     row.TxCurrency,
			ExchangeRate:   row.ExchangeRate,
			CounterpartyID: row.CounterpartyID,
			Counterparty:   row.CounterpartyName,
			TaxCode:        taxCode,
			TaxCodeID:      row.TaxCodeID,
			FuncTaxAmount:  row.FuncTaxAmount,
			BusinessUsePct: row.BusinessUsePct,
			StatementRef:   row.StatementRef,
			Memo:           reversalMemo(original.VoucherNo, reason, row.Memo),
		})
	}
	return out, nil
}

// reversalMemo mirrors the reference's memo construction:
// f"沖銷 {voucher_no}：{reason or row_memo or ”}".strip("："). A nil voucher
// number renders as Python str(None) — "None" — though a posted original
// always carries its number under BL-36.
func reversalMemo(voucherNo *string, reason, rowMemo string) string {
	no := "None"
	if voucherNo != nil {
		no = *voucherNo
	}
	tail := reason
	if tail == "" {
		tail = rowMemo
	}
	return strings.Trim("沖銷 "+no+"："+tail, "：")
}

func reversalRateError() error {
	return &PostingError{
		Kind:    KindReversalInvalid,
		Message: "REVERSAL_INVALID: invalid persisted exchange rate or business use.",
	}
}

func reversalTaxError() error {
	return &PostingError{
		Kind:    KindReversalInvalid,
		Message: "REVERSAL_INVALID: nonzero functional tax requires an explicit reversal policy.",
	}
}

// ValidateReversal mirrors the value rules of posting._reversal_original:
// a reversal draft must link a POSTED, non-reversal original in the same
// entity, and its currency and totals must mirror the original's. original
// is nil when the store found no record for the link. Returns the validated
// original (the reference returns the loaded original dict), nil without
// error when the voucher is not a reversal at all, or a classified refusal.
//
// Not representable here: the existence check for another effective posted
// reversal (a store query — the BL-03 uniqueness enforcement) and the row
// locks; both are P2 store-adapter work.
func ValidateReversal(current Voucher, original *Voucher) (*Voucher, error) {
	link := current.ReversalOfJournalID
	if link == nil || *link == "" {
		if current.SourceModule == "REVERSAL" {
			return nil, &PostingError{
				Kind:    KindReversalInvalid,
				Message: "REVERSAL_INVALID: reversal must link an original voucher.",
			}
		}
		return nil, nil
	}
	// Malformed reversal lines: numbers unique, accounts present, amounts
	// finite, non-negative, quantized. (The reference also refuses lines
	// without a line number or with unparsable amounts; those are
	// unrepresentable in the typed line and live at the store boundary.)
	numbers := map[int64]bool{}
	var zero money.Money
	for _, l := range current.Lines {
		if l.AccountCode == "" || numbers[l.LineNumber] {
			return nil, malformedReversalLines()
		}
		numbers[l.LineNumber] = true
		for _, m := range []money.Money{l.Debit, l.Credit, l.FuncDebit, l.FuncCredit} {
			q, err := m.Round(4, money.RoundHalfEven)
			if err != nil || !m.Equal(q) || m.Cmp(zero) < 0 {
				return nil, malformedReversalLines()
			}
		}
	}
	if len(current.Lines) == 0 {
		return nil, malformedReversalLines()
	}
	if original == nil || original.EntityCode != current.EntityCode {
		return nil, &PostingError{
			Kind:    KindReversalInvalid,
			Message: "REVERSAL_INVALID: original not found in this entity.",
		}
	}
	if (original.ReversalOfJournalID != nil && *original.ReversalOfJournalID != "") ||
		original.SourceModule == "REVERSAL" {
		return nil, &PostingError{
			Kind:    KindReversalInvalid,
			Message: "REVERSAL_INVALID: reversing a posted reversal is not supported.",
		}
	}
	if original.Status != StatusPosted {
		return nil, &PostingError{
			Kind:    KindReversalConflict,
			Message: "REVERSAL_CONFLICT: original must still be POSTED and not already reversed.",
		}
	}
	if current.Currency != original.Currency ||
		!current.TotalDebit.Equal(original.TotalCredit) ||
		!current.TotalCredit.Equal(original.TotalDebit) {
		return nil, &PostingError{
			Kind:    KindReversalInvalid,
			Message: "REVERSAL_INVALID: currency and totals must mirror the original.",
		}
	}
	return original, nil
}

func malformedReversalLines() error {
	return &PostingError{
		Kind:    KindReversalInvalid,
		Message: "REVERSAL_INVALID: malformed reversal lines.",
	}
}

// reversalSignature is _validate_reversal_lines' signature tuple: entity,
// account, layer, currency and the four amounts (debits and credits swapped
// when mirroring the original side). The amounts enter as canonical decimal
// keys because Python's Counter hashes Decimals by numeric value —
// Decimal("100.0000") and Decimal("100") are one key.
func reversalSignature(row LedgerLine, mirror bool) (string, error) {
	amounts := []string{row.TxDebit, row.TxCredit, row.FuncDebit, row.FuncCredit}
	keys := make([]string, 0, len(amounts))
	for _, raw := range amounts {
		m, err := money.Parse(raw)
		if err != nil {
			return "", err
		}
		var zero money.Money
		if m.Cmp(zero) < 0 {
			return "", errNegative
		}
		keys = append(keys, canonicalAmountKey(m))
	}
	prefix := row.EntityCode + "\x00" + row.AccountCode + "\x00" + row.EntryLayer + "\x00" + row.TxCurrency
	if mirror {
		return prefix + "\x00" + keys[1] + "\x00" + keys[0] + "\x00" + keys[3] + "\x00" + keys[2], nil
	}
	return prefix + "\x00" + keys[0] + "\x00" + keys[1] + "\x00" + keys[2] + "\x00" + keys[3], nil
}

// canonicalAmountKey renders a money value as a scale-insensitive key, so
// numerically equal values collide like Python's Decimal hashing requires:
// scientific notation expanded, trailing fractional zeros trimmed, and any
// zero (including a negative zero) collapsed to "0".
func canonicalAmountKey(m money.Money) string {
	s := m.String()
	if i := strings.IndexAny(s, "eE"); i >= 0 {
		s = expandScientific(s)
	}
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	if i := strings.Index(s, "."); i >= 0 {
		s = strings.TrimRight(s, "0")
		s = strings.TrimSuffix(s, ".")
	}
	if strings.Trim(s, "0") == "" {
		return "0"
	}
	if neg {
		return "-" + s
	}
	return s
}

// expandScientific rewrites a Python Decimal scientific form ("1.5E+3",
// "1E-7") into fixed notation. The exponent is bounded by money.Parse's
// limits, so the repeats below are small.
func expandScientific(s string) string {
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	eIdx := strings.IndexAny(s, "eE")
	mantissa, expText := s[:eIdx], s[eIdx+1:]
	sign := 1
	if expText[0] == '-' || expText[0] == '+' {
		if expText[0] == '-' {
			sign = -1
		}
		expText = expText[1:]
	}
	parsed, _ := strconv.Atoi(expText)
	exp := sign * parsed
	digits := mantissa
	if dot := strings.Index(mantissa, "."); dot >= 0 {
		digits = mantissa[:dot] + mantissa[dot+1:]
		exp -= len(mantissa) - dot - 1
	}
	if exp >= 0 {
		digits += strings.Repeat("0", exp)
	} else if point := len(digits) + exp; point <= 0 {
		digits = "0." + strings.Repeat("0", -point) + digits
	} else {
		digits = digits[:point] + "." + digits[point:]
	}
	if neg {
		return "-" + digits
	}
	return digits
}

// ValidateReversalMirror mirrors posting._validate_reversal_lines: the
// reversal's persisted rows must be an exact multiset mirror of the
// original's — same entities, accounts, entry layers, currencies, and
// swapped debit/credit amounts in both the transaction and functional
// layers. This is the net-to-zero guarantee in its reference form.
func ValidateReversalMirror(originalRows, reversalRows []LedgerLine) error {
	if len(originalRows) == 0 {
		return mirrorError()
	}
	originals := map[string]int{}
	for _, row := range originalRows {
		sig, err := reversalSignature(row, true)
		if err != nil {
			return invalidPersistedAmounts()
		}
		originals[sig]++
	}
	reversals := map[string]int{}
	for _, row := range reversalRows {
		sig, err := reversalSignature(row, false)
		if err != nil {
			return invalidPersistedAmounts()
		}
		reversals[sig]++
	}
	for sig, n := range originals {
		if reversals[sig] != n {
			return mirrorError()
		}
	}
	for sig, n := range reversals {
		if originals[sig] != n {
			return mirrorError()
		}
	}
	return nil
}

func mirrorError() error {
	return &PostingError{
		Kind: KindReversalInvalid,
		Message: "REVERSAL_INVALID: lines must exactly mirror the original persisted ledger " +
			"amounts, accounts, currencies and layers.",
	}
}

func invalidPersistedAmounts() error {
	return &PostingError{
		Kind:    KindReversalInvalid,
		Message: "REVERSAL_INVALID: invalid persisted line amounts.",
	}
}
