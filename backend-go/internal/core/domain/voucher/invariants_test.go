package voucher

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Invariant tests: engineering-workflow §3 and the control matrix are never
// divergence-eligible, so these hold regardless of the golden fixtures.
// Expected values come from the frozen Python reference or the recorded
// owner decisions (SRC-0017, SRC-0027), never from the Go port itself.

func requireKind(t *testing.T, err error, kind string) {
	t.Helper()
	if err == nil {
		t.Fatalf("want error kind %s, got success", kind)
	}
	got := ""
	var ve *VoucherError
	var pe *PostingError
	var ne *NumberError
	switch {
	case errors.As(err, &ve):
		got = ve.Kind
	case errors.As(err, &pe):
		got = pe.Kind
	case errors.As(err, &ne):
		got = ne.Kind
	}
	if got != kind {
		t.Fatalf("want error kind %s, got %s (%v)", kind, got, err)
	}
}

// netAmounts sums a line set's debits and credits in one layer.
func netAmounts(lines []LedgerLine, debitField, creditField func(LedgerLine) string) (money.Money, money.Money) {
	dr, cr := money.Money{}, money.Money{}
	for _, l := range lines {
		dr = dr.Add(mustParse(debitField(l)))
		cr = cr.Add(mustParse(creditField(l)))
	}
	return dr, cr
}

