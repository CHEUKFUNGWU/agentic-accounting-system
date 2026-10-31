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
		b.WriteString("    test: " + d.Test + "\n")
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

func selfCase(module, c, input, output, expectedError string) caseFile {
	cf := caseFile{Module: module, Case: c, Input: json.RawMessage(input)}
	if expectedError != "" {
		cf.ExpectedError = expectedError
	} else {
		cf.Output = json.RawMessage(output)
	}
	return cf
}

// TestHarnessMechanics drives checkCase directly: a matching case passes, a
// mismatch fails with a repairable message, a registered expected divergence
// passes with a note, and expected errors compare by kind.
func TestHarnessMechanics(t *testing.T) {
	root := t.TempDir()
	writeSelfDivergences(t, root, []divergence{
		{Finding: "BL-99", Module: "fixtureselftest", Scenario: "echo_divergent", Test: "TestHarnessMechanics", Reason: "harness self-test"},
	})

	problem, note := checkCase(root, "fixtureselftest", selftestReplay,
		selfCase("fixtureselftest", "echo_ok", `{"op":"echo","a":"1.500"}`, `"1.500"`, ""))
	if problem != "" || note != "" {
		t.Fatalf("matching case: problem=%q note=%q", problem, note)
	}

	problem, note = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase("fixtureselftest", "echo_divergent", `{"op":"echo","a":"1.500"}`, `"1.50"`, ""))
	if problem != "" {
		t.Fatalf("registered divergence must pass, got problem=%q", problem)
	}
	if note == "" {
		t.Fatal("registered divergence must produce a note for the log")
	}

	problem, _ = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase("fixtureselftest", "echo_unregistered", `{"op":"echo","a":"1.500"}`, `"1.50"`, ""))
	if problem == "" {
		t.Fatal("unregistered mismatch must fail")
	}

	problem, _ = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase("fixtureselftest", "reject_ok", `{"op":"reject","a":"x"}`, "", "invalid_input"))
	if problem != "" {
		t.Fatalf("classified error case must pass, got %q", problem)
	}

	problem, _ = checkCase(root, "fixtureselftest", selftestReplay,
		selfCase("fixtureselftest", "reject_kind", `{"op":"reject","a":"x"}`, "", "other_kind"))
	if problem == "" {
		t.Fatal("wrong error kind must fail")
	}

	problem, _ = checkCase(root, "othermodule", selftestReplay,
		selfCase("fixtureselftest", "echo_ok", `{"op":"echo","a":"1.500"}`, `"1.500"`, ""))
	if problem == "" {
		t.Fatal("module mismatch must fail")
	}
}

// TestValidateDivergencesOnRealRegistry validates the repository's own
// divergences.yaml against the bounded-registry rules.
func TestValidateDivergencesOnRealRegistry(t *testing.T) {
	ValidateDivergences(t)
}
