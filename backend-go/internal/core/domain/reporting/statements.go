package reporting

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Statements 1 and 2: the trial-balance compilation, the income statement
// and the balance sheet — the port of generate_reporting_pack sections 1-3.
//
// One deliberate departure from the reference, decided with BL-14: the
// income statement's P&L bands aggregate the report window's activity
// (period movements), never the all-time adjusted endings the reference
// read. The balance sheet keeps positions (a balance-sheet concept), and its
// equity carries the all-time profit position so A = L + E holds for any
// window. Where the reference is correct (P&L openings of zero — fresh
// books or the first month of a fiscal year) the two agree exactly; that is
// the golden-parity condition. Row inputs with a non-zero P&L opening are
// the defect scenario class and are excluded from the fixtures.

// LegalStructure mirrors EntityLegalStructure. The wire form is the string
// value.
type LegalStructure string

const (
	StructureSoleProprietor LegalStructure = "SOLE_PROPRIETOR" // 個體工商戶
	StructureOPCLimited     LegalStructure = "OPC_LIMITED"     // 一人有限公司
	StructureSMECorp        LegalStructure = "SME_CORP"        // 一般中小企有限公司
)

// ParseLegalStructure validates a structure string against the enum.
func ParseLegalStructure(s string) (LegalStructure, error) {
	switch LegalStructure(s) {
	case StructureSoleProprietor, StructureOPCLimited, StructureSMECorp:
		return LegalStructure(s), nil
	}
	return "", fail(ErrInvalidStatementInput,
		"INVALID_STATEMENT_INPUT: '"+s+"' 不是支援的營主體結構（SOLE_PROPRIETOR、OPC_LIMITED、SME_CORP）。")
}

// TrialBalanceRowView is one serialized trial-balance row (the reference's
// trial_balance_serialized dicts). All money crosses as strings.
type TrialBalanceRowView struct {
	AccountCode          string      `json:"account_code"`
	AccountName          string      `json:"account_name"`
	AccountType          string      `json:"account_type"`
	StatementRef         string      `json:"statement_ref"`
	OpeningBalance       money.Money `json:"opening_balance"`
	PeriodOpDebit        money.Money `json:"period_op_debit"`
	PeriodOpCredit       money.Money `json:"period_op_credit"`
	UnadjustedDebit      money.Money `json:"unadjusted_debit"`
	UnadjustedCredit     money.Money `json:"unadjusted_credit"`
	AdjustmentDebit      money.Money `json:"adjustment_debit"`
	AdjustmentCredit     money.Money `json:"adjustment_credit"`
	AdjustedDebit        money.Money `json:"adjusted_debit"`
	AdjustedCredit       money.Money `json:"adjusted_credit"`
	StatementDestination string      `json:"statement_destination"`
}

// TrialBalanceTotals are the ten column totals of the extended trial
// balance, quantized after every row exactly as the reference accumulates.
type TrialBalanceTotals struct {
	TotalOpeningDebit     money.Money `json:"total_opening_debit"`
	TotalOpeningCredit    money.Money `json:"total_opening_credit"`
	TotalPeriodDebit      money.Money `json:"total_period_debit"`
	TotalPeriodCredit     money.Money `json:"total_period_credit"`
	TotalUnadjustedDebit  money.Money `json:"total_unadjusted_debit"`
	TotalUnadjustedCredit money.Money `json:"total_unadjusted_credit"`
	TotalAdjustmentDebit  money.Money `json:"total_adjustment_debit"`
	TotalAdjustmentCredit money.Money `json:"total_adjustment_credit"`
	TotalAdjustedDebit    money.Money `json:"total_adjusted_debit"`
	TotalAdjustedCredit   money.Money `json:"total_adjusted_credit"`
}

// TrialBalanceCompilation is the section-1 result: rows and totals.
type TrialBalanceCompilation struct {
	Rows   []TrialBalanceRowView `json:"rows"`
	Totals TrialBalanceTotals    `json:"totals"`
}

