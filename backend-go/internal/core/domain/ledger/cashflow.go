package ledger

import (
	"sort"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports cash_flow_breakdown (backend/app/core/ledger.py, "Cash
// flow, by nature"): where the cash came from and where it went, bucketed by
// what the other side of the entry was. The derivation is an identity, not an
// estimate: the cash change equals the sum of every non-cash line's
// (credit - debit), so the buckets cannot disagree with the ledger.
//
// Compound entries overstate the gross buckets while still tying net cash —
// that is finding BL-18 and belongs to the reporting package's cash
// classification; this port reproduces the reference derivation as-is.

// CashFlowBucket is one bucket row: a functional-scheme category, the account
// type it rides on, and the signed contribution.
type CashFlowBucket struct {
	FSCategory  string      `json:"fs_category"`
	AccountType string      `json:"account_type"`
	Amount      money.Money `json:"amount"`
}

// CashFlowReport mirrors cash_flow_breakdown's return.
type CashFlowReport struct {
	EntityCode      string           `json:"entity_code"`
	Period          string           `json:"period"`
	Currency        *string          `json:"currency"` // filled by the caller in the reference; null here
	Opening         money.Money      `json:"opening"`
	Closing         money.Money      `json:"closing"`
	Movement        money.Money      `json:"movement"`
	DerivedMovement money.Money      `json:"derived_movement"`
	Inflows         []CashFlowBucket `json:"inflows"`
	Outflows        []CashFlowBucket `json:"outflows"`
	Ties            bool             `json:"ties"`
	PeriodStart     string           `json:"period_start"`
	PeriodEnd       string           `json:"period_end"`
}

// CashFlowBreakdown ports cash_flow_breakdown over the entity's chart, all
// its lines and its period rows. Lines are validated through the get_lines
// path (fail closed on malformed legacy rows); the tie that matters for the
// reader — opening + movement == the balance sheet's cash — is checked in
// Ties.
func CashFlowBreakdown(chart []Account, lines []Line, periods []Period, entityCode, periodCode string) (CashFlowReport, error) {
	cashCodes := map[string]bool{}
	for _, a := range chart {
		if a.FSCategory == "CASH" {
			cashCodes[a.AccountCode] = true
		}
	}
	period, err := ResolvePeriod(entityCode, periodCode, periods)
	if err != nil {
		return CashFlowReport{}, err
	}
	periodLines, err := FilterLines(lines, LineQuery{
		EntityCode: entityCode,
		PeriodCode: periodCode,
	})
	if err != nil {
		return CashFlowReport{}, err
	}

	// Group by entry in first-appearance order, as the reference's dict does,
	// so bucket insertion order is deterministic.
	var entryOrder []string
	byEntry := map[string][]Line{}
	for _, l := range periodLines {
		if _, seen := byEntry[l.JournalID]; !seen {
			entryOrder = append(entryOrder, l.JournalID)
		}
		byEntry[l.JournalID] = append(byEntry[l.JournalID], l)
	}

	var bucketOrder []string
	bucketAmount := map[string]money.Money{}
	bucketType := map[string]string{}
	for _, journalID := range entryOrder {
		entryLines := byEntry[journalID]
		hasCash := false
		for _, l := range entryLines {
			if cashCodes[l.AccountCode] {
				hasCash = true
				break
			}
		}
		if !hasCash {
			continue
		}
		for _, l := range entryLines {
			if cashCodes[l.AccountCode] {
				continue
			}
			contribution, err := q4(l.FuncCredit.Sub(l.FuncDebit))
			if err != nil {
				return CashFlowReport{}, err
			}
			if contribution.IsZero() {
				continue
			}
			key := "OTHER"
			accountType := ""
			for _, a := range chart {
				if a.AccountCode == l.AccountCode {
					if a.FSCategory != "" {
						key = a.FSCategory
					}
					accountType = a.AccountType
					break
				}
			}
			if _, seen := bucketAmount[key]; !seen {
				bucketOrder = append(bucketOrder, key)
				bucketAmount[key] = zeroQ4
				bucketType[key] = accountType
			}
			acc, err := q4(bucketAmount[key].Add(contribution))
			if err != nil {
				return CashFlowReport{}, err
			}
			bucketAmount[key] = acc
		}
	}

	balances, err := DeriveBalances(chart, lines, entityCode, periodCode)
	if err != nil {
		return CashFlowReport{}, err
	}
	byCode := BalancesByCode(balances)
	opening, closing := zeroQ4, zeroQ4
	for _, a := range chart {
		if !cashCodes[a.AccountCode] {
			continue
		}
		b, ok := byCode[a.AccountCode]
		if !ok {
			continue
		}
		opening = opening.Add(b.Opening)
		c, err := b.Closing()
		if err != nil {
			return CashFlowReport{}, err
		}
		closing = closing.Add(c)
	}
	opening, err = q4(opening)
	if err != nil {
		return CashFlowReport{}, err
	}
	closing, err = q4(closing)
	if err != nil {
		return CashFlowReport{}, err
	}
	derived := zeroQ4
	for _, key := range bucketOrder {
		derived = derived.Add(bucketAmount[key])
	}
	derived, err = q4(derived)
	if err != nil {
		return CashFlowReport{}, err
	}
	movement, err := q4(closing.Sub(opening))
	if err != nil {
		return CashFlowReport{}, err
	}

	report := CashFlowReport{
		EntityCode:      entityCode,
		Period:          periodCode,
		Opening:         opening,
		Closing:         closing,
		Movement:        movement,
		DerivedMovement: derived,
		Inflows:         []CashFlowBucket{},
		Outflows:        []CashFlowBucket{},
		Ties:            derived.Equal(movement),
		PeriodStart:     period.StartDate,
		PeriodEnd:       period.EndDate,
	}
	report.Inflows, err = bucketRows(bucketOrder, bucketAmount, bucketType, 1)
	if err != nil {
		return CashFlowReport{}, err
	}
	report.Outflows, err = bucketRows(bucketOrder, bucketAmount, bucketType, -1)
	return report, err
}

// bucketRows ports the reference's bucket_rows(sign): the buckets on one side
// of zero, amounts rendered on that side's own sign, largest first (stable,
// as Python's sorted is).
func bucketRows(order []string, amount map[string]money.Money, kinds map[string]string, sign int) ([]CashFlowBucket, error) {
	rows := []CashFlowBucket{}
	for _, key := range order {
		v := amount[key]
		positive := v.Cmp(zeroNum) > 0
		if positive != (sign > 0) || v.IsZero() {
			continue
		}
		shown := v
		if sign < 0 {
			shown = v.Neg()
		}
		rows = append(rows, CashFlowBucket{FSCategory: key, AccountType: kinds[key], Amount: shown})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Amount.Cmp(rows[j].Amount) > 0 })
	return rows, nil
}
