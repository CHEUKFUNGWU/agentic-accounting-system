package money

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// Fixture error kinds on the money replay wire — the same strings
// tools/gen_fixtures.py writes into expected_error fields.
const (
	kindInvalidParse    = "invalid_parse"
	kindInvalidQuantize = "invalid_quantize"
	kindDivisionByZero  = "division_by_zero"
	kindDivideInvalid   = "divide_invalid"
	kindOverflow        = "overflow"
)

// moneyReplay executes one fixture case. The op names and mode names are the
// wire forms written by backend-go/tools/gen_fixtures.py.
func moneyReplay(input json.RawMessage) (any, error) {
	var in struct {
		Op     string `json:"op"`
		A      string `json:"a"`
		B      string `json:"b"`
		Places *int32 `json:"places"`
		Mode   string `json:"mode"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	a, err := Parse(in.A)
	if err != nil {
		return nil, &fixture.Error{Kind: kindInvalidParse}
	}
	switch in.Op {
	case "string":
		return a.String(), nil
	case "add":
		b, err := Parse(in.B)
		if err != nil {
			return nil, &fixture.Error{Kind: kindInvalidParse}
		}
		return a.Add(b).String(), nil
	case "mul":
		b, err := Parse(in.B)
		if err != nil {
			return nil, &fixture.Error{Kind: kindInvalidParse}
		}
		return a.Mul(b).String(), nil
	case "div":
		b, err := Parse(in.B)
		if err != nil {
			return nil, &fixture.Error{Kind: kindInvalidParse}
		}
		q, err := a.Div(b)
		if err != nil {
			if errors.Is(err, ErrDivisionByZero) {
				return nil, &fixture.Error{Kind: kindDivisionByZero}
			}
			if errors.Is(err, ErrDivideInvalid) {
				return nil, &fixture.Error{Kind: kindDivideInvalid}
			}
			if errors.Is(err, ErrOverflow) {
				return nil, &fixture.Error{Kind: kindOverflow}
			}
			return nil, &fixture.Error{Kind: kindInvalidQuantize}
		}
		return q.String(), nil
	case "round":
		if in.Places == nil {
			return nil, errors.New("money replay: round needs places")
		}
		mode, err := parseMode(in.Mode)
		if err != nil {
			return nil, err
		}
		r, err := a.Round(*in.Places, mode)
		if err != nil {
			return nil, &fixture.Error{Kind: kindInvalidQuantize}
		}
		return r.String(), nil
	default:
		return nil, errors.New("money replay: unknown op " + in.Op)
	}
}

// TestGoldenFixtures replays the Python-generated money fixtures byte for
// byte (ADR-0002 D3). Generate with:
//
//	cd backend && uv run python ../backend-go/tools/gen_fixtures.py
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("money", moneyReplay)
	fixture.Run(t, "money")
	fixture.ValidateDivergences(t)
}
