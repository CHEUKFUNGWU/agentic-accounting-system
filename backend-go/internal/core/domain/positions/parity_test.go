package positions

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// The op names and field names are the wire forms written by
// backend-go/tools/gen_positions.py. Money values cross as strings; no
// float64 appears anywhere on the wire.
const (
	opPosition         = "position"
	opInScope          = "in_scope"
	opOutOfScope       = "out_of_scope"
	opVisibleAccounts  = "visible_accounts"
	opRequiredReviewer = "required_reviewer"
	opMayReviewMatrix  = "may_review_matrix"
	opPositionForAccs  = "position_for_accounts"
	opPositionForPrin  = "position_for_principal"
	opMonolithCommands = "monolith_commands"
	opValidateProposal = "validate_proposal"
	opEvaluateApproval = "evaluate_approval"
	opLinesSha256      = "lines_sha256"
	opEntrySha256      = "entry_sha256"
	opVerifyChain      = "verify_chain"
	opSoloMode         = "solo_mode"
	opSelfApproval     = "self_approval"
)

// positionWire is the JSON form of a Position, shared by inputs (durable
// override records, custom records) and outputs (the catalog cases).
type positionWire struct {
	PositionID      string   `json:"position_id"`
	TitleEn         string   `json:"title_en"`
	TitleZh         string   `json:"title_zh"`
	PrincipalKey    string   `json:"principal_key"`
	AccountScope    []string `json:"account_scope"`
	CanPrepare      bool     `json:"can_prepare"`
	CanReview       bool     `json:"can_review"`
	CashCustody     bool     `json:"cash_custody"`
	ReviewLevel     int      `json:"review_level"`
	ReadAllAccounts bool     `json:"read_all_accounts"`
	MandateEn       string   `json:"mandate_en"`
	MandateZh       string   `json:"mandate_zh"`
	IsHuman         bool     `json:"is_human"`
}

func toWire(p Position) positionWire {
	scope := p.AccountScope
	if scope == nil {
		scope = []string{}
	}
	return positionWire{
		PositionID: p.PositionID, TitleEn: p.TitleEn, TitleZh: p.TitleZh,
		PrincipalKey: p.PrincipalKey, AccountScope: scope,
		CanPrepare: p.CanPrepare, CanReview: p.CanReview, CashCustody: p.CashCustody,
		ReviewLevel: p.ReviewLevel, ReadAllAccounts: p.ReadAllAccounts,
		MandateEn: p.MandateEn, MandateZh: p.MandateZh, IsHuman: p.IsHuman,
	}
}

func fromWire(w positionWire) Position {
	scope := w.AccountScope
	if scope == nil {
		scope = []string{}
	}
	return Position{
		PositionID: w.PositionID, TitleEn: w.TitleEn, TitleZh: w.TitleZh,
		PrincipalKey: w.PrincipalKey, AccountScope: scope,
		CanPrepare: w.CanPrepare, CanReview: w.CanReview, CashCustody: w.CashCustody,
		ReviewLevel: w.ReviewLevel, ReadAllAccounts: w.ReadAllAccounts,
		MandateEn: w.MandateEn, MandateZh: w.MandateZh, IsHuman: w.IsHuman,
	}
}

func mustParse(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		panic("parity: unparsable money string " + s)
	}
	return m
}

type identityWire struct {
	PrincipalID            string `json:"principal_id"`
	AgentName              string `json:"agent_name"`
	Role                   string `json:"role"`
	MaxAutoApproveAmount   string `json:"max_auto_approve_func_amount"`
	MinConfidenceThreshold string `json:"min_confidence_threshold"`
}

func (w identityWire) identity() AgentIdentity {
	return AgentIdentity{
		PrincipalID: w.PrincipalID,
		AgentName:   w.AgentName,
		Role:        AgentRole(w.Role),
		// Legacy fields pending REQ-0007; pinned as-is by approval_legacy_*.
		MaxAutoApproveFuncAmount: mustParse(w.MaxAutoApproveAmount),
		MinConfidenceThreshold:   mustParse(w.MinConfidenceThreshold),
	}
}

type lineWire struct {
	LineNumber       int     `json:"line_number"`
	AccountCode      string  `json:"account_code"`
	IsControlAccount bool    `json:"is_control_account"`
	TxDebit          string  `json:"tx_debit"`
	TxCredit         string  `json:"tx_credit"`
	FuncDebit        string  `json:"func_debit"`
	FuncCredit       string  `json:"func_credit"`
	TaxCode          *string `json:"tax_code"`
	Memo             string  `json:"memo"`
}

