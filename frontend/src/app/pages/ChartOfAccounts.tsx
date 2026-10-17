import * as React from "react";
import { Check, Layers, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { L, localizeLabel } from "@/lib/labels"
import { term } from "@/lib/terms";
import type { Language } from "@/i18n";
import { bookApi, type ChartAccount } from "@/app/api";


const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const FS_CATEGORIES = ["CASH", "AR", "PREPAY_TAX", "INVENTORY", "FIXED_ASSET", "CONTRA_ASSET","AP_ACCRUAL", "DEFERRED_REV", "TAX_PAYABLE", "DIRECTOR_LOAN", "LONG_TERM_DEBT","EQUITY", "OWNER_DRAWINGS", "REVENUE", "COGS", "OPEX", "DEPRECIATION", "TAX_EXPENSE",
];
const CASH_FLOW = ["CASH_EQUIV", "OPERATING_WC", "NON_CASH", "INVESTING", "FINANCING"];

const inputCls ="h-7 w-full rounded-sm border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring";
const selectCls = cn(inputCls, "font-mono");

/** 科目表 — 科目的身份：性質、子帳、財報分類、現金流歸屬。 */
export function ChartOfAccounts({
  entity,
  lang,
  onSaved,
}: {
  entity: string;
  lang: Language;
  onSaved?: () => void;
}) {
  const [accounts, setAccounts] = React.useState<ChartAccount[]>([]);
  const [selected, setSelected] = React.useState<ChartAccount | null>(null);
  const [draft, setDraft] = React.useState<Partial<ChartAccount>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await bookApi.chart(entity, true);
    setAccounts(res.accounts);
  }, [entity]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const open = (account: ChartAccount) => {
    setSelected(account);
    setError(null);
    setDraft({
      account_name: account.account_name,
      account_type: account.account_type,
      normal_balance: account.normal_balance,
      fs_category: account.fs_category,
      statement_ref: account.statement_ref,
      cash_flow_activity: account.cash_flow_activity,
      is_control_account: account.is_control_account,
      allow_manual_je: account.allow_manual_je,
      is_active: account.is_active,
    });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await bookApi.saveAccount(entity, selected.account_code, draft);
      await load();
      setSelected({ ...selected, ...draft } as ChartAccount);
      onSaved?.();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                {[
                  [L(lang, "Code", "代碼", "代碼"), "w-[68px] pl-3 text-left"],
                  [L(lang, "Account", "科目名稱", "科目名稱"), "text-left"],
                  [L(lang, "Type", "類型", "類型"), "w-[92px] text-left"],
                  [L(lang, "Nature", "性質", "性質"), "w-[64px] text-left"],
                  [L(lang, "FS category", "財報分類", "財報分類"), "w-[120px] text-left"],
                  [L(lang, "Cash flow", "現金流", "現金流"), "w-[112px] text-left"],
                  [L(lang, "Flags", "標記", "標記"), "w-[112px] text-left"],
                  [L(lang, "Active", "啟用", "啟用"), "w-[56px] text-center"],
                ].map(([label, cls], i) => (
                  <th
                    key={i}
                    className={cn("border-b h-8 px-2 text-xs font-semibold text-muted-foreground uppercase",
                      cls as string,
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr
                  key={a.account_code}
                  onClick={() => open(a)}
                  className={cn("cursor-default border-b border-border/60 hover:bg-accent/50",
                    selected?.account_code === a.account_code && "bg-accent",
                    !a.is_active && "opacity-50",
                  )}
                >
                  <td className="num h-[var(--row-h)] pl-3 font-mono text-sm text-muted-foreground">{a.account_code}</td>
                  <td className="h-[var(--row-h)] truncate px-2 whitespace-nowrap">{localizeLabel(a.account_name, lang)}</td>
                  <td className="px-2 text-muted-foreground">{term(a.account_type, lang)}</td>
                  <td className="h-[var(--row-h)] px-2">
                    <Badge variant="outline">
                      {a.normal_balance === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸")}
                    </Badge>
                  </td>
                  <td className="px-2 text-muted-foreground">{term(a.fs_category, lang)}</td>
                  <td className="px-2 text-muted-foreground">{term(a.cash_flow_activity, lang)}</td>
                  <td className="h-[var(--row-h)] px-2">
                    <div className="flex items-center gap-1">
                      {a.is_control_account && (
                        <Badge variant="secondary">
                          <Layers className="size-3" />
                          {L(lang, "control", "子帳", "子帳")}
                        </Badge>
                      )}
                      {!a.allow_manual_je && <Badge variant="outline">{L(lang, "manual ✕", "禁手動", "禁手動")}</Badge>}
                    </div>
                  </td>
                  <td className="h-[var(--row-h)] px-2 text-center">
                    {a.is_active ? (
                      <Check className="mx-auto size-3.5 text-ok" strokeWidth={2.5} />
                    ) : (
                      <X className="mx-auto size-3.5 text-muted-foreground" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <aside className="border-l flex w-[300px] shrink-0 flex-col bg-background">
          <header className="border-b flex h-10 shrink-0 items-center justify-between px-3">
            <span className="font-mono text-sm">{selected.account_code}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={L(lang, "Close", "關閉", "關閉")}
            >
              <X className="size-3.5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
            <div>
              <div className="text-sm font-medium text-muted-foreground">{L(lang, "Name", "科目名稱", "科目名稱")}</div>
              <input
                value={draft.account_name ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, account_name: e.target.value }))}
                className={cn(inputCls, "mt-1")}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium text-muted-foreground">{L(lang, "Type", "類型", "類型")}</div>
                <select
                  value={draft.account_type ?? "ASSET"}
                  onChange={(e) => setDraft((d) => ({ ...d, account_type: e.target.value as ChartAccount["account_type"] }))}
                  className={cn(selectCls, "mt-1")}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">{L(lang, "Nature", "借貸性質", "借貸性質")}</div>
                <select
                  value={draft.normal_balance ?? "DEBIT"}
                  onChange={(e) => setDraft((d) => ({ ...d, normal_balance: e.target.value as "DEBIT" | "CREDIT" }))}
                  className={cn(selectCls, "mt-1")}
                >
                  <option value="DEBIT">{L(lang, "Debit", "借方", "借方")}</option>
                  <option value="CREDIT">{L(lang, "Credit", "貸方", "貸方")}</option>
                </select>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-muted-foreground">{L(lang, "FS category", "財報分類", "財報分類")}</div>
              <select
                value={draft.fs_category ?? "OPEX"}
                onChange={(e) => setDraft((d) => ({ ...d, fs_category: e.target.value }))}
                className={cn(selectCls, "mt-1")}
              >
                {FS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-sm font-medium text-muted-foreground">{L(lang, "Cash flow", "現金流", "現金流")}</div>
              <select
                value={draft.cash_flow_activity ?? "OPERATING_WC"}
                onChange={(e) => setDraft((d) => ({ ...d, cash_flow_activity: e.target.value }))}
                className={cn(selectCls, "mt-1")}
              >
                {CASH_FLOW.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t space-y-2 pt-3">
              {(
                [
                  ["is_control_account", L(lang, "Sub-ledger control account", "子帳控制科目", "子帳控制科目")],
                  ["allow_manual_je", L(lang, "Allow manual entries", "允許手動分錄", "允許手動分錄")],
                  ["is_active", L(lang, "Active", "啟用", "啟用")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[key])}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
                    className="size-3.5 accent-ink"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>

            {error && <div className="rounded-sm border border-risk-line bg-risk-bg px-2 py-1.5 text-sm text-risk">{error}</div>}
          </div>

          <footer className="border-t flex shrink-0 items-center justify-end gap-2 px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              {L(lang, "Cancel", "取消", "取消")}
            </Button>
            <Button variant="default" size="sm" onClick={() => void save()} disabled={saving}>
              <Save /> {L(lang, "Save", "儲存", "儲存")}
            </Button>
          </footer>
        </aside>
      )}
    </div>
  );
}
