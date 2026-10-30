package reporting

import "testing"

// TestDeriveFiguresHandlesEveryMappedCategory guards the single-source rule
// behind BL-13: every category in the versioned mapping must have a figure
// bucket in DeriveFigures. A category added to the mapping without a bucket
// would silently contribute zero figures to every statement.
func TestDeriveFiguresHandlesEveryMappedCategory(t *testing.T) {
	handled := map[string]bool{
		"REVENUE": true, "COGS": true, "OPEX": true, "DEPRECIATION": true,
		"TAX_EXPENSE": true, "CASH": true, "AR": true, "PREPAY_TAX": true,
		"FIXED_ASSET": true, "CONTRA_ASSET": true, "AP_ACCRUAL": true,
		"TAX_PAYABLE": true, "DIRECTOR_LOAN": true, "EQUITY": true,
	}
	for k := range fsCategoryRules {
		if !handled[k] {
			t.Errorf("fsCategoryRules has %q but DeriveFigures has no bucket for it", k)
		}
	}
}
