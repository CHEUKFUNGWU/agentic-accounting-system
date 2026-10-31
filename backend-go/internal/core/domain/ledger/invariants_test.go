package ledger

import (
	"errors"
	"testing"
)

// Invariant tests: the engineering-workflow §3 essence the ledger package
// carries, with expected values from the frozen Python reference (the same
// seed the golden fixtures record — fixtures/ledger/balances_2026_10.json and
// close_ok_2026_12.json hold the reference's outputs for these numbers).

// invariantsChart is the DEMO chart the fixtures use (the fields the pure
// rules read).
func invariantsChart() []Account {
	a := func(code, name, kind, normal, fs string) Account {
		return Account{
			AccountID: "DEMO:" + code, AccountCode: code, AccountName: name,
			AccountType: kind, NormalBalance: normal, FSCategory: fs,
			StatementRef: "TB", CashFlowActivity: "OPERATING_WC", IsActive: true,
		}
	}
	return []Account{
		a("1000", "銀行存款", "ASSET", "DEBIT", "CASH"),
		a("1210", "應收帳款", "ASSET", "DEBIT", "AR"),
		a("1490", "存貨", "ASSET", "DEBIT", "INVENTORY"),
		a("1650", "累計折舊", "ASSET", "CREDIT", "CONTRA_ASSET"),
		a("2190", "業主往來", "LIABILITY", "CREDIT", "DIRECTOR_LOAN"),
		a("3100", "實收資本及期初留存", "EQUITY", "CREDIT", "EQUITY"),
		a("4100", "主營業務收入", "REVENUE", "CREDIT", "REVENUE"),
		a("5100", "主營業務成本", "EXPENSE", "DEBIT", "COGS"),
		a("6100", "管理及營運費用", "EXPENSE", "DEBIT", "OPEX"),
	}
}

// invariantsLines mirrors the generator's demo_lines() seed line for line:
// the same balanced entries, amounts, dates, periods and layers. The golden
// fixtures record the reference's outputs for exactly this seed.
func invariantsLines() []Line {
	l := func(id, journal, code, period, layer, day, dr, cr string) Line {
		return Line{
			LineID: id, JournalID: journal, EntityCode: "DEMO", LineNumber: 1,
			AccountCode: code, PeriodCode: period, EntryLayer: layer,
			AccountingDate: day,
			TxDebit:        mustParse(dr), FuncDebit: mustParse(dr),
			TxCredit: mustParse(cr), FuncCredit: mustParse(cr),
		}
	}
	return []Line{
		// Prior fiscal year (BL-14 background): December 2025 revenue 100.
		l("L001", "J1", "1000", "2025-12", "OPERATIONAL", "2025-12-05", "100.0000", "0.0000"),
		l("L002", "J1", "4100", "2025-12", "OPERATIONAL", "2025-12-05", "0.0000", "100.0000"),
		// Opening capital, September 2026.
		l("L003", "J2", "1000", "2026-09", "OPENING", "2026-09-10", "5000.0000", "0.0000"),
		l("L004", "J2", "3100", "2026-09", "OPENING", "2026-09-10", "0.0000", "5000.0000"),
		// October sales.
		l("L005", "J3", "1000", "2026-10", "OPERATIONAL", "2026-10-05", "300.0000", "0.0000"),
		l("L006", "J3", "4100", "2026-10", "OPERATIONAL", "2026-10-05", "0.0000", "300.0000"),
		// October accrual (adjustment layer).
		l("L007", "J4", "6100", "2026-10", "AJE_MONTH_END", "2026-10-20", "45.2500", "0.0000"),
		l("L008", "J4", "2190", "2026-10", "AJE_MONTH_END", "2026-10-20", "0.0000", "45.2500"),
		// October reclass (adjustment layer) into inventory.
		l("L009", "J5", "1490", "2026-10", "RJE_RECLASS", "2026-10-31", "12.5000", "0.0000"),
		l("L010", "J5", "1000", "2026-10", "RJE_RECLASS", "2026-10-31", "0.0000", "12.5000"),
		// November cost of sales.
		l("L011", "J6", "5100", "2026-11", "OPERATIONAL", "2026-11-15", "80.0000", "0.0000"),
		l("L012", "J6", "1000", "2026-11", "OPERATIONAL", "2026-11-15", "0.0000", "80.0000"),
		// December credit sale.
		l("L013", "J7", "1210", "2026-12", "OPERATIONAL", "2026-12-10", "250.0000", "0.0000"),
		l("L014", "J7", "4100", "2026-12", "OPERATIONAL", "2026-12-10", "0.0000", "250.0000"),
		// January 2027 revenue 20 (the BL-14 "January 2027" figure).
		l("L015", "J8", "4100", "2027-01", "OPERATIONAL", "2027-01-10", "0.0000", "20.0000"),
		l("L016", "J8", "1000", "2027-01", "OPERATIONAL", "2027-01-10", "20.0000", "0.0000"),
		// October expense carrying a counterparty dimension.
		l("L017", "J9", "6100", "2026-10", "OPERATIONAL", "2026-10-12", "60.0000", "0.0000"),
		l("L018", "J9", "1000", "2026-10", "OPERATIONAL", "2026-10-12", "0.0000", "60.0000"),
	}
}

