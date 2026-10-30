package posting

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the pure content of ledger.write_lines_for_entry, the
// projection post_voucher runs before sealing: a posted voucher becomes the
// journal_lines rows the ledger derives every balance from. The reference's
// delete-existing-rows retry idiom, the flush and the line_id (uuid4) are
// store work; the row content is a decision and lives here. The reference
// re-runs validate_posting_date and assert_writable inside the writer; the
// sequence has already refused on both, so the projection takes the
// validated period code.

// allLayers mirrors ledger.ALL_LAYERS: an entry layer outside the set falls
// back to OPERATIONAL on the written rows.
var allLayers = map[string]bool{
	"OPENING": true, "OPERATIONAL": true, "AJE_MONTH_END": true,
	"RJE_RECLASS": true, "REVERSAL": true,
}

// Row is one projected journal_lines row — what the posting transaction
// writes for the sealed voucher. Money columns render as the reference's
// str(q4(...)): four decimal places, ROUND_HALF_UP (localization.q4).
// LineID is omitted: the store assigns it, and fixtures pin positional
// tokens in its place.
type Row struct {
	JournalID        string  `json:"journal_id"`
	EntityCode       string  `json:"entity_code"`
	LineNumber       int64   `json:"line_number"`
	AccountID        string  `json:"account_id"`
	AccountCode      string  `json:"account_code"`
	AccountName      string  `json:"account_name"`
	PeriodCode       string  `json:"period_code"`
	EntryLayer       string  `json:"entry_layer"`
	AccountingDate   string  `json:"accounting_date"`
	TxCurrency       string  `json:"tx_currency"`
	ExchangeRate     string  `json:"exchange_rate"`
	TxDebit          string  `json:"tx_debit"`
	TxCredit         string  `json:"tx_credit"`
	FuncDebit        string  `json:"func_debit"`
	FuncCredit       string  `json:"func_credit"`
	CounterpartyID   *string `json:"counterparty_id"`
	CounterpartyName string  `json:"counterparty_name"`
	TaxCodeID        *string `json:"tax_code_id"`
	FuncTaxAmount    string  `json:"func_tax_amount"`
	BusinessUsePct   string  `json:"business_use_pct"`
	StatementRef     string  `json:"statement_ref"`
	Memo             string  `json:"memo"`
}

// projectRows ports write_lines_for_entry's row construction. The chart must
// be the full chart including inactive accounts (the reference's
// get_chart include_inactive=True — an inactive account still accepts the
// postings already journaled against it).
func projectRows(j Journal, chart []ledger.Account, periodCode, entryLayer string) ([]Row, error) {
	if !allLayers[entryLayer] {
		entryLayer = "OPERATIONAL"
	}
	rows := make([]Row, 0, len(j.Lines))
	for _, line := range j.Lines {
		account := ledger.AccountByCode(chart, line.AccountCode)
		if account == nil {
			// Dead in the sequence — the chart check refused missing
			// accounts before the projection runs — but kept in the
			// reference's position (the writer re-checks per line).
			return nil, refusal(KindCOAMissingAccount,
				"科目 "+line.AccountCode+" 不存在於科目表。")
		}
		txDr, err := q4HalfUp(line.Debit)
		if err != nil {
			return nil, err
		}
		txCr, err := q4HalfUp(line.Credit)
		if err != nil {
			return nil, err
		}
		// `line.get("func_debit") or tx_dr`: an absent or empty functional
		// amount falls back to the transaction amount; an explicit
		// "0.0000" is a value, not a fallback.
		funcDr := line.FuncDebit
		if funcDr == "" {
			funcDr = txDr.String()
		}
		funcDrQ, err := q4HalfUp(funcDr)
		if err != nil {
			return nil, err
		}
		funcCr := line.FuncCredit
		if funcCr == "" {
			funcCr = txCr.String()
		}
		funcCrQ, err := q4HalfUp(funcCr)
		if err != nil {
			return nil, err
		}
		txCurrency := line.TxCurrency
		if txCurrency == "" {
			txCurrency = j.Currency
		}
		rate := line.ExchangeRate
		if rate == "" {
			// The journal dict carries no exchange rate of its own, so the
			// reference's fallback is the constant 1.00000000.
			rate = "1.00000000"
		}
		funcTax, err := q4HalfUp(line.FuncTaxAmount)
		if err != nil {
			return nil, err
		}
		businessUse := line.BusinessUsePct
		if businessUse == "" {
			businessUse = "1.0000"
		}
		statementRef := line.StatementRef
		if statementRef == "" {
			statementRef = account.StatementRef
		}
		rows = append(rows, Row{
			JournalID:      j.JournalID,
			EntityCode:     j.EntityCode,
			LineNumber:     line.LineNumber,
			AccountID:      account.AccountID,
			AccountCode:    account.AccountCode,
			AccountName:    account.AccountName,
			PeriodCode:     periodCode,
			EntryLayer:     entryLayer,
			AccountingDate: j.AccountingDate,
			TxCurrency:     txCurrency,
			ExchangeRate:   rate,
			TxDebit:        txDr.String(),
			TxCredit:       txCr.String(),
			FuncDebit:      funcDrQ.String(),
			FuncCredit:     funcCrQ.String(),
			CounterpartyID: line.CounterpartyID,
			// counterparty_name=line.get("counterparty") or ""
			CounterpartyName: line.Counterparty,
			TaxCodeID:        line.TaxCodeID,
			FuncTaxAmount:    funcTax.String(),
			BusinessUsePct:   businessUse,
			StatementRef:     statementRef,
			Memo:             line.Memo,
		})
	}
	return rows, nil
}

// q4HalfUp is the reference's q4 over a stored string (localization.q4,
// ROUND_HALF_UP to four places). An empty string is the reference's
// `line.get(key) or 0`.
func q4HalfUp(s string) (money.Money, error) {
	m, err := orZero(s)
	if err != nil {
		return money.Money{}, err
	}
	return m.Round(4, money.RoundHalfUp)
}

// rowAsLedgerLine adapts a projected row to the voucher package's persisted
// line shape for the reversal mirror check.
func rowAsLedgerLine(r Row) voucher.LedgerLine {
	return voucher.LedgerLine{
		JournalID:      r.JournalID,
		EntityCode:     r.EntityCode,
		LineNumber:     r.LineNumber,
		AccountCode:    r.AccountCode,
		EntryLayer:     r.EntryLayer,
		TxCurrency:     r.TxCurrency,
		ExchangeRate:   r.ExchangeRate,
		TxDebit:        r.TxDebit,
		TxCredit:       r.TxCredit,
		FuncDebit:      r.FuncDebit,
		FuncCredit:     r.FuncCredit,
		FuncTaxAmount:  r.FuncTaxAmount,
		BusinessUsePct: r.BusinessUsePct,
	}
}

// hashLines adapts the stored lines to the guard's hash input. The hash
// reads the stored strings verbatim (str(l.get("debit", "0.0000"))): a
// missing amount hashes as the "0.0000" default. The typed line cannot
// distinguish a missing key from an empty one, and stored lines always
// carry amounts, so the port renders the empty string as the default.
func hashLines(lines []Line) []positions.HashLine {
	out := make([]positions.HashLine, 0, len(lines))
	for _, l := range lines {
		ln, code := l.LineNumber, l.AccountCode
		debit, credit := hashAmount(l.Debit), hashAmount(l.Credit)
		out = append(out, positions.HashLine{
			LineNumber: &ln, AccountCode: &code, Debit: &debit, Credit: &credit,
		})
	}
	return out
}

func hashAmount(s string) string {
	if s == "" {
		return "0.0000"
	}
	return s
}
