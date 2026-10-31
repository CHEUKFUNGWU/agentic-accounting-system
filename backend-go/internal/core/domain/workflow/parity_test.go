package workflow

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// replayIn is the union of the ops' input shapes, exactly as
// tools/gen_workflow.py writes them. Money crosses as strings and parses
// into money.Money — never float64.
type replayIn struct {
	Op string `json:"op"`

	// amount / text / iso_date
	Value    json.RawMessage `json:"value"`
	Signed   bool            `json:"signed"`
	Positive bool            `json:"positive"`
	Field    string          `json:"field"`
	Limit    int             `json:"limit"`
	Period   *string         `json:"period"`

	// command gate
	Source string `json:"source"`
	Locked bool   `json:"locked"`
	Action string `json:"action"`

	// bills
	Bill       billWire        `json:"bill"`
	Approver   principalWire   `json:"approver"`
	Principals []principalWire `json:"principals"`

	// bank
	Bank        bankWire     `json:"bank"`
	Ledger      ledgerWire   `json:"ledger"`
	BankItems   []bankWire   `json:"bank_items"`
	LedgerItems []ledgerWire `json:"ledger_items"`

	// tax provision
	Schedules    []scheduleWire `json:"schedules"`
	FormCode     string         `json:"form_code"`
	Jurisdiction string         `json:"jurisdiction"`
	Amount       string         `json:"amount"`
	EntryID      string         `json:"entry_id"`

	// asset registration
	Name             string          `json:"name"`
	Category         string          `json:"category"`
	UsefulLifeMonths json.RawMessage `json:"useful_life_months"`
	CostBasis        string          `json:"cost_basis"`
	SalvageValue     string          `json:"salvage_value"`
	InServiceDate    string          `json:"in_service_date"`
}

type billWire struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	CreatedBy string `json:"created_by"`
	Amount    string `json:"amount"`
}

type principalWire struct {
	PrincipalKey string `json:"principal_key"`
	IsHuman      bool   `json:"is_human"`
	Active       bool   `json:"active"`
}

func (p principalWire) principal() positions.Principal {
	return positions.Principal{PrincipalKey: p.PrincipalKey, IsHuman: p.IsHuman, Active: p.Active}
}

type bankWire struct {
	ID     string `json:"id"`
	Amount string `json:"amount"`
	Status string `json:"status"`
}

type ledgerWire struct {
	ID         string `json:"id"`
	Amount     string `json:"amount"`
	Reconciled bool   `json:"reconciled"`
}

type scheduleWire struct {
	ID                   string `json:"id"`
	FormCode             string `json:"form_code"`
	Jurisdiction         string `json:"jurisdiction"`
	TaxableBase          string `json:"taxable_base"`
	StatutoryRate        string `json:"statutory_rate"`
	CreditsAndDeductions string `json:"credits_and_deductions"`
	Status               string `json:"status"`
	ProvisionJournalID   string `json:"provision_journal_id"`
}

// parseLife reads useful_life_months: an integer JSON number only — the
// reference's bool/int check (a JSON true is INVALID_ASSET).
func parseLife(raw json.RawMessage) (int, bool) {
	s := strings.TrimSpace(string(raw))
	if len(s) == 0 {
		return 0, false
	}
	if s[0] < '0' || s[0] > '9' {
		return 0, false
	}
	var life int
	if err := json.Unmarshal(raw, &life); err != nil {
		return 0, false
	}
	return life, true
}

func mustParse(s string) money.Money {
	m, err := money.Parse(s)
	if err != nil {
		// A fixture amount the reference itself accepted always parses.
		panic("workflow replay: unparsable fixture money " + s)
	}
	return m
}

// classify maps a replay error onto its fixture kind: the kinded sentinels'
// texts ARE the kinds; money's parse/quantize errors map beside them. Wiring
// mistakes (unknown op, unparsable input document) stay unclassified and fail
// loudly.
func classify(err error) error {
	for _, kind := range kindedSentinels {
		if errors.Is(err, kind) {
			return &fixture.Error{Kind: kind.Error()}
		}
	}
	switch {
	case errors.Is(err, money.ErrInvalidParse):
		return &fixture.Error{Kind: "invalid_parse"}
	case errors.Is(err, money.ErrQuantize):
		return &fixture.Error{Kind: "invalid_quantize"}
	}
	return err
}

