package voucher

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// The op names and field names are the wire forms written by
// backend-go/tools/gen_vouchers.py. Money values cross as strings; no
// float64 appears anywhere on the wire.
const (
	opQ4                  = "q4"
	opNormalBalance       = "normal_balance"
	opClassification      = "account_classification"
	opParseLines          = "parse_lines"
	opAssertBalanced      = "assert_balanced"
	opToProposedLines     = "to_proposed_lines"
	opBuildReversal       = "build_reversal_lines"
	opValidateReversal    = "validate_reversal"
	opReversalMirror      = "validate_reversal_mirror"
	opSnapshotCheck       = "snapshot_check"
	opSnapshotFields      = "snapshot_changed_fields"
	opCanSave             = "can_save_transition"
	opAllowedSave         = "allowed_save_transitions"
	opFinalizedSave       = "finalized_save"
	opCanPost             = "can_post"
	opFormatVoucherNumber = "format_voucher_number"
	opReportGaps          = "report_gaps"

	// errDecimalInvalidOperation pins the reference's decimal.InvalidOperation
	// escape (a non-decimal payload amount); see validation.go.
	errDecimalInvalidOperation = "DECIMAL_INVALID_OPERATION"
)

func mustParse(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("parity: unparsable money string " + s)
	}
	return m
}

type rawLineWire struct {
	AccountCode    string `json:"account_code"`
	AccountName    string `json:"account_name"`
	Debit          string `json:"debit"`
	Credit         string `json:"credit"`
	Memo           string `json:"memo"`
	Counterparty   string `json:"counterparty"`
	TaxCode        string `json:"tax_code"`
	BusinessUsePct string `json:"business_use_pct"`
}

// storedLineWire is the canonical stored-line shape, shared by parse_lines
// outputs and to_proposed_lines inputs.
type storedLineWire struct {
	LineNumber     int64  `json:"line_number"`
	AccountCode    string `json:"account_code"`
	AccountName    string `json:"account_name"`
	Debit          string `json:"debit"`
	Credit         string `json:"credit"`
	Memo           string `json:"memo"`
	Counterparty   string `json:"counterparty"`
	TaxCode        string `json:"tax_code"`
	BusinessUsePct string `json:"business_use_pct"`
}

func storedToWire(l StoredLine) storedLineWire {
	return storedLineWire{
		LineNumber: l.LineNumber, AccountCode: l.AccountCode, AccountName: l.AccountName,
		Debit: l.Debit.String(), Credit: l.Credit.String(), Memo: l.Memo,
		Counterparty: l.Counterparty, TaxCode: l.TaxCode, BusinessUsePct: l.BusinessUsePct,
	}
}

func wireToStored(w storedLineWire) StoredLine {
	return StoredLine{
		LineNumber: w.LineNumber, AccountCode: w.AccountCode, AccountName: w.AccountName,
		Debit: mustParse(w.Debit), Credit: mustParse(w.Credit), Memo: w.Memo,
		Counterparty: w.Counterparty, TaxCode: w.TaxCode, BusinessUsePct: w.BusinessUsePct,
	}
}

type proposedWire struct {
	LineNumber       int     `json:"line_number"`
	AccountCode      string  `json:"account_code"`
	IsControlAccount bool    `json:"is_control_account"`
	TxDebit          string  `json:"tx_debit"`
	TxCredit         string  `json:"tx_credit"`
	FuncDebit        string  `json:"func_debit"`
	FuncCredit       string  `json:"func_credit"`
	TaxCode          *string `json:"tax_code"`
	Memo             string  `json:"memo"`
}

type reversalOriginalWire struct {
	JournalID  string           `json:"journal_id"`
	EntityCode string           `json:"entity_code"`
	VoucherNo  *string          `json:"voucher_no"`
	EntryLayer *string          `json:"entry_layer"`
	Lines      []storedLineWire `json:"lines"`
}

func (w reversalOriginalWire) voucher() Voucher {
	v := Voucher{
		JournalID: w.JournalID, EntityCode: w.EntityCode, VoucherNo: w.VoucherNo,
		Status: StatusPosted,
	}
	if w.EntryLayer != nil {
		v.EntryLayer = *w.EntryLayer
	}
	for _, l := range w.Lines {
		v.Lines = append(v.Lines, wireToStored(l))
	}
	return v
}

// journalLineWire is one line of a journal dict; the reversal rules read the
// amounts with .get-or-zero semantics, so missing/null is zero.
type journalLineWire struct {
	LineNumber  int64   `json:"line_number"`
	AccountCode string  `json:"account_code"`
	Debit       *string `json:"debit"`
	Credit      *string `json:"credit"`
	FuncDebit   *string `json:"func_debit"`
	FuncCredit  *string `json:"func_credit"`
}

