package reporting

import (
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// BL-17 regression: the account-ledger projection preserves original and
// reversing amounts in their respective periods.
//
// Audit scenario (vouchers.py:262-264, mcp_roles.py:348-354, 895-900): the
// MCP account ledger filtered journals to status == "POSTED"; a reversal
// flips the ORIGINAL voucher to REVERSED while the reversing voucher posts,
// so an original cash debit 100 plus its reversal credit 100 reported -100
// instead of zero. Required: preserve original and reversing amounts in
// their respective periods.

// bl17Journals seeds the defect's pair: the original (now REVERSED) posted
// a cash debit 100 on 2026-10-05; the reversing voucher (POSTED) credited
// cash 100 on 2026-11-05.
func bl17Journals() []ProjectedJournal {
	orig := []ledger.Line{
		tline("V1", 1, "1000", "OPERATIONAL", "2026-10-05", "100.0000", "0.0000"),
		tline("V1", 2, "4100", "OPERATIONAL", "2026-10-05", "0.0000", "100.0000"),
	}
	rev := []ledger.Line{
		tline("V2", 1, "4100", "OPERATIONAL", "2026-11-05", "100.0000", "0.0000"),
		tline("V2", 2, "1000", "OPERATIONAL", "2026-11-05", "0.0000", "100.0000"),
	}
	return []ProjectedJournal{
		{JournalID: "V1", VoucherNo: "V-0001", Status: "REVERSED", AccountingDate: "2026-10-05", Lines: orig},
		{JournalID: "V2", VoucherNo: "V-0002", Status: "POSTED", AccountingDate: "2026-11-05", Lines: rev},
	}
}

// TestBL17_reversal_preserves_both_amounts pins the corrected outcome over
// the window covering both periods: the projection shows the original debit
// (REVERSED) and the reversal credit (POSTED), totals 100/100, and the
// running balance nets to exactly zero — not the defect's -100.
func TestBL17_reversal_preserves_both_amounts(t *testing.T) {
	report, err := ProjectAccountLedger(baseChart(), bl17Journals(), "1000", "2026-10-01", "2026-11-30")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Movements) != 2 {
		t.Fatalf("movements = %d, want 2 (original AND reversal)", len(report.Movements))
	}
	first, second := report.Movements[0], report.Movements[1]
	if first.Debit.String() != "100.0000" || first.Status != "REVERSED" {
		t.Errorf("first movement = %s dr / %s, want 100.0000 dr / REVERSED (the original stays in its period)",
			first.Debit.String(), first.Status)
	}
	if second.Credit.String() != "100.0000" || second.Status != "POSTED" {
		t.Errorf("second movement = %s cr / %s, want 100.0000 cr / POSTED",
			second.Credit.String(), second.Status)
	}
	if first.Date != "2026-10-05" || second.Date != "2026-11-05" {
		t.Errorf("movements must sit in their own periods, got %s and %s", first.Date, second.Date)
	}
	if report.TotalDebit.String() != "100.0000" || report.TotalCredit.String() != "100.0000" {
		t.Errorf("totals = %s/%s, want 100.0000/100.0000", report.TotalDebit.String(), report.TotalCredit.String())
	}
	if report.OpeningBalance.String() != "0.0000" || report.ClosingBalance.String() != "0.0000" {
		t.Errorf("opening/closing = %s/%s, want 0.0000/0.0000 (the defect reported -100)",
			report.OpeningBalance.String(), report.ClosingBalance.String())
	}
	if first.Balance.String() != "100.0000" || second.Balance.String() != "0.0000" {
		t.Errorf("running balances = %s then %s, want 100.0000 then 0.0000", first.Balance.String(), second.Balance.String())
	}
}

// TestBL17_original_survives_in_its_own_period pins the "respective
// periods" half: a window over October alone still shows the original's
// debit — the reversal lives in November and cannot retroactively erase it.
func TestBL17_original_survives_in_its_own_period(t *testing.T) {
	october, err := ProjectAccountLedger(baseChart(), bl17Journals(), "1000", "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	if len(october.Movements) != 1 || october.Movements[0].Debit.String() != "100.0000" {
		t.Fatalf("october movements = %+v, want the original's 100.0000 debit", october.Movements)
	}
	if october.ClosingBalance.String() != "100.0000" {
		t.Errorf("october closing = %s, want 100.0000", october.ClosingBalance.String())
	}
	november, err := ProjectAccountLedger(baseChart(), bl17Journals(), "1000", "2026-11-01", "2026-11-30")
	if err != nil {
		t.Fatal(err)
	}
	if len(november.Movements) != 1 || november.Movements[0].Credit.String() != "100.0000" {
		t.Fatalf("november movements = %+v, want the reversal's 100.0000 credit", november.Movements)
	}
	// November's opening carries October's original forward: 100 - 100 = 0.
	if november.OpeningBalance.String() != "100.0000" || november.ClosingBalance.String() != "0.0000" {
		t.Errorf("november opening/closing = %s/%s, want 100.0000/0.0000",
			november.OpeningBalance.String(), november.ClosingBalance.String())
	}
}

// TestBL17_unposted_journals_stay_out pins the other side of the inclusion
// rule: drafts and pending reviews are not ledger facts and contribute
// nothing; only POSTED and REVERSED originals do.
func TestBL17_unposted_journals_stay_out(t *testing.T) {
	journals := append(bl17Journals(), ProjectedJournal{
		JournalID: "V3", VoucherNo: "V-0003", Status: "PENDING_CHECKER",
		AccountingDate: "2026-10-20",
		Lines: []ledger.Line{
			tline("V3", 1, "1000", "OPERATIONAL", "2026-10-20", "77.0000", "0.0000"),
			tline("V3", 2, "4100", "OPERATIONAL", "2026-10-20", "0.0000", "77.0000"),
		},
	})
	report, err := ProjectAccountLedger(baseChart(), journals, "1000", "2026-10-01", "2026-11-30")
	if err != nil {
		t.Fatal(err)
	}
	if report.ClosingBalance.String() != "0.0000" || len(report.Movements) != 2 {
		t.Errorf("pending journals must stay out: movements = %d, closing = %s",
			len(report.Movements), report.ClosingBalance.String())
	}
	if _, err := ProjectAccountLedger(baseChart(), nil, "9999", "2026-10-01", "2026-10-31"); err == nil {
		t.Error("an account off the chart must be refused")
	}
}
