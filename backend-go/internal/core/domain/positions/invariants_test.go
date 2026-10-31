package positions

import (
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// Expected values below come from the cited sources, never from re-reading
// this package's implementation:
//   - positions.py and sod_guard.py (the frozen reference; also golden-pinned
//     by fixtures/positions/*.json),
//   - SRC-0028 (solo mode by active human-principal count, owner-confirmed
//     2026-10-30),
//   - ADR-0001 O2-g and the one-person-company profile owner decision of
//     2026-10-21 (solo self-approvals allowed, flagged, listed in the
//     year-end audit pack; agents never approve),
//   - the REQ-0035 work package README, absorbed findings (legacy
//     auto-approve thresholds ported unchanged pending REQ-0007).

func mustKind(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		t.Fatal("expected an InvariantError, got nil")
	}
	var inv *InvariantError
	if !errors.As(err, &inv) {
		t.Fatalf("expected an InvariantError, got %T: %v", err, err)
	}
	return inv.Kind
}

var boss = Principal{PrincipalKey: "boss-01", IsHuman: true, Active: true}
var bookkeeper = Principal{PrincipalKey: "bookkeeper-01", IsHuman: true, Active: true}
var apBot = Principal{PrincipalKey: "ap-bot-01", Active: true}

// TestSoloModeFollowsHumanPrincipalCount pins SRC-0028: the qualifying axis
// is the count of active human principals, never the legal entity type.
func TestSoloModeFollowsHumanPrincipalCount(t *testing.T) {
	if !SoloMode([]Principal{boss}) {
		t.Error("one active human principal must be solo mode (SRC-0028)")
	}
	if !SoloMode([]Principal{boss, apBot}) {
		t.Error("agent principals never count; one human plus agents is still solo mode")
	}
	if SoloMode([]Principal{boss, bookkeeper}) {
		t.Error("a second active human principal must end solo mode")
	}
	if SoloMode(nil) {
		t.Error("zero active human principals is not solo mode")
	}
	if !SoloMode([]Principal{boss, {PrincipalKey: "bookkeeper-01", IsHuman: true}}) {
		t.Error("an inactive second human principal does not end solo mode")
	}
	if SoloMode([]Principal{{PrincipalKey: "boss-01", IsHuman: true}}) {
		t.Error("an inactive sole human principal is not solo mode")
	}
}

// TestSecondHumanPrincipalRestoresMakerChecker pins SRC-0028's automatic
// exit: hiring a bookkeeper returns the company to maker-checker, so the
// boss's next self-approval is refused. Historical self-approvals stay
// flagged (they were recorded with the flag at approval time).
func TestSecondHumanPrincipalRestoresMakerChecker(t *testing.T) {
	solo := SoloMode([]Principal{boss, bookkeeper})
	if solo {
		t.Fatal("precondition: two active humans must not be solo mode")
	}
	d := CheckSelfApproval(solo, true, true)
	if d.Allowed || d.SelfApproved || d.Reason != KindSODMakerCheckerViolation {
		t.Errorf("non-solo self-approval must be refused with %s, got %+v", KindSODMakerCheckerViolation, d)
	}
}

// TestMakerCheckerRefusedOutsideSoloMode pins engineering-workflow §3: the
// maker never approves their own entry outside the one-person-company
// profile. The refusal kind is the one sod_guard.py and reviewer.py raise.
func TestMakerCheckerRefusedOutsideSoloMode(t *testing.T) {
	d := CheckSelfApproval(false, true, true)
	if d.Allowed || d.SelfApproved || d.Reason != KindSODMakerCheckerViolation {
		t.Errorf("non-solo self-approval must be refused and unflagged, got %+v", d)
	}
	d = CheckSelfApproval(false, false, true)
	if !d.Allowed || d.SelfApproved || d.Reason != "" {
		t.Errorf("a different human approver needs no exception and no flag, got %+v", d)
	}
}