func (w journalLineWire) amount(p *string) money.Money {
	if p == nil || *p == "" {
		return mustParse("0")
	}
	return mustParse(*p)
}

func (w journalLineWire) storedLine() StoredLine {
	return StoredLine{
		LineNumber: w.LineNumber, AccountCode: w.AccountCode,
		Debit: w.amount(w.Debit), Credit: w.amount(w.Credit),
		FuncDebit: w.amount(w.FuncDebit), FuncCredit: w.amount(w.FuncCredit),
	}
}

// journalWire is the journal-dict subset the voucher rules read (the shape
// repository.journal_to_dict emits).
type journalWire struct {
	JournalID           string            `json:"journal_id"`
	Revision            int64             `json:"revision"`
	EntityCode          string            `json:"entity_code"`
	SourceModule        string            `json:"source_module"`
	Status              string            `json:"status"`
	AccountingDate      string            `json:"accounting_date"`
	Currency            string            `json:"currency"`
	Period              *string           `json:"period"`
	VoucherNo           *string           `json:"voucher_no"`
	Memo                string            `json:"memo"`
	TotalDebit          string            `json:"total_debit"`
	TotalCredit         string            `json:"total_credit"`
	EntryLayer          *string           `json:"entry_layer"`
	ReversalOfJournalID *string           `json:"reversal_of_journal_id"`
	Lines               []journalLineWire `json:"lines"`
}

func (w journalWire) voucher() Voucher {
	v := Voucher{
		JournalID: w.JournalID, Revision: w.Revision, EntityCode: w.EntityCode,
		SourceModule: w.SourceModule, Status: Status(w.Status),
		AccountingDate: w.AccountingDate, Currency: w.Currency,
		VoucherNo: w.VoucherNo, Memo: w.Memo,
		TotalDebit:          mustParse(w.TotalDebit),
		TotalCredit:         mustParse(w.TotalCredit),
		ReversalOfJournalID: w.ReversalOfJournalID,
	}
	if w.Period != nil {
		v.Period = *w.Period
	}
	if w.EntryLayer != nil {
		v.EntryLayer = *w.EntryLayer
	}
	for _, l := range w.Lines {
		v.Lines = append(v.Lines, l.storedLine())
	}
	return v
}