// TestReversalLinesNetToZero is the BL-03 remediation invariant in its
// worked form (07-reviews/2026-10-21-business-logic-audit.md, BL-03: the
// repair's FX tests assert that both transaction and functional amounts net
// to zero; the reference build_reversal_lines implements the mirror).
func TestReversalLinesNetToZero(t *testing.T) {
	sameCurrency := Voucher{
		JournalID: "j-orig", EntityCode: "ACME", Status: StatusPosted,
		VoucherNo: strPtr("記-2026-10-0001"), EntryLayer: "OPERATIONAL",
	}
	rows := []LedgerLine{
		{LineID: "l-1", JournalID: "j-orig", EntityCode: "ACME", LineNumber: 1,
			AccountID: "acc-6100", AccountCode: "6100", EntryLayer: "OPERATIONAL",
			TxCurrency: "HKD", ExchangeRate: "1.00000000",
			TxDebit: "100.0000", TxCredit: "0.0000", FuncDebit: "100.0000", FuncCredit: "0.0000",
			FuncTaxAmount: "0.0000", BusinessUsePct: "1.0000"},
		{LineID: "l-2", JournalID: "j-orig", EntityCode: "ACME", LineNumber: 2,
			AccountID: "acc-2110", AccountCode: "2110", EntryLayer: "OPERATIONAL",
			TxCurrency: "HKD", ExchangeRate: "1.00000000",
			TxDebit: "0.0000", TxCredit: "100.0000", FuncDebit: "0.0000", FuncCredit: "100.0000",
			FuncTaxAmount: "0.0000", BusinessUsePct: "1.0000"},
	}
	reversal, err := BuildReversalLines(sameCurrency, rows, "")
	if err != nil {
		t.Fatalf("build reversal: %v", err)
	}
	txDr, txCr := netAmounts(rows, func(l LedgerLine) string { return l.TxDebit },
		func(l LedgerLine) string { return l.TxCredit })
	revTxDr, revTxCr := money.Money{}, money.Money{}
	for _, l := range reversal {
		revTxDr = revTxDr.Add(mustParse(l.Debit))
		revTxCr = revTxCr.Add(mustParse(l.Credit))
	}
	// The reversal mirrors the original side for side: the original's debits
	// become the reversal's credits and vice versa, so the pair nets to zero.
	if !txDr.Equal(revTxCr) || !txCr.Equal(revTxDr) {
		t.Fatalf("transaction layer does not mirror: original Dr %s Cr %s, reversal Dr %s Cr %s",
			txDr, txCr, revTxDr, revTxCr)
	}
	if !revTxDr.Equal(revTxCr) {
		t.Fatalf("reversal itself unbalanced: Dr %s Cr %s", revTxDr, revTxCr)
	}
	// The mirror check accepts the persisted pair in its reference form.
	revRows := mirrorRows(rows)
	if err := ValidateReversalMirror(rows, revRows); err != nil {
		t.Fatalf("mirror check refused the exact mirror: %v", err)
	}

	// FX worked example: 100 USD at 7.8 → 780 HKD functional; both layers
	// must net to zero against the reversal.
	fxRows := []LedgerLine{
		{LineID: "l-fx-1", JournalID: "j-orig", EntityCode: "ACME", LineNumber: 1,
			AccountID: "acc-6100", AccountCode: "6100", EntryLayer: "OPERATIONAL",
			TxCurrency: "USD", ExchangeRate: "7.80000000",
			TxDebit: "100.0000", TxCredit: "0.0000", FuncDebit: "780.0000", FuncCredit: "0.0000",
			FuncTaxAmount: "0.0000", BusinessUsePct: "1.0000"},
		{LineID: "l-fx-2", JournalID: "j-orig", EntityCode: "ACME", LineNumber: 2,
			AccountID: "acc-1210", AccountCode: "1210", EntryLayer: "OPERATIONAL",
			TxCurrency: "USD", ExchangeRate: "7.80000000",
			TxDebit: "0.0000", TxCredit: "100.0000", FuncDebit: "0.0000", FuncCredit: "780.0000",
			FuncTaxAmount: "0.0000", BusinessUsePct: "1.0000"},
	}
	fxReversal, err := BuildReversalLines(sameCurrency, fxRows, "")
	if err != nil {
		t.Fatalf("build fx reversal: %v", err)
	}
	funcDr, funcCr := money.Money{}, money.Money{}
	for _, l := range fxReversal {
		funcDr = funcDr.Add(mustParse(l.FuncDebit))
		funcCr = funcCr.Add(mustParse(l.FuncCredit))
	}
	if got, want := funcDr.String(), "780.0000"; got != want {
		t.Fatalf("fx reversal functional debit = %s, want %s (the mirrored 780)", got, want)
	}
	if got, want := funcCr.String(), "780.0000"; got != want {
		t.Fatalf("fx reversal functional credit = %s, want %s", got, want)
	}
	origTxDr, origTxCr := netAmounts(fxRows, func(l LedgerLine) string { return l.TxDebit },
		func(l LedgerLine) string { return l.TxCredit })
	revTxDr, revTxCr = money.Money{}, money.Money{}
	for _, l := range fxReversal {
		revTxDr = revTxDr.Add(mustParse(l.Debit))
		revTxCr = revTxCr.Add(mustParse(l.Credit))
	}
	if !origTxDr.Equal(revTxCr) || !origTxCr.Equal(revTxDr) {
		t.Fatalf("fx transaction layer does not net to zero against the original")
	}
	if err := ValidateReversalMirror(fxRows, mirrorRows(fxRows)); err != nil {
		t.Fatalf("fx mirror check refused the exact mirror: %v", err)
	}
}

// mirrorRows renders the persisted reversal rows of an exact mirror (sides
// swapped), as posting writes them.
func mirrorRows(rows []LedgerLine) []LedgerLine {
	out := make([]LedgerLine, 0, len(rows))
	for i, l := range rows {
		m := l
		m.LineID = "l-rev-" + strconv.Itoa(i+1)
		m.JournalID = "j-rev"
		m.TxDebit, m.TxCredit = l.TxCredit, l.TxDebit
		m.FuncDebit, m.FuncCredit = l.FuncCredit, l.FuncDebit
		out = append(out, m)
	}
	return out
}

func strPtr(s string) *string { return &s }

