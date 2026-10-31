package voucher

import (
	"strconv"
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/money"
)

// This file ports the structural-validation section of vouchers.py: the
// money helper, the account-nature rules the chart derivation uses, line
// parsing, the balance check, and the adaptation to the SoD guard's
// ProposedLine. Rejection kinds are this port's stable taxonomy for the
// reference's VoucherError messages (fixtures pin the kind, not the Chinese
// message text; the messages here are carried verbatim for user-facing
// parity).

// VoucherError mirrors vouchers.VoucherError: a user-facing rejection of a
// malformed voucher.
type VoucherError struct {
	// Kind is the stable rejection identifier of this port (see the Kind*
	// constants below). The reference's messages carry no prefixes, so the
	// generator maps the frozen message templates onto these kinds.
	Kind string
	// Message is the reference's user-facing text, with computed amounts
	// rendered exactly as Python str(Decimal) renders them.
	Message string
}

func (e *VoucherError) Error() string { return e.Message }

// Rejection kinds of vouchers.parse_lines and vouchers.assert_balanced, in
// the order the reference raises them.
const (
	KindLineMissingAccount = "LINE_MISSING_ACCOUNT" // 第 N 行未選擇科目。
	KindLineNegativeAmount = "LINE_NEGATIVE_AMOUNT" // 金額不可為負數
	KindLineBothSides      = "LINE_BOTH_SIDES"      // 同時有借方與貸方金額
	KindLineZeroAmount     = "LINE_ZERO_AMOUNT"     // 沒有金額
	KindTooFewLines        = "TOO_FEW_LINES"        // 分錄至少要兩行
	KindUnbalanced         = "UNBALANCED"           // 借貸不平衡
	KindNonPositiveTotal   = "NON_POSITIVE_TOTAL"   // 分錄金額必須大於零
	// ErrDecimalInvalidOperation pins the one non-VoucherError escape: a
	// payload amount that is not a decimal string makes the reference raise
	// decimal.InvalidOperation (an ArithmeticError, not a VoucherError), so
	// the API answers 500 rather than 400. Pinned as-is; the P2 API adapter
	// must not silently upgrade it to a polite refusal.
	ErrDecimalInvalidOperation = "DECIMAL_INVALID_OPERATION"
)

// Q4 mirrors vouchers.q4: quantize to 4 decimal places (分位至 0.0001) under
// the reference default context, half-even. The cent is 0.0001 throughout
// the reference, not 0.01.
func Q4(value string) (money.Money, error) {
	m, err := money.Parse(value)
	if err != nil {
		return money.Money{}, err
	}
	return m.Round(4, money.RoundHalfEven)
}

// ContraCreditCategories mirrors vouchers.CONTRA_CREDIT_CATEGORIES: contra
// accounts accumulate on the opposite side of their class, so an ASSET-
// category account with a credit nature must never derive a debit balance.
var ContraCreditCategories = map[string]bool{
	"CONTRA_ASSET": true,
}

// ControlFSCategories mirrors vouchers.CONTROL_FS_CATEGORIES: sub-ledger
// control accounts that manual journal entries may not touch (the guard
// enforces the isolation; to_proposed_lines flags them).
var ControlFSCategories = map[string]bool{
	"AR":            true,
	"AP_ACCRUAL":    true,
	"INVENTORY":     true,
	"FIXED_ASSET":   true,
	"TAX_PAYABLE":   true,
	"DIRECTOR_LOAN": true,
}

// NormalBalance mirrors vouchers.normal_balance: ASSET and EXPENSE are
// debit-nature; contra-assets and everything else are credit-nature. An
// empty fsCategory is the reference's None.
func NormalBalance(accountType, fsCategory string) string {
	if ContraCreditCategories[fsCategory] {
		return "CREDIT"
	}
	if accountType == "ASSET" || accountType == "EXPENSE" {
		return "DEBIT"
	}
	return "CREDIT"
}

// IsControlFSCategory mirrors the is_control_account derivation of
// vouchers.chart_of_accounts (fs_category in CONTROL_FS_CATEGORIES).
func IsControlFSCategory(fsCategory string) bool {
	return ControlFSCategories[fsCategory]
}

// RawLine is one client payload line as the reference's parse_lines reads
// it: the API models type every field as a string, so the port takes
// strings. Empty is the reference's missing-or-falsy.
type RawLine struct {
	AccountCode    string `json:"account_code"`
	AccountName    string `json:"account_name"`
	Debit          string `json:"debit"`
	Credit         string `json:"credit"`
	Memo           string `json:"memo"`
	Counterparty   string `json:"counterparty"`
	TaxCode        string `json:"tax_code"`
	BusinessUsePct string `json:"business_use_pct"`
}