// CompileTrialBalance ports section 1: side-splits, unadjusted and adjusted
// endings per row, the ten totals, and the P&L/Balance-Sheet destination
// read from the account type.
func CompileTrialBalance(rows []ledger.TrialBalanceReportRow) (*TrialBalanceCompilation, error) {
	out := &TrialBalanceCompilation{Rows: []TrialBalanceRowView{}}
	t := &out.Totals
	t.TotalOpeningDebit = zeroQ4
	t.TotalOpeningCredit = zeroQ4
	t.TotalPeriodDebit = zeroQ4
	t.TotalPeriodCredit = zeroQ4
	t.TotalUnadjustedDebit = zeroQ4
	t.TotalUnadjustedCredit = zeroQ4
	t.TotalAdjustmentDebit = zeroQ4
	t.TotalAdjustmentCredit = zeroQ4
	t.TotalAdjustedDebit = zeroQ4
	t.TotalAdjustedCredit = zeroQ4

	for _, row := range rows {
		unadj, err := q4(row.OpeningBalance.Add(row.PeriodOpDebit).Sub(row.PeriodOpCredit))
		if err != nil {
			return nil, err
		}
		adj, err := q4(unadj.Add(row.AdjustmentDebit).Sub(row.AdjustmentCredit))
		if err != nil {
			return nil, err
		}
		openDr := positiveZeroQ4(row.OpeningBalance, true)
		openCr := positiveZeroQ4(row.OpeningBalance, false)
		unadjDr := positiveZeroQ4(unadj, true)
		unadjCr := positiveZeroQ4(unadj, false)
		adjDr := positiveZeroQ4(adj, true)
		adjCr := positiveZeroQ4(adj, false)

		if t.TotalOpeningDebit, err = q4(t.TotalOpeningDebit.Add(openDr)); err != nil {
			return nil, err
		}
		if t.TotalOpeningCredit, err = q4(t.TotalOpeningCredit.Add(openCr)); err != nil {
			return nil, err
		}
		if t.TotalPeriodDebit, err = q4(t.TotalPeriodDebit.Add(row.PeriodOpDebit)); err != nil {
			return nil, err
		}
		if t.TotalPeriodCredit, err = q4(t.TotalPeriodCredit.Add(row.PeriodOpCredit)); err != nil {
			return nil, err
		}
		if t.TotalUnadjustedDebit, err = q4(t.TotalUnadjustedDebit.Add(unadjDr)); err != nil {
			return nil, err
		}
		if t.TotalUnadjustedCredit, err = q4(t.TotalUnadjustedCredit.Add(unadjCr)); err != nil {
			return nil, err
		}
		if t.TotalAdjustmentDebit, err = q4(t.TotalAdjustmentDebit.Add(row.AdjustmentDebit)); err != nil {
			return nil, err
		}
		if t.TotalAdjustmentCredit, err = q4(t.TotalAdjustmentCredit.Add(row.AdjustmentCredit)); err != nil {
			return nil, err
		}
		if t.TotalAdjustedDebit, err = q4(t.TotalAdjustedDebit.Add(adjDr)); err != nil {
			return nil, err
		}
		if t.TotalAdjustedCredit, err = q4(t.TotalAdjustedCredit.Add(adjCr)); err != nil {
			return nil, err
		}

		isPL := row.AccountType == "REVENUE" || row.AccountType == "EXPENSE"
		dest := "BALANCE_SHEET (B/S)"
		if isPL {
			dest = "INCOME_STATEMENT (P&L)"
		}
		out.Rows = append(out.Rows, TrialBalanceRowView{
			AccountCode:          row.AccountCode,
			AccountName:          row.AccountName,
			AccountType:          row.AccountType,
			StatementRef:         row.StatementRef,
			OpeningBalance:       row.OpeningBalance,
			PeriodOpDebit:        row.PeriodOpDebit,
			PeriodOpCredit:       row.PeriodOpCredit,
			UnadjustedDebit:      unadjDr,
			UnadjustedCredit:     unadjCr,
			AdjustmentDebit:      row.AdjustmentDebit,
			AdjustmentCredit:     row.AdjustmentCredit,
			AdjustedDebit:        adjDr,
			AdjustedCredit:       adjCr,
			StatementDestination: dest,
		})
	}
	return out, nil
}