func extraLine(id, journal, code, period, layer, day, dr, cr string) Line {
	return Line{
		LineID: id, JournalID: journal, EntityCode: "DEMO", LineNumber: 2,
		AccountCode: code, PeriodCode: period, EntryLayer: layer,
		AccountingDate: day,
		TxDebit:        mustParse(dr), FuncDebit: mustParse(dr),
		TxCredit: mustParse(cr), FuncCredit: mustParse(cr),
	}
}

// TestBalancesExactDecimalDebitsEqualCredits pins the ledger-wide invariant:
// total debits equal total credits in exact decimal money, entity-wide and
// for the period, with the reference-recorded amounts (fixtures/ledger/
// tb_check_balanced.json: 5867.7500 on each side, period 417.7500).
func TestBalancesExactDecimalDebitsEqualCredits(t *testing.T) {
	check, err := AssertTrialBalance("DEMO", "2026-10", invariantsLines())
	if err != nil {
		t.Fatal(err)
	}
	if !check.LedgerBalanced || !check.PeriodBalanced {
		t.Fatalf("ledger_balanced=%v period_balanced=%v, want both true", check.LedgerBalanced, check.PeriodBalanced)
	}
	if check.LedgerDebit != "5867.7500" || check.LedgerCredit != "5867.7500" || check.LedgerDifference != "0.0000" {
		t.Errorf("ledger totals = %s/%s/%s, want 5867.7500/5867.7500/0.0000 (reference)",
			check.LedgerDebit, check.LedgerCredit, check.LedgerDifference)
	}
	if check.PeriodDebit != "417.7500" || check.PeriodCredit != "417.7500" || check.PeriodDifference != "0.0000" {
		t.Errorf("period totals = %s/%s/%s, want 417.7500/417.7500/0.0000 (reference)",
			check.PeriodDebit, check.PeriodCredit, check.PeriodDifference)
	}
	// An unbalanced ledger is reported, not hidden (the close gate refuses on
	// exactly this flag).
	unbalanced := append(invariantsLines(),
		extraLine("LU", "JU", "5100", "2026-10", "OPERATIONAL", "2026-10-28", "999.9900", "0.0000"))
	check, err = AssertTrialBalance("DEMO", "2026-10", unbalanced)
	if err != nil {
		t.Fatal(err)
	}
	if check.LedgerBalanced || check.LedgerDifference != "999.9900" {
		t.Errorf("unbalanced check = %v/%s, want false/999.9900", check.LedgerBalanced, check.LedgerDifference)
	}
}

