package localization

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// Fixture error kinds on the localization replay wire — the strings
// tools/gen_localization.py writes into expected_error fields.
const (
	kindInvalidParse        = "invalid_parse"
	kindInvalidQuantize     = "invalid_quantize"
	kindInvalidJurisdiction = "invalid_jurisdiction"
	kindInvalidTaxID        = "invalid_tax_identifier"
)

// classify maps a replay error onto its fixture error kind. Wiring mistakes
// (unknown op, unparseable input document) stay unclassified and fail loudly.
func classify(err error) error {
	switch {
	case errors.Is(err, ErrInvalidTaxIdentifier):
		return &fixture.Error{Kind: kindInvalidTaxID}
	case errors.Is(err, money.ErrQuantize):
		return &fixture.Error{Kind: kindInvalidQuantize}
	case errors.Is(err, ErrUnknownJurisdiction):
		return &fixture.Error{Kind: kindInvalidJurisdiction}
	case errors.Is(err, money.ErrInvalidParse):
		return &fixture.Error{Kind: kindInvalidParse}
	}
	return err
}

// replayParseMoney parses a fixture money string, classifying a bad value as
// the invalid_parse fixture kind (the reference raises InvalidOperation at
// the same boundary).
func replayParseMoney(s string) (money.Money, error) {
	m, err := money.Parse(s)
	if err != nil {
		return money.Money{}, &fixture.Error{Kind: kindInvalidParse}
	}
	return m, nil
}

// localizationReplay executes one fixture case. The op names and input field
// names are the wire forms written by backend-go/tools/gen_localization.py.
// Money amounts cross as strings and are parsed here, never float-decoded.
func localizationReplay(input json.RawMessage) (any, error) {
	var in struct {
		Op           string `json:"op"`
		Jurisdiction string `json:"jurisdiction"`
		NetAmount    string `json:"net_amount"`
		TaxCode      string `json:"tax_code"`
		// Optional identifier inputs: absent and empty are the same falsy
		// value the reference reads.
		CounterpartyTaxID string `json:"counterparty_tax_id"`
		EInvoiceCode      string `json:"einvoice_code"`
		IsCrossBorderB2B  bool   `json:"is_cross_border_b2b"`
		HKProfitSource    string `json:"hk_profit_source"`

		MonthlyLeasePayment          string `json:"monthly_lease_payment"`
		OpeningLeaseLiability        string `json:"opening_lease_liability"`
		MonthlyDiscountRate          string `json:"monthly_discount_rate"`
		StraightLineIfrsRouAmort     string `json:"straight_line_ifrs_rou_amortization"`
		StraightLineAsc842SingleCost string `json:"straight_line_asc842_single_lease_cost"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	switch in.Op {
	case "evaluate_tax":
		j, err := ParseJurisdiction(in.Jurisdiction)
		if err != nil {
			return nil, classify(err)
		}
		net, err := replayParseMoney(in.NetAmount)
		if err != nil {
			return nil, err
		}
		out, err := EvaluateIndirectAndWithholdingTax(TaxInput{
			Jurisdiction:      j,
			NetAmount:         net,
			TaxCode:           in.TaxCode,
			CounterpartyTaxID: in.CounterpartyTaxID,
			EInvoiceCode:      in.EInvoiceCode,
			IsCrossBorderB2B:  in.IsCrossBorderB2B,
			HKProfitSource:    in.HKProfitSource,
		})
		if err != nil {
			return nil, classify(err)
		}
		return out, nil
	case "lease_delta":
		fields := []string{
			in.MonthlyLeasePayment,
			in.OpeningLeaseLiability,
			in.MonthlyDiscountRate,
			in.StraightLineIfrsRouAmort,
			in.StraightLineAsc842SingleCost,
		}
		vals := make([]money.Money, len(fields))
		for i, s := range fields {
			m, err := replayParseMoney(s)
			if err != nil {
				return nil, err
			}
			vals[i] = m
		}
		out, err := ComputeLeaseIFRS16VsASC842Delta(vals[0], vals[1], vals[2], vals[3], vals[4])
		if err != nil {
			return nil, classify(err)
		}
		return out, nil
	default:
		return nil, errors.New("localization replay: unknown op " + in.Op)
	}
}

// TestGoldenFixtures replays the Python-generated localization fixtures byte
// for byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_localization.py
//
// BL-22 scenarios are excluded from the golden baseline; their rejection
// behaviour is pinned by TestBL22_tax_identifier_fail_closed instead.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("localization", localizationReplay)
	fixture.Run(t, "localization")
	fixture.ValidateDivergences(t)
}
