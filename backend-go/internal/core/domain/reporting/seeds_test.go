package reporting

import (
	"strconv"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// Shared regression seeds. Expected values come from the 2026-10-21
// business-logic audit's worked examples and independent accounting
// arithmetic, never from the Go code under test.

func acc(code, fsCategory, accountType, normalBalance string) ledger.Account {
	return ledger.Account{
		AccountID:        "DEMO:" + code,
		AccountCode:      code,
		AccountName:      code,
		AccountType:      accountType,
		NormalBalance:    normalBalance,
		FSCategory:       fsCategory,
		StatementRef:     "TB",
		CashFlowActivity: "OPERATING_WC",
		IsActive:         true,
	}
}

// baseChart covers every mapped category; no INVENTORY account appears
// unless a test adds one (the BL-13 unmapped case).
func baseChart() []ledger.Account {
	return []ledger.Account{
		acc("1000", "CASH", "ASSET", "DEBIT"),
		acc("1210", "AR", "ASSET", "DEBIT"),
		acc("1410", "PREPAY_TAX", "ASSET", "DEBIT"),
		acc("1610", "FIXED_ASSET", "ASSET", "DEBIT"),
		acc("1650", "CONTRA_ASSET", "ASSET", "CREDIT"),
		acc("2110", "AP_ACCRUAL", "LIABILITY", "CREDIT"),
		acc("2190", "DIRECTOR_LOAN", "LIABILITY", "CREDIT"),
		acc("2210", "TAX_PAYABLE", "LIABILITY", "CREDIT"),
		acc("3100", "EQUITY", "EQUITY", "CREDIT"),
		acc("4100", "REVENUE", "REVENUE", "CREDIT"),
		acc("5100", "COGS", "EXPENSE", "DEBIT"),
		acc("6100", "OPEX", "EXPENSE", "DEBIT"),
		acc("6410", "DEPRECIATION", "EXPENSE", "DEBIT"),
		acc("7500", "TAX_EXPENSE", "EXPENSE", "DEBIT"),
	}
}

// tline builds one balanced entry's line.
func tline(journal string, no int, code, layer, date string, dr, cr string) ledger.Line {
	return ledger.Line{
		LineID:         journal + "-L" + strconv.Itoa(no),
		JournalID:      journal,
		EntityCode:     "DEMO",
		LineNumber:     no,
		AccountCode:    code,
		AccountName:    code,
		PeriodCode:     date[:7],
		EntryLayer:     layer,
		AccountingDate: date,
		TxDebit:        mustParse(dr),
		TxCredit:       mustParse(cr),
		FuncDebit:      mustParse(dr),
		FuncCredit:     mustParse(cr),
	}
}

// workedExampleLines is the two-month all-cash worked example:
//
//	September opening:   cash 5000 / equity 5000
//	October:             cash sale 1200; cash opex 300     -> profit 900
//	November:            cash sale 700;  cash opex 250     -> profit 450
func workedExampleLines() []ledger.Line {
	return []ledger.Line{
		tline("J1", 1, "1000", "OPENING", "2026-09-30", "5000.0000", "0.0000"),
		tline("J1", 2, "3100", "OPENING", "2026-09-30", "0.0000", "5000.0000"),
		tline("J2", 1, "1000", "OPERATIONAL", "2026-10-05", "1200.0000", "0.0000"),
		tline("J2", 2, "4100", "OPERATIONAL", "2026-10-05", "0.0000", "1200.0000"),
		tline("J3", 1, "6100", "OPERATIONAL", "2026-10-12", "300.0000", "0.0000"),
		tline("J3", 2, "1000", "OPERATIONAL", "2026-10-12", "0.0000", "300.0000"),
		tline("J4", 1, "1000", "OPERATIONAL", "2026-11-05", "700.0000", "0.0000"),
		tline("J4", 2, "4100", "OPERATIONAL", "2026-11-05", "0.0000", "700.0000"),
		tline("J5", 1, "6100", "OPERATIONAL", "2026-11-10", "250.0000", "0.0000"),
		tline("J5", 2, "1000", "OPERATIONAL", "2026-11-10", "0.0000", "250.0000"),
	}
}

// trow builds one trial-balance report row.
func trow(code, name, accountType, fsCategory, opening, opDr, opCr, ajDr, ajCr string) ledger.TrialBalanceReportRow {
	return ledger.TrialBalanceReportRow{
		AccountCode:      code,
		AccountName:      name,
		AccountType:      accountType,
		FSCategory:       fsCategory,
		StatementRef:     "TB",
		CashFlowActivity: "OPERATING_WC",
		OpeningBalance:   mustParse(opening),
		PeriodOpDebit:    mustParse(opDr),
		PeriodOpCredit:   mustParse(opCr),
		AdjustmentDebit:  mustParse(ajDr),
		AdjustmentCredit: mustParse(ajCr),
	}
}

// cashMonthRows is the balanced all-cash October row set (the parity seed):
// opening cash 5000 from equity, October cash sale 1200, cash opex 300.
func cashMonthRows() []ledger.TrialBalanceReportRow {
	return []ledger.TrialBalanceReportRow{
		trow("1000", "銀行存款", "ASSET", "CASH", "5000.0000", "1200.0000", "300.0000", "0.0000", "0.0000"),
		trow("3100", "實收資本及期初留存", "EQUITY", "EQUITY", "-5000.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
		trow("4100", "主營業務收入", "REVENUE", "REVENUE", "0.0000", "0.0000", "1200.0000", "0.0000", "0.0000"),
		trow("6100", "管理及營運費用", "EXPENSE", "OPEX", "0.0000", "300.0000", "0.0000", "0.0000", "0.0000"),
	}
}