// TestSoloSelfApprovalAllowedAndFlagged pins the one-person-company profile
// (ADR-0001 D4; owner decision 2026-10-21 on BL-31): self-approval is
// allowed, must carry the self-approval flag, and the flag is what lands the
// approval in the year-end audit pack.
func TestSoloSelfApprovalAllowedAndFlagged(t *testing.T) {
	d := CheckSelfApproval(true, true, true)
	if !d.Allowed || !d.SelfApproved || d.Reason != "" {
		t.Errorf("solo-mode self-approval must be allowed and flagged, got %+v", d)
	}
	d = CheckSelfApproval(true, false, true)
	if !d.Allowed || d.SelfApproved || d.Reason != "" {
		t.Errorf("solo-mode approval by a different human needs no flag, got %+v", d)
	}
}

// TestAgentsNeverApprove pins O2-g at both pure surfaces this package owns:
// the self-approval rule refuses a non-human approver even in solo mode, and
// the guard's role matrix refuses every role that is not an approver role.
// The command matrix never grants journal.review to a non-human position.
func TestAgentsNeverApprove(t *testing.T) {
	if d := CheckSelfApproval(true, true, false); d.Allowed || d.Reason != "HUMAN_REVIEWER_REQUIRED" {
		t.Errorf("an agent principal must never approve, even solo and even as creator: %+v", d)
	}
	if d := CheckSelfApproval(false, false, false); d.Allowed || d.Reason != "HUMAN_REVIEWER_REQUIRED" {
		t.Errorf("an agent principal must never approve: %+v", d)
	}

	creator := "11111111-1111-1111-1111-111111111111"
	reviewer := AgentIdentity{
		PrincipalID:              "22222222-2222-2222-2222-222222222222",
		AgentName:                "maker-bot",
		Role:                     RoleMakerAP,
		MaxAutoApproveFuncAmount: mustMoney("50000.0000"),
		MinConfidenceThreshold:   mustMoney("0.9000"),
	}
	if _, err := EvaluateApprovalTransition(creator, reviewer, mustMoney("1.0000"), mustMoney("0.9700"), false); mustKind(t, err) != KindSODApprovalRoleViolation {
		t.Errorf("a maker role must be refused approval authority, got %v", err)
	}
	reviewer.Role = RoleAuditorInternal
	if _, err := EvaluateApprovalTransition(creator, reviewer, mustMoney("1.0000"), mustMoney("0.9700"), false); mustKind(t, err) != KindSODApprovalRoleViolation {
		t.Errorf("an auditor role must be refused approval authority, got %v", err)
	}

	for _, id := range PositionIDs {
		p := POSITIONS[id]
		if p.IsHuman {
			continue
		}
		for _, cmd := range MonolithCommands(p) {
			if cmd == "journal.review" {
				t.Errorf("%s is not human and must never hold journal.review", id)
			}
		}
	}
	if got := MonolithCommands(POSITIONS["CPA_ADVISOR"]); !hasString(got, "journal.review") {
		t.Error("the human CPA position holds journal.review")
	}
}

// TestGuardRefusesSelfApproval pins the frozen reference's deterministic rule
// (sod_guard.evaluate_approval_transition): the approver principal ID can
// never equal the creator, checked before the role rules — even a HUMAN_CPA
// self-approval is a violation. The solo exception lives in CheckSelfApproval
// (SRC-0028 section), not in this guard; see the report in the P1 phase notes.
func TestGuardRefusesSelfApproval(t *testing.T) {
	creator := "11111111-1111-1111-1111-111111111111"
	reviewer := AgentIdentity{
		PrincipalID:              creator,
		AgentName:                "cpa-griffin",
		Role:                     RoleHumanCPA,
		MaxAutoApproveFuncAmount: mustMoney("50000.0000"),
		MinConfidenceThreshold:   mustMoney("0.9000"),
	}
	if _, err := EvaluateApprovalTransition(creator, reviewer, mustMoney("1.0000"), mustMoney("0.9700"), false); mustKind(t, err) != KindSODMakerCheckerViolation {
		t.Errorf("self-approval must be refused with %s, got %v", KindSODMakerCheckerViolation, err)
	}
}

