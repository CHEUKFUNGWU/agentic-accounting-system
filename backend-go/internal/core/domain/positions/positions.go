package positions

import "sort"

// This file ports backend/app/core/positions.py function by function (逐模組
// 對照). The Python module is the single source of truth for the authority
// matrix: authority is assigned by position and account scope, never by
// amount, so the MCP role servers can expose tools straight from it.
//
// Where the Python module reads session or database state, the port takes
// that state as an explicit argument: PositionForPrincipal receives the
// durable principal→position overrides Python keeps in the module-global
// PRINCIPAL_POSITIONS cache, which auth.py mutates per request.

// Position is one accounting position (positions.py Position, a frozen
// dataclass). Values are immutable by convention; the seeded matrix below is
// shared.
type Position struct {
	// PositionID is the stable key ("CASHIER", "GL_ACCOUNTANT", ...).
	PositionID string
	TitleEn    string
	TitleZh    string
	// PrincipalKey is the identity that holds this position in the seeded
	// matrix (positions.py: the bot identity from mcp_server.PRINCIPALS).
	PrincipalKey string
	// AccountScope lists the chart-of-accounts codes this position may
	// PREPARE entries for, sorted. "*" means every account.
	AccountScope []string
	CanPrepare   bool
	CanReview    bool
	// CashCustody (出納) — has custody of cash and therefore may never
	// review anything.
	CashCustody bool
	// ReviewLevel: 1 = clerk, 2 = chief accountant, 3 = finance manager,
	// 4 = external CPA, 5 = founder/director; 0 = no review standing.
	ReviewLevel int
	// ReadAllAccounts: may read every account in the ledger, not just its
	// own scope.
	ReadAllAccounts bool
	MandateEn       string
	MandateZh       string
	// IsHuman: true only for principals that are people. The audit question
	// "was a human in the loop" is unanswerable without this flag.
	IsHuman bool
}

