package positions

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports backend/app/core/sod_guard.py: the deterministic
// Segregation of Duties (SoD) & accounting invariant guard. The Python module
// docstring lists what it enforces:
//
//  1. Dual-currency double-entry balance (sum(DR) == sum(CR) in both TX and
//     Functional currencies)
//  2. Sub-ledger control account isolation (no manual journal entries to AR,
//     AP, Cash, Inventory, FA control accounts)
//  3. Fiscal period cut-off (OPEN vs. SOFT_CLOSE vs. HARD_CLOSE/LOCKED)
//  4. Maker-Checker-Auditor role separation (approver != creator)
//  5. SHA-256 cryptographic hash-chaining including journal lines protection
//     for POSTED entries
//
// Everything that read session or database state in Python arrives here as
// explicit arguments; every function is pure.

// AgentRole mirrors sod_guard.AgentRole (a str enum; the constant values are
// the wire forms).
type AgentRole string

const (
	RoleMakerBookkeeper   AgentRole = "MAKER_BOOKKEEPER"
	RoleMakerAP           AgentRole = "MAKER_AP"
	RoleMakerARRevRec     AgentRole = "MAKER_AR_REVREC"
	RoleMakerBankRec      AgentRole = "MAKER_BANK_REC"
	RoleMakerInvFA        AgentRole = "MAKER_INV_FA"
	RoleMakerCloseConsol  AgentRole = "MAKER_CLOSE_CONSOL"
	RoleCheckerController AgentRole = "CHECKER_CONTROLLER"
	RoleAuditorInternal   AgentRole = "AUDITOR_INTERNAL"
	RoleHumanCPA          AgentRole = "HUMAN_CPA"
)

// PeriodStatus mirrors sod_guard.PeriodStatus.
type PeriodStatus string

const (
	PeriodFuture    PeriodStatus = "FUTURE"
	PeriodOpen      PeriodStatus = "OPEN"
	PeriodSoftClose PeriodStatus = "SOFT_CLOSE"
	PeriodHardClose PeriodStatus = "HARD_CLOSE"
	PeriodLocked    PeriodStatus = "LOCKED"
)

// JournalStatus mirrors sod_guard.JournalStatus.
type JournalStatus string

const (
	JournalDraft          JournalStatus = "DRAFT"
	JournalPendingChecker JournalStatus = "PENDING_CHECKER"
	JournalAwaitingCPA    JournalStatus = "AWAITING_CPA"
	JournalPosted         JournalStatus = "POSTED"
	JournalReversed       JournalStatus = "REVERSED"
	JournalRejected       JournalStatus = "REJECTED"
)

// ProposedLine mirrors sod_guard.ProposedLine. is_control_account is a
// caller-supplied flag (the reference derives it at the call sites, e.g.
// account codes 1110/1210/2110 in mcp_server.py); the guard only reads it.
type ProposedLine struct {
	LineNumber       int
	AccountCode      string
	IsControlAccount bool
	TxDebit          money.Money
	TxCredit         money.Money
	FuncDebit        money.Money
	FuncCredit       money.Money
	// TaxCode is Python's Optional[str]; nil is None.
	TaxCode *string
	Memo    string
}

// AgentIdentity mirrors sod_guard.AgentIdentity.
type AgentIdentity struct {
	// PrincipalID is the principal's UUID in canonical lowercase form. The
	// reference compares Python UUID values (equality on the normalized
	// value); fixtures always carry canonical lowercase strings, for which
	// string equality is the same test.
	PrincipalID string
	AgentName   string
	Role        AgentRole
	// LEGACY (REQ-0035 work package, absorbed findings): the principal-
	// attached auto-approve depth threshold and confidence gate survive the
	// migration unchanged pending REQ-0007, which moves them to versioned
	// policies per ADR-0001 D4. Golden parity is not control endorsement.
	MaxAutoApproveFuncAmount money.Money
	MinConfidenceThreshold   money.Money
}