// TestLegacyAutoApproveThresholdsPinned pins the legacy principal-attached
// auto-approve depth threshold and confidence gating exactly as the frozen
// Python reference behaves (golden-pinned by the approval_legacy_* fixtures).
// LEGACY pending REQ-0007: this is characterization, not endorsement — the
// machine CHECKER_CONTROLLER auto-posting is expected to move to versioned
// policies per ADR-0001 D4.
func TestLegacyAutoApproveThresholdsPinned(t *testing.T) {
	reviewer := AgentIdentity{
		PrincipalID:              "22222222-2222-2222-2222-222222222222",
		AgentName:                "controller-bot",
		Role:                     RoleCheckerController,
		MaxAutoApproveFuncAmount: mustMoney("50000.0000"),
		MinConfidenceThreshold:   mustMoney("0.9000"),
	}
	creator := "11111111-1111-1111-1111-111111111111"

	cases := []struct {
		name       string
		total      string
		confidence string
		want       JournalStatus
	}{
		{"under_threshold", "100.0000", "0.9700", JournalPosted},
		{"amount_at_threshold_is_inclusive", "50000.0000", "0.9700", JournalPosted},
		{"confidence_at_threshold_is_inclusive", "100.0000", "0.9000", JournalPosted},
		{"amount_over_threshold", "50000.0001", "0.9700", JournalAwaitingCPA},
		{"confidence_under_threshold", "100.0000", "0.8999", JournalAwaitingCPA},
		{"both_over", "50000.0001", "0.8999", JournalAwaitingCPA},
	}
	for _, tc := range cases {
		status, err := EvaluateApprovalTransition(creator, reviewer,
			mustMoney(tc.total), mustMoney(tc.confidence), false)
		if err != nil || status != tc.want {
			t.Errorf("%s: status = %v, err = %v; want %v", tc.name, status, err, tc.want)
		}
	}
	if status, _ := EvaluateApprovalTransition(creator, reviewer,
		mustMoney("100.0000"), mustMoney("0.9700"), true); status != JournalAwaitingCPA {
		t.Errorf("intercompany/statutory adjustments always escalate, got %v", status)
	}
	if status, _ := EvaluateApprovalTransition(creator, AgentIdentity{
		PrincipalID: "33333333-3333-3333-3333-333333333333", Role: RoleHumanCPA,
		MaxAutoApproveFuncAmount: mustMoney("0.0000"), MinConfidenceThreshold: mustMoney("1.0000"),
	}, mustMoney("999999.0000"), mustMoney("0.0000"), false); status != JournalPosted {
		t.Error("a human CPA finalizes posting directly, whatever the amounts")
	}
}

// TestGuardBalanceInvariant pins the guard's double-entry control in both
// currencies on a worked example: 6100 Dr 100.00 / 2110 Cr 100.00 balances;
// breaking either currency is refused.
func TestGuardBalanceInvariant(t *testing.T) {
	maker := AgentIdentity{PrincipalID: "11111111-1111-1111-1111-111111111111", Role: RoleMakerAP}
	lines := []ProposedLine{
		{LineNumber: 1, AccountCode: "6100", TxDebit: mustMoney("100.00"), FuncDebit: mustMoney("100.00")},
		{LineNumber: 2, AccountCode: "2110", TxCredit: mustMoney("100.00"), FuncCredit: mustMoney("100.00")},
	}
	if err := ValidateProposalSubmission(maker, "AP", PeriodOpen, lines,
		[]string{"s3://evidence/inv-001.pdf"}, mustMoney("0.9700")); err != nil {
		t.Errorf("a balanced entry in both currencies must pass: %v", err)
	}
	unbalancedTx := []ProposedLine{
		{LineNumber: 1, AccountCode: "6100", TxDebit: mustMoney("100.00"), FuncDebit: mustMoney("100.00")},
		{LineNumber: 2, AccountCode: "2110", TxCredit: mustMoney("101.00"), FuncCredit: mustMoney("101.00")},
	}
	if err := ValidateProposalSubmission(maker, "AP", PeriodOpen, unbalancedTx,
		[]string{"s3://evidence/inv-001.pdf"}, mustMoney("0.9700")); mustKind(t, err) != KindUnbalancedEntryViolation {
		t.Errorf("an unbalanced TX side must be refused with %s, got %v", KindUnbalancedEntryViolation, err)
	}
	unbalancedFunc := []ProposedLine{
		{LineNumber: 1, AccountCode: "6100", TxDebit: mustMoney("100.00"), FuncDebit: mustMoney("100.00")},
		{LineNumber: 2, AccountCode: "2110", TxCredit: mustMoney("100.00"), FuncCredit: mustMoney("99.00")},
	}
	if err := ValidateProposalSubmission(maker, "AP", PeriodOpen, unbalancedFunc,
		[]string{"s3://evidence/inv-001.pdf"}, mustMoney("0.9700")); mustKind(t, err) != KindUnbalancedEntryViolation {
		t.Errorf("an unbalanced functional side must be refused with %s, got %v", KindUnbalancedEntryViolation, err)
	}
}

