// Package fixture is the golden-fixture parity harness (ADR-0002 D3, the
// primary test seam in the spec). The frozen Python reference emits
// input/output fixtures; Go tests replay the inputs through registered
// functions and must match the recorded outputs byte for byte.
//
// The expected-divergence registry (fixtures/divergences.yaml) is bounded:
// entries map one-to-one to SRC-0026 finding IDs and each entry excludes
// only that finding's registered reproduction scenario — never a module,
// never a control. Engineering-workflow §3 invariant tests and control-matrix
// counterexamples are never divergence-eligible. A fixture that diverges
// without a registration fails; a registration without a passing Go
// regression test fails CI.
package fixture

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// Error lets a replay function report a classified failure. Fixtures record
// an expected error kind so rejection behaviour is pinned without pinning
// Python's message text.
type Error struct{ Kind string }

func (e *Error) Error() string { return "fixture: " + e.Kind }

// findingRe bounds the registry to business-logic finding IDs. The 30
// SRC-0026 findings are all BL-XX (business-logic audit BL-01..29 and the
// AIS review BL-30..36); the AIS GAP-01..07 rows are capability gaps the
// owner registered as requirement candidates, not migration findings.
var findingRe = regexp.MustCompile(`^BL-\d+$`)

// ErrorKind extracts the classified kind from a replay error.
func ErrorKind(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return ""
}

// Replay runs one fixture case: input values in, output values out. Money
// values cross as strings; no float64 may appear in a replay result.
type Replay func(input json.RawMessage) (any, error)

var registry = map[string]Replay{}

// Register installs the replay function for a fixture module. Duplicate
// registration is a wiring bug and panics.
func Register(module string, r Replay) {
	if _, dup := registry[module]; dup {
		panic(fmt.Sprintf("fixture: module %q registered twice", module))
	}
	registry[module] = r
}

// caseFile is the on-disk fixture schema written by tools/gen_fixtures.py.
type caseFile struct {
	Module        string          `json:"module"`
	Case          string          `json:"case"`
	Input         json.RawMessage `json:"input"`
	Output        json.RawMessage `json:"output"`
	ExpectedError string          `json:"expected_error"`
}

// divergence is one entry of fixtures/divergences.yaml. Bounded by design:
// one per SRC-0026 finding, scoped to one scenario, and mechanically tied to
// a named Go regression test.
type divergence struct {
	Finding  string `yaml:"finding"`
	Module   string `yaml:"module"`
	Scenario string `yaml:"scenario"`
	Test     string `yaml:"test"`
	Reason   string `yaml:"reason"`
}

// Run loads fixtures/<module>/*.json relative to the module root, replays
// each case and compares canonical output bytes. A mismatch fails unless a
// registered expected divergence covers exactly this module and scenario.
func Run(t *testing.T, module string) {
	t.Helper()
	root, err := ModuleRoot()
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	replay, ok := registry[module]
	if !ok {
		t.Fatalf("fixture: module %q has no registered replay", module)
	}
	dir := filepath.Join(root, "fixtures", module)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("fixture: read %s (generate with backend-go/tools/gen_fixtures.py): %v", dir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			files = append(files, e.Name())
		}
	}
	if len(files) == 0 {
		t.Fatalf("fixture: no fixtures under %s", dir)
	}
	sort.Strings(files)
	for _, name := range files {
		t.Run(strings.TrimSuffix(name, ".json"), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			var c caseFile
			if err := json.Unmarshal(raw, &c); err != nil {
				t.Fatalf("parse fixture: %v", err)
			}
			problem, note := checkCase(root, module, replay, c)
			// File name and case must match: divergence scenarios are keyed
			// by case, and the registry validation checks the file exists
			// under the scenario name.
			if problem == "" && c.Case != strings.TrimSuffix(name, ".json") {
				problem = fmt.Sprintf("fixture file %q names case %q; file name and case must match", name, c.Case)
			}
			if note != "" {
				t.Logf("%s", note)
			}
			if problem != "" {
				t.Fatal(problem)
			}
		})
	}
}

// checkCase replays one parsed fixture document and returns a problem
// message, or "" when the replay matches the recorded output. A match
// achieved through a registered expected divergence is returned as a note
// for the caller to log. Pure over its inputs, so tests can drive it
// directly.
func checkCase(root, module string, replay Replay, c caseFile) (problem, note string) {
	if c.Module != module {
		return fmt.Sprintf("fixture says module %q, run for %q", c.Module, module), ""
	}
	out, err := replay(c.Input)
	if c.ExpectedError != "" {
		if err == nil {
			return fmt.Sprintf("replay succeeded, want error kind %q", c.ExpectedError), ""
		}
		if kind := ErrorKind(err); kind != c.ExpectedError {
			return fmt.Sprintf("replay error kind = %q, want %q (err: %v)", kind, c.ExpectedError, err), ""
		}
		return "", ""
	}
	if err != nil {
		return fmt.Sprintf("replay: %v", err), ""
	}
	got, err := canonical(out)
	if err != nil {
		return fmt.Sprintf("canonicalize output: %v", err), ""
	}
	want, err := canonical(json.RawMessage(c.Output))
	if err != nil {
		return fmt.Sprintf("canonicalize expected output: %v", err), ""
	}
	if !bytes.Equal(got, want) {
		d, ok, err := lookupDivergence(root, module, c.Case)
		if err != nil {
			return fmt.Sprintf("read divergences: %v", err), ""
		}
		if ok {
			return "", fmt.Sprintf("expected divergence %s (%s): %s", d.Finding, d.Scenario, d.Reason)
		}
		return fmt.Sprintf("output mismatch (no expected-divergence registration):\n got: %s\nwant: %s", got, want), ""
	}
	return "", ""
}