// WindowFigures carries every derived figure the statements and the tax
// schedule read, in exact decimals. The P&L band values are the window's
// activity; the position values are the window-end balance-sheet positions;
// the opening values are the pre-window balances the cash-flow deltas move
// from.
type WindowFigures struct {
	// P&L — the window's activity (BL-14: never all-time openings).
	TotalRevenue        money.Money
	TotalCOGS           money.Money
	GrossProfit         money.Money
	TotalOpex           money.Money
	TotalDep            money.Money
	EBITDA              money.Money
	OperatingProfitEBIT money.Money
	TaxExpense          money.Money
	WindowNetProfit     money.Money

	// Positions at window end (balance-sheet concepts).
	EndingCash              money.Money
	EndingAR                money.Money
	EndingPrepay            money.Money
	DirLoanNet              money.Money
	DirLoanAsset            money.Money
	DirLoanLiability        money.Money
	TotalCurrentAssets      money.Money
	GrossFixedAssets        money.Money
	AccumDepreciation       money.Money
	NetBookValueFA          money.Money
	TotalAssets             money.Money
	EndingAPAccruals        money.Money
	EndingTaxPayable        money.Money
	TotalLiabilities        money.Money
	OpeningEquityAndCapital money.Money
	AllTimeProfit           money.Money
	TotalEquity             money.Money
	TotalLiabAndEquity      money.Money

	// Pre-window balances the cash-flow movements move from.
	OpeningCash    money.Money
	OpeningAR      money.Money
	OpeningPrepay  money.Money
	OpeningAP      money.Money
	OpeningTax     money.Money
	OpeningFA      money.Money
	OpeningEq      money.Money
	OpeningDirLoan money.Money

	// Window movements.
	DeltaAR                money.Money
	DeltaPrepay            money.Money
	DeltaAP                money.Money
	DeltaTax               money.Money
	CapitalOrDrawingsDelta money.Money
	DirLoanCashImpact      money.Money
}

// pnlChain applies the reference's income-statement arithmetic to one pair
// of band sums: gross profit, EBITDA, EBIT and net profit, each q4 after
// the reference's own subtraction order.
func pnlChain(revenue, cogs, opex, dep, tax money.Money) (gp, ebitda, ebit, net money.Money, err error) {
	if gp, err = q4(revenue.Sub(cogs)); err != nil {
		return
	}
	if ebitda, err = q4(gp.Sub(opex)); err != nil {
		return
	}
	if ebit, err = q4(ebitda.Sub(dep)); err != nil {
		return
	}
	net, err = q4(ebit.Sub(tax))
	return
}