// TestMayReviewMatrixPins pins the reviewer-assignment rules from
// positions.py's docstrings: custody never reviews, nobody below the required
// position reviews, and the founder never reviews vouchers.
func TestMayReviewMatrixPins(t *testing.T) {
	ar := POSITIONS["AR_CLERK"]
	if MayReview(POSITIONS["CASHIER"], ar) {
		t.Error("the cashier holds custody and may never review anything")
	}
	if !MayReview(POSITIONS["GL_ACCOUNTANT"], ar) {
		t.Error("the chief accountant reviews clerk entries")
	}
	if MayReview(ar, POSITIONS["GL_ACCOUNTANT"]) {
		t.Error("a clerk may never review the chief accountant")
	}
	if !MayReview(POSITIONS["FINANCE_MANAGER"], POSITIONS["GL_ACCOUNTANT"]) {
		t.Error("the finance manager reviews the chief accountant's own entries")
	}
	if !MayReview(POSITIONS["CPA_ADVISOR"], POSITIONS["FINANCE_MANAGER"]) {
		t.Error("the external CPA reviews the finance manager's own entries")
	}
	if MayReview(POSITIONS["FOUNDER_DIRECTOR"], ar) {
		t.Error("the founder does not review vouchers — that is the accounting department's job")
	}
}

// TestEntryHashRounding pins the :.4f rendering rules the chain format
// depends on: half-even at four places, sign of zero kept, context precision
// never applied (Decimal.__format__ expands).
func TestEntryHashRounding(t *testing.T) {
	cases := []struct{ in, want string }{
		{"100", "100.0000"},
		{"1234.56789", "1234.5679"},
		{"0.00015", "0.0002"},   // tie -> even
		{"0.00025", "0.0002"},   // tie -> even
		{"0.00005", "0.0000"},   // tie -> even
		{"-0.00001", "-0.0000"}, // sign of zero preserved
		{"-5", "-5.0000"},
		{"1E+2", "100.0000"},
		{"1E+30", "1000000000000000000000000000000.0000"},
	}
	for _, tc := range cases {
		if got := formatFixed4(mustMoney(tc.in)); got != tc.want {
			t.Errorf("formatFixed4(%s) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func mustMoney(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("test: unparsable money " + s)
	}
	return m
}

func hasString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// The seeded matrix and the ID order must stay in sync; PositionIDs drives
// order-sensitive iteration (PositionForAccounts tie-breaking, fixtures).
func TestPositionIDsMatchSeededMatrix(t *testing.T) {
	if len(PositionIDs) != len(POSITIONS) {
		t.Fatalf("PositionIDs has %d entries, POSITIONS has %d", len(PositionIDs), len(POSITIONS))
	}
	for _, id := range PositionIDs {
		if _, ok := POSITIONS[id]; !ok {
			t.Errorf("PositionIDs entry %q missing from POSITIONS", id)
		}
	}
	for id := range POSITIONS {
		if !hasString(PositionIDs, id) {
			t.Errorf("POSITIONS entry %q missing from PositionIDs", id)
		}
	}
	if last := PositionIDs[len(PositionIDs)-1]; last != "AUDITOR_READONLY" {
		t.Errorf("insertion order must match the Python dict; got %v", PositionIDs)
	}
}
