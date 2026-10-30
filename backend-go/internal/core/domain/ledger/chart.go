package ledger

import (
	"fmt"
	"strings"
)

// This file ports the chart-of-accounts rules of backend/app/core/ledger.py:
// the account projection (_account_dict), normal_balance derivation,
// account-code resolution, and the field-normalisation core of upsert_account
// (required code, account-type validation, control-account default, and the
// manual-journal linkage that follows the control flag). The session read and
// write are store work; the port computes the resulting row.

// Account mirrors one chart_of_accounts row (ChartOfAccountsModel) as the
// pure rules read it. JSON tags are the keys of _account_dict; the two
// nullable columns cross as null.
type Account struct {
	AccountID        string  `json:"account_id"`
	AccountCode      string  `json:"account_code"`
	AccountName      string  `json:"account_name"`
	AccountType      string  `json:"account_type"`
	NormalBalance    string  `json:"normal_balance"`
	FSCategory       string  `json:"fs_category"`
	StatementRef     string  `json:"statement_ref"`
	CashFlowActivity string  `json:"cash_flow_activity"`
	IsControlAccount bool    `json:"is_control_account"`
	AllowManualJE    bool    `json:"allow_manual_je"`
	TaxCodeDefault   *string `json:"tax_code_default"`
	IsActive         bool    `json:"is_active"`
	ParentAccountID  *string `json:"parent_account_id"`
}

// Balance-sheet and P&L account types; upsert accepts exactly these.
var (
	bsAccountTypes = map[string]bool{"ASSET": true, "LIABILITY": true, "EQUITY": true}
	plAccountTypes = map[string]bool{"REVENUE": true, "EXPENSE": true}
)

// ControlFSCategories: control accounts hold a sub-ledger, so a manual
// journal may not touch them.
var controlFSCategories = map[string]bool{
	"AR": true, "AP_ACCRUAL": true, "INVENTORY": true,
	"FIXED_ASSET": true, "TAX_PAYABLE": true, "DIRECTOR_LOAN": true,
}

// ContraCreditCategories: contra accounts accumulate on the opposite side of
// their class.
var contraCreditCategories = map[string]bool{
	"CONTRA_ASSET": true,
}

// NormalBalanceFor ports normal_balance_for: contra-credit categories carry
// a CREDIT normal balance, assets and expenses are DEBIT, everything else
// CREDIT.
func NormalBalanceFor(accountType, fsCategory string) string {
	if contraCreditCategories[fsCategory] {
		return "CREDIT"
	}
	if accountType == "ASSET" || accountType == "EXPENSE" {
		return "DEBIT"
	}
	return "CREDIT"
}

// AccountByCode ports account_by_code over the chart the caller passes (the
// reference resolves against the full chart including inactive accounts, in
// account-code order from the store). Returns nil when no account matches.
func AccountByCode(chart []Account, accountCode string) *Account {
	for i := range chart {
		if chart[i].AccountCode == accountCode {
			return &chart[i]
		}
	}
	return nil
}

// ActiveAccounts ports get_chart's default filter: active accounts only, in
// the order given (the store returns account-code order).
func ActiveAccounts(chart []Account) []Account {
	out := make([]Account, 0, len(chart))
	for _, a := range chart {
		if a.IsActive {
			out = append(out, a)
		}
	}
	return out
}

// AccountPayload mirrors the JSON payload upsert_account accepts. Pointers
// distinguish an absent field from an empty one; the reference's
// payload.get(key, default) plus or-chains treat an empty string exactly like
// an absent one, so optional string fields fall through on "" as well.
type AccountPayload struct {
	AccountCode      *string `json:"account_code"`
	AccountName      *string `json:"account_name"`
	AccountType      *string `json:"account_type"`
	NormalBalance    *string `json:"normal_balance"`
	FSCategory       *string `json:"fs_category"`
	StatementRef     *string `json:"statement_ref"`
	CashFlowActivity *string `json:"cash_flow_activity"`
	IsControlAccount *bool   `json:"is_control_account"`
	AllowManualJE    *bool   `json:"allow_manual_je"`
	TaxCodeDefault   *string `json:"tax_code_default"`
	IsActive         *bool   `json:"is_active"`
	ParentAccountID  *string `json:"parent_account_id"`
}

