package ledger

import "strings"

// This file replaces the counterparty resolution of backend/app/core/ledger.py
// with the BL-30 rule (2026-10-21 AIS textbook gap review): the reference's
// resolve_counterparty creates a counterparty master record as a side effect
// of document intake — no approval, no change record — and its lowercase-slug
// primary key makes name variants collide instead of match ("Acme Pty Ltd"
// then "ACME Pty Ltd." raised IntegrityError on counterparties.counterparty_id).
//
// The pure port is lookup-only: find by normalized name, report found or
// not-found, never create, never crash on a variant. Creation is an explicit,
// authorized master-data command at the store layer, with its own change
// record; near-duplicate warnings are a caller concern on top of this lookup.

// Counterparty mirrors one counterparties row (CounterpartyModel) as the pure
// rules read it.
type Counterparty struct {
	CounterpartyID   string `json:"counterparty_id"`
	EntityCode       string `json:"entity_code"`
	CounterpartyType string `json:"counterparty_type"`
	LegalName        string `json:"legal_name"`
	CountryCode      string `json:"country_code"`
	TaxIDNumber      string `json:"tax_id_number"`
	WithholdingRule  string `json:"withholding_rule"`
}

// ResolvedCounterparty is what a found match exposes: identity, name and
// type — the reference's found branch returns exactly these three fields.
type ResolvedCounterparty struct {
	CounterpartyID   string `json:"counterparty_id"`
	LegalName        string `json:"legal_name"`
	CounterpartyType string `json:"counterparty_type"`
}

// CounterpartyLookup is the BL-30 result: found or not-found. There is no
// created flag and no id allocation, because nothing is written.
type CounterpartyLookup struct {
	Found        bool                 `json:"found"`
	Counterparty ResolvedCounterparty `json:"counterparty"`
}

// NormalizeCounterpartyName trims surrounding whitespace for lookup equality
// (the reference strips the incoming name too). Case is folded at comparison
// time by ResolveCounterparty, not by building a slug key — the slug key is
// the collision BL-30 forbids.
func NormalizeCounterpartyName(name string) string {
	return strings.TrimSpace(name)
}

// ResolveCounterparty finds a counterparty by normalized name and reports the
// outcome. A blank name is COUNTERPARTY_REQUIRED, as in the reference. A name
// that matches no existing record is a not-found result, not a creation and
// not an error: "ACME Pty Ltd." after "Acme Pty Ltd" resolves to not-found
// instead of the reference's IntegrityError crash. Matching is Unicode simple
// case-folding over trimmed names, so "acme pty ltd" finds "Acme Pty Ltd"
// while variant spellings (punctuation, abbreviations) stay distinct — the
// audit's "normalized matching" floor; full case folding (ß→ss) is not
// applied and remains a documented micro-divergence.
func ResolveCounterparty(counterparties []Counterparty, name string) (CounterpartyLookup, error) {
	wanted := NormalizeCounterpartyName(name)
	if wanted == "" {
		return CounterpartyLookup{}, fail(ErrCounterpartyRequired, "COUNTERPARTY_REQUIRED: 對方單位不可為空。")
	}
	for _, c := range counterparties {
		if strings.EqualFold(NormalizeCounterpartyName(c.LegalName), wanted) {
			return CounterpartyLookup{
				Found: true,
				Counterparty: ResolvedCounterparty{
					CounterpartyID:   c.CounterpartyID,
					LegalName:        c.LegalName,
					CounterpartyType: c.CounterpartyType,
				},
			}, nil
		}
	}
	return CounterpartyLookup{Found: false}, nil
}