// TestPostedVoucherIsImmutable pins engineering-workflow §3: posted entries
// are never edited; corrections go by reversal. repository.save_journal's
// finalized branch refuses any content change and any transition away from
// POSTED except the status-only reversal.
func TestPostedVoucherIsImmutable(t *testing.T) {
	if kind := CheckSave(StatusPosted, StatusPosted, true); kind != KindVoucherImmutable {
		t.Fatalf("editing a POSTED voucher must be VOUCHER_IMMUTABLE, got %q", kind)
	}
	if kind := CheckSave(StatusPosted, StatusDraft, false); kind != KindVoucherImmutable {
		t.Fatalf("un-posting a POSTED voucher must be VOUCHER_IMMUTABLE, got %q", kind)
	}
	if kind := CheckSave(StatusPosted, StatusReversed, false); kind != "" {
		t.Fatalf("the status-only POSTED→REVERSED reversal must be allowed, got %q", kind)
	}
	if kind := CheckSave(StatusPosted, StatusReversed, true); kind != KindVoucherImmutable {
		t.Fatalf("even the reversal may not smuggle a content change, got %q", kind)
	}
	if kind := CheckSave(StatusReversed, StatusPosted, false); kind != KindVoucherImmutable {
		t.Fatalf("a REVERSED voucher must stay finalized, got %q", kind)
	}
	if kind := CheckSave(StatusVoid, StatusDraft, false); kind != KindVoucherImmutable {
		t.Fatalf("VOID is terminal, got %q", kind)
	}
	if CanSaveTransition(StatusPosted, StatusDraft) {
		t.Fatal("POSTED→DRAFT must never be a legal save transition")
	}
	// The posting engine is the only path to POSTED, from the two review
	// states (posting.py:208, repository.py:818).
	if CanPost(StatusPosted) {
		t.Fatal("a POSTED voucher must not post again")
	}
	if CanPost(StatusDraft) || CanPost(StatusRejected) || CanPost(StatusVoid) {
		t.Fatal("only PENDING_CHECKER and AWAITING_CPA may post")
	}
	if !CanPost(StatusPendingChecker) || !CanPost(StatusAwaitingCPA) {
		t.Fatal("PENDING_CHECKER and AWAITING_CPA must post")
	}
}

// TestReversalOfReversalRefused pins the reference behaviour
// (posting.py:134–135): an original that is itself a reversal is refused,
// whether linked or by source module.
func TestReversalOfReversalRefused(t *testing.T) {
	current := Voucher{
		JournalID: "j-rev2", EntityCode: "ACME", SourceModule: "REVERSAL",
		Status: StatusPendingChecker, Currency: "HKD",
		TotalDebit: mustParse("100.0000"), TotalCredit: mustParse("100.0000"),
		ReversalOfJournalID: strPtr("j-rev1"),
		Lines: []StoredLine{
			{LineNumber: 1, AccountCode: "6100", Credit: mustParse("100.0000"), FuncCredit: mustParse("100.0000")},
			{LineNumber: 2, AccountCode: "2110", Debit: mustParse("100.0000"), FuncDebit: mustParse("100.0000")},
		},
	}
	linked := Voucher{
		JournalID: "j-rev1", EntityCode: "ACME", SourceModule: "MANUAL",
		Status: StatusPosted, Currency: "HKD",
		TotalDebit: mustParse("100.0000"), TotalCredit: mustParse("100.0000"),
		ReversalOfJournalID: strPtr("j-orig"),
	}
	_, err := ValidateReversal(current, &linked)
	requireKind(t, err, KindReversalInvalid)

	byModule := linked
	byModule.ReversalOfJournalID = nil
	byModule.SourceModule = "REVERSAL"
	_, err = ValidateReversal(current, &byModule)
	requireKind(t, err, KindReversalInvalid)

	// The happy path still validates: a plain POSTED original.
	plain := linked
	plain.ReversalOfJournalID = nil
	plain.SourceModule = "MANUAL"
	validated, err := ValidateReversal(current, &plain)
	if err != nil || validated.JournalID != "j-rev1" {
		t.Fatalf("plain posted original must validate, got %v, %v", validated, err)
	}
}