// UpsertAccount ports the pure field-normalisation of upsert_account: given
// the (possibly absent) stored row, compute the row the reference would
// write. The persisted upsert is store work. A blank code is
// ACCOUNT_CODE_REQUIRED and an out-of-set type is INVALID_ACCOUNT_TYPE; other
// payload values are uppercased or passed through without further validation,
// exactly as the reference does.
func UpsertAccount(existing *Account, entityCode string, payload AccountPayload) (Account, error) {
	code := ""
	if payload.AccountCode != nil {
		code = strings.TrimSpace(*payload.AccountCode)
	}
	if code == "" {
		return Account{}, fail(ErrAccountCodeRequired, "ACCOUNT_CODE_REQUIRED: 科目代碼不可為空。")
	}
	accountType := "EXPENSE"
	if v, ok := optNonEmpty(payload.AccountType); ok {
		accountType = strings.ToUpper(v)
	}
	if !bsAccountTypes[accountType] && !plAccountTypes[accountType] {
		return Account{}, fail(ErrInvalidAccountType, fmt.Sprintf("INVALID_ACCOUNT_TYPE: '%s'", accountType))
	}
	fsCategory := "OPEX"
	if v, ok := optNonEmpty(payload.FSCategory); ok {
		fsCategory = strings.ToUpper(v)
	}

	var account Account
	if existing != nil {
		account = *existing
	}
	account.AccountID = entityCode + ":" + code
	account.AccountCode = code

	if v, ok := optNonEmpty(payload.AccountName); ok {
		account.AccountName = v
	} else if account.AccountName == "" {
		account.AccountName = code
	}
	account.AccountType = accountType
	if v, ok := optNonEmpty(payload.NormalBalance); ok {
		account.NormalBalance = strings.ToUpper(v)
	} else {
		account.NormalBalance = NormalBalanceFor(accountType, fsCategory)
	}
	account.FSCategory = fsCategory
	if v, ok := optNonEmpty(payload.StatementRef); ok {
		account.StatementRef = v
	} else if account.StatementRef == "" {
		account.StatementRef = "TB"
	}
	if v, ok := optNonEmpty(payload.CashFlowActivity); ok {
		account.CashFlowActivity = v
	} else if account.CashFlowActivity == "" {
		account.CashFlowActivity = "OPERATING_WC"
	}
	if payload.IsControlAccount != nil {
		account.IsControlAccount = *payload.IsControlAccount
	} else {
		account.IsControlAccount = controlFSCategories[fsCategory]
	}
	// A sub-ledger control account may not be posted to by hand: the entry has
	// to come from whatever maintains that sub-ledger. The default follows the
	// just-assigned control flag (the reference reads model.is_control_account).
	if payload.AllowManualJE != nil {
		account.AllowManualJE = *payload.AllowManualJE
	} else {
		account.AllowManualJE = !account.IsControlAccount
	}
	if v, ok := optNonEmpty(payload.TaxCodeDefault); ok {
		account.TaxCodeDefault = strPtr(v)
	}
	if payload.IsActive != nil {
		account.IsActive = *payload.IsActive
	} else {
		account.IsActive = true
	}
	if v, ok := optNonEmpty(payload.ParentAccountID); ok {
		account.ParentAccountID = strPtr(v)
	}
	return account, nil
}

// optNonEmpty mirrors Python's `payload.get(key) or fallback`: an absent or
// empty string is not a value.
func optNonEmpty(p *string) (string, bool) {
	if p != nil && *p != "" {
		return *p, true
	}
	return "", false
}

func strPtr(s string) *string { return &s }
