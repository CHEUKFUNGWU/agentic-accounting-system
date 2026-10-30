package ledger

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// Fixture error kinds on the ledger replay wire — the strings
// tools/gen_ledger.py writes into expected_error fields (the reference's
// LedgerError UPPER_SNAKE prefixes, lowercased).
const (
	kindInvalidPeriod             = "invalid_period"
	kindInvalidAccountingDate     = "invalid_accounting_date"
	kindPeriodDateMismatch        = "period_date_mismatch"
	kindPeriodLocked              = "period_locked"
	kindPeriodAlreadyLocked       = "period_already_locked"
	kindPeriodHasUnpostedVouchers = "period_has_unposted_vouchers"
	kindTrialBalanceBroken        = "trial_balance_broken"
	kindCOAMissingAccount         = "coa_missing_account"
	kindAccountCodeRequired       = "account_code_required"
	kindInvalidAccountType        = "invalid_account_type"
	kindCounterpartyRequired      = "counterparty_required"
	kindInvalidParse              = "invalid_parse"
	kindInvalidQuantize           = "invalid_quantize"
)

// classify maps a replay error onto its fixture kind. Wiring mistakes
// (unknown op, unparseable input document) stay unclassified and fail loudly.
func classify(err error) error {
	switch {
	case errors.Is(err, ErrInvalidPeriod):
		return &fixture.Error{Kind: kindInvalidPeriod}
	case errors.Is(err, ErrInvalidAccountingDate):
		return &fixture.Error{Kind: kindInvalidAccountingDate}
	case errors.Is(err, ErrPeriodDateMismatch):
		return &fixture.Error{Kind: kindPeriodDateMismatch}
	case errors.Is(err, ErrPeriodLocked):
		return &fixture.Error{Kind: kindPeriodLocked}
	case errors.Is(err, ErrPeriodAlreadyLocked):
		return &fixture.Error{Kind: kindPeriodAlreadyLocked}
	case errors.Is(err, ErrPeriodHasUnpostedVouchers):
		return &fixture.Error{Kind: kindPeriodHasUnpostedVouchers}
	case errors.Is(err, ErrTrialBalanceBroken):
		return &fixture.Error{Kind: kindTrialBalanceBroken}
	case errors.Is(err, ErrCOAMissingAccount):
		return &fixture.Error{Kind: kindCOAMissingAccount}
	case errors.Is(err, ErrAccountCodeRequired):
		return &fixture.Error{Kind: kindAccountCodeRequired}
	case errors.Is(err, ErrInvalidAccountType):
		return &fixture.Error{Kind: kindInvalidAccountType}
	case errors.Is(err, ErrCounterpartyRequired):
		return &fixture.Error{Kind: kindCounterpartyRequired}
	case errors.Is(err, money.ErrInvalidParse):
		return &fixture.Error{Kind: kindInvalidParse}
	case errors.Is(err, money.ErrQuantize):
		return &fixture.Error{Kind: kindInvalidQuantize}
	}
	return err
}

// lineWire is get_lines' projection of a Line for the wire: the stored fields
// the reference returns, which do not include entity_code.
type lineWire struct {
	LineID           string      `json:"line_id"`
	JournalID        string      `json:"journal_id"`
	AccountCode      string      `json:"account_code"`
	AccountName      string      `json:"account_name"`
	PeriodCode       string      `json:"period_code"`
	EntryLayer       string      `json:"entry_layer"`
	AccountingDate   string      `json:"accounting_date"`
	TxCurrency       string      `json:"tx_currency"`
	ExchangeRate     string      `json:"exchange_rate"`
	TxDebit          money.Money `json:"tx_debit"`
	TxCredit         money.Money `json:"tx_credit"`
	FuncDebit        money.Money `json:"func_debit"`
	FuncCredit       money.Money `json:"func_credit"`
	CounterpartyID   *string     `json:"counterparty_id"`
	CounterpartyName string      `json:"counterparty_name"`
	TaxCodeID        *string     `json:"tax_code_id"`
	BusinessUsePct   string      `json:"business_use_pct"`
	StatementRef     string      `json:"statement_ref"`
	Memo             string      `json:"memo"`
}