// DeriveFigures derives every statement figure from the window's
// trial-balance rows. It is the BL-13 gate: rows with a category outside
// the versioned mapping block reporting before any derivation runs.
func DeriveFigures(rows []ledger.TrialBalanceReportRow) (*WindowFigures, error) {
	if err := ValidateStatementCategories(rows); err != nil {
		return nil, err
	}
	f := &WindowFigures{}
	zeros := [](*money.Money){
		&f.TotalRevenue, &f.TotalCOGS, &f.TotalOpex, &f.TotalDep, &f.TaxExpense,
		&f.EndingCash, &f.EndingAR, &f.EndingPrepay, &f.DirLoanNet,
		&f.GrossFixedAssets, &f.AccumDepreciation, &f.EndingAPAccruals, &f.EndingTaxPayable,
		&f.OpeningEquityAndCapital,
		&f.OpeningCash, &f.OpeningAR, &f.OpeningPrepay, &f.OpeningAP, &f.OpeningTax,
		&f.OpeningFA, &f.OpeningEq, &f.OpeningDirLoan,
	}
	for _, z := range zeros {
		*z = zeroQ4
	}
	// All-time cumulative P&L bands (the reference's total_revenue/... read
	// from adjusted endings). The balance sheet's equity position is a
	// balance-sheet concept, so it keeps the reference's cumulative basis.
	cumRevenue, cumCOGS, cumOpex, cumDep, cumTax := zeroQ4, zeroQ4, zeroQ4, zeroQ4, zeroQ4
	var err error
	for _, row := range rows {
		adj, err := q4(row.OpeningBalance.Add(row.PeriodOpDebit).Sub(row.PeriodOpCredit).
			Add(row.AdjustmentDebit).Sub(row.AdjustmentCredit))
		if err != nil {
			return nil, err
		}
		// Window activity of the P&L bands, reference subtraction order.
		activity := row.PeriodOpCredit.Sub(row.PeriodOpDebit).
			Add(row.AdjustmentCredit).Sub(row.AdjustmentDebit)
		switch row.FSCategory {
		case "REVENUE":
			f.TotalRevenue = f.TotalRevenue.Add(activity)
			cumRevenue = cumRevenue.Add(adj.Neg())
		case "COGS":
			f.TotalCOGS = f.TotalCOGS.Add(activity.Neg())
			cumCOGS = cumCOGS.Add(adj)
		case "OPEX":
			f.TotalOpex = f.TotalOpex.Add(activity.Neg())
			cumOpex = cumOpex.Add(adj)
		case "DEPRECIATION":
			f.TotalDep = f.TotalDep.Add(activity.Neg())
			cumDep = cumDep.Add(adj)
		case "TAX_EXPENSE":
			f.TaxExpense = f.TaxExpense.Add(activity.Neg())
			cumTax = cumTax.Add(adj)
		case "CASH":
			f.EndingCash = f.EndingCash.Add(adj)
			f.OpeningCash = f.OpeningCash.Add(row.OpeningBalance)
		case "AR":
			f.EndingAR = f.EndingAR.Add(adj)
			f.OpeningAR = f.OpeningAR.Add(row.OpeningBalance)
		case "PREPAY_TAX":
			f.EndingPrepay = f.EndingPrepay.Add(adj)
			f.OpeningPrepay = f.OpeningPrepay.Add(row.OpeningBalance)
		case "FIXED_ASSET":
			f.GrossFixedAssets = f.GrossFixedAssets.Add(adj)
			f.OpeningFA = f.OpeningFA.Add(row.OpeningBalance)
		case "CONTRA_ASSET":
			f.AccumDepreciation = f.AccumDepreciation.Add(adj)
		case "AP_ACCRUAL":
			f.EndingAPAccruals = f.EndingAPAccruals.Add(adj.Neg())
			f.OpeningAP = f.OpeningAP.Add(row.OpeningBalance.Neg())
		case "TAX_PAYABLE":
			f.EndingTaxPayable = f.EndingTaxPayable.Add(adj.Neg())
			f.OpeningTax = f.OpeningTax.Add(row.OpeningBalance.Neg())
		case "DIRECTOR_LOAN":
			f.DirLoanNet = f.DirLoanNet.Add(adj)
			f.OpeningDirLoan = f.OpeningDirLoan.Add(row.OpeningBalance)
		case "EQUITY":
			f.OpeningEquityAndCapital = f.OpeningEquityAndCapital.Add(adj.Neg())
			f.OpeningEq = f.OpeningEq.Add(row.OpeningBalance.Neg())
		}
	}
	// Quantize the band sums after the fact, as the reference's q4(sum(...)).
	for _, z := range []*money.Money{
		&f.TotalRevenue, &f.TotalCOGS, &f.TotalOpex, &f.TotalDep, &f.TaxExpense,
		&f.EndingCash, &f.EndingAR, &f.EndingPrepay, &f.DirLoanNet,
		&f.GrossFixedAssets, &f.AccumDepreciation, &f.EndingAPAccruals, &f.EndingTaxPayable,
		&f.OpeningEquityAndCapital,
		&f.OpeningCash, &f.OpeningAR, &f.OpeningPrepay, &f.OpeningAP, &f.OpeningTax,
		&f.OpeningFA, &f.OpeningEq, &f.OpeningDirLoan,
	} {
		if *z, err = q4(*z); err != nil {
			return nil, err
		}
	}
	// The all-time profit position follows the reference's cumulative chain
	// (each cumulative band q4'ed, then the profit chain), because the
	// balance sheet's equity must reproduce the reference's numbers.
	if _, _, _, f.AllTimeProfit, err = pnlChain(cumRevenue, cumCOGS, cumOpex, cumDep, cumTax); err != nil {
		return nil, err
	}
	if f.GrossProfit, f.EBITDA, f.OperatingProfitEBIT, f.WindowNetProfit, err =
		pnlChain(f.TotalRevenue, f.TotalCOGS, f.TotalOpex, f.TotalDep, f.TaxExpense); err != nil {
		return nil, err
	}

	// Director loan splits by side.
	f.DirLoanAsset = positiveZeroQ4(f.DirLoanNet, true)
	f.DirLoanLiability = positiveZeroQ4(f.DirLoanNet, false)

	if f.TotalCurrentAssets, err = q4(f.EndingCash.Add(f.EndingAR).Add(f.EndingPrepay).Add(f.DirLoanAsset)); err != nil {
		return nil, err
	}
	if f.NetBookValueFA, err = q4(f.GrossFixedAssets.Add(f.AccumDepreciation)); err != nil {
		return nil, err
	}
	if f.TotalAssets, err = q4(f.TotalCurrentAssets.Add(f.NetBookValueFA)); err != nil {
		return nil, err
	}
	if f.TotalLiabilities, err = q4(f.EndingAPAccruals.Add(f.EndingTaxPayable).Add(f.DirLoanLiability)); err != nil {
		return nil, err
	}
	if f.TotalEquity, err = q4(f.OpeningEquityAndCapital.Add(f.AllTimeProfit)); err != nil {
		return nil, err
	}
	if f.TotalLiabAndEquity, err = q4(f.TotalLiabilities.Add(f.TotalEquity)); err != nil {
		return nil, err
	}

	// Window movements: closing minus the pre-window balance.
	if f.DeltaAR, err = q4(f.EndingAR.Sub(f.OpeningAR)); err != nil {
		return nil, err
	}
	if f.DeltaPrepay, err = q4(f.EndingPrepay.Sub(f.OpeningPrepay)); err != nil {
		return nil, err
	}
	if f.DeltaAP, err = q4(f.EndingAPAccruals.Sub(f.OpeningAP)); err != nil {
		return nil, err
	}
	if f.DeltaTax, err = q4(f.EndingTaxPayable.Sub(f.OpeningTax)); err != nil {
		return nil, err
	}
	if f.CapitalOrDrawingsDelta, err = q4(f.OpeningEquityAndCapital.Sub(f.OpeningEq)); err != nil {
		return nil, err
	}
	if f.DirLoanCashImpact, err = q4(f.DirLoanNet.Sub(f.OpeningDirLoan).Neg()); err != nil {
		return nil, err
	}
	return f, nil
}

