import * as React from "react"
import ReactDOM from "react-dom/client"
import { BookText, LayoutDashboard, Receipt, Scale, Settings as SettingsIcon, Table2 } from "lucide-react"
import "./app.css"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { L } from "@/lib/labels"
import { I18nProvider, useI18n } from "@/i18n"
import { ENTITIES, usePack } from "@/app/data"
import { bookApi, type FiscalPeriod, type Principal, type VoucherDetail } from "@/app/api"
import { Overview } from "@/app/pages/Overview"
import { Transactions } from "@/app/pages/Transactions"
import { JournalEntries } from "@/app/pages/JournalEntries"
import { JournalEntryEditor } from "@/app/pages/JournalEntryEditor"
import { TrialBalance } from "@/app/pages/TrialBalance"
import { Ledger } from "@/app/pages/Ledger"
import { Statements } from "@/app/pages/Statements"
import { Settings } from "@/app/pages/Settings"
import { AppearanceProvider } from "@/app/appearance"

type PageId = "overview" | "transaction" | "journal" | "trial" | "statements" | "setting"

const NAV: Array<{ id: PageId; en: string; cn: string; tw: string; icon: React.ElementType }> = [
  { id: "overview", en: "Overview", cn: "概览", tw: "概覽", icon: LayoutDashboard },
  { id: "transaction", en: "Transaction", cn: "单据", tw: "單據", icon: Receipt },
  { id: "journal", en: "Journal Entry", cn: "凭证明细", tw: "憑證明細", icon: BookText },
  { id: "trial", en: "Trial Balance", cn: "试算表", tw: "試算表", icon: Table2 },
  { id: "statements", en: "Statements", cn: "财务报表", tw: "財務報表", icon: Scale },
  { id: "setting", en: "Setting", cn: "设置", tw: "設定", icon: SettingsIcon },
]

function App() {
  const { lang } = useI18n()
  // Deep links: #setting opens Setting. Also how the shell is screenshotted.
  const [page, setPage] = React.useState<PageId>(() => {
    const hash = window.location.hash.replace("#", "")
    return (NAV.some((n) => n.id === hash) ? hash : "overview") as PageId
  })
  const [entity, setEntity] = React.useState(ENTITIES[0].code)
  const [period, setPeriod] = React.useState("2026-10")

  React.useEffect(() => {
    window.history.replaceState(null, "", `#${page}`)
  }, [page])
  const [principals, setPrincipals] = React.useState<Principal[]>([])
  const [principalKey, setPrincipalKey] = React.useState("ap-clerk-01")
  const [periods, setPeriods] = React.useState<FiscalPeriod[]>([])
  const [editor, setEditor] = React.useState<{ mode: "new" } | { mode: "edit"; voucher: VoucherDetail } | null>(null)
  const [drillAccount, setDrillAccount] = React.useState<string | undefined>()

  const { pack, loading } = usePack(entity, period)
  const principal = principals.find((p) => p.principal_key === principalKey) ?? principals[0]
  const entityName = ENTITIES.find((e) => e.code === entity)?.name ?? ""

  const refresh = React.useCallback(async () => {
    const [p, fp] = await Promise.all([bookApi.principals(), bookApi.periods(entity)])
    setPrincipals(p.principals)
    setPeriods(fp.periods)
  }, [entity])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const openVoucherById = async (id: string) => {
    setEditor({ mode: "edit", voucher: (await bookApi.voucher(id)).voucher })
    setPage("journal")
  }

  const periodInfo = periods.find((p) => p.period_code === period)

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            A
          </div>
          <span className="text-sm font-semibold">Accounting</span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPage(item.id)
                if (item.id !== "journal") setEditor(null)
              }}
              className={cn("flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                page === item.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <item.icon className="size-4" />
              {L(lang, item.en, item.cn, item.tw)}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t p-3">
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITIES.map((e) => (
                <SelectItem key={e.code} value={e.code}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["2026-09", "2026-10", "2026-11"].map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {principal && (
            <Select value={principalKey} onValueChange={setPrincipalKey}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {principals.map((p) => (
                  <SelectItem key={p.principal_key} value={p.principal_key}>
                    {p.agent_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </aside>

      {/* Content */}
      <main className="flex min-w-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{L(lang, "Loading…", "载入中…", "載入中…")}</div>
        ) : page === "overview" ? (
          <Overview
            entity={entity}
            entityName={entityName}
            period={period}
            periodInfo={periodInfo}
            pack={pack}
            lang={lang}
            onGo={(p) => setPage(p as PageId)}
          />
        ) : page === "transaction" ? (
          <Transactions
            entity={entity}
            principalKey={principalKey}
            lang={lang}
            onCreated={() => void refresh()}
            onOpenVoucher={openVoucherById}
          />
        ) : page === "journal" ? (
          editor ? (
            <JournalEntryEditor
              key={editor.mode === "edit" ? editor.voucher.journal_id : "new"}
              entity={entity}
              period={period}
              currency={pack?.currency ?? "AUD"}
              principal={principal}
              voucher={editor.mode === "edit" ? editor.voucher : null}
              lang={lang}
              onChanged={() => void refresh()}
              onClose={() => setEditor(null)}
            />
          ) : (
            <JournalEntries
              entity={entity}
              period={period}
              lang={lang}
              principal={principal}
              onOpen={openVoucherById}
              onNew={() => setEditor({ mode: "new" })}
            />
          )
        ) : page === "trial" ? (
          drillAccount ? (
            <Ledger
              entity={entity}
              period={period}
              lang={lang}
              initialAccount={drillAccount}
              onOpenVoucher={openVoucherById}
              onBack={() => setDrillAccount(undefined)}
            />
          ) : (
            <TrialBalance
              entity={entity}
              entityName={entityName}
              period={period}
              periodInfo={periodInfo}
              lang={lang}
              onOpenAccount={(code) => setDrillAccount(code)}
            />
          )
        ) : page === "statements" ? (
          <Statements pack={pack} lang={lang} />
        ) : (
          <Settings
            entity={entity}
            entityName={entityName}
            pack={pack}
            lang={lang}
            principal={principal}
            onChanged={() => void refresh()}
          />
        )}
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById("app-root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <AppearanceProvider>
        <App />
      </AppearanceProvider>
    </I18nProvider>
  </React.StrictMode>,
)