// parseAmount mirrors q4(raw.get(key) or 0): an absent or empty amount is
// zero; anything else must be a decimal string. A non-decimal string raises
// decimal.InvalidOperation in the reference — not a VoucherError — so the
// error here is returned unwrapped for the caller to classify.
func parseAmount(value string) (money.Money, error) {
	if value == "" {
		value = "0"
	}
	m, err := money.Parse(value)
	if err != nil {
		return money.Money{}, err
	}
	return m.Round(4, money.RoundHalfEven)
}

// ParseLines mirrors vouchers.parse_lines: normalise the client payload into
// the canonical stored line shape, refusing (in the reference's order)
// missing accounts, negative amounts, both-sides lines and zero lines.
// Line numbers start at 1.
func ParseLines(raw []RawLine) ([]StoredLine, error) {
	lines := make([]StoredLine, 0, len(raw))
	for i, r := range raw {
		idx := i + 1
		accountCode := strings.TrimSpace(r.AccountCode)
		if accountCode == "" {
			return nil, &VoucherError{
				Kind:    KindLineMissingAccount,
				Message: "第 " + strconv.Itoa(idx) + " 行未選擇科目。",
			}
		}
		debit, err := parseAmount(r.Debit)
		if err != nil {
			return nil, err
		}
		credit, err := parseAmount(r.Credit)
		if err != nil {
			return nil, err
		}
		var zero money.Money
		if debit.Cmp(zero) < 0 || credit.Cmp(zero) < 0 {
			return nil, &VoucherError{
				Kind:    KindLineNegativeAmount,
				Message: "第 " + strconv.Itoa(idx) + " 行金額不可為負數；貸方請填在貸方欄。",
			}
		}
		if debit.Cmp(zero) > 0 && credit.Cmp(zero) > 0 {
			return nil, &VoucherError{
				Kind:    KindLineBothSides,
				Message: "第 " + strconv.Itoa(idx) + " 行同時有借方與貸方金額，請拆成兩行。",
			}
		}
		if debit.IsZero() && credit.IsZero() {
			return nil, &VoucherError{
				Kind:    KindLineZeroAmount,
				Message: "第 " + strconv.Itoa(idx) + " 行沒有金額。",
			}
		}
		businessUse := r.BusinessUsePct
		if businessUse == "" {
			businessUse = "1.0000"
		}
		lines = append(lines, StoredLine{
			LineNumber:     int64(idx),
			AccountCode:    accountCode,
			AccountName:    r.AccountName, // not stripped in the reference
			Debit:          debit,
			Credit:         credit,
			Memo:           strings.TrimSpace(r.Memo),
			Counterparty:   strings.TrimSpace(r.Counterparty),
			TaxCode:        strings.TrimSpace(r.TaxCode),
			BusinessUsePct: businessUse, // not stripped in the reference
		})
	}
	return lines, nil
}

// AssertBalanced mirrors vouchers.assert_balanced: at least two lines,
// debits equal credits, total greater than zero. The sums start from zero
// and follow the reference's ideal-exponent addition, so the returned totals
// render exactly as the reference's str(sum) does.
func AssertBalanced(lines []StoredLine) (money.Money, money.Money, error) {
	if len(lines) < 2 {
		return money.Money{}, money.Money{}, &VoucherError{
			Kind:    KindTooFewLines,
			Message: "分錄至少要兩行（一借一貸）。",
		}
	}
	dr := money.Money{}
	cr := money.Money{}
	for _, l := range lines {
		dr = dr.Add(l.Debit)
		cr = cr.Add(l.Credit)
	}
	if !dr.Equal(cr) {
		return dr, cr, &VoucherError{
			Kind: KindUnbalanced,
			Message: "借貸不平衡：借方 " + dr.String() + "，貸方 " + cr.String() +
				"，差額 " + dr.Sub(cr).String() + "。",
		}
	}
	var zero money.Money
	if dr.Cmp(zero) <= 0 {
		return dr, cr, &VoucherError{
			Kind:    KindNonPositiveTotal,
			Message: "分錄金額必須大於零。",
		}
	}
	return dr, cr, nil
}

// ToProposedLines mirrors vouchers.to_proposed_lines: adapt stored lines to
// the guard's dataclass so one implementation validates. Single-currency
// desktop v0.4: functional == transaction amount. An empty stored tax code
// is the guard's None.
func ToProposedLines(lines []StoredLine, controlAccounts map[string]bool) []positions.ProposedLine {
	out := make([]positions.ProposedLine, 0, len(lines))
	for _, l := range lines {
		var taxCode *string
		if l.TaxCode != "" {
			code := l.TaxCode
			taxCode = &code
		}
		out = append(out, positions.ProposedLine{
			LineNumber:       int(l.LineNumber),
			AccountCode:      l.AccountCode,
			IsControlAccount: controlAccounts[l.AccountCode],
			TxDebit:          l.Debit,
			TxCredit:         l.Credit,
			// Single-currency desktop v0.4: functional == transaction amount.
			FuncDebit:  l.Debit,
			FuncCredit: l.Credit,
			TaxCode:    taxCode,
			Memo:       l.Memo,
		})
	}
	return out
}
