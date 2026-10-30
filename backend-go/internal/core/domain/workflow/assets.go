package workflow

import (
	"errors"
	"strconv"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports asset.register and asset.depreciate of
// backend/app/core/monolith.py (lines 262–292) over value types, with the
// BL-11 fix.
//
// Store boundary (P2): the reference's commands mutate the fixedAssets
// collection, reopen/complete the CLS-05 close task and post the depreciation
// journal inside the workspace transaction. The port returns the schedule;
// the P2 store adapter persists the updated rows and posts the entry.

// assetCategories is the reference's category whitelist.
var assetCategories = map[string]bool{
	"Compute Cluster": true, "Networking": true, "Leasehold": true, "Workstations": true,
}

// AssetRecord is one fixed-assets row plus the BL-11 capitalization link.
type AssetRecord struct {
	ID                      string      `json:"id"`
	Name                    string      `json:"name"`
	Category                string      `json:"category"`
	InServiceDate           string      `json:"in_service_date"`
	UsefulLifeMonths        int         `json:"useful_life_months"`
	CostBasis               money.Money `json:"cost_basis"`
	SalvageValue            money.Money `json:"salvage_value"`
	AccumulatedDepreciation money.Money `json:"accumulated_depreciation"`
	LastDepreciatedPeriod   string      `json:"last_depreciated_period"`
	Status                  string      `json:"status"`
	// BL-11: the validated capitalization link — the posted entry that
	// capitalized the cost, and the asset account it debited. Empty until the
	// acquisition posting is linked; depreciation is refused without it.
	CapitalizationEntryID     string `json:"capitalization_entry_id,omitempty"`
	CapitalizationAccountCode string `json:"capitalization_account_code,omitempty"`
}

// NewAsset is RegisterAsset's input. The in-service date is the document date
// the caller supplies (BL-34: no defaulting through posting_date).
type NewAsset struct {
	Name             string
	Category         string
	InServiceDate    string
	UsefulLifeMonths int
	CostBasis        money.Money
	SalvageValue     money.Money
}

// RegisterAsset ports asset.register's validation: a positive cost, salvage
// not above cost, a useful life of 1–1200 months, a whitelisted category, a
// name, and an explicit in-service date. The reference's bool/int typing
// check on usefulLifeMonths is unrepresentable in Go's typed input (a JSON
// true never reaches here; parity_test.go maps it onto ErrInvalidAsset).
// The record starts uncaptalized: registering alone capitalizes nothing
// (BL-11) — the acquisition posting is a separate, linked step
// (CapitalizeAsset).
func RegisterAsset(in NewAsset, assetID string) (AssetRecord, error) {
	name, err := ValidateText(in.Name, "asset name", 500)
	if err != nil {
		return AssetRecord{}, err
	}
	var zero money.Money
	if in.CostBasis.Cmp(zero) <= 0 {
		return AssetRecord{}, invalidAmount()
	}
	if in.UsefulLifeMonths < 1 || in.UsefulLifeMonths > 1200 || in.SalvageValue.Cmp(in.CostBasis) > 0 {
		return AssetRecord{}, fail(ErrInvalidAsset,
			"INVALID_ASSET: Useful life must be 1–1200 months and salvage cannot exceed cost.")
	}
	if !assetCategories[in.Category] {
		return AssetRecord{}, fail(ErrInvalidAssetCategory, "INVALID_ASSET_CATEGORY")
	}
	if _, err := ValidateISODate(in.InServiceDate, nil); err != nil {
		return AssetRecord{}, err
	}
	return AssetRecord{
		ID:               assetID,
		Name:             name,
		Category:         in.Category,
		InServiceDate:    in.InServiceDate,
		UsefulLifeMonths: in.UsefulLifeMonths,
		CostBasis:        in.CostBasis,
		SalvageValue:     in.SalvageValue,
		Status:           "Active",
	}, nil
}

// CapitalizeAsset links a registered asset to its posted acquisition: the
// entry that debited the asset account with the cost. The BL-11 validation
// runs in ValidateCapitalization; recording the link is a separate, explicit
// act — registering alone capitalizes nothing.
func CapitalizeAsset(asset AssetRecord, entryID, accountCode string) AssetRecord {
	asset.CapitalizationEntryID = entryID
	asset.CapitalizationAccountCode = accountCode
	return asset
}

// ValidateCapitalization is the BL-11 rule: depreciation requires a validated
// capitalization linkage. The link must name a POSTED entry whose debits to
// the asset account equal the registered cost basis — the asset-register/GL
// reconciliation the review record requires. The reference registered 1,200
// with no capitalization at all and still depreciated 100/month; the port
// refuses every depreciation run until the link exists and reconciles.
func ValidateCapitalization(asset AssetRecord, journals []JournalEntry, chart []ChartAccount) error {
	if asset.CapitalizationEntryID == "" || asset.CapitalizationAccountCode == "" {
		return fail(ErrAssetNotCapitalized,
			"ASSET_NOT_CAPITALIZED: "+asset.ID+" has no validated capitalization link; post and link the acquisition before depreciating.")
	}
	if _, err := FindEligibleAccount(chart, asset.CapitalizationAccountCode, ""); err != nil {
		return err
	}
	var entry *JournalEntry
	for i := range journals {
		if journals[i].ID == asset.CapitalizationEntryID {
			entry = &journals[i]
			break
		}
	}
	if entry == nil {
		return fail(ErrAssetNotCapitalized,
			"ASSET_NOT_CAPITALIZED: capitalization entry "+asset.CapitalizationEntryID+" does not exist.")
	}
	if entry.Status != "Posted" {
		return fail(ErrCapitalizationNotPosted,
			"CAPITALIZATION_NOT_POSTED: capitalization entry "+entry.ID+" is "+entry.Status+", not Posted.")
	}
	var zero money.Money
	capitalized := money.Money{}
	for _, l := range entry.Lines {
		if l.AccountCode == asset.CapitalizationAccountCode {
			capitalized = capitalized.Add(l.Debit)
		}
	}
	if !capitalized.Equal(asset.CostBasis) || capitalized.Cmp(zero) <= 0 {
		return fail(ErrCapitalizationMismatch,
			"CAPITALIZATION_AMOUNT_MISMATCH: entry "+entry.ID+" capitalizes "+capitalized.String()+
				" to "+asset.CapitalizationAccountCode+"; the register carries "+asset.CostBasis.String()+".")
	}
	return nil
}

// DepreciationResult is one asset's run outcome (asset.depreciate's per-row
// mutation, as values).
type DepreciationResult struct {
	AssetID                 string      `json:"asset_id"`
	Amount                  money.Money `json:"amount"`
	AccumulatedDepreciation money.Money `json:"accumulated_depreciation"`
	LastDepreciatedPeriod   string      `json:"last_depreciated_period"`
	Status                  string      `json:"status"`
}

// RunDepreciation ports asset.depreciate's schedule computation with the
// BL-11 gate: every asset due for the period must have a validated
// capitalization link BEFORE anything is computed (fail closed — the run
// either validates whole or produces nothing). The per-asset math is the
// reference's: base = cost − salvage; monthly = round2(base ÷ life,
// HALF_UP) capped at the remaining depreciable base; an asset whose
// remaining base is fully consumed becomes Fully Depreciated. A run with
// nothing due is refused (NO_DEPRECIATION_DUE), exactly like the reference.
func RunDepreciation(assets []AssetRecord, journals []JournalEntry, chart []ChartAccount, period string) ([]DepreciationResult, money.Money, error) {
	due := make([]AssetRecord, 0, len(assets))
	for _, a := range assets {
		if a.LastDepreciatedPeriod >= period {
			continue
		}
		due = append(due, a)
	}
	for _, a := range due {
		if err := ValidateCapitalization(a, journals, chart); err != nil {
			return nil, money.Money{}, err
		}
	}
	results := make([]DepreciationResult, 0, len(due))
	total := money.Money{}
	for _, a := range due {
		base := a.CostBasis.Sub(a.SalvageValue)
		remaining := base.Sub(a.AccumulatedDepreciation)
		var zero money.Money
		if remaining.Cmp(zero) < 0 {
			remaining = zero
		}
		monthly, err := divMoneyInt(base, int64(a.UsefulLifeMonths))
		if err != nil {
			return nil, money.Money{}, err
		}
		amount, err := monthly.Round(2, money.RoundHalfUp)
		if err != nil {
			return nil, money.Money{}, err
		}
		if amount.Cmp(remaining) > 0 {
			amount = remaining
		}
		status := "Active"
		if amount.Equal(remaining) {
			status = "Fully Depreciated"
		}
		accumulated := a.AccumulatedDepreciation.Add(amount)
		results = append(results, DepreciationResult{
			AssetID:                 a.ID,
			Amount:                  amount,
			AccumulatedDepreciation: accumulated,
			LastDepreciatedPeriod:   period,
			Status:                  status,
		})
		total = total.Add(amount)
	}
	if total.Cmp(money.Money{}) <= 0 {
		return nil, money.Money{}, fail(ErrNoDepreciationDue,
			"NO_DEPRECIATION_DUE: No assets need depreciation for this period.")
	}
	return results, total, nil
}

// divMoneyInt divides an exact money value by a positive integer the way the
// reference's Decimal division does: money.Div carries the full context
// semantics (ideal exponent for exact quotients, 28-significant-digit
// half-even rounding otherwise); the wrapper only enforces the
// positive-integer divisor the depreciation schedule needs.
func divMoneyInt(m money.Money, d int64) (money.Money, error) {
	if d <= 0 {
		return money.Money{}, errors.New("workflow: division needs a positive integer divisor")
	}
	divisor, err := money.Parse(strconv.FormatInt(d, 10))
	if err != nil {
		return money.Money{}, err
	}
	return m.Div(divisor)
}