func lineViews(lines []Line) []lineWire {
	out := make([]lineWire, 0, len(lines))
	for _, l := range lines {
		out = append(out, lineWire{
			LineID:           l.LineID,
			JournalID:        l.JournalID,
			AccountCode:      l.AccountCode,
			AccountName:      l.AccountName,
			PeriodCode:       l.PeriodCode,
			EntryLayer:       l.EntryLayer,
			AccountingDate:   l.AccountingDate,
			TxCurrency:       l.TxCurrency,
			ExchangeRate:     l.ExchangeRate,
			TxDebit:          l.TxDebit,
			TxCredit:         l.TxCredit,
			FuncDebit:        l.FuncDebit,
			FuncCredit:       l.FuncCredit,
			CounterpartyID:   l.CounterpartyID,
			CounterpartyName: l.CounterpartyName,
			TaxCodeID:        l.TaxCodeID,
			BusinessUsePct:   l.BusinessUsePct,
			StatementRef:     l.StatementRef,
			Memo:             l.Memo,
		})
	}
	return out
}

// balanceWire renders one AccountBalance the way the generator records it:
// derived fields alongside the accumulated ones, money as strings.
type balanceWire struct {
	AccountCode    string      `json:"account_code"`
	Opening        money.Money `json:"opening"`
	OpDebit        money.Money `json:"op_debit"`
	OpCredit       money.Money `json:"op_credit"`
	AjDebit        money.Money `json:"aj_debit"`
	AjCredit       money.Money `json:"aj_credit"`
	Movement       money.Money `json:"movement"`
	Closing        money.Money `json:"closing"`
	ClosingSide    string      `json:"closing_side"`
	DisplayBalance money.Money `json:"display_balance"`
	DebitNature    bool        `json:"debit_nature"`
}

func balanceView(b AccountBalance) (balanceWire, error) {
	movement, err := b.Movement()
	if err != nil {
		return balanceWire{}, err
	}
	closing, err := b.Closing()
	if err != nil {
		return balanceWire{}, err
	}
	side, err := b.ClosingSide()
	if err != nil {
		return balanceWire{}, err
	}
	display, err := b.DisplayBalance()
	if err != nil {
		return balanceWire{}, err
	}
	return balanceWire{
		AccountCode:    b.AccountCode,
		Opening:        b.Opening,
		OpDebit:        b.OpDebit,
		OpCredit:       b.OpCredit,
		AjDebit:        b.AjDebit,
		AjCredit:       b.AjCredit,
		Movement:       movement,
		Closing:        closing,
		ClosingSide:    side,
		DisplayBalance: display,
		DebitNature:    b.DebitNature,
	}, nil
}

// replayIn is the union of the ops' input shapes, exactly as
// tools/gen_ledger.py writes them. Money crosses as strings and decodes into
// money.Money; nulls decode into nil pointers.
type replayIn struct {
	Op string `json:"op"`

	EntityCode     string  `json:"entity_code"`
	PeriodCode     string  `json:"period_code"`
	AccountingDate *string `json:"accounting_date"`
	Period         *string `json:"period"` // validate_posting_date's explicit period (null = derive)
	AccountCode    string  `json:"account_code"`
	Name           string  `json:"name"`
	PrincipalKey   string  `json:"principal_key"`

	Periods        []Period       `json:"periods"`
	Accounts       []Account      `json:"accounts"`
	Lines          []Line         `json:"lines"`
	Counterparties []Counterparty `json:"counterparties"`
	Journals       []JournalRef   `json:"journals"`
	Payload        AccountPayload `json:"payload"`

	Query struct {
		EntityCode     string `json:"entity_code"`
		AccountCode    string `json:"account_code"`
		PeriodCode     string `json:"period_code"`
		CounterpartyID string `json:"counterparty_id"`
		Limit          int    `json:"limit"`
	} `json:"query"`
}