// PLLineItem is one income-statement line (the reference's line_items dicts;
// margin_pct appears only on the subtotal lines that carry it).
type PLLineItem struct {
	Key          string      `json:"key"`
	StatementRef string      `json:"statement_ref"`
	Label        string      `json:"label"`
	Amount       money.Money `json:"amount"`
	IsSubtotal   bool        `json:"is_subtotal"`
	MarginPct    string      `json:"margin_pct,omitempty"`
}

// IncomeStatementReport is statement 1 (損益表), the reference's
// income_statement dict. The band amounts are the window's activity.
type IncomeStatementReport struct {
	StatementCode string       `json:"statement_code"` // "PL"
	Period        string       `json:"period"`
	Currency      string       `json:"currency"`
	LineItems     []PLLineItem `json:"line_items"`
}

// IncomeStatement ports section 2 over the window figures, including the
// margin percentages (28-significant-digit division, then q4, then a
// half-even one-decimal render).
func IncomeStatement(f *WindowFigures, period, currency string) (*IncomeStatementReport, error) {
	grossMargin := zeroQ4
	if f.TotalRevenue.Cmp(zeroNum) > 0 {
		quotient, err := div28(f.GrossProfit, f.TotalRevenue)
		if err != nil {
			return nil, err
		}
		if grossMargin, err = q4(quotient.Mul(mustParse("100"))); err != nil {
			return nil, err
		}
	}
	gm, err := formatPct1(grossMargin)
	if err != nil {
		return nil, err
	}
	netMargin := zeroQ4
	if f.TotalRevenue.Cmp(zeroNum) > 0 {
		quotient, err := div28(f.WindowNetProfit, f.TotalRevenue)
		if err != nil {
			return nil, err
		}
		if netMargin, err = q4(quotient.Mul(mustParse("100"))); err != nil {
			return nil, err
		}
	}
	nm, err := formatPct1(netMargin)
	if err != nil {
		return nil, err
	}
	items := []PLLineItem{
		{Key: "REVENUE", StatementRef: "PL-10", Label: "Revenue / Turnover (主營業務收入)", Amount: f.TotalRevenue},
		{Key: "COGS", StatementRef: "PL-20", Label: "Less: Direct Cloud & API Cost of Sales (營業成本)", Amount: negDisplay(f.TotalCOGS)},
		{Key: "GROSS_PROFIT", StatementRef: "PL", Label: "Gross Profit (毛利)", Amount: f.GrossProfit, IsSubtotal: true, MarginPct: gm},
		{Key: "OPEX", StatementRef: "PL-40", Label: "Less: Operating & Admin Expenses (管理及營運費用)", Amount: negDisplay(f.TotalOpex)},
		{Key: "EBITDA", StatementRef: "PL", Label: "EBITDA (稅息折舊攤銷前利潤)", Amount: f.EBITDA, IsSubtotal: true},
		{Key: "DEPRECIATION", StatementRef: "FA", Label: "Less: Depreciation & Amortization (折舊及攤銷)", Amount: negDisplay(f.TotalDep)},
		{Key: "PBT", StatementRef: "PL", Label: "Profit Before Tax / EBT (稅前淨利)", Amount: f.OperatingProfitEBIT, IsSubtotal: true},
		{Key: "TAX_EXPENSE", StatementRef: "TAX", Label: "Less: Income Tax Provision (所得稅費用提列)", Amount: negDisplay(f.TaxExpense)},
		{Key: "NET_PROFIT", StatementRef: "EQ", Label: "Net Profit for the Period (本期淨利)", Amount: f.WindowNetProfit, IsSubtotal: true, MarginPct: nm},
	}
	return &IncomeStatementReport{
		StatementCode: "PL",
		Period:        period,
		Currency:      currency,
		LineItems:     items,
	}, nil
}