// Stable machine-readable kinds carried by InvariantError: the message
// prefixes the frozen reference embeds in AccountingInvariantError strings.
// Fixtures pin the kind, not the message text.
const (
	KindSODRoleViolation                 = "SOD_ROLE_VIOLATION"
	KindPeriodCutoffViolation            = "PERIOD_CUTOFF_VIOLATION"
	KindSoftCloseViolation               = "SOFT_CLOSE_VIOLATION"
	KindEvidenceRequiredViolation        = "EVIDENCE_REQUIRED_VIOLATION"
	KindInvalidConfidenceScore           = "INVALID_CONFIDENCE_SCORE"
	KindDoubleEntryViolation             = "DOUBLE_ENTRY_VIOLATION"
	KindLineExclusivityViolation         = "LINE_EXCLUSIVITY_VIOLATION"
	KindControlAccountIsolationViolation = "CONTROL_ACCOUNT_ISOLATION_VIOLATION"
	KindUnbalancedEntryViolation         = "UNBALANCED_ENTRY_VIOLATION"
	KindSODMakerCheckerViolation         = "SOD_MAKER_CHECKER_VIOLATION"
	KindSODApprovalRoleViolation         = "SOD_APPROVAL_ROLE_VIOLATION"
)

// InvariantError mirrors sod_guard.AccountingInvariantError: a deterministic
// accounting-invariant or SoD-policy violation.
type InvariantError struct {
	Kind string
	// Message mirrors the reference message text, including its dynamic
	// parts (agent names, account codes, Decimal sum renderings).
	Message string
}

func (e *InvariantError) Error() string { return e.Message }

func invariantErrf(kind, format string, args ...any) *InvariantError {
	return &InvariantError{Kind: kind, Message: kind + ": " + fmt.Sprintf(format, args...)}
}

// pyEnum renders a str-mixin enum member the way the frozen reference prints
// it inside error messages: since Python 3.11, format() of a mixed-in enum
// member yields "EnumName.MEMBER" (verified on the reference interpreter,
// CPython 3.13). The error messages are not fixture-pinned; this keeps them
// byte-comparable with the Python ones anyway.
func pyEnum(enumName, value string) string {
	return enumName + "." + value
}

// SODOperationalModules and SODClosingModules mirror the guard's module
// sets. CLOSING_MODULES is defined-but-unused in the frozen reference; it is
// kept for parity.
var (
	SODOperationalModules = map[string]bool{
		"AP": true, "AR": true, "BANK_REC": true, "INVENTORY": true, "EXPENSE_SPLIT": true,
	}
	SODClosingModules = map[string]bool{
		"FA": true, "LEASE": true, "REV_REC": true, "FX_REVAL": true,
		"IC_ELIM": true, "GL_MANUAL": true, "AJE": true,
	}
)

var (
	zero4 = parseConst("0.0000")
	one4  = parseConst("1.0000")
)

// parseConst parses a compile-time constant; a failure is a programming
// error, not an input condition.
func parseConst(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("positions: constant money " + s)
	}
	return m
}

