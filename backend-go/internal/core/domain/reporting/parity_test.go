package reporting

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// Fixture error kinds on the reporting replay wire — the strings
// tools/gen_reporting.py would write into expected_error fields. The
// reference's drivable surface (generate_reporting_pack) never refuses, so
// no current fixture carries one; the classification exists so P3 parity
// cases can pin rejections without pinning message text.
func classify(err error) error {
	switch {
	case errors.Is(err, ErrFSCategoryUnmapped):
		return &fixture.Error{Kind: "fs_category_unmapped"}
	case errors.Is(err, ErrFilingJurisdictionUnsupported):
		return &fixture.Error{Kind: "filing_jurisdiction_unsupported"}
	case errors.Is(err, ErrCashEntryUnbalanced):
		return &fixture.Error{Kind: "cashflow_entry_unbalanced"}
	case errors.Is(err, ErrCOAMissingAccount):
		return &fixture.Error{Kind: "coa_missing_account"}
	case errors.Is(err, ErrDivisionByZero):
		return &fixture.Error{Kind: "division_by_zero"}
	case errors.Is(err, ErrInvalidStatementInput):
		return &fixture.Error{Kind: "invalid_statement_input"}
	case errors.Is(err, money.ErrQuantize):
		return &fixture.Error{Kind: "invalid_quantize"}
	case errors.Is(err, money.ErrInvalidParse):
		return &fixture.Error{Kind: "invalid_parse"}
	}
	return err
}

// reportingReplay executes one fixture case. The op names and input field
// names are the wire forms written by backend-go/tools/gen_reporting.py;
// the expected outputs are the reference pack's own statement slices.
func reportingReplay(input json.RawMessage) (any, error) {
	var in struct {
		Op              string `json:"op"`
		Period          string `json:"period"`
		PeriodCode      string `json:"period_code"`
		Currency        string `json:"currency"`
		Jurisdiction    string `json:"jurisdiction"`
		EntityStructure string `json:"entity_structure"`

		Rows []ledger.TrialBalanceReportRow `json:"rows"`

		Chart []ledger.Account `json:"chart"`
		Lines []ledger.Line    `json:"lines"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	switch in.Op {
	case "trial_balance":
		comp, err := CompileTrialBalance(in.Rows)
		if err != nil {
			return nil, classify(err)
		}
		return comp, nil
	case "income_statement":
		f, err := DeriveFigures(in.Rows)
		if err != nil {
			return nil, classify(err)
		}
		out, err := IncomeStatement(f, in.Period, in.Currency)
		if err != nil {
			return nil, classify(err)
		}
		return out, nil
	case "balance_sheet":
		structure, err := ParseLegalStructure(in.EntityStructure)
		if err != nil {
			return nil, classify(err)
		}
		f, err := DeriveFigures(in.Rows)
		if err != nil {
			return nil, classify(err)
		}
		out, err := BalanceSheet(f, structure, in.Period, in.Currency)
		if err != nil {
			return nil, classify(err)
		}
		return out, nil
	case "tax_schedule":
		f, err := DeriveFigures(in.Rows)
		if err != nil {
			return nil, classify(err)
		}
		out, _, err := StatutoryTaxSchedule(f, in.Jurisdiction)
		if err != nil {
			return nil, classify(err)
		}
		return out, nil
	case "cash_flow":
		structure, err := ParseLegalStructure(in.EntityStructure)
		if err != nil {
			return nil, classify(err)
		}
		_ = structure // the balance-sheet shape is not part of this slice
		span, err := ledger.PeriodBounds(in.PeriodCode)
		if err != nil {
			return nil, classify(err)
		}
		out, err := CashFlowStatement(in.Chart, in.Lines, span.Start, span.End, in.Period, in.Currency)
		if err != nil {
			return nil, classify(err)
		}
		return out, nil
	default:
		return nil, errors.New("reporting replay: unknown op " + in.Op)
	}
}

// TestGoldenFixtures replays the Python-generated reporting fixtures byte
// for byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_reporting.py
//
// The finding defect scenarios (BL-12, 13, 14, 18, 20 and the BL-17
// projection) are excluded from the golden baseline; their corrected
// behaviour is pinned by the TestBL* regressions instead.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("reporting", reportingReplay)
	fixture.Run(t, "reporting")
	fixture.ValidateDivergences(t)
}
