package reporting

import (
	"fmt"
	"sort"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Statement 3: the cash flow statement (現金流量表), rebuilt on actual cash
// legs — the BL-12 and BL-18 fixes.
//
// The reference derived the statement from trial-balance column deltas, so a
// credit-funded equipment purchase reported an operating inflow and an
// investing outflow of the same amount (BL-12), and a compound entry
// reported the gross of every noncash leg as a cash flow while still tying
// net cash (BL-18, the same defect ledger.cash_flow_breakdown preserves for
// parity). The fix here classifies each entry's ACTUAL cash legs and only
// them:
//
//   - An entry with no cash-account line contributes nothing to the flows;
//     its movements are disclosed as noncash (BL-12: cash settlements and
//     noncash movements are distinguished, never conflated).
//   - The entry's cash inflow (cash-line debits) is matched against its
//     noncash credit legs in line order, and its cash outflow (cash-line
//     credits) against its noncash debit legs; each matched amount reports
//     into the counterpart category's activity. The unmatched cash
//     remainders of an entry are transfers between own cash accounts and net
//     to zero; if they cannot cancel, the entry does not balance and the
//     classification refuses (posted entries balance, so this names ledger
//     corruption).
//
// In every scenario where the reference behaves correctly (all movements
// cash-settled) the classified result equals the reference's derivation
// byte for byte; that is the golden-parity condition.

// NonCashMovement discloses one category's noncash movement over the
// window: the sum of the entry legs no cash leg matched, credit minus
// debit.
type NonCashMovement struct {
	Activity   Activity    `json:"activity"`
	FSCategory string      `json:"fs_category"`
	Amount     money.Money `json:"amount"`
}

// ClassifiedFlows is the entry-level classification result: gross flows per
// activity, the direct-method memo buckets, the financing split the
// statement renders, the noncash disclosures, and the net increase — which
// equals the window's actual cash movement by construction.
type ClassifiedFlows struct {
	OperatingIn   money.Money `json:"operating_in"`
	OperatingOut  money.Money `json:"operating_out"`
	InvestingIn   money.Money `json:"investing_in"`
	InvestingOut  money.Money `json:"investing_out"`
	FinancingIn   money.Money `json:"financing_in"`
	FinancingOut  money.Money `json:"financing_out"`
	MemoCustomers money.Money `json:"memo_customers"`
	MemoSuppliers money.Money `json:"memo_suppliers"`
	MemoTaxes     money.Money `json:"memo_taxes"`
	// Financing rendered as the reference's two lines: the equity-matched
	// amounts (capital contributions / dividends) and the director-loan
	// amounts (owner dealings), inflows positive, outflows negative.
	FinancingEquity   money.Money       `json:"financing_equity"`
	FinancingDirector money.Money       `json:"financing_director"`
	NetIncrease       money.Money       `json:"net_increase"`
	NonCash           []NonCashMovement `json:"non_cash"`
}

// memoGroup assigns a category to one of the reference's three
// direct-method operating memo lines. Categories outside the groups ride
// their activity only.
type memoGroup int

const (
	memoNone memoGroup = iota
	memoCustomers
	memoSuppliers
	memoTaxes
)

func memoGroupOf(fsCategory string) memoGroup {
	switch fsCategory {
	case "REVENUE", "AR":
		return memoCustomers
	case "COGS", "OPEX", "PREPAY_TAX", "AP_ACCRUAL":
		return memoSuppliers
	case "TAX_PAYABLE", "TAX_EXPENSE":
		return memoTaxes
	}
	return memoNone
}

// leg is one entry side available for matching: a noncash credit leg
// explains cash received, a noncash debit leg explains cash paid.
type leg struct {
	fsCategory string
	remaining  money.Money
}

// ClassifyCashFlows classifies the window's entries. chart decides which
// accounts are cash (fs_category CASH) and maps every counterpart category;
// both are BL-13-validated first.
func ClassifyCashFlows(chart []ledger.Account, lines []ledger.Line, start, end string) (*ClassifiedFlows, error) {
	if err := ValidateChartCategories(chart); err != nil {
		return nil, err
	}
	cashCode := make(map[string]bool, len(chart))
	categoryOf := make(map[string]string, len(chart))
	for _, a := range chart {
		if a.FSCategory == "CASH" {
			cashCode[a.AccountCode] = true
		}
		categoryOf[a.AccountCode] = a.FSCategory
	}
	for i := range lines {
		pc := lines[i].PeriodCode
		if _, err := ledger.ValidatePostingDate(lines[i].AccountingDate, &pc); err != nil {
			return nil, err
		}
	}
	// Group the window's lines by entry in first-appearance order.
	var entryOrder []string
	byEntry := map[string][]ledger.Line{}
	for _, l := range lines {
		if l.AccountingDate < start || l.AccountingDate > end {
			continue
		}
		if _, seen := byEntry[l.JournalID]; !seen {
			entryOrder = append(entryOrder, l.JournalID)
		}
		byEntry[l.JournalID] = append(byEntry[l.JournalID], l)
	}
	flows := &ClassifiedFlows{
		OperatingIn: zeroQ4, OperatingOut: zeroQ4,
		InvestingIn: zeroQ4, InvestingOut: zeroQ4,
		FinancingIn: zeroQ4, FinancingOut: zeroQ4,
		MemoCustomers: zeroQ4, MemoSuppliers: zeroQ4, MemoTaxes: zeroQ4,
		FinancingEquity: zeroQ4, FinancingDirector: zeroQ4,
		NonCash: []NonCashMovement{},
	}
	// Noncash disclosures accumulate per category, deterministic order.
	var disclosureOrder []string
	disclosure := map[string]money.Money{}
	disclosureActivity := map[string]Activity{}
	addDisclosure := func(fsCategory string, amount money.Money) error {
		if amount.IsZero() {
			return nil
		}
		if _, seen := disclosure[fsCategory]; !seen {
			disclosureOrder = append(disclosureOrder, fsCategory)
			disclosure[fsCategory] = zeroQ4
			disclosureActivity[fsCategory] = activityOf(fsCategory)
		}
		acc, err := q4(disclosure[fsCategory].Add(amount))
		if err != nil {
			return err
		}
		disclosure[fsCategory] = acc
		return nil
	}
	// addFlow books one matched amount into its activity bucket, the memo
	// buckets, and the financing split.
	addFlow := func(in bool, fsCategory string, amount money.Money) error {
		if amount.IsZero() {
			return nil
		}
		var target *money.Money
		switch activityOf(fsCategory) {
		case ActivityOperating:
			if in {
				target = &flows.OperatingIn
			} else {
				target = &flows.OperatingOut
			}
		case ActivityInvesting:
			if in {
				target = &flows.InvestingIn
			} else {
				target = &flows.InvestingOut
			}
		case ActivityFinancing:
			if in {
				target = &flows.FinancingIn
			} else {
				target = &flows.FinancingOut
			}
		}
		acc, err := q4(target.Add(amount))
		if err != nil {
			return err
		}
		*target = acc
		shown := amount
		if !in {
			shown = amount.Neg()
		}
		switch memoGroupOf(fsCategory) {
		case memoCustomers:
			target = &flows.MemoCustomers
		case memoSuppliers:
			target = &flows.MemoSuppliers
		case memoTaxes:
			target = &flows.MemoTaxes
		default:
			if fsCategory == "EQUITY" {
				target = &flows.FinancingEquity
			} else if fsCategory == "DIRECTOR_LOAN" {
				target = &flows.FinancingDirector
			} else {
				return nil
			}
		}
		if *target, err = q4(target.Add(shown)); err != nil {
			return err
		}
		return nil
	}

	for _, journalID := range entryOrder {
		entryLines := byEntry[journalID]
		cashIn, cashOut := zeroQ4, zeroQ4
		entryDebit, entryCredit := zeroQ4, zeroQ4
		var creditLegs, debitLegs []leg
		for _, l := range entryLines {
			entryDebit = entryDebit.Add(l.FuncDebit)
			entryCredit = entryCredit.Add(l.FuncCredit)
			if cashCode[l.AccountCode] {
				if !l.FuncDebit.IsZero() {
					cashIn = cashIn.Add(l.FuncDebit)
				}
				if !l.FuncCredit.IsZero() {
					cashOut = cashOut.Add(l.FuncCredit)
				}
				continue
			}
			fsCategory := categoryOf[l.AccountCode]
			if !l.FuncCredit.IsZero() {
				creditLegs = append(creditLegs, leg{fsCategory: fsCategory, remaining: l.FuncCredit})
			}
			if !l.FuncDebit.IsZero() {
				debitLegs = append(debitLegs, leg{fsCategory: fsCategory, remaining: l.FuncDebit})
			}
		}
		// A posted entry balances; the classification refuses anything else
		// instead of allocating a broken entry's cash.
		if !entryDebit.Equal(entryCredit) {
			return nil, fail(ErrCashEntryUnbalanced,
				fmt.Sprintf("CASHFLOW_ENTRY_UNBALANCED: 分錄 %s 借 %s 不等於貸 %s。已過賬分錄借貸必平；此分錄不可分類。",
					journalID, entryDebit.String(), entryCredit.String()))
		}
		// Match the actual cash legs against the counterpart legs in line
		// order (BL-18: only the cash amounts are flows, never the gross of
		// the other side).
		match := func(cash *money.Money, legs []leg, in bool) error {
			for i := range legs {
				if cash.IsZero() {
					break
				}
				if legs[i].remaining.IsZero() {
					continue
				}
				take := legs[i].remaining
				if take.Cmp(*cash) > 0 {
					take = *cash
				}
				if err := addFlow(in, legs[i].fsCategory, take); err != nil {
					return err
				}
				legs[i].remaining = legs[i].remaining.Sub(take)
				*cash = cash.Sub(take)
			}
			return nil
		}
		if err := match(&cashIn, creditLegs, true); err != nil {
			return nil, err
		}
		if err := match(&cashOut, debitLegs, false); err != nil {
			return nil, err
		}
		// Leftover cash on both sides is a transfer between own cash
		// accounts; a residual imbalance is a broken entry, refused.
		if !cashIn.Equal(cashOut) {
			return nil, fail(ErrCashEntryUnbalanced,
				fmt.Sprintf("CASHFLOW_ENTRY_UNBALANCED: 分錄 %s 的現金腿與非現金腿無法對平（未配對現金收 %s、付 %s）。已過賬分錄借貸必平；此分錄不可分類。",
					journalID, cashIn.String(), cashOut.String()))
		}
		// Whatever no cash leg matched is a noncash movement (BL-12).
		for _, l := range creditLegs {
			if err := addDisclosure(l.fsCategory, l.remaining); err != nil {
				return nil, err
			}
		}
		for _, l := range debitLegs {
			if err := addDisclosure(l.fsCategory, l.remaining.Neg()); err != nil {
				return nil, err
			}
		}
	}
	for _, cat := range disclosureOrder {
		flows.NonCash = append(flows.NonCash, NonCashMovement{
			Activity:   disclosureActivity[cat],
			FSCategory: cat,
			Amount:     disclosure[cat],
		})
	}
	// Deterministic disclosure order (category name), independent of the
	// entries' appearance order.
	sort.SliceStable(flows.NonCash, func(i, j int) bool {
		return flows.NonCash[i].FSCategory < flows.NonCash[j].FSCategory
	})
	flows.NetIncrease = flows.OperatingIn.Sub(flows.OperatingOut).
		Add(flows.InvestingIn).Sub(flows.InvestingOut).
		Add(flows.FinancingIn).Sub(flows.FinancingOut)
	buckets := []*money.Money{
		&flows.OperatingIn, &flows.OperatingOut,
		&flows.InvestingIn, &flows.InvestingOut,
		&flows.FinancingIn, &flows.FinancingOut,
		&flows.MemoCustomers, &flows.MemoSuppliers, &flows.MemoTaxes,
		&flows.FinancingEquity, &flows.FinancingDirector,
		&flows.NetIncrease,
	}
	for _, b := range buckets {
		v, err := q4(*b)
		if err != nil {
			return nil, err
		}
		*b = v
	}
	return flows, nil
}

// CFLine is one cash-flow statement line.
type CFLine struct {
	StatementRef string      `json:"statement_ref"`
	Label        string      `json:"label"`
	Amount       money.Money `json:"amount"`
}

// CashFlowStatementReport is statement 3 (現金流量表) in the reference's
// dual-track shape: the indirect operating section (the window's movements),
// the direct-method memo (classified cash legs), the classified activity
// nets, and the cash tie-out. The activity nets come from the
// classification, so noncash movements never create flows.
type CashFlowStatementReport struct {
	StatementCode                  string      `json:"statement_code"` // "CF"
	Period                         string      `json:"period"`
	Currency                       string      `json:"currency"`
	IndirectMethodOperating        []CFLine    `json:"indirect_method_operating"`
	DirectMethodOperatingMemo      []CFLine    `json:"direct_method_operating_memo"`
	NetCashFromOperatingActivities money.Money `json:"net_cash_from_operating_activities"`
	InvestingActivities            []CFLine    `json:"investing_activities"`
	NetCashFromInvestingActivities money.Money `json:"net_cash_from_investing_activities"`
	FinancingActivities            []CFLine    `json:"financing_activities"`
	NetCashFromFinancingActivities money.Money `json:"net_cash_from_financing_activities"`
	NetIncreaseInCash              money.Money `json:"net_increase_in_cash"`
	OpeningCashBalance             money.Money `json:"opening_cash_balance"`
	EndingCashBalance              money.Money `json:"ending_cash_balance"`
}

// CashFlowStatement compiles statement 3 over the window: the window rows
// feed the indirect memo and the cash anchors, the classification feeds the
// nets and the direct memo. The ending balance ties to the balance sheet's
// cash by construction (the classified net is the actual cash movement).
func CashFlowStatement(chart []ledger.Account, lines []ledger.Line, start, end, period, currency string) (*CashFlowStatementReport, error) {
	rows, err := WindowRows(chart, lines, start, end)
	if err != nil {
		return nil, err
	}
	f, err := DeriveFigures(rows)
	if err != nil {
		return nil, err
	}
	flows, err := ClassifyCashFlows(chart, lines, start, end)
	if err != nil {
		return nil, err
	}
	// The indirect operating section, the reference's movement-basis lines:
	// the window's profit and depreciation, then the working-capital
	// movements (BL-14: every statement now reads the same anchored window).
	indirect := []CFLine{
		{StatementRef: "PL", Label: "Net Profit for the Period (本期淨利)", Amount: f.WindowNetProfit},
		{StatementRef: "FA", Label: "Add back: Depreciation & Amortization (加：折舊及攤銷)", Amount: f.TotalDep},
		{StatementRef: "AR", Label: "Increase / Decrease in Accounts Receivable (應收賬款變動)", Amount: negDisplay(f.DeltaAR)},
		{StatementRef: "PREPAY", Label: "Increase / Decrease in Prepayments & Input Tax (預付及留抵稅額變動)", Amount: negDisplay(f.DeltaPrepay)},
		{StatementRef: "AP", Label: "Increase / Decrease in Payables & Accruals (應付及應計費用變動)", Amount: f.DeltaAP},
		{StatementRef: "TAX", Label: "Increase / Decrease in Statutory Taxes Payable (應交稅費變動)", Amount: f.DeltaTax},
	}
	memo := []CFLine{
		{StatementRef: "AR", Label: "Cash Received from Customers (銷售商品、提供勞務收到的現金)", Amount: flows.MemoCustomers},
		{StatementRef: "AP", Label: "Cash Paid to Suppliers & Employees (購買商品、接受勞務及營運支付的現金)", Amount: flows.MemoSuppliers},
		{StatementRef: "TAX", Label: "Cash Paid for Taxes & Levies (支付的各項稅費)", Amount: flows.MemoTaxes},
	}
	opNet, err := q4(flows.OperatingIn.Sub(flows.OperatingOut))
	if err != nil {
		return nil, err
	}
	invNet, err := q4(flows.InvestingIn.Sub(flows.InvestingOut))
	if err != nil {
		return nil, err
	}
	finNet, err := q4(flows.FinancingIn.Sub(flows.FinancingOut))
	if err != nil {
		return nil, err
	}
	net, err := q4(opNet.Add(invNet).Add(finNet))
	if err != nil {
		return nil, err
	}
	ending, err := q4(f.OpeningCash.Add(net))
	if err != nil {
		return nil, err
	}
	investing := []CFLine{
		{StatementRef: "FA", Label: "Payments for Property, Plant & Equipment (購建固定資產支付的現金)", Amount: invNet},
	}
	financing := []CFLine{
		{StatementRef: "EQ", Label: "Capital Contributions / Dividends (吸收投資或分配股利)", Amount: flows.FinancingEquity},
		{StatementRef: "DIRECTOR", Label: "Net Director's Loan / Owner Drawings Movement (股東/業主往來資金變動)", Amount: flows.FinancingDirector},
	}
	return &CashFlowStatementReport{
		StatementCode:                  "CF",
		Period:                         period,
		Currency:                       currency,
		IndirectMethodOperating:        indirect,
		DirectMethodOperatingMemo:      memo,
		NetCashFromOperatingActivities: opNet,
		InvestingActivities:            investing,
		NetCashFromInvestingActivities: invNet,
		FinancingActivities:            financing,
		NetCashFromFinancingActivities: finNet,
		NetIncreaseInCash:              net,
		OpeningCashBalance:             f.OpeningCash,
		EndingCashBalance:              ending,
	}, nil
}
