import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn, moneyPlain } from "@/lib/utils"
import { L } from "@/lib/labels"
import type { Language } from "@/i18n"
import { bookApi, type CashFlowBreakdown, type FiscalPeriod, type TrialBalanceRow, type VoucherSummary } from "@/app/api"
import { PageHeader } from "@/app/components/PageHeader"
import { CashFlow, IncomeFlow } from "@/app/components/SankeyChart"

/**
 * Overview.
 *
 * Four figures and one flow diagram. Nothing else, on purpose:
 *
 *  · The period is the subject, so it sits in the diagram's subtitle rather
 *    than in a status badge. Whether a period is locked is a question for the
 *    person who has to write to it; the reader of this page never does.
 *  · The ledger's trial balance is not shown. Double entry cannot fail to
 *    balance, so "debits = credits ✓" is a statement that can never be false —
 *    it is not news, it is a property of arithmetic.
 *  · Pending work appears only when something is pending. A row reading
 *    "drafts 0 · awaiting review 0" tells the reader nothing and occupies the
 *    same weight as a number that matters.
 */
export function Overview({
  entity,
  entityName,
  period,
  onGo,
  pack,
  lang,
}: {
  entity: string
  entityName: string
  period: string
  periodInfo?: FiscalPeriod
  onGo: (page: string) => void
  pack: any
  lang: Language
}) {
  const [rows, setRows] = React.useState<TrialBalanceRow[]>([])
  const [vouchers, setVouchers] = React.useState<VoucherSummary[]>([])
  const [cashFlow, setCashFlow] = React.useState<CashFlowBreakdown | null>(null)
  const [flow, setFlow] = React.useState<"income" | "cash">("income")

  React.useEffect(() => {
    bookApi.trialBalance(entity, period).then((r) => setRows(r.rows))
    bookApi.vouchers(entity, period).then((r) => setVouchers(r.vouchers))
    bookApi
      .cashFlow(entity, period)
      .then(setCashFlow)
      .catch(() => setCashFlow(null))
  }, [entity, period])

  const total = (type: string) => rows.filter((r) => r.account_type === type).reduce((t, r) => t + Number(r.closing), 0)
  const revenue = -total("REVENUE")
  const expense = total("EXPENSE")
  const netProfit = revenue - expense
  const cash = rows.filter((r) => r.fs_category === "CASH").reduce((t, r) => t + Number(r.closing), 0)

  const drafts = vouchers.filter((v) => v.status === "DRAFT").length
  const pending = vouchers.filter((v) => v.status === "PENDING_CHECKER" || v.status === "AWAITING_CPA").length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Overview"
        toolbar={
          <div className="flex gap-1 rounded-md bg-background p-0.5">
            {(
              [
                ["income", L(lang, "Income structure", "损益结构", "損益結構")],
                ["cash", L(lang, "Where the cash went", "现金流向", "現金流向")],
              ] as Array<["income" | "cash", string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFlow(id)}
                className={cn(
                  "h-7 rounded-sm px-3 text-sm transition-colors",
                  flow === id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <dl className="mb-6 grid max-w-3xl grid-cols-4 gap-8">
          {[
            { label: L(lang, "Revenue", "收入", "收入"), value: revenue },
            { label: L(lang, "Expenses", "费用", "費用"), value: expense },
            { label: L(lang, "Net profit", "净利润", "淨利潤"), value: netProfit },
            { label: L(lang, "Cash", "现金", "現金"), value: cash },
          ].map((figure) => (
            <div key={figure.label}>
              <dt className="text-sm text-muted-foreground">{figure.label}</dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight">{moneyPlain(figure.value)}</dd>
            </div>
          ))}
        </dl>

        <div className="min-h-[460px] max-w-5xl rounded-lg border p-5">
          {flow === "income" ? (
            <IncomeFlow pack={pack} lang={lang} period={period} entityName={entityName} />
          ) : (
            <CashFlow breakdown={cashFlow} lang={lang} period={period} entityName={entityName} />
          )}
        </div>

        {drafts + pending > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 -ml-2 text-muted-foreground"
            onClick={() => onGo("journal")}
          >
            {drafts > 0 ? `${drafts} ${L(lang, "draft", "草稿", "草稿")}` : ""}
            {drafts > 0 && pending > 0 ? " · " : ""}
            {pending > 0 ? `${pending} ${L(lang, "awaiting review", "待复核", "待複核")}` : ""}
            <span className="ml-1">→</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
