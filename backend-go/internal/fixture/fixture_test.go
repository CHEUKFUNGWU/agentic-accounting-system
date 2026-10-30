package fixture

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// selftestReplay covers the harness mechanics: echo returns the input, and
// reject returns a classified error.
func selftestReplay(input json.RawMessage) (any, error) {
	var in struct {
		Op string `json:"op"`
		A  string `json:"a"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	switch in.Op {
	case "echo":
		return in.A, nil
	case "reject":
		return nil, &Error{Kind: "invalid_input"}
	default:
		return nil, errors.New("unknown op")
	}
}

func writeSelfDivergences(t *testing.T, root string, entries []divergence) {
	t.Helper()
	var b strings.Builder
	b.WriteString("entries:\n")
	for _, d := range entries {
		b.WriteString("  - finding: " + d.Finding + "\n")
		b.WriteString("    module: " + d.Module + "\n")
		b.WriteString("    scenario: " + d.Scenario + "\n")
		b.WriteString("    reason: " + d.Reason + "\n")
	}
	dir := filepath.Join(root, "fixtures")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "divergences.yaml"), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func selfCase(t *testing.T, c, op, a, output, expectedError string) []byte {
	t.Helper()
	doc := map[string]any{"module": "fixtureselftest", "case": c, "input": map[string]any{"op": op, "a": a}}
	if expectedError != "" {
		doc["expected_error"] = expectedError
	} else {
		doc["output"] = output
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// TestHarnessMechanics drives checkCase directly: a matching case passes, a
// mismatch fails with a repairable message, a registered expected divergence
// passes with a note, and expected errors compare by kind.
func TestHarnessMechanics(t *testing.T) {
	root := t.TempDir()
	writeSelfDivergences(t, root, []divergence{
		{Finding: "BL-99", Module: "fixtureselftest", Scenario: "echo_divergent", Reason: "harness self-test"},
	})

	problem, note := checkCase(root, "fixtureselftest", selftestReplay,
		selfCase(t, "echo_ok", "echo", "1.500", "1.500", ""))
	if problem != "" || note != "" {
		t.Fatalf("matching case: problem=%q note=%q", problem, note)
	}

	problem, note = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase(t, "echo_divergent", "echo", "1.500", "1.50", ""))
	if problem != "" {
		t.Fatalf("registered divergence must pass, got problem=%q", problem)
	}
	if note == "" {
		t.Fatal("registered divergence must produce a note for the log")
	}

	problem, _ = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase(t, "echo_unregistered", "echo", "1.500", "1.50", ""))
	if problem == "" {
		t.Fatal("unregistered mismatch must fail")
	}

	problem, _ = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase(t, "reject_ok", "reject", "x", "", "invalid_input"))
	if problem != "" {
		t.Fatalf("classified error case must pass, got %q", problem)
	}

	problem, _ = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase(t, "reject_kind", "reject", "x", "", "other_kind"))
	if problem == "" {
		t.Fatal("wrong error kind must fail")
	}

	problem, _ = checkCase(root, "othermodule", selftestReplay,
		selfCase(t, "echo_ok", "echo", "1.500", "1.500", ""))
	if problem == "" {
		t.Fatal("module mismatch must fail")
	}
}

// TestValidateDivergencesOnRealRegistry validates the repository's own
// divergences.yaml against the bounded-registry rules.
func TestValidateDivergencesOnRealRegistry(t *testing.T) {
	ValidateDivergences(t)
}
