package posting

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// The op names and field names are the wire forms written by
// backend-go/tools/gen_posting.py. Money values cross as strings; no float64
// appears anywhere on the wire.

type postInputWire struct {
	Submitted voucher.Snapshot `json:"submitted"`
	Current   voucher.Snapshot `json:"current"`

	Chart   []ledger.Account `json:"chart"`
	Periods []ledger.Period  `json:"periods"`

	Original     *voucher.Snapshot    `json:"original"`
	OriginalRows []voucher.LedgerLine `json:"original_rows"`
	// EffectiveReversalOf is the store query's answer as a list of journal
	// IDs (the reference selects one per original; the list is the set).
	EffectiveReversalOf []string     `json:"effective_reversal_of"`
	Chain               []ChainEntry `json:"chain"`
	Approver            Approver     `json:"approver"`
	PostedAt            string       `json:"posted_at"`
}

// replay executes one fixture case. Refusals surface as *fixture.Error
// carrying the reference's message-kind prefix.
func replay(input json.RawMessage) (any, error) {
	var header struct {
		Op string `json:"op"`
	}
	if err := json.Unmarshal(input, &header); err != nil {
		return nil, err
	}
	switch header.Op {
	case "post_voucher":
		return replayPost(input)
	case "save":
		var in struct {
			Current   voucher.Snapshot `json:"current"`
			Submitted voucher.Snapshot `json:"submitted"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		plan, err := PlanSave(in.Current, in.Submitted)
		if err != nil {
			return nil, fixtureKind(err)
		}
		return plan, nil
	case "chain_head":
		var in struct {
			Entries []ChainEntry `json:"entries"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		prevHash, nextIndex := ChainHead(in.Entries)
		return map[string]any{"prev_entry_hash": prevHash, "next_block_index": nextIndex}, nil
	case "destination_columns":
		var in struct {
			EntryLayer *string `json:"entry_layer"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		layer := ""
		if in.EntryLayer != nil {
			layer = *in.EntryLayer
		}
		return DestinationColumns(layer), nil
	case "review_verdict":
		var in struct {
			Status               string   `json:"status"`
			VoucherNo            *string  `json:"voucher_no"`
			Verdict              string   `json:"verdict"`
			ReviewerPosition     string   `json:"reviewer_position"`
			ReviewerPrincipalKey string   `json:"reviewer_principal_key"`
			Checked              []string `json:"checked"`
			Reason               string   `json:"reason"`
			ReviewedAt           string   `json:"reviewed_at"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return nil, err
		}
		current := Journal{Status: voucher.Status(in.Status), VoucherNo: in.VoucherNo}
		outcome, err := ApplyReview(current, ReviewDecision{
			Verdict:              in.Verdict,
			ReviewerPosition:     in.ReviewerPosition,
			ReviewerPrincipalKey: in.ReviewerPrincipalKey,
			Checked:              in.Checked,
			Reason:               in.Reason,
			ReviewedAt:           in.ReviewedAt,
		})
		if err != nil {
			return nil, fixtureKind(err)
		}
		return outcome, nil
	}
	return nil, errors.New("posting replay: unknown op " + header.Op)
}

func replayPost(input json.RawMessage) (any, error) {
	var in postInputWire
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	current, err := ParseJournal(in.Current)
	if err != nil {
		return nil, err
	}
	effective := map[string]bool{}
	for _, id := range in.EffectiveReversalOf {
		effective[id] = true
	}
	seq := Input{
		Submitted:           in.Submitted,
		CurrentDoc:          in.Current,
		Current:             current,
		Chart:               in.Chart,
		Periods:             in.Periods,
		OriginalRows:        in.OriginalRows,
		EffectiveReversalOf: effective,
		Chain:               in.Chain,
		Approver:            in.Approver,
		PostedAt:            in.PostedAt,
	}
	if in.Original != nil {
		original, err := ParseJournal(*in.Original)
		if err != nil {
			return nil, err
		}
		seq.Original = &original
	}
	plan, err := Plan(seq)
	if err != nil {
		return nil, fixtureKind(err)
	}
	return plan, nil
}

// fixtureKind maps the path's errors onto the harness's classified error.
// The reference re-wraps every LedgerError as a PostingError carrying the
// kind prefix, so the ledger sentinels map to their UPPER_SNAKE kinds here
// (unlike the ledger module's replay, whose fixtures use the lowercase
// sentinel names).
func fixtureKind(err error) error {
	var pe *voucher.PostingError
	if errors.As(err, &pe) {
		return &fixture.Error{Kind: pe.Kind}
	}
	switch {
	case errors.Is(err, ledger.ErrInvalidPeriod):
		return &fixture.Error{Kind: "INVALID_PERIOD"}
	case errors.Is(err, ledger.ErrInvalidAccountingDate):
		return &fixture.Error{Kind: "INVALID_ACCOUNTING_DATE"}
	case errors.Is(err, ledger.ErrPeriodDateMismatch):
		return &fixture.Error{Kind: "PERIOD_DATE_MISMATCH"}
	case errors.Is(err, ledger.ErrPeriodLocked):
		return &fixture.Error{Kind: "PERIOD_LOCKED"}
	case errors.Is(err, ledger.ErrCOAMissingAccount):
		return &fixture.Error{Kind: "COA_MISSING_ACCOUNT"}
	}
	return err
}

// TestGoldenFixtures replays the Python-generated posting fixtures byte for
// byte (ADR-0002 D3). Generate with:
//
//	cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_posting.py
//
// The cases drive the frozen reference for real over isolated SQLite (the
// harness of the reference's own posting tests). Injected mid-transaction
// failure scenarios are excluded: the transaction is P2 store work, and the
// pure all-or-nothing property is pinned by TestPlanNeverMutatesInputs.
func TestGoldenFixtures(t *testing.T) {
	fixture.Register("posting", replay)
	fixture.Run(t, "posting")
	fixture.ValidateDivergences(t)
}