// TestSubmittedSnapshotGuard pins post_voucher's snapshot rule: reviewers
// may change review metadata, never the submitted accounting snapshot.
func TestSubmittedSnapshotGuard(t *testing.T) {
	base := `{
		"revision": 3, "entity_code": "ACME", "source_module": "AP",
		"status": "PENDING_CHECKER", "accounting_date": "2026-10-05",
		"currency": "HKD", "period": "2026-10",
		"total_debit": "100.0000", "total_credit": "100.0000",
		"created_by_principal_key": "ap-bot-01",
		"created_by_principal_id": "11111111-1111-1111-1111-111111111111",
		"lines": [{"line_number": 1, "account_code": "6100", "debit": "100.0000", "credit": "0.0000"}],
		"entry_layer": "OPERATIONAL", "memo": "辦公室租金",
		"evidence_uris": ["s3://evidence/inv-001.pdf"]
	}`
	changed := strings.Replace(base, `"total_debit": "100.0000"`, `"total_debit": "101.0000"`, 1)
	err := CheckSnapshot(snap(t, base), snap(t, changed))
	requireKind(t, err, KindVoucherSnapshotChanged)

	// A textual scale drift on a money string is a change: the reference
	// compares the stored strings.
	scaled := strings.Replace(base, `"100.0000"`, `"100.000"`, 1)
	if err := CheckSnapshot(snap(t, base), snap(t, scaled)); err == nil {
		t.Fatal("textual money drift must refuse the approval")
	}

	// Status and review metadata are not snapshot fields.
	statusOnly := strings.Replace(base, `"PENDING_CHECKER"`, `"AWAITING_CPA"`, 1)
	if err := CheckSnapshot(snap(t, base), snap(t, statusOnly)); err != nil {
		t.Fatalf("review metadata changes must not refuse: %v", err)
	}

	if got := ChangedSnapshotFields(snap(t, base), snap(t, changed)); len(got) != 1 || got[0] != "total_debit" {
		t.Fatalf("changed fields = %v, want [total_debit]", got)
	}
}

func snap(t *testing.T, s string) Snapshot {
	t.Helper()
	var m Snapshot
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return m
}

// TestBL36_DraftIDVoucherNumberSeparation pins the SRC-0027 owner decision
// (2026-10-24): drafts use a separate draft ID; the voucher number is
// allocated only at posting under a unique constraint per entity and
// period, so rejected or voided drafts cannot leave gaps in the posted
// sequence.
func TestBL36_DraftIDVoucherNumberSeparation(t *testing.T) {
	draft := NewDraft("d-0001", "ACME")
	if draft.VoucherNo != nil {
		t.Fatalf("a draft must carry no voucher number, got %q", *draft.VoucherNo)
	}
	if draft.JournalID != "d-0001" {
		t.Fatalf("the draft ID must identify the draft, got %q", draft.JournalID)
	}
	// A draft cannot be numbered: numbers exist only on posted vouchers.
	_, err := AllocateVoucherNumber(draft, 1)
	requireKind(t, err, KindVoucherNumberInvalid)

	posted := draft
	posted.Status = StatusPosted
	posted.Period = "2026-10"
	numbered, err := AllocateVoucherNumber(posted, 1)
	if err != nil {
		t.Fatalf("allocate at posting: %v", err)
	}
	if got, want := *numbered.VoucherNo, "JV-2026-0001"; got != want {
		t.Fatalf("allocated number = %q, want %q (SRC-0027 neutral default)", got, want)
	}
	// The draft ID survives as the identifier next to the number.
	if numbered.JournalID != "d-0001" {
		t.Fatal("allocation must not replace the draft ID")
	}
	// Double allocation is the pure shadow of the unique constraint.
	_, err = AllocateVoucherNumber(numbered, 2)
	requireKind(t, err, KindVoucherNumberAlreadyAllocated)
}