// TestPeriodLockRejectsPostingInLockedPeriod pins the period-lock invariant
// at the pure-function level, with the BL-04 remediation's overlap matrix:
// a date inside any locked overlapping period rejects; an open month inside a
// locked quarter rejects; an undated period check conservatively rejects any
// overlapping lock.
func TestPeriodLockRejectsPostingInLockedPeriod(t *testing.T) {
	p := func(code, start, end, status string) Period {
		return Period{PeriodID: "DEMO:" + code, EntityCode: "DEMO", PeriodCode: code,
			StartDate: start, EndDate: end, Status: status}
	}
	lockedNov := p("2026-11", "2026-11-01", "2026-11-30", "LOCKED")
	lockedQ3 := p("2026-Q3", "2026-07-01", "2026-09-30", "LOCKED")
	openSep := p("2026-09", "2026-09-01", "2026-09-30", "OPEN")
	openQ4 := p("2026-Q4", "2026-10-01", "2026-12-31", "OPEN")

	cases := []struct {
		name    string
		periods []Period
		code    string
		date    string
		wantErr error
	}{
		{"locked month refuses", []Period{lockedNov}, "2026-11", "2026-11-20", ErrPeriodLocked},
		{"locked month refuses through open quarter label", []Period{lockedNov, openQ4}, "2026-Q4", "2026-11-20", ErrPeriodLocked},
		{"open month refuses inside locked quarter", []Period{openSep, lockedQ3}, "2026-09", "2026-09-15", ErrPeriodLocked},
		{"undated check conservatively refuses overlapping lock", []Period{lockedNov}, "2026-Q4", "", ErrPeriodLocked},
		{"future blocks writes", []Period{p("2027-01", "2027-01-01", "2027-01-31", "FUTURE")}, "2027-01", "2027-01-10", ErrPeriodLocked},
	}
	for _, tc := range cases {
		var date *string
		if tc.date != "" {
			date = &tc.date
		}
		_, err := AssertWritable("DEMO", tc.code, date, tc.periods)
		if !errors.Is(err, tc.wantErr) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.wantErr)
		}
	}

	// The remediation's positive case: an open October date stays writable
	// when only November is locked, even under a Q4 label.
	oct := "2026-10-05"
	period, err := AssertWritable("DEMO", "2026-Q4", &oct, []Period{lockedNov, openQ4})
	if err != nil {
		t.Errorf("open October under Q4 label with only November locked must pass: %v", err)
	} else if period.PeriodCode != "2026-Q4" {
		t.Errorf("returned period = %q, want 2026-Q4", period.PeriodCode)
	}

	// Soft-close still accepts postings; hard-close does not.
	softClose := p("2026-10", "2026-10-01", "2026-10-31", "SOFT_CLOSE")
	if _, err := AssertWritable("DEMO", "2026-10", &oct, []Period{softClose}); err != nil {
		t.Errorf("SOFT_CLOSE must stay writable: %v", err)
	}
	softClose.Status = "HARD_CLOSE"
	if _, err := AssertWritable("DEMO", "2026-10", &oct, []Period{softClose}); !errors.Is(err, ErrPeriodLocked) {
		t.Errorf("HARD_CLOSE must refuse: %v", err)
	}
}

// TestAccountingDateNotOverriddenByPeriodLabel pins the document-date versus
// accounting-date separation the invariant list requires: a September date
// labeled November is rejected before any financial effect, even when the
// November period itself is open — the original BL-04 cutoff attack.
func TestAccountingDateNotOverriddenByPeriodLabel(t *testing.T) {
	_, err := ValidatePostingDate("2026-09-15", strPtr("2026-11"))
	if !errors.Is(err, ErrPeriodDateMismatch) {
		t.Fatalf("err = %v, want ErrPeriodDateMismatch", err)
	}
	// The date is never rewritten to fit the label; an absent period derives
	// from the validated date's month.
	period, err := ValidatePostingDate("2026-07-15", nil)
	if err != nil || period != "2026-07" {
		t.Errorf("absent period derivation = %q, %v; want 2026-07, nil", period, err)
	}
	// An explicitly empty period is rejected, never silently derived.
	if _, err := ValidatePostingDate("2026-07-15", strPtr("")); !errors.Is(err, ErrInvalidPeriod) {
		t.Errorf("empty period = %v, want ErrInvalidPeriod", err)
	}
}

// TestMalformedLegacyRecordRejectedNotOmitted pins the reporting-derivation
// rule from the BL-04 remediation: malformed legacy date/period records are
// refused without repairing or silently omitting them.
func TestMalformedLegacyRecordRejectedNotOmitted(t *testing.T) {
	lines := append(invariantsLines(),
		extraLine("LM", "JM", "1000", "2026-10", "OPERATIONAL", "2026-02-30", "10.0000", "0.0000"))
	if _, err := DeriveBalances(invariantsChart(), lines, "DEMO", "2026-10"); !errors.Is(err, ErrInvalidAccountingDate) {
		t.Errorf("DeriveBalances = %v, want ErrInvalidAccountingDate", err)
	}
	mislabeled := append(invariantsLines(),
		extraLine("LM2", "JM2", "1000", "2026-11", "OPERATIONAL", "2026-10-05", "10.0000", "0.0000"))
	if _, err := DeriveBalances(invariantsChart(), mislabeled, "DEMO", "2026-10"); !errors.Is(err, ErrPeriodDateMismatch) {
		t.Errorf("DeriveBalances mislabeled = %v, want ErrPeriodDateMismatch", err)
	}
	if _, err := DeriveBalances(invariantsChart(), invariantsLines(), "DEMO", "2026"); !errors.Is(err, ErrInvalidPeriod) {
		t.Errorf("DeriveBalances annual period = %v, want ErrInvalidPeriod", err)
	}
}

