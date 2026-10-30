package ledger

import (
	"fmt"
	"sort"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the derived-balance rules of backend/app/core/ledger.py:
// the journal-line projection get_lines reads, the AccountBalance dataclass
// and its properties, derive_balances' one-pass derivation, the two trial
// balance schedules, assert_trial_balance's debits-equal-credits check, and
// account_ledger's running balance. Where the reference iterates query
// results, the port iterates Line value slices; nothing is stored, every
// balance is opening + sum(lines), computed on demand.

// zeroQ4 is the reference's ZERO = Decimal("0.0000"): the accumulator start.
var zeroQ4 = mustParse("0.0000")

// zeroNum is the numeric zero used for sign comparisons.
var zeroNum = mustParse("0")

func mustParse(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("ledger: constant money " + s + ": " + err.Error())
	}
	return m
}

// q4 is the reference's q4 (localization.q4): ROUND_HALF_UP quantize to four
// decimal places, mode explicit. It errors where Python's quantize raises
// decimal.InvalidOperation (result beyond context precision).
func q4(m money.Money) (money.Money, error) {
	return m.Round(4, money.RoundHalfUp)
}

// Entry layers. A line belongs to the adjustment columns when its layer is a
// month-end adjustment or reclass; OPENING and REVERSAL are ordinary
// movements for reporting purposes — a reversal of an operational entry is
// operational, which is why the reversing voucher carries its own layer.
var adjustmentLayers = map[string]bool{
	"AJE_MONTH_END": true,
	"RJE_RECLASS":   true,
}

