package ledger

import (
	"fmt"
	"sort"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the pure content of close_period (backend/app/core/ledger.py,
// "Closing a period"): the already-locked refusal, the unposted-voucher
// refusal, the trial-balance gate, the next-period derivation and the
// carried-forward schedule. The reference then flips the period row to LOCKED
// against a named principal and stamps closed_at — those writes, and the
// audit timestamp, belong to the store; this function computes exactly what
// the reference returns and nothing more.

// JournalRef carries the fields close_period's pending-voucher check reads
// from one journal entry (repo.get_journals returns dicts with these keys).
// A nil Period behaves as an absent key: the period derives from the date.
type JournalRef struct {
	JournalID      string  `json:"journal_id"`
	VoucherNo      string  `json:"voucher_no"`
	Status         string  `json:"status"`
	AccountingDate string  `json:"accounting_date"`
	Period         *string `json:"period"`
}

// pendingStatuses are the voucher statuses that block a close: closing over
// unposted work is how a ledger ends up disagreeing with its vouchers.
var pendingStatuses = map[string]bool{
	"DRAFT":           true,
	"PENDING_CHECKER": true,
	"AWAITING_CPA":    true,
}

// CarriedRow is one carried_forward row: the account's opening in the next
// period, which is everything dated before that period starts.
type CarriedRow struct {
	AccountCode string      `json:"account_code"`
	Opening     money.Money `json:"opening"`
}

// CloseResult mirrors close_period's return.
type CloseResult struct {
	PeriodCode           string            `json:"period_code"`
	Status               string            `json:"status"`
	ClosedByPrincipalKey string            `json:"closed_by_principal_key"`
	NextPeriod           string            `json:"next_period"`
	TrialBalance         TrialBalanceCheck `json:"trial_balance"`
	CarriedForward       []CarriedRow      `json:"carried_forward"`
	CarriedForwardTotal  money.Money       `json:"carried_forward_total"`
}

// ClosePeriod ports close_period's decision sequence:
//
//  1. A period already LOCKED refuses (PERIOD_ALREADY_LOCKED); a missing
//     period row behaves as auto-created OPEN, as get_period does.
//  2. Vouchers still awaiting a decision inside the period refuse
//     (PERIOD_HAS_UNPOSTED_VOUCHERS); every candidate journal's date is
//     validated first, so a malformed legacy record refuses the close.
//  3. The ledger must balance (TRIAL_BALANCE_BROKEN).
//  4. The next period code is derived and the carried-forward schedule is the
//     next period's non-zero openings, sorted by account code. Opening
//     balances are not copied anywhere: they are the sum of everything dated
//     before the next period starts.
func ClosePeriod(entityCode, periodCode, principalKey string, periods []Period, journals []JournalRef, chart []Account, lines []Line) (CloseResult, error) {
	period, err := ResolvePeriod(entityCode, periodCode, periods)
	if err != nil {
		return CloseResult{}, err
	}
	if period.Status == "LOCKED" {
		return CloseResult{}, fail(ErrPeriodAlreadyLocked,
			fmt.Sprintf("PERIOD_ALREADY_LOCKED: 期間 %s 已經封存。", periodCode))
	}

	span, err := PeriodBounds(periodCode)
	if err != nil {
		return CloseResult{}, err
	}
	pending := 0
	var pendingNames []string
	for _, j := range journals {
		if !pendingStatuses[j.Status] {
			continue
		}
		// Validate before the window check, as the reference does: a malformed
		// legacy record refuses the close rather than slipping past it.
		date := j.AccountingDate
		if _, err := ValidatePostingDate(date, j.Period); err != nil {
			return CloseResult{}, err
		}
		if span.Start <= date && date <= span.End {
			pending++
			if len(pendingNames) < 5 {
				if j.VoucherNo != "" {
					pendingNames = append(pendingNames, j.VoucherNo)
				} else {
					pendingNames = append(pendingNames, j.JournalID)
				}
			}
		}
	}
	if pending > 0 {
		return CloseResult{}, fail(ErrPeriodHasUnpostedVouchers,
			fmt.Sprintf("PERIOD_HAS_UNPOSTED_VOUCHERS: 期間 %s 尚有 %d 張未過賬憑證（%s…）。結帳前必須全部處理完畢。",
				periodCode, pending, strings.Join(pendingNames, "、")))
	}

	balance, err := AssertTrialBalance(entityCode, periodCode, lines)
	if err != nil {
		return CloseResult{}, err
	}
	if !balance.LedgerBalanced {
		return CloseResult{}, fail(ErrTrialBalanceBroken,
			fmt.Sprintf("TRIAL_BALANCE_BROKEN: 分類帳借貸不平衡，借方 %s，貸方 %s，差額 %s。不可結帳。",
				balance.LedgerDebit, balance.LedgerCredit, balance.LedgerDifference))
	}

	nextCode, err := NextPeriodCode(periodCode)
	if err != nil {
		return CloseResult{}, err
	}
	// The carried-forward schedule is the next period's openings; deriving it
	// validates the next period's bounds exactly as the reference's
	// derive_balances(next_code) does.
	carried, err := DeriveBalances(chart, lines, entityCode, nextCode)
	if err != nil {
		return CloseResult{}, err
	}
	rows := make([]CarriedRow, 0, len(carried))
	for _, b := range carried {
		if !b.Opening.IsZero() {
			rows = append(rows, CarriedRow{AccountCode: b.AccountCode, Opening: b.Opening})
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].AccountCode < rows[j].AccountCode })
	total := zeroQ4
	for _, r := range rows {
		total = total.Add(r.Opening)
	}
	total, err = q4(total)
	if err != nil {
		return CloseResult{}, err
	}
	return CloseResult{
		PeriodCode:           periodCode,
		Status:               "LOCKED",
		ClosedByPrincipalKey: principalKey,
		NextPeriod:           nextCode,
		TrialBalance:         balance,
		CarriedForward:       rows,
		CarriedForwardTotal:  total,
	}, nil
}