// jsonString decodes a JSON string value; ok is false for anything else.
func jsonString(raw json.RawMessage) (string, bool) {
	s := strings.TrimSpace(string(raw))
	if len(s) == 0 || s[0] != '"' {
		return "", false
	}
	var quoted string
	if err := json.Unmarshal(raw, &quoted); err != nil {
		return "", false
	}
	return quoted, true
}

// replayValue renders the amount op's value: a JSON string parses verbatim, a
// bare number token keeps its literal text, and a bool or null is the
// reference's INVALID_AMOUNT bool branch.
func replayValue(raw json.RawMessage) (string, bool) {
	s := strings.TrimSpace(string(raw))
	if len(s) == 0 {
		return "", false
	}
	if s[0] == '"' {
		return jsonString(raw)
	}
	switch s[0] {
	case '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9':
		return s, true
	}
	return "", false
}

// workflowReplay executes one fixture case. The op names and input field
// names are the wire forms written by backend-go/tools/gen_workflow.py; every
// recorded value comes from the frozen reference's own functions.
func workflowReplay(input json.RawMessage) (any, error) {
	var in replayIn
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	switch in.Op {
	case "amount":
		raw, ok := replayValue(in.Value)
		if !ok {
			return nil, classify(invalidAmount())
		}
		m, err := ParseAmount(raw, in.Signed, in.Positive)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"amount": m.String()}, nil

	case "text":
		value, ok := jsonString(in.Value)
		if !ok {
			return nil, fail(ErrInvalidField,
				"INVALID_FIELD: "+in.Field+" is required, up to a string value.")
		}
		out, err := ValidateText(value, in.Field, in.Limit)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"text": out}, nil

	case "iso_date":
		value, ok := jsonString(in.Value)
		if !ok {
			return nil, fail(ErrInvalidDate, "INVALID_DATE: Use YYYY-MM-DD.")
		}
		out, err := ValidateISODate(value, in.Period)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"date": out}, nil

	case "journal_source":
		if err := ValidateJournalSource(in.Source); err != nil {
			return nil, classify(err)
		}
		return map[string]any{"source": in.Source}, nil

	case "command_gate":
		if err := CommandPeriodGate(in.Locked, in.Action); err != nil {
			return nil, classify(err)
		}
		return map[string]any{"allowed": true}, nil

	case "approve_bill":
		bill := BillRecord{
			ID:                    in.Bill.ID,
			Status:                BillStatus(in.Bill.Status),
			CreatedByPrincipalKey: in.Bill.CreatedBy,
			Amount:                mustParse(in.Bill.Amount),
		}
		principals := make([]positions.Principal, 0, len(in.Principals))
		for _, p := range in.Principals {
			principals = append(principals, p.principal())
		}
		updated, _, err := ApproveBill(bill, in.Approver.principal(), principals)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"status": string(updated.Status)}, nil

	case "pay_bill":
		bill := BillRecord{
			ID:                    in.Bill.ID,
			Status:                BillStatus(in.Bill.Status),
			CreatedByPrincipalKey: in.Bill.CreatedBy,
			Amount:                mustParse(in.Bill.Amount),
		}
		updated, _, err := RecordBillPayment(bill)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"status": string(updated.Status)}, nil

	case "reconcile":
		bank, err := bankOf(in.Bank)
		if err != nil {
			return nil, err
		}
		ledgerItem, err := ledgerOf(in.Ledger)
		if err != nil {
			return nil, err
		}
		result, err := MatchBankItem(bank, ledgerItem)
		if err != nil {
			return nil, classify(err)
		}
		bankItems := make([]BankItem, 0, len(in.BankItems))
		for _, b := range in.BankItems {
			item, err := bankOf(b)
			if err != nil {
				return nil, err
			}
			if item.ID == result.Bank.ID {
				item = result.Bank
			}
			bankItems = append(bankItems, item)
		}
		ledgerItems := make([]LedgerCashItem, 0, len(in.LedgerItems))
		for _, l := range in.LedgerItems {
			item, err := ledgerOf(l)
			if err != nil {
				return nil, err
			}
			if item.ID == result.Ledger.ID {
				item = result.Ledger
			}
			ledgerItems = append(ledgerItems, item)
		}
		return map[string]any{
			"bank_status":           result.Bank.Status,
			"matched_ledger_id":     result.Bank.MatchedLedgerID,
			"match_confidence":      100,
			"ledger_reconciled":     result.Ledger.Reconciled,
			"close_check_completed": CloseCheckReconciliation(bankItems, ledgerItems),
		}, nil

	case "tax_provision":
		var schedule *TaxSchedule
		for _, s := range in.Schedules {
			if s.FormCode == in.FormCode && s.Jurisdiction == in.Jurisdiction {
				schedule = &TaxSchedule{
					ID:                   s.ID,
					FormCode:             s.FormCode,
					Jurisdiction:         s.Jurisdiction,
					TaxableBase:          mustParse(s.TaxableBase),
					StatutoryRate:        mustParse(s.StatutoryRate),
					CreditsAndDeductions: mustParse(s.CreditsAndDeductions),
					Status:               s.Status,
					ProvisionJournalID:   s.ProvisionJournalID,
				}
				break
			}
		}
		if schedule == nil {
			return nil, classify(fail(ErrNotFound, "NOT_FOUND: Unknown tax schedule."))
		}
		stated, err := ParseAmount(in.Amount, false, false)
		if err != nil {
			return nil, classify(err)
		}
		updated, err := PostProvision(*schedule, stated, in.EntryID)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"provision_journal_id": updated.ProvisionJournalID}, nil

	case "register_asset":
		cost, err := ParseAmount(in.CostBasis, false, true)
		if err != nil {
			return nil, classify(err)
		}
		salvage, err := ParseAmount(in.SalvageValue, false, false)
		if err != nil {
			return nil, classify(err)
		}
		life, ok := parseLife(in.UsefulLifeMonths)
		if !ok {
			return nil, classify(fail(ErrInvalidAsset,
				"INVALID_ASSET: Useful life must be 1–1200 months and salvage cannot exceed cost."))
		}
		asset, err := RegisterAsset(NewAsset{
			Name:             in.Name,
			Category:         in.Category,
			InServiceDate:    in.InServiceDate,
			UsefulLifeMonths: life,
			CostBasis:        cost,
			SalvageValue:     salvage,
		}, "FA-0000000000")
		if err != nil {
			return nil, classify(err)
		}
		// No success case exists in the baseline (the reference's record
		// embeds a float conversion); the projection stays minimal.
		return map[string]any{"name": asset.Name}, nil

	case "bank_exception":
		item, err := bankOf(in.Bank)
		if err != nil {
			return nil, err
		}
		resolution, err := ClassifyBankException(item, nil, nil, nil)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"kind": string(resolution.Kind)}, nil
	}
	return nil, errors.New("workflow replay: unknown op " + in.Op)
}

