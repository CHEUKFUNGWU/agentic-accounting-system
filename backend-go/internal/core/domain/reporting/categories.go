package reporting

import (
	"fmt"
	"sort"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
)

// The statement-category mapping — the BL-13 fix.
//
// The defect: backend/app/core/reporting.py picked statement bands with
// inline fs_category literals and dropped every other category on the floor,
// so an inventory debit 500 against a loan credit 500 reported zero assets
// and liabilities with all consistency checks passing. The fix is a
// validated, versioned mapping and a hard block: any balance whose category
// is outside the mapping blocks reporting with an error naming the
// offending accounts — never a silent skip, never zeros that pass checks.
//
// Version 1 maps exactly the categories the reference's statements handle,
// so every parity case the reference gets right stays right. Growing the
// mapping (INVENTORY has no statement band yet) is a version bump with
// owner review, never a local edit.
const FSCategoryMappingVersion = "2026-10-31.1"

// StatementDestination says which statement a category reports into.
type StatementDestination string

const (
	DestinationIncomeStatement StatementDestination = "INCOME_STATEMENT"
	DestinationBalanceSheet    StatementDestination = "BALANCE_SHEET"
)

// Activity is the cash-flow activity a category's cash-settled legs report
// into (BL-12/18 classification) and the group its noncash movements are
// disclosed under.
type Activity string

const (
	ActivityOperating Activity = "OPERATING"
	ActivityInvesting Activity = "INVESTING"
	ActivityFinancing Activity = "FINANCING"
)

// FSCategoryRule is one mapping row: statement destination plus cash-flow
// activity.
type FSCategoryRule struct {
	Destination StatementDestination
	Activity    Activity
}

// fsCategoryRules is mapping version 2026-10-31.1. CONTRA_ASSET rides
// INVESTING because it moves with fixed assets (disposal proceeds are
// investing cash; the depreciation AJE that usually moves it has no cash leg
// and is disclosed as noncash); DEPRECIATION stays OPERATING as the
// add-back band of the operating section.
var fsCategoryRules = map[string]FSCategoryRule{
	"CASH":          {DestinationBalanceSheet, ActivityOperating},
	"AR":            {DestinationBalanceSheet, ActivityOperating},
	"PREPAY_TAX":    {DestinationBalanceSheet, ActivityOperating},
	"FIXED_ASSET":   {DestinationBalanceSheet, ActivityInvesting},
	"CONTRA_ASSET":  {DestinationBalanceSheet, ActivityInvesting},
	"AP_ACCRUAL":    {DestinationBalanceSheet, ActivityOperating},
	"TAX_PAYABLE":   {DestinationBalanceSheet, ActivityOperating},
	"DIRECTOR_LOAN": {DestinationBalanceSheet, ActivityFinancing},
	"EQUITY":        {DestinationBalanceSheet, ActivityFinancing},
	"REVENUE":       {DestinationIncomeStatement, ActivityOperating},
	"COGS":          {DestinationIncomeStatement, ActivityOperating},
	"OPEX":          {DestinationIncomeStatement, ActivityOperating},
	"DEPRECIATION":  {DestinationIncomeStatement, ActivityOperating},
	"TAX_EXPENSE":   {DestinationIncomeStatement, ActivityOperating},
}

// RuleFor returns the mapping row for a category. The second return is
// false for unmapped categories — callers report through
// ValidateStatementCategories instead of improvising.
func RuleFor(fsCategory string) (FSCategoryRule, bool) {
	r, ok := fsCategoryRules[fsCategory]
	return r, ok
}

// MappedCategories lists the mapping's categories, sorted.
func MappedCategories() []string {
	out := make([]string, 0, len(fsCategoryRules))
	for k := range fsCategoryRules {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// UnmappedCategories returns the sorted distinct categories of rows that the
// versioned mapping does not cover, with the account codes that carry them.
func UnmappedCategories(rows []ledger.TrialBalanceReportRow) []string {
	seen := map[string][]string{}
	for _, r := range rows {
		if _, ok := fsCategoryRules[r.FSCategory]; !ok {
			seen[r.FSCategory] = append(seen[r.FSCategory], r.AccountCode)
		}
	}
	out := make([]string, 0, len(seen))
	for cat, codes := range seen {
		sort.Strings(codes)
		out = append(out, cat+" ("+strings.Join(codes, ", ")+")")
	}
	sort.Strings(out)
	return out
}

// ValidateStatementCategories is the BL-13 gate: every trial-balance row
// must carry a mapped category before any statement is derived. Unmapped
// balances block reporting; they never disappear into zero bands with the
// checks passing.
func ValidateStatementCategories(rows []ledger.TrialBalanceReportRow) error {
	unmapped := UnmappedCategories(rows)
	if len(unmapped) == 0 {
		return nil
	}
	return fail(ErrFSCategoryUnmapped,
		fmt.Sprintf("FSCATEGORY_UNMAPPED: 報表類型對照表版本 %s 未涵蓋下列科目類別，報表拒絕產出（不可靜默略過）： %s。",
			FSCategoryMappingVersion, strings.Join(unmapped, "; ")))
}

// ValidateChartCategories is the same gate for entry-level classification:
// every account the cash classification may meet must be mapped.
func ValidateChartCategories(chart []ledger.Account) error {
	var unmapped []string
	for _, a := range chart {
		if _, ok := fsCategoryRules[a.FSCategory]; !ok {
			unmapped = append(unmapped, a.FSCategory+" ("+a.AccountCode+")")
		}
	}
	if len(unmapped) == 0 {
		return nil
	}
	sort.Strings(unmapped)
	return fail(ErrFSCategoryUnmapped,
		fmt.Sprintf("FSCATEGORY_UNMAPPED: 報表類型對照表版本 %s 未涵蓋下列科目類別，現金流量分類拒絕作業： %s。",
			FSCategoryMappingVersion, strings.Join(unmapped, "; ")))
}

// activityOf is the activity a category's matched cash legs report into.
// The caller has validated the category.
func activityOf(fsCategory string) Activity {
	return fsCategoryRules[fsCategory].Activity
}