func (w lineWire) line() ProposedLine {
	return ProposedLine{
		LineNumber:       w.LineNumber,
		AccountCode:      w.AccountCode,
		IsControlAccount: w.IsControlAccount,
		TxDebit:          mustParse(w.TxDebit),
		TxCredit:         mustParse(w.TxCredit),
		FuncDebit:        mustParse(w.FuncDebit),
		FuncCredit:       mustParse(w.FuncCredit),
		TaxCode:          w.TaxCode,
		Memo:             w.Memo,
	}
}

// hashLineWire mirrors HashLine with optional fields; extra line fields in
// the fixture input (memo, tax code) are ignored, exactly as the reference's
// compute_lines_sha256 reads only the four keys.
type hashLineWire struct {
	LineNumber  *int64  `json:"line_number"`
	AccountCode *string `json:"account_code"`
	Debit       *string `json:"debit"`
	Credit      *string `json:"credit"`
}

func (w hashLineWire) line() HashLine {
	return HashLine{LineNumber: w.LineNumber, AccountCode: w.AccountCode, Debit: w.Debit, Credit: w.Credit}
}

type journalWire struct {
	Status                string         `json:"status"`
	EntryHash             string         `json:"entry_hash"`
	PrevEntryHash         string         `json:"prev_entry_hash"`
	CreatedAt             string         `json:"created_at"`
	JournalID             string         `json:"journal_id"`
	EntityCode            string         `json:"entity_code"`
	AccountingDate        string         `json:"accounting_date"`
	TotalDebit            string         `json:"total_debit"`
	TotalCredit           string         `json:"total_credit"`
	CreatedByPrincipalID  string         `json:"created_by_principal_id"`
	ApprovedByPrincipalID string         `json:"approved_by_principal_id"`
	Lines                 []hashLineWire `json:"lines"`
}

func (w journalWire) journal() JournalRecord {
	lines := make([]HashLine, 0, len(w.Lines))
	for _, l := range w.Lines {
		lines = append(lines, l.line())
	}
	return JournalRecord{
		Status: w.Status, EntryHash: w.EntryHash, PrevEntryHash: w.PrevEntryHash,
		CreatedAt: w.CreatedAt, JournalID: w.JournalID, EntityCode: w.EntityCode,
		AccountingDate: w.AccountingDate, TotalDebit: w.TotalDebit, TotalCredit: w.TotalCredit,
		CreatedByPrincipalID: w.CreatedByPrincipalID, ApprovedByPrincipalID: w.ApprovedByPrincipalID,
		Lines: lines,
	}
}