func bankOf(w bankWire) (BankItem, error) {
	amount, err := money.Parse(w.Amount)
	if err != nil {
		return BankItem{}, err
	}
	return BankItem{ID: w.ID, Amount: amount, Status: w.Status}, nil
}

func ledgerOf(w ledgerWire) (LedgerCashItem, error) {
	amount, err := money.Parse(w.Amount)
	if err != nil {
		return LedgerCashItem{}, err
	}
	return LedgerCashItem{ID: w.ID, Amount: amount, Reconciled: w.Reconciled}, nil
}

// TestGoldenFixtures replays the Python-generated workflow fixtures byte for
// byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_workflow.py
//
// The finding defect scenarios (BL-09 candidate-blind posting, BL-27 float
// persistence, BL-31 missing creator/approver records, BL-32 duplicate
// acceptance, BL-33 absent void, BL-34 date defaulting, BL-35 stored buckets,
// BL-11 uncaptalized depreciation, BL-21 post-posting input edits) are
// excluded from the golden baseline; their fixed behaviour is pinned by the
// TestBL* regression tests. divergences.yaml stays empty: every generated
// case is behaviour the reference itself exhibits.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("workflow", workflowReplay)
	fixture.Run(t, "workflow")
	fixture.ValidateDivergences(t)
}