// ValidateProposalSubmission mirrors
// DeterministicSoDGuard.validate_proposal_submission. The checks run in the
// reference's order; the first failure wins.
func ValidateProposalSubmission(
	maker AgentIdentity,
	sourceModule string,
	periodStatus PeriodStatus,
	lines []ProposedLine,
	evidenceURIs []string,
	confidence money.Money,
) error {
	// 1. Verify Maker Role Permissions: must strictly be a Maker role.
	if !strings.HasPrefix(string(maker.Role), "MAKER_") {
		return invariantErrf(KindSODRoleViolation,
			"Principal '%s' with role '%s' cannot create proposals.",
			maker.AgentName, pyEnum("AgentRole", string(maker.Role)))
	}

	// 2. Verify Period Cut-Off.
	switch periodStatus {
	case PeriodFuture, PeriodHardClose, PeriodLocked:
		return invariantErrf(KindPeriodCutoffViolation,
			"Cannot submit journal proposals to a period in '%s' status.",
			pyEnum("PeriodStatus", string(periodStatus)))
	}
	if periodStatus == PeriodSoftClose && SODOperationalModules[sourceModule] {
		return invariantErrf(KindSoftCloseViolation,
			"Operational module '%s' is blocked during SOFT_CLOSE.", sourceModule)
	}

	// 3. Verify Evidence Attachment & Confidence.
	if len(evidenceURIs) == 0 {
		return &InvariantError{Kind: KindEvidenceRequiredViolation,
			Message: "EVIDENCE_REQUIRED_VIOLATION: Every agentic journal proposal must include at least one immutable evidence URI."}
	}
	if confidence.Cmp(zero4) < 0 || confidence.Cmp(one4) > 0 {
		return &InvariantError{Kind: KindInvalidConfidenceScore,
			Message: "INVALID_CONFIDENCE_SCORE: Confidence score must be between 0.0000 and 1.0000."}
	}

	// 4. Verify Double-Entry Balancing & Control Account Isolation.
	if len(lines) < 2 {
		return &InvariantError{Kind: KindDoubleEntryViolation,
			Message: "DOUBLE_ENTRY_VIOLATION: Journal entry must contain at least 2 lines."}
	}

	// Python sums start at Decimal("0.0000"), so every sum carries at least
	// four fractional digits; money.Money.Add reproduces the zero-operand
	// exponent rules behind that.
	txDR := zero4
	txCR := zero4
	funcDR := zero4
	funcCR := zero4
	for _, line := range lines {
		txDR = txDR.Add(line.TxDebit)
		txCR = txCR.Add(line.TxCredit)
		funcDR = funcDR.Add(line.FuncDebit)
		funcCR = funcCR.Add(line.FuncCredit)
	}

	for _, line := range lines {
		if (line.TxDebit.Cmp(zero4) > 0 && line.TxCredit.Cmp(zero4) > 0) ||
			(line.TxDebit.Cmp(zero4) <= 0 && line.TxCredit.Cmp(zero4) <= 0) {
			return invariantErrf(KindLineExclusivityViolation,
				"Line %d must have strictly positive debit OR credit.", line.LineNumber)
		}
		if line.IsControlAccount && sourceModule == "GL_MANUAL" {
			return invariantErrf(KindControlAccountIsolationViolation,
				"Account '%s' is a Sub-Ledger Control Account and cannot be posted via GL_MANUAL.",
				line.AccountCode)
		}
	}

	if !txDR.Equal(txCR) || !funcDR.Equal(funcCR) || txDR.Cmp(zero4) <= 0 {
		return invariantErrf(KindUnbalancedEntryViolation,
			"Debits and Credits do not balance (TX DR=%s, TX CR=%s; FUNC DR=%s, FUNC CR=%s).",
			txDR, txCR, funcDR, funcCR)
	}

	return nil
}

// EvaluateApprovalTransition mirrors
// DeterministicSoDGuard.evaluate_approval_transition: determines whether a
// reviewer approval transitions the entry directly to POSTED or escalates to
// AWAITING_CPA (Human-in-the-Loop).
func EvaluateApprovalTransition(
	createdByPrincipalID string,
	reviewer AgentIdentity,
	totalFuncDebit money.Money,
	proposalConfidence money.Money,
	involvesIntercompanyOrStatutoryAdj bool,
) (JournalStatus, error) {
	if reviewer.PrincipalID == createdByPrincipalID {
		return "", &InvariantError{Kind: KindSODMakerCheckerViolation,
			Message: "SOD_MAKER_CHECKER_VIOLATION: Approver Principal ID cannot equal Creator Principal ID."}
	}

	if reviewer.Role != RoleCheckerController && reviewer.Role != RoleHumanCPA {
		return "", invariantErrf(KindSODApprovalRoleViolation,
			"Role '%s' is not authorized to approve proposals.",
			pyEnum("AgentRole", string(reviewer.Role)))
	}

	// Human CPA can finalize posting directly.
	if reviewer.Role == RoleHumanCPA {
		return JournalPosted, nil
	}

	// LEGACY (REQ-0035 work package, absorbed findings): a machine may only
	// auto-post where the basis is verifiable, gated by the principal-
	// attached depth threshold and confidence threshold below. These port
	// unchanged from the frozen reference pending REQ-0007; golden parity is
	// not control endorsement.
	if !involvesIntercompanyOrStatutoryAdj &&
		totalFuncDebit.Cmp(reviewer.MaxAutoApproveFuncAmount) <= 0 &&
		proposalConfidence.Cmp(reviewer.MinConfidenceThreshold) >= 0 {
		return JournalPosted, nil
	}

	return JournalAwaitingCPA, nil
}

// HashLine is one journal line as the line-hash helpers see it
// (compute_lines_sha256 takes loose dicts in Python). Every field is
// optional: a missing LineNumber sorts as 0 but serializes as JSON null; a
// missing Debit or Credit serializes as "0.0000"; a missing AccountCode
// serializes as JSON null. Amounts cross as strings.
type HashLine struct {
	LineNumber  *int64
	AccountCode *string
	Debit       *string
	Credit      *string
}

// genesisBlock is the chain root the frozen reference starts from
// (verify_hash_chain's local constant).
const genesisBlock = "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"