// Account codes come from the seeded chart of accounts:
//
//	1110 銀行存款  1210 應收帳款  1420 預付款項及進項稅額  1610 固定資產原值
//	1650 累計折舊  2110 應付帳款及應計費用  2190 股東/業主往來  2210 應交稅費
//	3100 實收資本及期初留存  4100 主營業務收入  5100 主營業務成本
//	6100 管理及營運費用  6410 折舊費用  7500 所得稅費用
//
// positionDefs keeps the Python dict's insertion order; several functions
// below (PositionForAccounts tie-breaking, PositionForPrincipal lookup) are
// order-sensitive.
var positionDefs = []Position{
	{
		PositionID: "ADMIN", TitleEn: "System administrator", TitleZh: "系統管理員",
		PrincipalKey: "admin-01", AccountScope: []string{},
		CanPrepare: false, CanReview: false, CashCustody: false, ReviewLevel: 0,
		ReadAllAccounts: false, IsHuman: true,
		MandateEn: "Identity and credential governance only. No accounting authority.",
		MandateZh: "只管理身份及憑證，沒有會計權限。",
	},
	{
		PositionID: "CASHIER", TitleEn: "Cashier", TitleZh: "出納",
		PrincipalKey: "cashier-01", AccountScope: []string{"1110"},
		CanPrepare: true, CanReview: false, CashCustody: true, ReviewLevel: 1,
		ReadAllAccounts: false,
		MandateEn: "Bank and cash movements only. Cannot record revenue, expenses, receivables or payables, " +
			"and may never review a voucher (segregation of custody from record-keeping).",
		MandateZh: "只登記現金與銀行收付。不得登記收入、費用、債權債務，且永遠不可複核憑證（錢帳分管）。",
	},
	{
		PositionID: "AR_CLERK", TitleEn: "Receivables accountant", TitleZh: "應收會計",
		PrincipalKey: "ar-clerk-01", AccountScope: []string{"1210", "4100"},
		CanPrepare: true, CanReview: false, CashCustody: false, ReviewLevel: 1,
		ReadAllAccounts: false,
		MandateEn:       "Receivables and revenue only.",
		MandateZh:       "只負責應收帳款與收入。",
	},
	{
		PositionID: "AP_CLERK", TitleEn: "Payables accountant", TitleZh: "應付會計",
		PrincipalKey: "ap-clerk-01",
		// 5100 (COGS) sits with payables when there is no separate cost accountant.
		AccountScope: []string{"1420", "2110", "5100", "6100"},
		CanPrepare:   true, CanReview: false, CashCustody: false, ReviewLevel: 1,
		ReadAllAccounts: false,
		MandateEn:       "Payables, operating expenses, prepayments and cost of sales.",
		MandateZh:       "負責應付帳款、管理費用、預付款項與營業成本。",
	},
	{
		PositionID: "FA_CLERK", TitleEn: "Fixed asset accountant", TitleZh: "固定資產會計",
		PrincipalKey: "fa-clerk-01", AccountScope: []string{"1610", "1650", "6410"},
		CanPrepare: true, CanReview: false, CashCustody: false, ReviewLevel: 1,
		ReadAllAccounts: false,
		MandateEn:       "Fixed asset register, accumulated depreciation and the depreciation run.",
		MandateZh:       "負責固定資產登記簿、累計折舊與折舊跑批。",
	},
	{
		PositionID: "TAX_CLERK", TitleEn: "Tax accountant", TitleZh: "稅務會計",
		PrincipalKey: "tax-clerk-01", AccountScope: []string{"2210", "7500"},
		CanPrepare: true, CanReview: false, CashCustody: false, ReviewLevel: 1,
		ReadAllAccounts: false,
		MandateEn:       "Statutory taxes payable and income tax expense.",
		MandateZh:       "負責應交稅費與所得稅費用。",
	},
	{
		PositionID: "GL_ACCOUNTANT", TitleEn: "Chief accountant / General ledger", TitleZh: "會計主任／總帳會計",
		PrincipalKey: "gl-chief-01",
		// General-ledger nature entries only: equity, opening balances, owner
		// current account. Operational account entries belong to the clerks —
		// if the chief accountant prepared them too, nobody below could review.
		AccountScope: []string{"2190", "3100"},
		CanPrepare:   true, CanReview: true, CashCustody: false, ReviewLevel: 2,
		ReadAllAccounts: true,
		MandateEn: "Reviews every voucher in every account. May only PREPARE general-ledger entries " +
			"(equity, opening balances, owner current account, period close).",
		MandateZh: "可複核全部科目的憑證；但只能編制總帳性質的分錄（權益、期初、股東往來、月末結轉）。",
	},
	{
		PositionID: "FINANCE_MANAGER", TitleEn: "Finance manager", TitleZh: "財務經理",
		PrincipalKey: "finance-manager-01", AccountScope: []string{"*"},
		CanPrepare: true, CanReview: true, CashCustody: false, ReviewLevel: 3,
		ReadAllAccounts: true,
		MandateEn:       "Reviews the chief accountant's own entries, approves the period close and the pack.",
		MandateZh:       "複核會計主任自己編制的分錄，核准結帳與報表。",
	},
	{
		PositionID: "CPA_ADVISOR", TitleEn: "External CPA (bookkeeping oversight)", TitleZh: "外部會計師（帳務督導）",
		PrincipalKey: "cpa-griffin", AccountScope: []string{},
		CanPrepare: false, CanReview: true, CashCustody: false, ReviewLevel: 4,
		ReadAllAccounts: true, IsHuman: true,
		MandateEn: "For one-person companies there is no internal chief accountant, so review lands here. " +
			"Reviewing a voucher is a different act from signing the annual accounts.",
		MandateZh: "一人公司沒有內部會計主任，複核落在這裡。複核憑證與簽核年度報表是兩件事。",
	},
	{
		PositionID: "FOUNDER_DIRECTOR", TitleEn: "Founder / Director (human)", TitleZh: "創辦人／董事（人）",
		PrincipalKey: "founder-director-01", AccountScope: []string{},
		CanPrepare: false, CanReview: false, CashCustody: false, ReviewLevel: 5,
		ReadAllAccounts: true, IsHuman: true,
		MandateEn: "Signs the financial statements, approves payments and resolves the exception queue. " +
			"Does not review vouchers — that is the accounting department's job.",
		MandateZh: "簽核財務報表、批准付款、處理例外佇列。不複核憑證——那是會計部門的事。",
	},
	{
		PositionID: "AUDITOR_READONLY", TitleEn: "Auditor (read-only)", TitleZh: "審計（唯讀）",
		PrincipalKey: "auditor-readonly-01", AccountScope: []string{},
		CanPrepare: false, CanReview: false, CashCustody: false, ReviewLevel: 0,
		ReadAllAccounts: true,
		MandateEn:       "Read-only. No write tool exists on this surface.",
		MandateZh:       "唯讀。這個表面上不存在任何寫入工具。",
	},
}

// POSITIONS is the seeded authority matrix (positions.py POSITIONS), keyed by
// position ID. Treat the records as immutable.
var POSITIONS = buildPositions()

