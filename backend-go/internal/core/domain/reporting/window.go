package reporting

import (
	"fmt"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Statement period anchoring — the BL-14 consumption side of SRC-0027.
//
// The reference's reporting period derivation is the defect: the P&L read an
// all-time "adjusted ending" (every line ever dated before the period), so
// December 2025 revenue kept appearing in a January 2027 report and the P&L
// profit disagreed with the cash-flow statement's movement-based starting
// profit. The decided semantics live in the ledger package (fiscal.go,
// owner-confirmed 2026-10-30): financial reports are monthly, quarterly,
// semi-annual or annual windows anchored to the entity's fiscal calendar and
// its fiscal_periods state; management reports keep custom windows as
// read-only projections that never bypass period locks.
//
// This file consumes those decided primitives. The reference's own period
// derivation is NOT ported — there is nothing to preserve.

// WindowRows derives one trial-balance report row per chart account over the
// inclusive date window [start, end]:
//
//   - OpeningBalance is the signed balance of everything dated before the
//     window — a balance-sheet concept under SRC-0027, never a P&L input.
//   - PeriodOpDebit/Credit and AdjustmentDebit/Credit are the window's
//     activity by accounting date, split by entry layer exactly as the
//     ledger's derive_balances splits it (AJE_MONTH_END and RJE_RECLASS are
//     the adjustment columns).
//
// Every line is validated first and fail-closed on malformed legacy rows
// (BL-04 remediation state). A line whose account is not on the chart is an
// error, not a silent omission: statements must never drop activity — that
// is the BL-13 failure mode wearing a different hat. The ledger package's
// period-bound DeriveBalances keeps its parity behaviour for its callers;
// this window-anchored derivation is the decided reporting semantics.
func WindowRows(chart []ledger.Account, lines []ledger.Line, start, end string) ([]ledger.TrialBalanceReportRow, error) {
	if !validWindowBound(start) || !validWindowBound(end) {
		return nil, fail(ErrInvalidStatementInput,
			"INVALID_STATEMENT_INPUT: 報表視窗必須是真實的 YYYY-MM-DD 日期。")
	}
	if start > end {
		return nil, fail(ErrInvalidStatementInput,
			"INVALID_STATEMENT_INPUT: 視窗起日 "+start+" 晚於迄日 "+end+"。")
	}
	onChart := make(map[string]bool, len(chart))
	for _, a := range chart {
		onChart[a.AccountCode] = true
	}
	for i := range lines {
		pc := lines[i].PeriodCode
		if _, err := ledger.ValidatePostingDate(lines[i].AccountingDate, &pc); err != nil {
			return nil, err
		}
		if !onChart[lines[i].AccountCode] {
			return nil, fail(ErrCOAMissingAccount,
				fmt.Sprintf("COA_MISSING_ACCOUNT: 分錄 %s 引用科目 %s，不在科目表。", lines[i].LineID, lines[i].AccountCode))
		}
	}
	opening := make([]money.Money, len(chart))
	opDr := make([]money.Money, len(chart))
	opCr := make([]money.Money, len(chart))
	ajDr := make([]money.Money, len(chart))
	ajCr := make([]money.Money, len(chart))
	index := make(map[string]int, len(chart))
	for i, a := range chart {
		index[a.AccountCode] = i
		opening[i], opDr[i], opCr[i], ajDr[i], ajCr[i] = zeroQ4, zeroQ4, zeroQ4, zeroQ4, zeroQ4
	}
	for _, l := range lines {
		i := index[l.AccountCode]
		switch {
		case l.AccountingDate < start:
			opening[i] = opening[i].Add(l.FuncDebit.Sub(l.FuncCredit))
		case l.AccountingDate > end:
			// Future-dated lines count for nothing in this window.
		default:
			if adjustmentLayer(l.EntryLayer) {
				ajDr[i] = ajDr[i].Add(l.FuncDebit)
				ajCr[i] = ajCr[i].Add(l.FuncCredit)
			} else {
				opDr[i] = opDr[i].Add(l.FuncDebit)
				opCr[i] = opCr[i].Add(l.FuncCredit)
			}
		}
	}
	rows := make([]ledger.TrialBalanceReportRow, 0, len(chart))
	for i, a := range chart {
		var err error
		if opening[i], err = q4(opening[i]); err != nil {
			return nil, err
		}
		if opDr[i], err = q4(opDr[i]); err != nil {
			return nil, err
		}
		if opCr[i], err = q4(opCr[i]); err != nil {
			return nil, err
		}
		if ajDr[i], err = q4(ajDr[i]); err != nil {
			return nil, err
		}
		if ajCr[i], err = q4(ajCr[i]); err != nil {
			return nil, err
		}
		rows = append(rows, ledger.TrialBalanceReportRow{
			AccountCode:      a.AccountCode,
			AccountName:      a.AccountName,
			AccountType:      a.AccountType,
			FSCategory:       a.FSCategory,
			StatementRef:     a.StatementRef,
			CashFlowActivity: a.CashFlowActivity,
			OpeningBalance:   opening[i],
			PeriodOpDebit:    opDr[i],
			PeriodOpCredit:   opCr[i],
			AdjustmentDebit:  ajDr[i],
			AdjustmentCredit: ajCr[i],
		})
	}
	return rows, nil
}

// adjustmentLayer mirrors the ledger package's adjustment-layer set.
func adjustmentLayer(entryLayer string) bool {
	return entryLayer == "AJE_MONTH_END" || entryLayer == "RJE_RECLASS"
}

// validWindowBound checks a canonical real date through the ledger's
// posting-date validation (a nil period derives from the date's month, so
// the call validates the date itself).
func validWindowBound(day string) bool {
	_, err := ledger.ValidatePostingDate(day, nil)
	return err == nil
}

// FinancialProjection anchors a standard financial report (SRC-0027): the
// ledger fiscal calendar decides the window, the aggregated fiscal-period
// state is reported next to the rows, and the rows carry the window's
// activity. Nothing here creates or mutates period state.
type FinancialProjection struct {
	Frequency   string                         `json:"frequency"`
	FiscalYear  int                            `json:"fiscal_year"`
	Index       int                            `json:"index"`
	Window      ledger.ReportWindow            `json:"window"`
	PeriodState string                         `json:"period_state"`
	Rows        []ledger.TrialBalanceReportRow `json:"rows"`
}

// AnchorFinancialProjection builds the projection for one standard financial
// report. The period rows the caller passes are the fiscal_periods state;
// a window month with no stored row behaves as OPEN (the reference
// auto-creates OPEN periods), and an unrecognised stored status fails
// closed.
func AnchorFinancialProjection(
	cal ledger.FiscalCalendar,
	spec ledger.FinancialReportSpec,
	periods []ledger.Period,
	chart []ledger.Account,
	lines []ledger.Line,
) (*FinancialProjection, error) {
	window, err := cal.FinancialReportWindow(spec)
	if err != nil {
		return nil, err
	}
	state, err := ledger.AggregatePeriodState(periods, window.MonthCodes)
	if err != nil {
		return nil, err
	}
	rows, err := WindowRows(chart, lines, window.Start, window.End)
	if err != nil {
		return nil, err
	}
	return &FinancialProjection{
		Frequency:   string(spec.Frequency),
		FiscalYear:  spec.FiscalYear,
		Index:       spec.Index,
		Window:      window,
		PeriodState: state,
		Rows:        rows,
	}, nil
}

// ManagementProjection is the custom-window read-only projection (SRC-0027):
// management reports keep custom periods, but nothing here turns the window
// into a writable period or a fiscal-period row, and the projection reports
// the stored state of every overlapping fiscal period so nobody mistakes an
// unsettled window for a settled one.
type ManagementProjection struct {
	Window             ledger.ManagementWindow        `json:"window"`
	OverlappingPeriods []ledger.Period                `json:"overlapping_periods"`
	Rows               []ledger.TrialBalanceReportRow `json:"rows"`
}

// AnchorManagementProjection builds the read-only projection for a custom
// window.
func AnchorManagementProjection(
	w ledger.ManagementWindow,
	periods []ledger.Period,
	chart []ledger.Account,
	lines []ledger.Line,
) (*ManagementProjection, error) {
	rows, err := WindowRows(chart, lines, w.Start, w.End)
	if err != nil {
		return nil, err
	}
	return &ManagementProjection{
		Window:             w,
		OverlappingPeriods: ledger.PeriodsOverlappingWindow(periods, w),
		Rows:               rows,
	}, nil
}