// replay executes one fixture case. Refusals surface as *fixture.Error
// carrying the reference's message-kind prefix (or this port's kind taxonomy
// for the prefix-less VoucherError messages).
func replay(input json.RawMessage) (any, error) {
	var header struct {
		Op string `json:"op"`
	}
	if err := json.Unmarshal(input, &header); err != nil {
		return nil, err
	}
	switch header.Op {
	case opQ4:
		var in struct {
			Value string `json:"value"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		m, err := Q4(in.Value)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return m.String(), nil

	case opNormalBalance:
		var in struct {
			AccountType string `json:"account_type"`
			FSCategory  string `json:"fs_category"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return NormalBalance(in.AccountType, in.FSCategory), nil

	case opClassification:
		var in struct {
			AccountType string `json:"account_type"`
			FSCategory  string `json:"fs_category"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return map[string]any{
			"normal_balance":     NormalBalance(in.AccountType, in.FSCategory),
			"is_control_account": IsControlFSCategory(in.FSCategory),
		}, nil

	case opParseLines:
		var in struct {
			Lines []rawLineWire `json:"lines"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		raw := make([]RawLine, 0, len(in.Lines))
		for _, l := range in.Lines {
			raw = append(raw, RawLine(l))
		}
		lines, err := ParseLines(raw)
		if err != nil {
			return nil, fixtureKind(err)
		}
		out := make([]storedLineWire, 0, len(lines))
		for _, l := range lines {
			out = append(out, storedToWire(l))
		}
		return out, nil

	case opAssertBalanced:
		var in struct {
			Lines []struct {
				Debit  string `json:"debit"`
				Credit string `json:"credit"`
			} `json:"lines"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		lines := make([]StoredLine, 0, len(in.Lines))
		for i, l := range in.Lines {
			lines = append(lines, StoredLine{
				LineNumber: int64(i + 1),
				Debit:      mustParse(l.Debit), Credit: mustParse(l.Credit),
			})
		}
		dr, cr, err := AssertBalanced(lines)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return map[string]any{"total_debit": dr.String(), "total_credit": cr.String()}, nil

	case opToProposedLines:
		var in struct {
			Lines           []storedLineWire `json:"lines"`
			ControlAccounts []string         `json:"control_accounts"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		lines := make([]StoredLine, 0, len(in.Lines))
		for _, l := range in.Lines {
			lines = append(lines, wireToStored(l))
		}
		control := map[string]bool{}
		for _, c := range in.ControlAccounts {
			control[c] = true
		}
		proposed := ToProposedLines(lines, control)
		out := make([]proposedWire, 0, len(proposed))
		for _, p := range proposed {
			out = append(out, proposedWire{
				LineNumber: p.LineNumber, AccountCode: p.AccountCode,
				IsControlAccount: p.IsControlAccount,
				TxDebit:          p.TxDebit.String(), TxCredit: p.TxCredit.String(),
				FuncDebit: p.FuncDebit.String(), FuncCredit: p.FuncCredit.String(),
				TaxCode: p.TaxCode, Memo: p.Memo,
			})
		}
		return out, nil

	case opBuildReversal:
		var in struct {
			Reason   string               `json:"reason"`
			Original reversalOriginalWire `json:"original"`
			Rows     []LedgerLine         `json:"rows"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		lines, err := BuildReversalLines(in.Original.voucher(), in.Rows, in.Reason)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return lines, nil

	case opValidateReversal:
		var in struct {
			Current  journalWire  `json:"current"`
			Original *journalWire `json:"original"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		var original *Voucher
		if in.Original != nil {
			loaded := in.Original.voucher()
			original = &loaded
		}
		validated, err := ValidateReversal(in.Current.voucher(), original)
		if err != nil {
			return nil, fixtureKind(err)
		}
		if validated == nil {
			return nil, nil
		}
		return map[string]any{"original_journal_id": validated.JournalID}, nil

	case opReversalMirror:
		var in struct {
			OriginalRows []LedgerLine `json:"original_rows"`
			ReversalRows []LedgerLine `json:"reversal_rows"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		if err := ValidateReversalMirror(in.OriginalRows, in.ReversalRows); err != nil {
			return nil, fixtureKind(err)
		}
		return map[string]any{"ok": true}, nil

	case opSnapshotCheck, opSnapshotFields:
		var in struct {
			Submitted Snapshot `json:"submitted"`
			Current   Snapshot `json:"current"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		if header.Op == opSnapshotFields {
			return map[string]any{"changed_fields": ChangedSnapshotFields(in.Submitted, in.Current)}, nil
		}
		if err := CheckSnapshot(in.Submitted, in.Current); err != nil {
			return nil, fixtureKind(err)
		}
		return map[string]any{"ok": true}, nil

	case opCanSave:
		var in struct {
			From Status `json:"from"`
			To   Status `json:"to"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return CanSaveTransition(in.From, in.To), nil

	case opAllowedSave:
		var in struct {
			From Status `json:"from"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return AllowedSaveTransitions(in.From), nil

	case opFinalizedSave:
		var in struct {
			Current        Status `json:"current"`
			Proposed       Status `json:"proposed"`
			ContentChanged bool   `json:"content_changed"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		kind := CheckSave(in.Current, in.Proposed, in.ContentChanged)
		return kind == "", nil

	case opCanPost:
		var in struct {
			From Status `json:"from"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return CanPost(in.From), nil

	case opFormatVoucherNumber:
		var in struct {
			Entity   string `json:"entity"`
			Period   string `json:"period"`
			Sequence int64  `json:"sequence"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		number, err := FormatVoucherNumber(in.Entity, in.Period, in.Sequence)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return number, nil

	case opReportGaps:
		var in struct {
			Posted []int64 `json:"posted"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		gaps, err := ReportGaps(in.Posted)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return map[string]any{"gaps": gaps}, nil

	default:
		return nil, errors.New("voucher replay: unknown op " + header.Op)
	}
}

// fixtureKind maps the package's errors onto the harness's classified error.
func fixtureKind(err error) error {
	var ve *VoucherError
	if errors.As(err, &ve) {
		return &fixture.Error{Kind: ve.Kind}
	}
	var pe *PostingError
	if errors.As(err, &pe) {
		return &fixture.Error{Kind: pe.Kind}
	}
	var ne *NumberError
	if errors.As(err, &ne) {
		return &fixture.Error{Kind: ne.Kind}
	}
	if errors.Is(err, money.ErrInvalidParse) || errors.Is(err, money.ErrQuantize) {
		return &fixture.Error{Kind: errDecimalInvalidOperation}
	}
	return err
}

// TestGoldenFixtures replays the Python-generated vouchers fixtures byte for
// byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_vouchers.py
//
// The BL-36 numbering cases are spec-derived (SRC-0017 owner decision
// 2026-10-21; SRC-0027 2026-10-24) — no Python implementation exists.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("vouchers", replay)
	fixture.Run(t, "vouchers")
	fixture.ValidateDivergences(t)
}
