package reporting

import (
	"fmt"
	"sort"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// The account-ledger projection — the BL-17 fix.
//
// The defect (backend/app/core/vouchers.py account_ledger, surfaced through
// mcp_roles.py): the projection filtered journals to status == "POSTED", and
// a reversal flips the ORIGINAL voucher to REVERSED while the reversing
// voucher posts. So an original cash debit 100 plus its reversal credit 100
// reported a running balance of -100: the original's amounts fell out of the
// ledger the moment it was reversed. Required: preserve original and
// reversing amounts in their respective periods.
//
// The fix lives in the projection construction, so it is implemented here as
// a corrected projection beside the ledger package's parity version
// (ledger.AccountLedger over lines-without-status). The ledger package keeps
// the reference behaviour for its parity callers; P2 callers choose the
// projection that matches their source data. This version:
//
//   - includes POSTED journals and REVERSED originals — a reversed original
//     remains a real posting of its period, and its reversal is a real
//     posting of its own period;
//   - reports each movement's journal status so the reader can see the
//     original and its reversal;
//   - keeps the ledger package's AccountLedger shape (signed debit-positive
//     running balance, SideOf sides) and its fail-closed validation.

// ProjectedJournal is one journal with its lines as the projection reads
// it. Status is the journal's posted-state: POSTED, or REVERSED for an
// original that a reversal flipped.
type ProjectedJournal struct {
	JournalID      string
	VoucherNo      string
	Status         string
	AccountingDate string
	Memo           string
	Lines          []ledger.Line
}

// includedStatuses are the journal states whose lines are ledger facts:
// a REVERSED original stays in the books, which is exactly what the defect
// dropped.
var includedStatuses = map[string]bool{
	"POSTED":   true,
	"REVERSED": true,
}

// IncludedStatuses lists the projection's included journal states, for
// callers to render next to the report.
func IncludedStatuses() []string {
	return []string{"POSTED", "REVERSED"}
}

// ProjectedMovement is one movement row: the ledger package's movement
// shape plus the journal status that makes the original/reversal pair
// visible.
type ProjectedMovement struct {
	ledger.AccountLedgerMovement
	Status string `json:"status"`
}

// AccountLedgerProjection mirrors ledger.AccountLedgerReport for the
// status-aware projection.
type AccountLedgerProjection struct {
	AccountCode      string              `json:"account_code"`
	AccountName      string              `json:"account_name"`
	DebitNature      bool                `json:"debit_nature"`
	IncludedStatuses []string            `json:"included_statuses"`
	OpeningBalance   money.Money         `json:"opening_balance"`
	OpeningSide      string              `json:"opening_side"`
	TotalDebit       money.Money         `json:"total_debit"`
	TotalCredit      money.Money         `json:"total_credit"`
	ClosingBalance   money.Money         `json:"closing_balance"`
	ClosingSide      string              `json:"closing_side"`
	Movements        []ProjectedMovement `json:"movements"`
}

// ProjectAccountLedger builds the corrected projection for one account
// over the inclusive window [start, end]. Journals outside the included
// statuses (drafts, pending reviews) contribute nothing; every line is
// validated fail-closed; the account must exist on the chart. The running
// balance is signed debit-positive as ledger.SideOf renders it, so the
// original 100 debit and its reversal 100 credit net to exactly zero.
func ProjectAccountLedger(
	chart []ledger.Account,
	journals []ProjectedJournal,
	accountCode, start, end string,
) (*AccountLedgerProjection, error) {
	account := ledger.AccountByCode(chart, accountCode)
	if account == nil {
		return nil, fail(ErrCOAMissingAccount,
			fmt.Sprintf("COA_MISSING_ACCOUNT: 科目 %s 不存在於科目表。", accountCode))
	}
	if !validWindowBound(start) || !validWindowBound(end) || start > end {
		return nil, fail(ErrInvalidStatementInput,
			"INVALID_STATEMENT_INPUT: 分類帳視窗必須是真實的 YYYY-MM-DD 日期，起日不晚於迄日。")
	}
	type row struct {
		line      ledger.Line
		voucherNo string
		status    string
	}
	var rows []row
	opening := zeroQ4
	for _, j := range journals {
		if !includedStatuses[j.Status] {
			continue
		}
		for _, l := range j.Lines {
			pc := l.PeriodCode
			if _, err := ledger.ValidatePostingDate(l.AccountingDate, &pc); err != nil {
				return nil, err
			}
			if l.AccountCode != accountCode {
				continue
			}
			if l.AccountingDate < start {
				opening = opening.Add(l.FuncDebit.Sub(l.FuncCredit))
				continue
			}
			if l.AccountingDate > end {
				continue
			}
			rows = append(rows, row{line: l, voucherNo: j.VoucherNo, status: j.Status})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].line.AccountingDate != rows[j].line.AccountingDate {
			return rows[i].line.AccountingDate < rows[j].line.AccountingDate
		}
		return rows[i].line.LineNumber < rows[j].line.LineNumber
	})
	var err error
	if opening, err = q4(opening); err != nil {
		return nil, err
	}
	report := &AccountLedgerProjection{
		AccountCode:      account.AccountCode,
		AccountName:      account.AccountName,
		DebitNature:      account.NormalBalance == "DEBIT",
		IncludedStatuses: IncludedStatuses(),
		OpeningBalance:   opening,
		OpeningSide:      ledger.SideOf(opening),
		TotalDebit:       zeroQ4,
		TotalCredit:      zeroQ4,
		Movements:        []ProjectedMovement{},
	}
	running := opening
	for _, r := range rows {
		l := r.line
		if report.TotalDebit, err = q4(report.TotalDebit.Add(l.FuncDebit)); err != nil {
			return nil, err
		}
		if report.TotalCredit, err = q4(report.TotalCredit.Add(l.FuncCredit)); err != nil {
			return nil, err
		}
		if running, err = q4(running.Add(l.FuncDebit.Sub(l.FuncCredit))); err != nil {
			return nil, err
		}
		m := ProjectedMovement{
			AccountLedgerMovement: ledger.AccountLedgerMovement{
				Date:         l.AccountingDate,
				JournalID:    l.JournalID,
				EntryLayer:   l.EntryLayer,
				Memo:         l.Memo,
				Counterparty: l.CounterpartyName,
				Debit:        l.FuncDebit,
				Credit:       l.FuncCredit,
				Balance:      running,
				BalanceSide:  ledger.SideOf(running),
			},
			Status: r.status,
		}
		if r.voucherNo != "" {
			v := r.voucherNo
			m.VoucherNo = &v
		}
		report.Movements = append(report.Movements, m)
	}
	report.ClosingBalance = running
	report.ClosingSide = ledger.SideOf(running)
	return report, nil
}
