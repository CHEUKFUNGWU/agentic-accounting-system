package ledger

import (
	"errors"
	"testing"
)

// BL-30 regression test: the 2026-10-21 AIS textbook gap review reproduced
// the reference crash — after "Acme Pty Ltd" was created, resolving
// "ACME Pty Ltd." raised IntegrityError on counterparties.counterparty_id,
// because lookup was by exact name while the primary key was a lowercase slug
// of the name, so variants collided instead of matching. The pure port is
// lookup-only: normalized matching, found/not-found results, no creation,
// no crash.
func TestBL30_no_implicit_counterparty_creation(t *testing.T) {
	// The master file as it exists after "Acme Pty Ltd" was legitimately
	// created by an authorized command.
	existing := []Counterparty{
		{CounterpartyID: "DEMO:acme-pty-ltd", EntityCode: "DEMO",
			CounterpartyType: "VENDOR", LegalName: "Acme Pty Ltd", CountryCode: "AU"},
	}

	// The audit's crashing lookup: the name variant of an existing record.
	res, err := ResolveCounterparty(existing, "ACME Pty Ltd.")
	if err != nil {
		t.Fatalf("resolving a name variant must not crash (the reference raised IntegrityError): %v", err)
	}
	if res.Found {
		t.Error("a distinct spelling with a trailing dot is a different name and must not resolve to the existing record")
	}
	// Not-found means not-found: there is no created counterparty, no
	// allocated id, and nothing to persist. The result carries no counterpart.
	if res.Counterparty != (ResolvedCounterparty{}) {
		t.Errorf("not-found result carries a counterpart: %+v", res.Counterparty)
	}

	// The reference's exact-name lookup still resolves.
	res, err = ResolveCounterparty(existing, "Acme Pty Ltd")
	if err != nil || !res.Found {
		t.Fatalf("exact name must resolve, got found=%v err=%v", res.Found, err)
	}
	if res.Counterparty.CounterpartyID != "DEMO:acme-pty-ltd" {
		t.Errorf("resolved id = %q, want DEMO:acme-pty-ltd", res.Counterparty.CounterpartyID)
	}

	// Normalized matching finds case variants of the same name (trim +
	// case-fold), so a re-typed document still hits the existing record.
	for _, name := range []string{"acme pty ltd", "ACME PTY LTD", "  Acme Pty Ltd  "} {
		res, err = ResolveCounterparty(existing, name)
		if err != nil || !res.Found {
			t.Errorf("normalized lookup %q: found=%v err=%v, want found", name, res.Found, err)
		}
	}

	// A blank name is refused, as in the reference.
	if _, err = ResolveCounterparty(existing, ""); !errors.Is(err, ErrCounterpartyRequired) {
		t.Errorf("blank name = %v, want ErrCounterpartyRequired", err)
	}
	if _, err = ResolveCounterparty(existing, "   "); !errors.Is(err, ErrCounterpartyRequired) {
		t.Errorf("whitespace name = %v, want ErrCounterpartyRequired", err)
	}

	// Empty master file: lookup-only behaviour degrades to not-found, not
	// to creation.
	res, err = ResolveCounterparty(nil, "Brand New Vendor")
	if err != nil {
		t.Fatalf("empty master file lookup must not error: %v", err)
	}
	if res.Found {
		t.Error("lookup against an empty master file must not report found — creation is an explicit, authorized command")
	}
}

// NormalizeCounterpartyName trims but does not build a slug key: the slug key
// is the collision BL-30 forbids.
func TestNormalizeCounterpartyNameTrimsOnly(t *testing.T) {
	if got := NormalizeCounterpartyName("  Acme Pty Ltd  "); got != "Acme Pty Ltd" {
		t.Errorf("NormalizeCounterpartyName = %q, want trimmed", got)
	}
	if NormalizeCounterpartyName("Acme Pty Ltd") == NormalizeCounterpartyName("Acme Pty Ltd.") {
		t.Error("distinct spellings must not normalize to the same key")
	}
}