// TestBL36_NumberFormatNeutralDefault pins SRC-0027: a neutral
// prefix-year-sequence default until the jurisdiction packs (REQ-0014
// onward) replace the format — "JV-<year>-<sequence>", sequence zero-padded
// to four digits, entity not rendered.
func TestBL36_NumberFormatNeutralDefault(t *testing.T) {
	for _, c := range []struct {
		period   string
		sequence int64
		want     string
	}{
		{"2026-10", 1, "JV-2026-0001"},
		{"2026-10", 2, "JV-2026-0002"},
		{"2026-Q3", 12, "JV-2026-0012"},
		{"2026-12", 9999, "JV-2026-9999"},
		{"2026-12", 10000, "JV-2026-10000"},
	} {
		got, err := FormatVoucherNumber("ACME", c.period, c.sequence)
		if err != nil {
			t.Fatalf("format %s %d: %v", c.period, c.sequence, err)
		}
		if got != c.want {
			t.Fatalf("format(%q,%d) = %q, want %q", c.period, c.sequence, got, c.want)
		}
	}
	// The entity does not enter the neutral default (uniqueness is scoped
	// per entity and period at the store, not spelled into the number).
	got, _ := FormatVoucherNumber("OTHER", "2026-10", 1)
	if got != "JV-2026-0001" {
		t.Fatalf("neutral default must not render the entity, got %q", got)
	}
	// Fail closed on anything the posting rules could not have produced.
	for _, period := range []string{"", "26-10", "20261", "abcd-10"} {
		if _, err := FormatVoucherNumber("ACME", period, 1); err == nil {
			t.Fatalf("period %q must be refused", period)
		}
	}
	if _, err := FormatVoucherNumber("ACME", "2026-10", 0); err == nil {
		t.Fatal("sequence 0 must be refused")
	}
}

// TestBL36_ReportGaps pins the BL-36 gap report: given the sorted posted
// sequence numbers of one entity and period, the missing sequences in 1..max
// are reported (the audit-trail sequence check the reference never had).
func TestBL36_ReportGaps(t *testing.T) {
	for _, c := range []struct {
		posted []int64
		want   []int64
	}{
		{[]int64{}, []int64{}},
		{[]int64{1}, []int64{}},
		{[]int64{2}, []int64{1}},
		{[]int64{1, 2, 4, 5}, []int64{3}},
		{[]int64{1, 2, 3}, []int64{}},
		{[]int64{5}, []int64{1, 2, 3, 4}},
	} {
		got, err := ReportGaps(c.posted)
		if err != nil {
			t.Fatalf("gaps %v: %v", c.posted, err)
		}
		if len(got) != len(c.want) {
			t.Fatalf("gaps(%v) = %v, want %v", c.posted, got, c.want)
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("gaps(%v) = %v, want %v", c.posted, got, c.want)
			}
		}
	}
	// Corrupted input fails closed rather than producing a misleading audit
	// report.
	for _, posted := range [][]int64{{1, 1}, {2, 1}, {0}, {-1}} {
		if _, err := ReportGaps(posted); err == nil {
			t.Fatalf("gaps(%v) must fail closed", posted)
		}
	}
}

// TestNonzeroTaxReversalFailsClosed pins the BL-03 remediation boundary: no
// signed-tax reversal policy is defined, so a persisted nonzero functional
// tax amount is refused, never silently negated or dropped.
func TestNonzeroTaxReversalFailsClosed(t *testing.T) {
	original := Voucher{
		JournalID: "j-orig", EntityCode: "ACME", Status: StatusPosted,
		VoucherNo: strPtr("記-2026-10-0001"), EntryLayer: "OPERATIONAL",
	}
	rows := []LedgerLine{
		{LineID: "l-1", JournalID: "j-orig", EntityCode: "ACME", LineNumber: 1,
			AccountID: "acc-1420", AccountCode: "1420", EntryLayer: "OPERATIONAL",
			TxCurrency: "HKD", ExchangeRate: "1.00000000",
			TxDebit: "100.0000", TxCredit: "0.0000", FuncDebit: "100.0000", FuncCredit: "0.0000",
			FuncTaxAmount: "12.0000", BusinessUsePct: "1.0000"},
	}
	_, err := BuildReversalLines(original, rows, "")
	requireKind(t, err, KindReversalInvalid)
}
