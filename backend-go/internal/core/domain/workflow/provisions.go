package workflow

import (
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports tax.provision and tax.update of backend/app/core/monolith.py
// (lines 235–261) over value types, with the BL-21 fix.
//
// Store boundary (P2): the reference's commands mutate the taxSchedules
// collection and post the provision journal inside the workspace transaction;
// the P2 store adapter persists the schedule row and the entry.

// TaxSchedule is one taxSchedules row as the provision rules read it. The
// money fields arrive parsed (ParseAmount at the boundary); the rate is a
// percentage like 8.875.
type TaxSchedule struct {
	ID                   string      `json:"id"`
	FormCode             string      `json:"form_code"`
	Jurisdiction         string      `json:"jurisdiction"`
	TaxableBase          money.Money `json:"taxable_base"`
	StatutoryRate        money.Money `json:"statutory_rate"`
	CreditsAndDeductions money.Money `json:"credits_and_deductions"`
	Status               string      `json:"status"`
	// ProvisionJournalID is the posted provision's entry id; empty means the
	// provision has not been recorded.
	ProvisionJournalID string `json:"provision_journal_id,omitempty"`
}

// ProvisionAmount ports tax.provision's calculation: gross = the taxable base
// times the statutory rate, divided by 100 and rounded to whole units with
// ROUND_HALF_UP; the provision is the gross minus credits and deductions,
// floored at zero. Division by 100 is a pure decimal-point shift (exact for
// every decimal), expressed as a multiplication so no division operator is
// needed; the final quantize to whole units erases any representation
// difference from the reference's divide-by-100 form.
func ProvisionAmount(s TaxSchedule) money.Money {
	gross := s.TaxableBase.Mul(s.StatutoryRate).Mul(mustAmount("0.01"))
	gross, err := gross.Round(0, money.RoundHalfUp)
	if err != nil {
		// The product of two range-checked amounts cannot exceed the
		// quantize bound without overflowing the 28-digit context first —
		// unreachable for reference inputs; fail loudly rather than guess.
		panic("workflow: provision gross exceeds the reference context: " + err.Error())
	}
	amount := gross.Sub(s.CreditsAndDeductions)
	var zero money.Money
	if amount.Cmp(zero) < 0 {
		amount = zero
	}
	return amount
}

// PostProvision ports tax.provision's guards and effect: a schedule records
// its provision once (ALREADY_POSTED), the stated amount must equal the
// recomputed one (PROVISION_MISMATCH — refresh the calculation before
// posting), and the posted journal's id is recorded on the schedule. The
// entry itself is the caller's: Pair("6800", "2150", amount) through
// BuildJournalEntry with source "System Accrual". entryID arrives as an
// argument.
func PostProvision(s TaxSchedule, statedAmount money.Money, entryID string) (TaxSchedule, error) {
	if s.ProvisionJournalID != "" {
		return TaxSchedule{}, fail(ErrAlreadyPosted,
			"ALREADY_POSTED: This provision has already been recorded.")
	}
	amount := ProvisionAmount(s)
	if !statedAmount.Equal(amount) {
		return TaxSchedule{}, fail(ErrProvisionMismatch,
			"PROVISION_MISMATCH: Refresh the tax calculation before posting.")
	}
	s.ProvisionJournalID = entryID
	return s, nil
}

// TaxUpdates is tax.update's change set: only the calculation inputs and the
// review status are editable, and the reference refuses anything else
// (INVALID_TAX_UPDATE).
type TaxUpdates struct {
	TaxableBase          *money.Money `json:"taxable_base,omitempty"`
	CreditsAndDeductions *money.Money `json:"credits_and_deductions,omitempty"`
	Status               *string      `json:"status,omitempty"`
	// Other lists disallowed keys the caller received; the reference's
	// set-difference refusal.
	Other []string `json:"other,omitempty"`
}

// taxStatuses is tax.update's local review-status whitelist. A local update
// can never mark a return as filed.
var taxStatuses = map[string]bool{"In Review": true, "Ready to File": true, "Nexus Warning": true}

// UpdateTaxSchedule ports tax.update with the BL-21 fix: once the provision
// is posted, the calculation inputs are frozen — the reference let them move
// after posting, leaving a 210 journal against inputs that now calculated
// 420. The freeze is the owner-recorded remedy ("freeze inputs or linked
// adjustment workflow"): adjusting a posted provision goes through the
// correction workflow (reverse the provision entry, restate the inputs,
// repost) — the P2 store adapter owns that flow; nothing here edits a frozen
// input in place. Review-status updates stay allowed.
func UpdateTaxSchedule(s TaxSchedule, updates TaxUpdates) (TaxSchedule, error) {
	for _, key := range updates.Other {
		return TaxSchedule{}, fail(ErrInvalidTaxUpdate,
			"INVALID_TAX_UPDATE: Only the calculation inputs and review status are editable (got "+key+").")
	}
	frozen := s.ProvisionJournalID != "" && (updates.TaxableBase != nil || updates.CreditsAndDeductions != nil)
	if frozen {
		return TaxSchedule{}, fail(ErrProvisionInputsFrozen,
			"PROVISION_INPUTS_FROZEN: Provision "+s.ProvisionJournalID+" recorded these inputs; adjust through the correction workflow.")
	}
	if updates.TaxableBase != nil {
		s.TaxableBase = *updates.TaxableBase
	}
	if updates.CreditsAndDeductions != nil {
		s.CreditsAndDeductions = *updates.CreditsAndDeductions
	}
	if updates.Status != nil {
		if !taxStatuses[*updates.Status] {
			return TaxSchedule{}, fail(ErrFilingNotConnected,
				"FILING_NOT_CONNECTED: A local update cannot mark a return as filed.")
		}
		s.Status = *updates.Status
	}
	return s, nil
}