// PositionIDs lists the position keys in the Python module's insertion order
// (positions.py POSITION_IDS).
var PositionIDs = positionIDs()

func buildPositions() map[string]Position {
	m := make(map[string]Position, len(positionDefs))
	for _, p := range positionDefs {
		m[p.PositionID] = p
	}
	return m
}

func positionIDs() []string {
	ids := make([]string, 0, len(positionDefs))
	for _, p := range positionDefs {
		ids = append(ids, p.PositionID)
	}
	return ids
}

// contains reports whether the sorted scope holds code.
func contains(scope []string, code string) bool {
	for _, c := range scope {
		if c == code {
			return true
		}
	}
	return false
}

// InScope mirrors positions.in_scope.
func InScope(position Position, accountCode string) bool {
	return contains(position.AccountScope, "*") || contains(position.AccountScope, accountCode)
}

// OutOfScope mirrors positions.out_of_scope: the input codes that the
// position's scope does not cover, input order and duplicates preserved.
func OutOfScope(position Position, accountCodes []string) []string {
	out := []string{}
	for _, code := range accountCodes {
		if !InScope(position, code) {
			out = append(out, code)
		}
	}
	return out
}

// VisibleAccounts mirrors positions.visible_accounts.
func VisibleAccounts(position Position, allCodes []string) []string {
	if position.ReadAllAccounts {
		return append([]string{}, allCodes...)
	}
	out := []string{}
	for _, code := range allCodes {
		if InScope(position, code) {
			out = append(out, code)
		}
	}
	return out
}

// RequiredReviewer mirrors positions.required_reviewer. The three rules, in
// accounting terms:
//
//  1. 出納 cannot review anything (custody vs record-keeping) and clerks are
//     reviewed by the chief accountant.
//  2. The chief accountant's own entries go up to the finance manager —
//     nobody underneath can review the person above them.
//  3. The finance manager's own entries fall to the external CPA, because in
//     an SME there is no one left inside the company.
func RequiredReviewer(preparer Position) Position {
	if preparer.CashCustody || preparer.ReviewLevel == 1 {
		return POSITIONS["GL_ACCOUNTANT"]
	}
	if preparer.PositionID == "GL_ACCOUNTANT" {
		return POSITIONS["FINANCE_MANAGER"]
	}
	if preparer.PositionID == "FINANCE_MANAGER" {
		return POSITIONS["CPA_ADVISOR"]
	}
	return POSITIONS["GL_ACCOUNTANT"]
}

// MayReview mirrors positions.may_review: a reviewer is allowed if they hold
// the required position, or sit above it. Sitting above it (finance manager
// covering for an absent chief accountant) is normal in a small finance team;
// sitting *below* it never is.
func MayReview(reviewer, preparer Position) bool {
	if !reviewer.CanReview || reviewer.CashCustody {
		return false
	}
	return reviewer.ReviewLevel >= RequiredReviewer(preparer).ReviewLevel
}

// PositionForAccounts mirrors positions.position_for_accounts: which position
// owns an entry that touches these accounts. A month-end adjustment is not
// "the chief accountant's entry": the tax provision belongs to the tax
// accountant and the depreciation run to the fixed asset accountant. The
// owner is whoever's scope covers every account in the entry, preferring the
// narrowest scope so the entry lands with the clerk who has to defend it. It
// falls back to the chief accountant when no single clerk's scope covers
// everything. ok is false exactly when no non-empty code remains.
func PositionForAccounts(accountCodes []string) (Position, bool) {
	codes := map[string]bool{}
	for _, c := range accountCodes {
		if c != "" {
			codes[c] = true
		}
	}
	if len(codes) == 0 {
		return Position{}, false
	}
	// Python iterates POSITIONS.values() (insertion order) and takes min by
	// (scope size, review level); min keeps the first minimal candidate, so
	// the strict-improvement comparison below preserves the tie-break.
	best := -1
	bestScopeLen, bestLevel := 0, 0
	for i, p := range positionDefs {
		if !p.CanPrepare || contains(p.AccountScope, "*") {
			continue
		}
		covers := true
		for c := range codes {
			if !contains(p.AccountScope, c) {
				covers = false
				break
			}
		}
		if !covers {
			continue
		}
		if best == -1 || len(p.AccountScope) < bestScopeLen ||
			(len(p.AccountScope) == bestScopeLen && p.ReviewLevel < bestLevel) {
			best, bestScopeLen, bestLevel = i, len(p.AccountScope), p.ReviewLevel
		}
	}
	if best == -1 {
		return POSITIONS["GL_ACCOUNTANT"], true
	}
	return positionDefs[best], true
}