// TestCarryForwardOpeningsAreThePrecedingLines pins carry-forward
// correctness: the next period's opening is the sum of every line dated
// before it (reference values from fixtures/ledger/close_ok_2026_12.json),
// and a balanced book carries forward a grand total of exactly zero.
// Zero-opening accounts produce no carried row.
func TestCarryForwardOpeningsAreThePrecedingLines(t *testing.T) {
	periods := []Period{
		{PeriodID: "DEMO:2026-12", EntityCode: "DEMO", PeriodCode: "2026-12",
			FiscalYear: 2026, PeriodNumber: 12, StartDate: "2026-12-01", EndDate: "2026-12-31", Status: "OPEN"},
	}
	result, err := ClosePeriod("DEMO", "2026-12", "finance-manager-01", periods, nil, invariantsChart(), invariantsLines())
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "LOCKED" || result.NextPeriod != "2027-01" {
		t.Errorf("status/next = %s/%s, want LOCKED/2027-01", result.Status, result.NextPeriod)
	}
	byCode := map[string]string{}
	for _, row := range result.CarriedForward {
		byCode[row.AccountCode] = row.Opening.String()
	}
	// Reference values (close_ok_2026_12.json). 1650 has a zero opening and
	// is therefore absent.
	want := map[string]string{
		"1000": "5247.5000", // 100 + 5000 + 300 - 12.5 - 80 - 60
		"1210": "250.0000",
		"1490": "12.5000",
		"2190": "-45.2500",
		"3100": "-5000.0000",
		"4100": "-650.0000", // -(100 + 300 + 250)
		"5100": "80.0000",
		"6100": "105.2500", // 45.25 + 60
	}
	for code, opening := range want {
		if byCode[code] != opening {
			t.Errorf("carried %s = %q, want %q", code, byCode[code], opening)
		}
	}
	if len(result.CarriedForward) != len(want) {
		t.Errorf("carried rows = %d, want %d (zero openings carry no row)", len(result.CarriedForward), len(want))
	}
	if result.CarriedForwardTotal.String() != "0.0000" {
		t.Errorf("carried total = %s, want 0.0000 (balanced books carry zero)", result.CarriedForwardTotal.String())
	}
	// Refusals in the reference's order: already locked, then unposted
	// vouchers, then the balance gate.
	periods = append(periods, Period{PeriodID: "DEMO:2026-11", PeriodCode: "2026-11",
		StartDate: "2026-11-01", EndDate: "2026-11-30", Status: "LOCKED"})
	if _, err := ClosePeriod("DEMO", "2026-11", "x", periods, nil, invariantsChart(), invariantsLines()); !errors.Is(err, ErrPeriodAlreadyLocked) {
		t.Errorf("closing a LOCKED period = %v, want ErrPeriodAlreadyLocked", err)
	}
	dec := "2026-12-20"
	journals := []JournalRef{{
		JournalID: "JD", VoucherNo: "V-9", Status: "DRAFT", AccountingDate: dec,
		Period: strPtr("2026-12"),
	}}
	if _, err := ClosePeriod("DEMO", "2026-12", "x", periods, journals, invariantsChart(), invariantsLines()); !errors.Is(err, ErrPeriodHasUnpostedVouchers) {
		t.Errorf("closing over an unposted voucher = %v, want ErrPeriodHasUnpostedVouchers", err)
	}
	broken := append(invariantsLines(),
		extraLine("LB", "JB", "5100", "2026-12", "OPERATIONAL", "2026-12-28", "1.0000", "0.0000"))
	if _, err := ClosePeriod("DEMO", "2026-12", "x", periods, nil, invariantsChart(), broken); !errors.Is(err, ErrTrialBalanceBroken) {
		t.Errorf("closing an unbalanced ledger = %v, want ErrTrialBalanceBroken", err)
	}
}

// TestContraAccountQuirksPinned pins the reference's closing-side behaviour
// the golden fixtures recorded: the non-negative closing_side branch reads
// DEBIT for every account (the nature test in the reference is dead code),
// and display_balance normalizes a zero to positive.
func TestContraAccountQuirksPinned(t *testing.T) {
	b := AccountBalance{
		AccountCode: "1650",
		OpDebit:     mustParse("0.0000"), OpCredit: mustParse("0.0000"),
		AjDebit: mustParse("0.0000"), AjCredit: mustParse("0.0000"), DebitNature: false,
	}
	side, err := b.ClosingSide()
	if err != nil || side != "DEBIT" {
		t.Errorf("zero closing_side = %q, %v; want DEBIT (reference quirk, ported verbatim)", side, err)
	}
	display, err := b.DisplayBalance()
	if err != nil || display.String() != "0.0000" {
		t.Errorf("zero display_balance = %q, %v; want 0.0000 (decimal minus normalizes zero)", display.String(), err)
	}
	// A credit-nature account with a credit closing reads positive on display.
	b.AjCredit = mustParse("100.0000")
	display, err = b.DisplayBalance()
	if err != nil || display.String() != "100.0000" {
		t.Errorf("credit display_balance = %q, %v; want 100.0000", display.String(), err)
	}
}