// ComputeLinesSHA256 mirrors DeterministicSoDGuard.compute_lines_sha256: a
// deterministic SHA-256 over the lines sorted by line number (stable, missing
// = 0), each rendered as the four-key object Python's
// json.dumps(..., sort_keys=True, separators=(",", ":")) emits. Extra line
// fields (memo, tax code) never enter the hash.
func ComputeLinesSHA256(lines []HashLine) string {
	order := make([]int, len(lines))
	for i := range order {
		order[i] = i
	}
	sortKey := func(l HashLine) int64 {
		if l.LineNumber != nil {
			return *l.LineNumber
		}
		return 0
	}
	sort.SliceStable(order, func(a, b int) bool {
		return sortKey(lines[order[a]]) < sortKey(lines[order[b]])
	})

	var b strings.Builder
	b.WriteByte('[')
	for n, i := range order {
		l := lines[i]
		if n > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"account_code":`)
		b.WriteString(pyJSONString(l.AccountCode))
		b.WriteString(`,"credit":`)
		b.WriteString(pyJSONStringOr(l.Credit, "0.0000"))
		b.WriteString(`,"debit":`)
		b.WriteString(pyJSONStringOr(l.Debit, "0.0000"))
		b.WriteString(`,"line_number":`)
		if l.LineNumber != nil {
			b.WriteString(strconv.FormatInt(*l.LineNumber, 10))
		} else {
			b.WriteString("null")
		}
		b.WriteByte('}')
	}
	b.WriteByte(']')
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// pyJSONString renders a JSON string the way Python json.dumps does with its
// default ensure_ascii: control characters and the quote/backslash escaped,
// every rune above U+007E as \uXXXX (surrogate pairs for astral runes). nil
// renders as null.
func pyJSONString(s *string) string {
	if s == nil {
		return "null"
	}
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range *s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			fmt.Fprintf(&b, `\u%04x`, r)
		case r <= 0x7E:
			b.WriteRune(r)
		case r <= 0xFFFF:
			fmt.Fprintf(&b, `\u%04x`, r)
		default:
			hi, lo := utf16Pair(r)
			fmt.Fprintf(&b, `\u%04x\u%04x`, hi, lo)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// pyJSONStringOr renders s when present, else the quoted fallback (Python's
// str(l.get(key, default))).
func pyJSONStringOr(s *string, fallback string) string {
	if s == nil {
		return pyJSONString(&fallback)
	}
	return pyJSONString(s)
}

func utf16Pair(r rune) (uint16, uint16) {
	v := uint32(r - 0x10000)
	return uint16(0xD800 + (v >> 10)), uint16(0xDC00 + (v & 0x3FF))
}

// ComputeEntrySHA256Hash mirrors
// DeterministicSoDGuard.compute_entry_sha256_hash: the immutable
// cryptographic hash linking an entry to the previous block and its line
// contents. The amount fields render through Python's f"{Decimal:.4f}"
// (formatFixed4).
func ComputeEntrySHA256Hash(
	prevEntryHash string,
	journalID string,
	entityCode string,
	accountingDate string,
	funcDebit money.Money,
	funcCredit money.Money,
	linesSHA256 string,
	createdBy string,
	approvedBy string,
) string {
	payload := prevEntryHash + "|" + journalID + "|" + entityCode + "|" + accountingDate + "|" +
		formatFixed4(funcDebit) + "|" + formatFixed4(funcCredit) + "|" +
		linesSHA256 + "|" + createdBy + "|" + approvedBy
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

// formatFixed4 renders m like Python's f"{Decimal:.4f}" — exactly four
// fractional digits, ROUND_HALF_EVEN, sign of zero preserved. The
// __format__ rendering is unbounded by the arithmetic context (unlike
// quantize), so it lives in money.FormatFixed; the entry-hash format is the
// one place the reference renders without a context cap.
func formatFixed4(m money.Money) string {
	return money.FormatFixed(m, 4)
}

// JournalRecord is one journal as VerifyHashChain sees it
// (verify_hash_chain takes loose dicts). Amounts cross as strings.
type JournalRecord struct {
	Status                string // compared against JournalPosted's value
	EntryHash             string // empty means absent: the entry is skipped
	PrevEntryHash         string
	CreatedAt             string // sort key; stable for equal keys
	JournalID             string
	EntityCode            string
	AccountingDate        string
	TotalDebit            string
	TotalCredit           string
	CreatedByPrincipalID  string
	ApprovedByPrincipalID string
	Lines                 []HashLine
}

// ChainReport is verify_hash_chain's return dict: {"valid": true,
// "verified_blocks_count": n} on success, {"valid": false, "error": msg} on
// tampering or breakage.
type ChainReport struct {
	Valid               bool
	VerifiedBlocksCount int
	Error               string
}

// VerifyHashChain mirrors DeterministicSoDGuard.verify_hash_chain: validates
// cryptographic integrity and uninterrupted chaining of posted journals.
// Non-POSTED entries and entries without an entry hash are skipped; the
// remaining entries sort chronologically by created_at (stable, so equal
// timestamps keep input order) and must chain from genesis with recomputed
// hashes.
func VerifyHashChain(journals []JournalRecord) (ChainReport, error) {
	posted := make([]JournalRecord, 0, len(journals))
	for _, j := range journals {
		if j.Status == string(JournalPosted) && j.EntryHash != "" {
			posted = append(posted, j)
		}
	}
	sort.SliceStable(posted, func(a, b int) bool { return posted[a].CreatedAt < posted[b].CreatedAt })

	prevHash := genesisBlock
	for idx, j := range posted {
		if j.PrevEntryHash != prevHash {
			return ChainReport{Valid: false,
				Error: fmt.Sprintf("Chain broken at entry index %d (%s): expected prev %s, got %s",
					idx, j.JournalID, prevHash, j.PrevEntryHash)}, nil
		}
		totalDebit, err := money.Parse(j.TotalDebit)
		if err != nil {
			return ChainReport{}, fmt.Errorf("positions: unparsable total_debit %q: %w", j.TotalDebit, err)
		}
		totalCredit, err := money.Parse(j.TotalCredit)
		if err != nil {
			return ChainReport{}, fmt.Errorf("positions: unparsable total_credit %q: %w", j.TotalCredit, err)
		}
		computed := ComputeEntrySHA256Hash(
			j.PrevEntryHash,
			j.JournalID,
			j.EntityCode,
			j.AccountingDate,
			totalDebit,
			totalCredit,
			ComputeLinesSHA256(j.Lines),
			j.CreatedByPrincipalID,
			j.ApprovedByPrincipalID,
		)
		if computed != j.EntryHash {
			return ChainReport{Valid: false,
				Error: fmt.Sprintf("Hash mismatch at entry %s: computed %s vs stored %s",
					j.JournalID, computed, j.EntryHash)}, nil
		}
		prevHash = computed
	}
	return ChainReport{Valid: true, VerifiedBlocksCount: len(posted)}, nil
}

// ---------------------------------------------------------------------------
// Self-approval rule — ADR-0001 D4 (owner decision 2026-10-21), refined by
// SRC-0028 (confirmed 2026-10-30). Not present in the frozen Python backend:
// there the guard refuses self-approval unconditionally (report: the solo
// exception is policy, unimplemented in Python). This is the owner-decided
// rule the Go port implements.
// ---------------------------------------------------------------------------

// SelfApprovalDecision is the outcome of the maker-checker check for one
// approval act.
type SelfApprovalDecision struct {
	// Allowed: may the approval proceed at all.
	Allowed bool
	// SelfApproved is the self-approval flag: record that the approver is
	// the creator and list the approval in the year-end audit pack (BL-31
	// owner decision, 2026-10-21). True only for solo-mode self-approvals.
	SelfApproved bool
	// Reason is the machine-readable refusal reason, "" when allowed.
	Reason string
}

// CheckSelfApproval applies the maker-checker invariant with the
// one-person-company exception: the maker never approves their own entry,
// except in solo mode (一人公司模式) where self-approval is allowed and
// flagged. Agents never approve in any mode (O2-g) — a non-human approver is
// refused even when everything else would allow them. solo comes from
// SoloMode.
func CheckSelfApproval(solo, approverIsCreator, approverIsHuman bool) SelfApprovalDecision {
	if !approverIsHuman {
		// reviewer.py's O2-g refusal: agents may pre-review and advise;
		// approval requires a human reviewer.
		return SelfApprovalDecision{Reason: "HUMAN_REVIEWER_REQUIRED"}
	}
	if approverIsCreator && !solo {
		// sod_guard.py's self-approval refusal; reviewer.py raises the same
		// kind when the maker tries to review their own voucher.
		return SelfApprovalDecision{Reason: KindSODMakerCheckerViolation}
	}
	return SelfApprovalDecision{Allowed: true, SelfApproved: approverIsCreator}
}
