package money

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestParseStringParity(t *testing.T) {
	// Expected values are Python str(Decimal(s)) semantics, checked
	// independently of the Go implementation.
	cases := []struct{ in, want string }{
		{"0", "0"},
		{"-0", "-0"},
		{"1", "1"},
		{"1.5", "1.5"},
		{"1.500", "1.500"},
		{"-1.500", "-1.500"},
		{"0.000001", "0.000001"},
		{"0.0000001", "1E-7"},
		{"1E+2", "1E+2"},
		{"1e2", "1E+2"},
		{"1.5E-3", "0.0015"},
		{"1.5e2", "1.5E+2"},
		{"1.", "1"},
		{".5", "0.5"},
		{"100", "100"},
		{"+0.5", "0.5"},
		{"-0E-2", "-0.00"},
		{"0E+2", "0E+2"},
		{"001.500", "1.500"},
		{"1_000.50", "1000.50"},
		{"1_", "1"},
		{"_1", "1"},
		{"1__0", "10"},
		{"-_1", "-1"},
		{"_.5", "0.5"},
		{"1.5_", "1.5"},
		{"1e1_0", "1E+10"},
		{"  12.5  ", "12.5"},
		{"999999999999.9997", "999999999999.9997"},
		{"-999999999999.9997", "-999999999999.9997"},
	}
	for _, c := range cases {
		m, err := Parse(c.in)
		if err != nil {
			t.Fatalf("Parse(%q): unexpected error %v", c.in, err)
		}
		if got := m.String(); got != c.want {
			t.Fatalf("Parse(%q).String() = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseRejects(t *testing.T) {
	for _, in := range []string{"", "abc", "12,5", "1.2.3", "1e", "--1", "e5", ".", "._", "_ _", "1_+", "Infinity", "NaN", "- 1", "1 e2", "1.5.5_"} {
		if _, err := Parse(in); !errors.Is(err, ErrInvalidParse) {
			t.Fatalf("Parse(%q) = %v, want ErrInvalidParse", in, err)
		}
	}
}

func TestAdd(t *testing.T) {
	cases := []struct{ a, b, want string }{
		{"1.50", "0.255", "1.755"},
		{"0.00", "0.00", "0.00"},
		{"-0", "-0", "-0"},
		{"-0", "0", "0"},
		{"-5", "5", "0"},
		{"1E+2", "1E+2", "2E+2"},
		{"0", "1E+2", "100"},
		{"0.00", "1.5", "1.50"},
		{"0", "1.500", "1.500"},
		{"0E+5", "1E+2", "1E+2"},
		{"0E+2", "1E+5", "1.000E+5"},
		{"0E+2", "1.5", "1.5"},
		{"999999999999.9997", "0.0003", "1000000000000.0000"},
		{"9999999999999999999999999999", "1", "1.000000000000000000000000000E+28"},
		{"-1.500", "1.500", "0.000"},
		{"1.5e2", "1.5", "151.5"},
	}
	for _, c := range cases {
		a, err := Parse(c.a)
		if err != nil {
			t.Fatalf("Parse(%q): %v", c.a, err)
		}
		b, err := Parse(c.b)
		if err != nil {
			t.Fatalf("Parse(%q): %v", c.b, err)
		}
		if got := a.Add(b).String(); got != c.want {
			t.Fatalf("Add(%q, %q) = %q, want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestSub(t *testing.T) {
	cases := []struct{ a, b, want string }{
		{"1E+2", "1E+2", "0E+2"},
		{"1.5", "1.5", "0.0"},
		{"5", "5", "0"},
		{"0.255", "1.50", "-1.245"},
	}
	for _, c := range cases {
		a, err := Parse(c.a)
		if err != nil {
			t.Fatalf("Parse(%q): %v", c.a, err)
		}
		b, err := Parse(c.b)
		if err != nil {
			t.Fatalf("Parse(%q): %v", c.b, err)
		}
		if got := a.Sub(b).String(); got != c.want {
			t.Fatalf("Sub(%q, %q) = %q, want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestRound(t *testing.T) {
	cases := []struct {
		in    string
		place int32
		mode  RoundingMode
		want  string
	}{
		{"2.675", 2, RoundHalfUp, "2.68"},
		{"2.5", 0, RoundHalfEven, "2"},
		{"3.5", 0, RoundHalfEven, "4"},
		{"-2.5", 0, RoundHalfEven, "-2"},
		{"1.005", 2, RoundDown, "1.00"},
		{"-1.005", 2, RoundUp, "-1.01"},
		{"-0.4", 0, RoundHalfUp, "-0"},
		{"1E+2", 0, RoundHalfEven, "100"},
		{"1.5E-3", 6, RoundHalfEven, "0.001500"},
	}
	for _, c := range cases {
		m, err := Parse(c.in)
		if err != nil {
			t.Fatalf("Parse(%q): %v", c.in, err)
		}
		got, err := m.Round(c.place, c.mode)
		if err != nil {
			t.Fatalf("Round(%q, %d): %v", c.in, c.place, err)
		}
		if got.String() != c.want {
			t.Fatalf("Round(%q, %d, mode) = %q, want %q", c.in, c.place, got.String(), c.want)
		}
	}
}

func TestRoundRejectsOverPrecision(t *testing.T) {
	m, err := Parse("12345678901234567890123456789") // 29 significant digits
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if _, err := m.Round(0, RoundHalfEven); !errors.Is(err, ErrQuantize) {
		t.Fatalf("Round of a 29-digit value = %v, want ErrQuantize", err)
	}
}

func TestJSONRoundTrip(t *testing.T) {
	m, err := Parse("1.500")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(b) != `"1.500"` {
		t.Fatalf("Marshal = %s, want \"1.500\"", b)
	}
	var back Money
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if back.String() != "1.500" {
		t.Fatalf("round trip = %q, want 1.500", back.String())
	}
	// Bare number token (json.Number callers) is accepted without float64.
	var fromNumber Money
	if err := json.Unmarshal([]byte(`12.30`), &fromNumber); err != nil {
		t.Fatalf("Unmarshal(number): %v", err)
	}
	if fromNumber.String() != "12.30" {
		t.Fatalf("number round trip = %q, want 12.30", fromNumber.String())
	}
}

func TestParseStringIdentity(t *testing.T) {
	for _, s := range []string{"0", "-0.00", "1E+2", "1.500", "1E-7", "999999999999.9997", "0E+2"} {
		m, err := Parse(s)
		if err != nil {
			t.Fatalf("Parse(%q): %v", s, err)
		}
		again, err := Parse(m.String())
		if err != nil {
			t.Fatalf("Parse(String(Parse(%q))): %v", s, err)
		}
		if again.String() != m.String() {
			t.Fatalf("Parse∘String not idempotent for %q: %q vs %q", s, again.String(), m.String())
		}
	}
}

func TestComparison(t *testing.T) {
	a, _ := Parse("-0")
	b, _ := Parse("0.00")
	if !a.Equal(b) {
		t.Fatal("-0 must equal 0.00 numerically")
	}
	c, _ := Parse("1.5")
	d, _ := Parse("1.500")
	if !c.Equal(d) {
		t.Fatal("1.5 must equal 1.500")
	}
	if c.Cmp(d) != 0 || c.Cmp(b) != 1 || b.Cmp(c) != -1 {
		t.Fatal("Cmp ordering broken")
	}
}