// ledgerReplay executes one fixture case. The op names and input field names
// are the wire forms written by backend-go/tools/gen_ledger.py. All fixture
// money is parsed through money.Money — never float64.
func ledgerReplay(input json.RawMessage) (any, error) {
	var in replayIn
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	switch in.Op {
	case "validate_posting_date":
		if in.AccountingDate == nil {
			return nil, errors.New("ledger replay: validate_posting_date needs accounting_date")
		}
		period, err := ValidatePostingDate(*in.AccountingDate, in.Period)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"period": period}, nil

	case "period_bounds":
		span, err := PeriodBounds(in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{
			"start": span.Start, "end": span.End,
			"fiscal_year": span.FiscalYear, "period_number": span.PeriodNumber,
		}, nil

	case "next_period":
		next, err := NextPeriodCode(in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"next_period": next}, nil

	case "previous_period":
		prev, err := PreviousPeriodCode(in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"previous_period": prev}, nil

	case "assert_writable":
		period, err := AssertWritable(in.EntityCode, in.PeriodCode, in.AccountingDate, in.Periods)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"period": ViewOf(period)}, nil

	case "account_by_code":
		account := AccountByCode(in.Accounts, in.AccountCode)
		if account == nil {
			return map[string]any{"account": nil}, nil
		}
		return map[string]any{"account": *account}, nil

	case "upsert_account":
		var existing *Account
		if in.Payload.AccountCode != nil {
			id := in.EntityCode + ":" + strings.TrimSpace(*in.Payload.AccountCode)
			for i := range in.Accounts {
				if in.Accounts[i].AccountID == id {
					existing = &in.Accounts[i]
					break
				}
			}
		}
		account, err := UpsertAccount(existing, in.EntityCode, in.Payload)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"account": account}, nil

	case "resolve_counterparty":
		res, err := ResolveCounterparty(in.Counterparties, in.Name)
		if err != nil {
			return nil, classify(err)
		}
		if !res.Found {
			// The not-found branch is the BL-30 fix; it never appears in the
			// golden baseline (the reference would create). Pinned by the
			// TestBL30 regression tests instead.
			return map[string]any{"resolved": nil}, nil
		}
		return map[string]any{"resolved": res.Counterparty}, nil

	case "filter_lines":
		lines, err := FilterLines(in.Lines, LineQuery{
			EntityCode:     in.Query.EntityCode,
			AccountCode:    in.Query.AccountCode,
			PeriodCode:     in.Query.PeriodCode,
			CounterpartyID: in.Query.CounterpartyID,
			Limit:          in.Query.Limit,
		})
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"lines": lineViews(lines)}, nil

	case "derive_balances":
		balances, err := DeriveBalances(in.Accounts, in.Lines, in.EntityCode, in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		out := map[string]balanceWire{}
		for _, b := range balances {
			view, err := balanceView(b)
			if err != nil {
				return nil, classify(err)
			}
			out[b.AccountCode] = view
		}
		return map[string]any{"balances": out}, nil

	case "trial_balance":
		rows, err := TrialBalance(in.Accounts, in.Lines, in.EntityCode, in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"rows": rows}, nil

	case "trial_balance_report":
		rows, err := TrialBalanceReportRows(in.Accounts, in.Lines, in.EntityCode, in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"rows": rows}, nil

	case "assert_trial_balance":
		check, err := AssertTrialBalance(in.EntityCode, in.PeriodCode, in.Lines)
		if err != nil {
			return nil, classify(err)
		}
		return check, nil

	case "account_ledger":
		report, err := AccountLedger(in.Accounts, in.Lines, in.EntityCode, in.AccountCode, in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"report": report}, nil

	case "close_period":
		result, err := ClosePeriod(in.EntityCode, in.PeriodCode, in.PrincipalKey,
			in.Periods, in.Journals, in.Accounts, in.Lines)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"result": result}, nil

	case "cash_flow_breakdown":
		report, err := CashFlowBreakdown(in.Accounts, in.Lines, in.Periods, in.EntityCode, in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"report": report}, nil
	}
	return nil, errors.New("ledger replay: unknown op " + in.Op)
}

// TestGoldenFixtures replays the Python-generated ledger fixtures byte for
// byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_ledger.py
//
// BL-14 defect scenarios (fiscal carry/revenue periods), BL-30 creation
// scenarios and the BL-18 compound cash-bucket scenario are excluded from the
// golden baseline; their behaviour is pinned by the TestBL14_*, TestBL30_*
// regression tests and the reporting package instead.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("ledger", ledgerReplay)
	fixture.Run(t, "ledger")
	fixture.ValidateDivergences(t)
}
