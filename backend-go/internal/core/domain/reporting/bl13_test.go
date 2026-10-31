package reporting

import (
	"errors"
	"strings"
	"testing"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// BL-13 regression: unmapped statement categories block reporting.
//
// Audit scenario (reporting.py:169-173, 213-221; ledger.py:247): an
// inventory debit 500 against a loan credit 500 reported zero assets and
// liabilities with every consistency check passing — the statements picked
// bands with inline fs_category literals and dropped everything else on the
// floor. Required: validated/versioned mappings and blocking on unmapped
// balances.

func bl13Rows() []ledger.TrialBalanceReportRow {
	return []ledger.TrialBalanceReportRow{
		// The defect's scenario: inventory 500 bought on the owner's loan 500.
		trow("1490", "存貨", "ASSET", "INVENTORY", "500.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
		trow("2190", "業主往來", "LIABILITY", "DIRECTOR_LOAN", "-500.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
	}
}

// TestBL13_unmapped_categories_block_reporting pins the corrected outcome:
// mapping version 1 has no inventory band, so the pack REFUSES with an
// error naming the category and account — it never again reports zero
// assets and liabilities with checks passing.
func TestBL13_unmapped_categories_block_reporting(t *testing.T) {
	if err := ValidateStatementCategories(bl13Rows()); !errors.Is(err, ErrFSCategoryUnmapped) {
		t.Fatalf("ValidateStatementCategories = %v, want ErrFSCategoryUnmapped", err)
	} else if !strings.Contains(err.Error(), "INVENTORY") || !strings.Contains(err.Error(), "1490") {
		t.Errorf("refusal must name the category and account, got %v", err)
	}
	if _, err := DeriveFigures(bl13Rows()); !errors.Is(err, ErrFSCategoryUnmapped) {
		t.Errorf("DeriveFigures = %v, want ErrFSCategoryUnmapped (the pack cannot silently drop the inventory)", err)
	}
	// The same gate guards entry-level classification.
	chart := baseChart()
	chart = append(chart, acc("1490", "INVENTORY", "ASSET", "DEBIT"))
	if err := ValidateChartCategories(chart); !errors.Is(err, ErrFSCategoryUnmapped) {
		t.Errorf("ValidateChartCategories = %v, want ErrFSCategoryUnmapped", err)
	}
	// A genuinely unknown category blocks the same way.
	typoRows := cashMonthRows()
	typoRows[1].FSCategory = "REVANUE"
	err := ValidateStatementCategories(typoRows)
	if !errors.Is(err, ErrFSCategoryUnmapped) || !strings.Contains(err.Error(), "REVANUE") {
		t.Errorf("typo'd category = %v, want ErrFSCategoryUnmapped naming REVANUE", err)
	}
	// And the mapping is a versioned artifact: the version is stated in the
	// refusal and the mapped set is queryable.
	if FSCategoryMappingVersion == "" {
		t.Error("the mapping must carry a version")
	}
	if got := len(MappedCategories()); got != 14 {
		t.Errorf("mapping v1 maps %d categories, want 14 (the reference's handled set)", got)
	}
}

// TestBL13_mapped_categories_report pins the contrast: the gate blocks only
// unmapped categories. The mapped loan reports as a real liability — the
// defect's other half (a mapped balance disappearing behind zeros) stays
// fixed.
func TestBL13_mapped_categories_report(t *testing.T) {
	// Loan-financed purchase with a MAPPED category: cash 500 spent on
	// prepayments, funded by the owner's loan.
	rows := []ledger.TrialBalanceReportRow{
		trow("1410", "預付費用及進項稅額", "ASSET", "PREPAY_TAX", "500.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
		trow("2190", "業主往來", "LIABILITY", "DIRECTOR_LOAN", "-500.0000", "0.0000", "0.0000", "0.0000", "0.0000"),
	}
	f, err := DeriveFigures(rows)
	if err != nil {
		t.Fatal(err)
	}
	if f.TotalAssets.String() != "500.0000" {
		t.Errorf("total assets = %s, want 500.0000 (mapped balances report, not zero)", f.TotalAssets.String())
	}
	if f.TotalLiabilities.String() != "500.0000" {
		t.Errorf("total liabilities = %s, want 500.0000", f.TotalLiabilities.String())
	}
	bs, err := BalanceSheet(f, StructureSMECorp, "2026-10", "HKD")
	if err != nil {
		t.Fatal(err)
	}
	if !bs.TotalAssets.Equal(bs.TotalLiabilitiesAndEquity) {
		t.Errorf("A (%s) must equal L+E (%s)", bs.TotalAssets.String(), bs.TotalLiabilitiesAndEquity.String())
	}
}