// BSLine is one balance-sheet line. is_subtotal is omitted where the
// reference's dicts omit it.
type BSLine struct {
	StatementRef string      `json:"statement_ref"`
	Label        string      `json:"label"`
	Amount       money.Money `json:"amount"`
	IsSubtotal   bool        `json:"is_subtotal,omitempty"`
}

// BalanceSheetReport is statement 2 (資產負債表), the reference's
// balance_sheet dict with its A = L + E shape.
type BalanceSheetReport struct {
	StatementCode             string      `json:"statement_code"` // "BS"
	AsOfPeriod                string      `json:"as_of_period"`
	Currency                  string      `json:"currency"`
	CurrentAssets             []BSLine    `json:"current_assets"`
	TotalCurrentAssets        money.Money `json:"total_current_assets"`
	NonCurrentAssets          []BSLine    `json:"non_current_assets"`
	TotalAssets               money.Money `json:"total_assets"`
	CurrentLiabilities        []BSLine    `json:"current_liabilities"`
	TotalLiabilities          money.Money `json:"total_liabilities"`
	Equity                    []BSLine    `json:"equity"`
	TotalEquity               money.Money `json:"total_equity"`
	TotalLiabilitiesAndEquity money.Money `json:"total_liabilities_and_equity"`
}

// BalanceSheet ports section 3: positions at window end, the director-loan
// side split, and the equity label by legal structure. Equity carries the
// all-time profit position (a balance-sheet concept under SRC-0027), so the
// equation holds for any window.
func BalanceSheet(f *WindowFigures, structure LegalStructure, period, currency string) (*BalanceSheetReport, error) {
	equityLabel := "Issued Share Capital & Opening Retained Earnings (實收資本及期初未分配利潤)"
	if structure == StructureSoleProprietor {
		equityLabel = "Owner's Capital & Opening Surplus (業主資本及期初留存)"
	}
	currentAssets := []BSLine{
		{StatementRef: "CASH", Label: "Cash & Bank Balances (貨幣資金 / 銀行存款)", Amount: f.EndingCash},
		{StatementRef: "AR", Label: "Accounts Receivable, Net (應收賬款淨額)", Amount: f.EndingAR},
		{StatementRef: "PREPAY", Label: "Prepayments & Input VAT/GST (預付賬款及留抵稅額)", Amount: f.EndingPrepay},
	}
	if f.DirLoanAsset.Cmp(zeroNum) > 0 {
		currentAssets = append(currentAssets, BSLine{
			StatementRef: "DIRECTOR", Label: "Due from Director / Owner (應收股東/業主往來)", Amount: f.DirLoanAsset,
		})
	}
	currentLiabilities := []BSLine{
		{StatementRef: "AP", Label: "Accounts Payable & Accrued Expenses (應付賬款及應計費用)", Amount: f.EndingAPAccruals},
		{StatementRef: "TAX", Label: "Statutory Taxes Payable - GST/VAT/CIT (應交稅費)", Amount: f.EndingTaxPayable},
	}
	if f.DirLoanLiability.Cmp(zeroNum) > 0 {
		currentLiabilities = append(currentLiabilities, BSLine{
			StatementRef: "DIRECTOR", Label: "Director's Loan / Due to Owner (應付股東/董事往來款)", Amount: f.DirLoanLiability,
		})
	}
	return &BalanceSheetReport{
		StatementCode:      "BS",
		AsOfPeriod:         period,
		Currency:           currency,
		CurrentAssets:      currentAssets,
		TotalCurrentAssets: f.TotalCurrentAssets,
		NonCurrentAssets: []BSLine{
			{StatementRef: "FA", Label: "Property, Plant & Equipment - Cost (固定資產原值)", Amount: f.GrossFixedAssets},
			{StatementRef: "FA", Label: "Less: Accumulated Depreciation (累計折舊)", Amount: f.AccumDepreciation},
			{StatementRef: "FA", Label: "Fixed Assets, Net Book Value (固定資產淨值)", Amount: f.NetBookValueFA, IsSubtotal: true},
		},
		TotalAssets:        f.TotalAssets,
		CurrentLiabilities: currentLiabilities,
		TotalLiabilities:   f.TotalLiabilities,
		Equity: []BSLine{
			{StatementRef: "EQ", Label: equityLabel, Amount: f.OpeningEquityAndCapital},
			{StatementRef: "PL", Label: "Current Period Net Profit (本期淨利結轉)", Amount: f.AllTimeProfit},
		},
		TotalEquity:               f.TotalEquity,
		TotalLiabilitiesAndEquity: f.TotalLiabAndEquity,
	}, nil
}