// canonical renders output as deterministic JSON bytes: sorted keys, no HTML
// escaping, numbers preserved as tokens. Both the expected and actual sides
// pass through the same canonicalizer, so comparison is over one form.
func canonical(v any) ([]byte, error) {
	var decoded any
	dec := json.NewDecoder(bytes.NewReader(rawOf(v)))
	dec.UseNumber()
	if err := dec.Decode(&decoded); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(decoded); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func rawOf(v any) []byte {
	if r, ok := v.(json.RawMessage); ok {
		return r
	}
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func lookupDivergence(root, module, scenario string) (divergence, bool, error) {
	divs, err := loadDivergences(root)
	if err != nil {
		return divergence{}, false, err
	}
	for _, d := range divs {
		if d.Module == module && d.Scenario == scenario {
			return d, true, nil
		}
	}
	return divergence{}, false, nil
}

// loadDivergences reads fixtures/divergences.yaml under the module root.
func loadDivergences(root string) ([]divergence, error) {
	raw, err := os.ReadFile(filepath.Join(root, "fixtures", "divergences.yaml"))
	if err != nil {
		return nil, err
	}
	var doc struct {
		Entries []divergence `yaml:"entries"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	return doc.Entries, nil
}

// ValidateDivergences enforces the registry's bound mechanically (design.md
// §fixture): one entry per SRC-0026 finding, each scoped to one scenario
// that exists as a fixture case file, each carrying a reason and the name of
// a Go regression test that exists in the module's source. Called from
// tests, so an entry that breaks any of these fails CI.
func ValidateDivergences(t *testing.T) {
	t.Helper()
	root, err := ModuleRoot()
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	divs, err := loadDivergences(root)
	if err != nil {
		t.Fatalf("read divergences.yaml: %v", err)
	}
	tests := goTestFunctions(t, root)
	seen := map[string]string{}
	for _, d := range divs {
		if !findingRe.MatchString(d.Finding) {
			t.Errorf("divergence finding %q is not a BL-XX finding ID", d.Finding)
		}
		if d.Module == "" || d.Scenario == "" || d.Reason == "" || d.Test == "" {
			t.Errorf("divergence %s needs module, scenario, test and reason", d.Finding)
			continue
		}
		if prev, dup := seen[d.Finding]; dup {
			t.Errorf("divergence finding %s registered twice (%s and %s); the bound is one entry per finding", d.Finding, prev, d.Scenario)
		}
		seen[d.Finding] = d.Scenario
		caseFile := filepath.Join(root, "fixtures", d.Module, d.Scenario+".json")
		if _, err := os.Stat(caseFile); err != nil {
			t.Errorf("divergence %s scenario %q is not a fixture case of module %q (missing %s)", d.Finding, d.Scenario, d.Module, caseFile)
		}
		if _, ok := tests[d.Test]; !ok {
			t.Errorf("divergence %s regression test %q not found in source; a registration without a passing Go regression test fails CI", d.Finding, d.Test)
		}
	}
}

// goTestFunctions collects the test function names declared in the module's
// Go sources, keyed by name.
func goTestFunctions(t *testing.T, root string) map[string]bool {
	t.Helper()
	funcRe := regexp.MustCompile(`(?m)^func (Test\w+)\(`)
	names := map[string]bool{}
	err := WalkGoSources(root, func(path string, src []byte) error {
		for _, m := range funcRe.FindAllStringSubmatch(string(src), -1) {
			names[m[1]] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan test functions: %v", err)
	}
	return names
}

// WalkGoSources visits every Go source file under root, skipping
// non-source directories (.git, vendor, fixtures, tools). fn receives each
// file's path and contents. Shared by the divergence registry validation and
// the money package's import lint, which walk for the same purpose.
func WalkGoSources(root string, fn func(path string, src []byte) error) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "vendor", "fixtures", "tools":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return fn(path, src)
	})
}

// ModuleRoot walks up from the working directory to the directory holding
// go.mod (tests run inside their package directory).
func ModuleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("fixture: no go.mod above %s", dir)
		}
		dir = parent
	}
}