// replay executes one fixture case. Guard violations surface as
// *fixture.Error carrying the reference's message-kind prefix.
func replay(input json.RawMessage) (any, error) {
	var header struct {
		Op string `json:"op"`
	}
	if err := json.Unmarshal(input, &header); err != nil {
		return nil, err
	}
	switch header.Op {
	case opPosition:
		var in struct {
			PositionID string `json:"position_id"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		p, ok := POSITIONS[in.PositionID]
		if !ok {
			return nil, nil
		}
		return toWire(p), nil

	case opInScope:
		var in struct {
			PositionID  string `json:"position_id"`
			AccountCode string `json:"account_code"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return InScope(POSITIONS[in.PositionID], in.AccountCode), nil

	case opOutOfScope:
		var in struct {
			PositionID   string   `json:"position_id"`
			AccountCodes []string `json:"account_codes"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return OutOfScope(POSITIONS[in.PositionID], in.AccountCodes), nil

	case opVisibleAccounts:
		var in struct {
			PositionID string   `json:"position_id"`
			AllCodes   []string `json:"all_codes"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return VisibleAccounts(POSITIONS[in.PositionID], in.AllCodes), nil

	case opRequiredReviewer:
		var in struct {
			PositionID string `json:"position_id"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return RequiredReviewer(POSITIONS[in.PositionID]).PositionID, nil

	case opMayReviewMatrix:
		var in struct {
			ReviewerID string `json:"reviewer_id"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		reviewer := POSITIONS[in.ReviewerID]
		out := map[string]bool{}
		for _, prep := range PositionIDs {
			out[prep] = MayReview(reviewer, POSITIONS[prep])
		}
		return out, nil

	case opPositionForAccs:
		var in struct {
			AccountCodes []string `json:"account_codes"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		p, ok := PositionForAccounts(in.AccountCodes)
		if !ok {
			return nil, nil
		}
		return p.PositionID, nil

	case opPositionForPrin:
		var in struct {
			PrincipalKey string                  `json:"principal_key"`
			Dynamic      map[string]positionWire `json:"dynamic"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		dynamic := map[string]Position{}
		for k, w := range in.Dynamic {
			dynamic[k] = fromWire(w)
		}
		p, ok := PositionForPrincipal(in.PrincipalKey, dynamic)
		if !ok {
			return nil, nil
		}
		return p.PositionID, nil

	case opMonolithCommands:
		var in struct {
			Position positionWire `json:"position"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return MonolithCommands(fromWire(in.Position)), nil

	case opValidateProposal:
		var in struct {
			Maker        identityWire `json:"maker"`
			SourceModule string       `json:"source_module"`
			PeriodStatus string       `json:"period_status"`
			Lines        []lineWire   `json:"lines"`
			EvidenceURIs []string     `json:"evidence_uris"`
			Confidence   string       `json:"confidence_score"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		lines := make([]ProposedLine, 0, len(in.Lines))
		for _, l := range in.Lines {
			lines = append(lines, l.line())
		}
		if err := ValidateProposalSubmission(
			in.Maker.identity(), in.SourceModule, PeriodStatus(in.PeriodStatus),
			lines, in.EvidenceURIs, mustParse(in.Confidence)); err != nil {
			return nil, fixtureKind(err)
		}
		return map[string]any{"ok": true}, nil

	case opEvaluateApproval:
		var in struct {
			CreatedBy    string       `json:"created_by_principal_id"`
			Reviewer     identityWire `json:"reviewer"`
			Total        string       `json:"total_func_debit"`
			Confidence   string       `json:"proposal_confidence"`
			Intercompany bool         `json:"involves_intercompany_or_statutory_adj"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		status, err := EvaluateApprovalTransition(
			in.CreatedBy, in.Reviewer.identity(),
			mustParse(in.Total), mustParse(in.Confidence), in.Intercompany)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return string(status), nil

	case opLinesSha256:
		var in struct {
			Lines []hashLineWire `json:"lines"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		lines := make([]HashLine, 0, len(in.Lines))
		for _, l := range in.Lines {
			lines = append(lines, l.line())
		}
		return ComputeLinesSHA256(lines), nil

	case opEntrySha256:
		var in struct {
			PrevEntryHash  string `json:"prev_entry_hash"`
			JournalID      string `json:"journal_id"`
			EntityCode     string `json:"entity_code"`
			AccountingDate string `json:"accounting_date"`
			FuncDebit      string `json:"func_debit"`
			FuncCredit     string `json:"func_credit"`
			LinesSHA256    string `json:"lines_sha256"`
			CreatedBy      string `json:"created_by"`
			ApprovedBy     string `json:"approved_by"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		return ComputeEntrySHA256Hash(
			in.PrevEntryHash, in.JournalID, in.EntityCode, in.AccountingDate,
			mustParse(in.FuncDebit), mustParse(in.FuncCredit),
			in.LinesSHA256, in.CreatedBy, in.ApprovedBy), nil

	case opVerifyChain:
		var in struct {
			Journals []journalWire `json:"journals"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		journals := make([]JournalRecord, 0, len(in.Journals))
		for _, j := range in.Journals {
			journals = append(journals, j.journal())
		}
		report, err := VerifyHashChain(journals)
		if err != nil {
			return nil, err
		}
		if !report.Valid {
			return map[string]any{"valid": false, "error": report.Error}, nil
		}
		return map[string]any{"valid": true, "verified_blocks_count": report.VerifiedBlocksCount}, nil

	case opSoloMode:
		var in struct {
			Principals []struct {
				Key     string `json:"key"`
				IsHuman bool   `json:"is_human"`
				Active  bool   `json:"active"`
			} `json:"principals"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		principals := make([]Principal, 0, len(in.Principals))
		for _, p := range in.Principals {
			principals = append(principals, Principal{PrincipalKey: p.Key, IsHuman: p.IsHuman, Active: p.Active})
		}
		return map[string]any{"human_count": activeHumanCount(principals), "solo": SoloMode(principals)}, nil

	case opSelfApproval:
		var in struct {
			Solo              bool `json:"solo"`
			ApproverIsCreator bool `json:"approver_is_creator"`
			ApproverIsHuman   bool `json:"approver_is_human"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		d := CheckSelfApproval(in.Solo, in.ApproverIsCreator, in.ApproverIsHuman)
		var reason any
		if d.Reason != "" {
			reason = d.Reason
		}
		return map[string]any{"allowed": d.Allowed, "self_approved": d.SelfApproved, "reason": reason}, nil

	default:
		return nil, errors.New("positions replay: unknown op " + header.Op)
	}
}

// fixtureKind maps a guard refusal onto the harness's classified error.
func fixtureKind(err error) error {
	var inv *InvariantError
	if errors.As(err, &inv) {
		return &fixture.Error{Kind: inv.Kind}
	}
	return err
}

// TestGoldenFixtures replays the Python-generated positions fixtures byte for
// byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_positions.py
//
// The solo-mode and self-approval cases are spec-derived (SRC-0028; ADR-0001
// D4; BL-31 owner decision 2026-10-21) — no Python implementation exists.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("positions", replay)
	fixture.Run(t, "positions")
	fixture.ValidateDivergences(t)
}