// ConsistencyCheckReport mirrors the reference's consistency_checks dict.
type ConsistencyCheckReport struct {
	TrialBalanceBalanced         bool        `json:"trial_balance_balanced"`
	AdjustmentsBalanced          bool        `json:"adjustments_balanced"`
	ReportedBalanceBalanced      bool        `json:"reported_balance_balanced"`
	BalanceSheetEquationBalanced bool        `json:"balance_sheet_equation_balanced"`
	BalanceSheetVariance         money.Money `json:"balance_sheet_variance"`
	CashFlowReconcilesToBSCash   bool        `json:"cash_flow_reconciles_to_bs_cash"`
	CashFlowVariance             money.Money `json:"cash_flow_variance"`
	NetProfitFlowsToEquity       bool        `json:"net_profit_flows_to_equity"`
}

// ConsistencyChecks ports the pack's consistency checks. The cash-flow tie
// reads the classified statement's ending balance — the classified net ties
// to actual cash legs by construction (BL-12/18), so a mismatch names
// missing cash accounts, not rounding.
func ConsistencyChecks(comp *TrialBalanceCompilation, f *WindowFigures, cf *CashFlowStatementReport) (*ConsistencyCheckReport, error) {
	t := &comp.Totals
	variance, err := q4(f.TotalAssets.Sub(f.TotalLiabAndEquity))
	if err != nil {
		return nil, err
	}
	cfVariance, err := q4(cf.EndingCashBalance.Sub(f.EndingCash))
	if err != nil {
		return nil, err
	}
	return &ConsistencyCheckReport{
		TrialBalanceBalanced:         t.TotalUnadjustedDebit.Equal(t.TotalUnadjustedCredit),
		AdjustmentsBalanced:          t.TotalAdjustmentDebit.Equal(t.TotalAdjustmentCredit),
		ReportedBalanceBalanced:      t.TotalAdjustedDebit.Equal(t.TotalAdjustedCredit),
		BalanceSheetEquationBalanced: f.TotalAssets.Equal(f.TotalLiabAndEquity),
		BalanceSheetVariance:         variance,
		CashFlowReconcilesToBSCash:   cf.EndingCashBalance.Equal(f.EndingCash),
		CashFlowVariance:             cfVariance,
		NetProfitFlowsToEquity:       f.OpeningEquityAndCapital.Add(f.AllTimeProfit).Equal(f.TotalEquity),
	}, nil
}