// PrincipalAliases mirrors positions.PRINCIPAL_ALIASES: earlier bot identities
// that predate the position model. They are the same jobs under different key
// names, so they map onto positions rather than being left outside the
// authority model — otherwise the REST surface and the MCP surface would
// enforce two different sets of rules for the same actor.
var PrincipalAliases = map[string]string{
	"bookkeeper-maker-01":   "AP_CLERK",      // expense splits and payables entries
	"workpaper-close-01":    "GL_ACCOUNTANT", // month-end closing work
	"controller-checker-01": "GL_ACCOUNTANT", // reviewer of record
}

// PositionForPrincipal mirrors positions.position_for_principal. dynamic
// carries the durable principal→position overrides that the Python module
// keeps in its PRINCIPAL_POSITIONS global (filled from principal rows by
// app/core/auth.py at request time); it is consulted first, exactly as Python
// consults the cache. Lookup order: dynamic override, seeded matrix by
// principal key, then the legacy alias table.
func PositionForPrincipal(principalKey string, dynamic map[string]Position) (Position, bool) {
	if p, ok := dynamic[principalKey]; ok {
		return p, true
	}
	for _, p := range positionDefs {
		if p.PrincipalKey == principalKey {
			return p, true
		}
	}
	alias, ok := PrincipalAliases[principalKey]
	if !ok || alias == "" {
		return Position{}, false
	}
	p, ok := POSITIONS[alias]
	return p, ok
}

// monolithManagerCommands is the FINANCE_MANAGER action set from
// positions.monolith_commands.
var monolithManagerCommands = []string{
	"journal.create", "journal.review", "invoice.create", "invoice.collect", "bill.create",
	"bill.approve", "bill.pay", "bank.reconcile", "bank.batch", "bank.exception", "tax.update",
	"tax.provision", "asset.register", "asset.depreciate", "close.checklist", "close.amortize",
	"agent.resolve", "budget.save", "forecast.save",
}

// MonolithCommands mirrors positions.monolith_commands. Python returns an
// unordered set; the Go slice is sorted, which is the form auth.py surfaces
// (sorted(monolith_actions(self))). journal.review is human-only: a principal
// that is not a person never holds the review command.
func MonolithCommands(position Position) []string {
	actions := map[string]bool{}
	if position.ReadAllAccounts {
		actions["preferences.update"] = true
	}
	if position.PositionID == "FINANCE_MANAGER" {
		for _, c := range monolithManagerCommands {
			actions[c] = true
		}
	}
	if position.PositionID == "GL_ACCOUNTANT" || position.PositionID == "CPA_ADVISOR" {
		actions["journal.review"] = true
		actions["close.checklist"] = true
	}
	if position.PositionID == "FOUNDER_DIRECTOR" {
		actions["bill.approve"] = true
	}
	if !position.IsHuman {
		delete(actions, "journal.review")
	}
	// Signing and reopening remain unavailable until MFA enrollment is shipped.
	out := make([]string, 0, len(actions))
	for c := range actions {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Solo mode (一人公司模式) — SRC-0028, confirmed by the owner 2026-10-30.
// Not present in the frozen Python backend; this is the owner-decided rule
// the Go port implements. design.md assigns solo mode to this package.
// ---------------------------------------------------------------------------

// Principal is one principal of an entity as the solo-mode rule sees it. The
// Python backend carries these flags on principal rows; they arrive here as
// values.
type Principal struct {
	PrincipalKey string
	// IsHuman marks principals that are people.
	IsHuman bool
	// Active marks principals that can currently act.
	Active bool
}

// SoloMode reports one-person-company mode (一人公司模式) by the SRC-0028
// rule: the qualifying axis is the count of active human principals, never
// the legal entity type. An entity is in solo mode while it has exactly one
// active human principal; a second one (e.g. hiring a bookkeeper)
// automatically returns the company to maker-checker, and historical
// self-approvals stay flagged. Agent principals never count — agents never
// approve in any mode (O2-g). Jurisdiction packs may tighten qualification,
// never relax it.
func SoloMode(principals []Principal) bool {
	return activeHumanCount(principals) == 1
}

// activeHumanCount counts the principals that are both people and active.
func activeHumanCount(principals []Principal) int {
	humans := 0
	for _, p := range principals {
		if p.Active && p.IsHuman {
			humans++
		}
	}
	return humans
}
