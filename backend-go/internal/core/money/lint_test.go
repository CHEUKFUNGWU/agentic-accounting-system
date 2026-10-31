package money

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/fixture"
)

// TestShopspringOnlyInsideMoney enforces the design rule that callers never
// import shopspring/decimal directly: the parity rules live in this package,
// and a second import path would fork them (design.md §money).
func TestShopspringOnlyInsideMoney(t *testing.T) {
	root, err := fixture.ModuleRoot()
	if err != nil {
		t.Fatalf("find module root: %v", err)
	}
	err = fixture.WalkGoSources(root, func(path string, src []byte) error {
		if strings.Contains(filepath.ToSlash(path), "/internal/core/money/") {
			return nil
		}
		if strings.Contains(string(src), "shopspring/decimal") {
			t.Errorf("%s imports shopspring/decimal directly; use internal/core/money", path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
}