// Line mirrors one journal_lines row (JournalLineModel) as the ledger's pure
// derivations read it — the field set of get_lines' projection. Money values
// are exact decimals and cross JSON as strings.
type Line struct {
	LineID           string      `json:"line_id"`
	JournalID        string      `json:"journal_id"`
	EntityCode       string      `json:"entity_code"`
	LineNumber       int         `json:"line_number"`
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

// LineQuery carries get_lines' filter arguments over an in-memory slice.
// Empty strings mean "no filter", as the reference's default arguments do.
type LineQuery struct {
	EntityCode     string
	AccountCode    string
	PeriodCode     string
	CounterpartyID string
	Limit          int // 0 = unlimited
}

// FilterLines ports get_lines' query semantics: inclusive period bounds by
// accounting date (regardless of stored period label), ordering by
// (accounting_date, line_number), an optional limit, and the fail-closed
// validation of every returned row — a malformed legacy record is rejected,
// never silently omitted (BL-04 remediation).
func FilterLines(lines []Line, q LineQuery) ([]Line, error) {
	var start, end string
	if q.PeriodCode != "" {
		span, err := PeriodBounds(q.PeriodCode)
		if err != nil {
			return nil, err
		}
		start, end = span.Start, span.End
	}
	out := make([]Line, 0, len(lines))
	for _, l := range lines {
		if q.EntityCode != "" && l.EntityCode != q.EntityCode {
			continue
		}
		if q.AccountCode != "" && l.AccountCode != q.AccountCode {
			continue
		}
		if start != "" && (l.AccountingDate < start || l.AccountingDate > end) {
			continue
		}
		if q.CounterpartyID != "" && (l.CounterpartyID == nil || *l.CounterpartyID != q.CounterpartyID) {
			continue
		}
		out = append(out, l)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].AccountingDate != out[j].AccountingDate {
			return out[i].AccountingDate < out[j].AccountingDate
		}
		return out[i].LineNumber < out[j].LineNumber
	})
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	for i := range out {
		pc := out[i].PeriodCode
		if _, err := ValidatePostingDate(out[i].AccountingDate, &pc); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// AccountBalance ports the AccountBalance dataclass. Opening is signed:
// positive = debit.
type AccountBalance struct {
	AccountCode string      `json:"account_code"`
	Opening     money.Money `json:"opening"`
	OpDebit     money.Money `json:"op_debit"`
	OpCredit    money.Money `json:"op_credit"`
	AjDebit     money.Money `json:"aj_debit"`
	AjCredit    money.Money `json:"aj_credit"`
	DebitNature bool        `json:"debit_nature"`
}

// Movement ports the movement property: the period's net movement
// (operational plus adjustments), quantized.
func (b AccountBalance) Movement() (money.Money, error) {
	return q4(b.OpDebit.Sub(b.OpCredit).Add(b.AjDebit.Sub(b.AjCredit)))
}

// Closing ports the closing property: opening + movement.
func (b AccountBalance) Closing() (money.Money, error) {
	m, err := b.Movement()
	if err != nil {
		return money.Money{}, err
	}
	return q4(b.Opening.Add(m))
}

// ClosingSide ports the closing_side property verbatim. The reference's
// non-negative branch is `"DEBIT" if self.debit_nature else "DEBIT"` — the
// nature test is dead code and every non-negative closing reads DEBIT; this
// port keeps that behaviour for golden parity (a contra account's side
// question is answered by display_balance instead).
func (b AccountBalance) ClosingSide() (string, error) {
	closing, err := b.Closing()
	if err != nil {
		return "", err
	}
	if closing.Cmp(zeroNum) >= 0 {
		return "DEBIT", nil
	}
	return "CREDIT", nil
}

// DisplayBalance ports the display_balance property: always reported on the
// account's own normal side, so a credit-nature account reads positive when
// in credit. The reference negates with decimal's minus operation, which
// normalizes zero to positive ("−0.0000" negates back to "0.0000"), so a
// zero closing is returned unchanged.
func (b AccountBalance) DisplayBalance() (money.Money, error) {
	closing, err := b.Closing()
	if err != nil {
		return money.Money{}, err
	}
	if b.DebitNature || closing.IsZero() {
		return closing, nil
	}
	return closing.Neg(), nil
}

// SideOf reports the side a signed balance sits on: non-negative is DEBIT,
// negative CREDIT — the `"DEBIT" if x >= 0 else "CREDIT"` the reference uses
// for opening_side/closing_side/balance_side.
func SideOf(v money.Money) string {
	if v.Cmp(zeroNum) >= 0 {
		return "DEBIT"
	}
	return "CREDIT"
}

// BalancesByCode indexes a DeriveBalances result by account code.
func BalancesByCode(bs []AccountBalance) map[string]AccountBalance {
	m := make(map[string]AccountBalance, len(bs))
	for _, b := range bs {
		m[b.AccountCode] = b
	}
	return m
}

// DeriveBalances ports derive_balances: one pass over the entity's lines
// produces every account's opening, period movement, adjustments and closing
// balance for the given period. Lines dated before the period start carry
// forward into opening for every account — a trial balance is cumulative
// until the fiscal-year close — and future-dated lines count for nothing
// here. Every line is validated first: fail closed on legacy corruption,
// including mismatched period labels; never reinterpret historical dates.
// Balances come back in chart order.
func DeriveBalances(chart []Account, lines []Line, entityCode, periodCode string) ([]AccountBalance, error) {
	span, err := PeriodBounds(periodCode)
	if err != nil {
		return nil, err
	}
	allLines, err := FilterLines(lines, LineQuery{EntityCode: entityCode})
	if err != nil {
		return nil, err
	}
	out := make([]AccountBalance, 0, len(chart))
	for _, account := range chart {
		b := AccountBalance{
			AccountCode: account.AccountCode,
			Opening:     zeroQ4,
			OpDebit:     zeroQ4,
			OpCredit:    zeroQ4,
			AjDebit:     zeroQ4,
			AjCredit:    zeroQ4,
			DebitNature: account.NormalBalance == "DEBIT",
		}
		for _, l := range allLines {
			if l.AccountCode != account.AccountCode {
				continue
			}
			dr, cr := l.FuncDebit, l.FuncCredit
			if span.Start <= l.AccountingDate && l.AccountingDate <= span.End {
				if adjustmentLayers[l.EntryLayer] {
					b.AjDebit = b.AjDebit.Add(dr)
					b.AjCredit = b.AjCredit.Add(cr)
				} else {
					b.OpDebit = b.OpDebit.Add(dr)
					b.OpCredit = b.OpCredit.Add(cr)
				}
			} else if l.AccountingDate < span.Start {
				b.Opening = b.Opening.Add(dr.Sub(cr))
			}
		}
		if b.Opening, err = q4(b.Opening); err != nil {
			return nil, err
		}
		if b.OpDebit, err = q4(b.OpDebit); err != nil {
			return nil, err
		}
		if b.OpCredit, err = q4(b.OpCredit); err != nil {
			return nil, err
		}
		if b.AjDebit, err = q4(b.AjDebit); err != nil {
			return nil, err
		}
		if b.AjCredit, err = q4(b.AjCredit); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

// TrialBalanceRow mirrors one row of the reference's trial_balance dict.
type TrialBalanceRow struct {
	AccountCode      string      `json:"account_code"`
	AccountName      string      `json:"account_name"`
	AccountType      string      `json:"account_type"`
	FSCategory       string      `json:"fs_category"`
	StatementRef     string      `json:"statement_ref"`
	NormalBalance    string      `json:"normal_balance"`
	Opening          money.Money `json:"opening"`
	OpeningSide      string      `json:"opening_side"`
	PeriodDebit      money.Money `json:"period_debit"`
	PeriodCredit     money.Money `json:"period_credit"`
	AdjustmentDebit  money.Money `json:"adjustment_debit"`
	AdjustmentCredit money.Money `json:"adjustment_credit"`
	Closing          money.Money `json:"closing"`
	ClosingSide      string      `json:"closing_side"`
	DisplayBalance   money.Money `json:"display_balance"`
}

// TrialBalance ports trial_balance: the extended trial balance over the full
// chart (including inactive accounts), in chart order.
func TrialBalance(chart []Account, lines []Line, entityCode, periodCode string) ([]TrialBalanceRow, error) {
	balances, err := DeriveBalances(chart, lines, entityCode, periodCode)
	if err != nil {
		return nil, err
	}
	byCode := BalancesByCode(balances)
	rows := make([]TrialBalanceRow, 0, len(chart))
	for _, account := range chart {
		b, ok := byCode[account.AccountCode]
		if !ok {
			continue
		}
		closing, err := b.Closing()
		if err != nil {
			return nil, err
		}
		display, err := b.DisplayBalance()
		if err != nil {
			return nil, err
		}
		rows = append(rows, TrialBalanceRow{
			AccountCode:      account.AccountCode,
			AccountName:      account.AccountName,
			AccountType:      account.AccountType,
			FSCategory:       account.FSCategory,
			StatementRef:     account.StatementRef,
			NormalBalance:    account.NormalBalance,
			Opening:          b.Opening,
			OpeningSide:      SideOf(b.Opening),
			PeriodDebit:      b.OpDebit,
			PeriodCredit:     b.OpCredit,
			AdjustmentDebit:  b.AjDebit,
			AdjustmentCredit: b.AjCredit,
			Closing:          closing,
			ClosingSide:      SideOf(closing),
			DisplayBalance:   display,
		})
	}
	return rows, nil
}

// TrialBalanceReportRow mirrors reporting.TrialBalanceAccountRow, the shape
// the schedule engine consumes (trial_balance_from_ledger).
type TrialBalanceReportRow struct {
	AccountCode      string      `json:"account_code"`
	AccountName      string      `json:"account_name"`
	AccountType      string      `json:"account_type"`
	FSCategory       string      `json:"fs_category"`
	StatementRef     string      `json:"statement_ref"`
	CashFlowActivity string      `json:"cash_flow_activity"`
	OpeningBalance   money.Money `json:"opening_balance"`
	PeriodOpDebit    money.Money `json:"period_op_debit"`
	PeriodOpCredit   money.Money `json:"period_op_credit"`
	AdjustmentDebit  money.Money `json:"adjustment_debit"`
	AdjustmentCredit money.Money `json:"adjustment_credit"`
}

// TrialBalanceReportRows ports trial_balance_from_ledger.
func TrialBalanceReportRows(chart []Account, lines []Line, entityCode, periodCode string) ([]TrialBalanceReportRow, error) {
	balances, err := DeriveBalances(chart, lines, entityCode, periodCode)
	if err != nil {
		return nil, err
	}
	byCode := BalancesByCode(balances)
	rows := make([]TrialBalanceReportRow, 0, len(chart))
	for _, account := range chart {
		b, ok := byCode[account.AccountCode]
		if !ok {
			continue
		}
		rows = append(rows, TrialBalanceReportRow{
			AccountCode:      account.AccountCode,
			AccountName:      account.AccountName,
			AccountType:      account.AccountType,
			FSCategory:       account.FSCategory,
			StatementRef:     account.StatementRef,
			CashFlowActivity: account.CashFlowActivity,
			OpeningBalance:   b.Opening,
			PeriodOpDebit:    b.OpDebit,
			PeriodOpCredit:   b.OpCredit,
			AdjustmentDebit:  b.AjDebit,
			AdjustmentCredit: b.AjCredit,
		})
	}
	return rows, nil
}

// TrialBalanceCheck mirrors assert_trial_balance's result: Σ debits ≡ Σ
// credits, entity-wide and for the period. This is the check that has to
// pass before a period may be locked.
type TrialBalanceCheck struct {
	LedgerBalanced   bool   `json:"ledger_balanced"`
	LedgerDebit      string `json:"ledger_debit"`
	LedgerCredit     string `json:"ledger_credit"`
	LedgerDifference string `json:"ledger_difference"`
	PeriodBalanced   bool   `json:"period_balanced"`
	PeriodDebit      string `json:"period_debit"`
	PeriodCredit     string `json:"period_credit"`
	PeriodDifference string `json:"period_difference"`
}

// AssertTrialBalance ports assert_trial_balance over the entity's lines.
func AssertTrialBalance(entityCode, periodCode string, lines []Line) (TrialBalanceCheck, error) {
	span, err := PeriodBounds(periodCode)
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	allLines, err := FilterLines(lines, LineQuery{EntityCode: entityCode})
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	allDr, allCr := zeroQ4, zeroQ4
	pDr, pCr := zeroQ4, zeroQ4
	for _, l := range allLines {
		allDr = allDr.Add(l.FuncDebit)
		allCr = allCr.Add(l.FuncCredit)
		if span.Start <= l.AccountingDate && l.AccountingDate <= span.End {
			pDr = pDr.Add(l.FuncDebit)
			pCr = pCr.Add(l.FuncCredit)
		}
	}
	allDr, err = q4(allDr)
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	allCr, err = q4(allCr)
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	pDr, err = q4(pDr)
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	pCr, err = q4(pCr)
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	ledDiff, err := q4(allDr.Sub(allCr))
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	perDiff, err := q4(pDr.Sub(pCr))
	if err != nil {
		return TrialBalanceCheck{}, err
	}
	return TrialBalanceCheck{
		LedgerBalanced:   allDr.Equal(allCr),
		LedgerDebit:      allDr.String(),
		LedgerCredit:     allCr.String(),
		LedgerDifference: ledDiff.String(),
		PeriodBalanced:   pDr.Equal(pCr),
		PeriodDebit:      pDr.String(),
		PeriodCredit:     pCr.String(),
		PeriodDifference: perDiff.String(),
	}, nil
}

// AccountLedgerMovement is one movement row of account_ledger, with the
// running balance after the line.
type AccountLedgerMovement struct {
	Date         string      `json:"date"`
	VoucherNo    *string     `json:"voucher_no"` // filled by the caller in the reference; null here
	JournalID    string      `json:"journal_id"`
	EntryLayer   string      `json:"entry_layer"`
	Memo         string      `json:"memo"`
	Counterparty string      `json:"counterparty"`
	Debit        money.Money `json:"debit"`
	Credit       money.Money `json:"credit"`
	Balance      money.Money `json:"balance"`
	BalanceSide  string      `json:"balance_side"`
}

// AccountLedgerReport mirrors account_ledger's result for one account and
// period, opening + movements + closing.
type AccountLedgerReport struct {
	Account        Account                 `json:"account"`
	Period         string                  `json:"period"`
	OpeningBalance money.Money             `json:"opening_balance"`
	OpeningSide    string                  `json:"opening_side"`
	TotalDebit     money.Money             `json:"total_debit"`
	TotalCredit    money.Money             `json:"total_credit"`
	ClosingBalance money.Money             `json:"closing_balance"`
	ClosingSide    string                  `json:"closing_side"`
	DisplayBalance money.Money             `json:"display_balance"`
	DebitNature    bool                    `json:"debit_nature"`
	Movements      []AccountLedgerMovement `json:"movements"`
}

// AccountLedger ports account_ledger: the one-account schedule with a running
// balance. The account must exist on the chart (including inactive), or
// COA_MISSING_ACCOUNT refuses.
func AccountLedger(chart []Account, lines []Line, entityCode, accountCode, periodCode string) (AccountLedgerReport, error) {
	account := AccountByCode(chart, accountCode)
	if account == nil {
		return AccountLedgerReport{}, fail(ErrCOAMissingAccount,
			fmt.Sprintf("COA_MISSING_ACCOUNT: 科目 %s 不存在於科目表。", accountCode))
	}
	if _, err := PeriodBounds(periodCode); err != nil {
		return AccountLedgerReport{}, err
	}
	balances, err := DeriveBalances(chart, lines, entityCode, periodCode)
	if err != nil {
		return AccountLedgerReport{}, err
	}
	b, ok := BalancesByCode(balances)[accountCode]
	if !ok {
		return AccountLedgerReport{}, fail(ErrCOAMissingAccount,
			fmt.Sprintf("COA_MISSING_ACCOUNT: 科目 %s 不存在於科目表。", accountCode))
	}
	movements, err := FilterLines(lines, LineQuery{
		EntityCode:  entityCode,
		AccountCode: accountCode,
		PeriodCode:  periodCode,
	})
	if err != nil {
		return AccountLedgerReport{}, err
	}
	report := AccountLedgerReport{
		Account:        *account,
		Period:         periodCode,
		OpeningBalance: b.Opening,
		OpeningSide:    SideOf(b.Opening),
		TotalDebit:     b.OpDebit.Add(b.AjDebit),
		TotalCredit:    b.OpCredit.Add(b.AjCredit),
		DebitNature:    account.NormalBalance == "DEBIT",
		Movements:      []AccountLedgerMovement{},
	}
	closing, err := b.Closing()
	if err != nil {
		return AccountLedgerReport{}, err
	}
	display, err := b.DisplayBalance()
	if err != nil {
		return AccountLedgerReport{}, err
	}
	report.ClosingBalance = closing
	report.ClosingSide = SideOf(closing)
	report.DisplayBalance = display

	running := b.Opening
	for _, l := range movements {
		running, err = q4(running.Add(l.FuncDebit.Sub(l.FuncCredit)))
		if err != nil {
			return AccountLedgerReport{}, err
		}
		report.Movements = append(report.Movements, AccountLedgerMovement{
			Date:         l.AccountingDate,
			JournalID:    l.JournalID,
			EntryLayer:   l.EntryLayer,
			Memo:         l.Memo,
			Counterparty: l.CounterpartyName,
			Debit:        l.FuncDebit,
			Credit:       l.FuncCredit,
			Balance:      running,
			BalanceSide:  SideOf(running),
		})
	}
	return report, nil
}
