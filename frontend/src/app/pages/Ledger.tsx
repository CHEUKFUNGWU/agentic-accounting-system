import * as React from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, money, moneyPlain } from "@/lib/utils";
import { L, localizeLabel } from "@/lib/labels";
import type { Language } from "@/i18n";
import { bookApi, type Account, type AccountLedger } from "@/app/api";


/* ==========================================================================
   General ledger, derived from POSTED vouchers.

   The point of this screen is architectural: the trial balance is now computed
   from journal lines, and the trial balance is downstream of it. Until recently the trial balance
   was the source of truth, which is why nothing could be traced back to a
   document.
   ========================================================================== */

export function Ledger({
  entity,
  period,
  lang,
  initialAccount,
  onOpenVoucher,
  onBack,
}: {
  entity: string;
  period: string;
  lang: Language;
  initialAccount?: string;
  onOpenVoucher: (journalId: string) => void;
  onBack?: () => void;
}) {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  React.useEffect(() => {
    bookApi.chart(entity).then((r) => setAccounts(r.accounts));
  }, [entity]);
  const [selected, setSelected] = React.useState<string>(initialAccount ?? accounts[0]?.account_code ?? "");
  const [ledger, setLedger] = React.useState<AccountLedger | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (initialAccount) setSelected(initialAccount);
  }, [initialAccount]);

  const load = React.useCallback(
    async (code: string) => {
      if (!code) return;
      setLoading(true);
      try {
        setLedger(await bookApi.accountLedger(entity, code, period));
      } catch {
        setLedger(null);
      } finally {
        setLoading(false);
      }
    },
    [entity, period],
  );

  React.useEffect(() => {
    void load(selected);
  }, [selected, load]);

  React.useEffect(() => {
    if (!selected && accounts[0]) setSelected(accounts[0].account_code);
  }, [accounts, selected]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* account list */}
      <aside className="border-r flex w-[300px] shrink-0 flex-col bg-background">
        <div className="border-b flex h-9 items-center justify-between px-3">
          <span className="text-sm font-medium text-muted-foreground">{L(lang, "Chart of accounts", "科目表", "科目表")}</span>
          <span className="num text-xs text-muted-foreground">{accounts.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {accounts.map((a) => (
            <button
              key={a.account_code}
              type="button"
              onClick={() => setSelected(a.account_code)}
              className={cn("flex w-full items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left transition-colors",
                selected === a.account_code ? "bg-accent" : "hover:bg-accent/50",
              )}
              style={selected === a.account_code ? { boxShadow: "inset 2px 0 0 var(--color-ink)" } : undefined}
            >
              <span className="w-[38px] shrink-0 font-mono text-xs text-muted-foreground">{a.account_code}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{localizeLabel(a.account_name, lang)}</span>
              <Badge variant="outline" className="shrink-0">
                {a.normal_balance === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸")}
              </Badge>
            </button>
          ))}
        </div>
      </aside>

      {/* movements */}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {ledger ? (
          <>
            <header className="border-b flex h-9 items-center justify-between px-3">
              {onBack && (
                <button type="button" onClick={onBack} className="rounded-sm px-1 text-sm text-muted-foreground hover:text-foreground">←</button>
              )}
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{ledger.account.account_code}</span>
                <span className="truncate font-medium">{localizeLabel(ledger.account.account_name, lang)}</span>
              </div>
              {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="border-b h-8 w-[100px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Date", "日期", "日期")}
                    </th>
                    <th className="border-b h-8 w-[150px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Voucher", "憑證號", "憑證號")}
                    </th>
                    <th className="border-b h-8 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Summary", "摘要", "摘要")}
                    </th>
                    <th className="border-b h-8 w-[150px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Counterparty", "對方", "對方")}
                    </th>
                    <th className="border-b h-8 w-[120px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Debit", "借方", "借方")}
                    </th>
                    <th className="border-b h-8 w-[120px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Credit", "貸方", "貸方")}
                    </th>
                    <th className="border-b h-8 w-[150px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Balance", "餘額", "餘額")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-muted">
                    <td className="h-7 px-3 text-sm text-muted-foreground" colSpan={6}>
                      {L(lang, "Opening balance", "期初餘額", "期初餘額")}
                    </td>
                    <td className="num h-7 px-3 text-right font-medium">
                      {money(ledger.opening_balance)}{" "}
                      <span className="text-xs text-muted-foreground">
                        {ledger.opening_side === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸")}
                      </span>
                    </td>
                  </tr>

                  {ledger.movements.length === 0 && (
                    <tr>
                      <td colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                        {L(lang, "No posted movement in this period", "本期沒有已過賬的分錄", "本期沒有已過賬的分錄")}
                      </td>
                    </tr>
                  )}

                  {ledger.movements.map((m, i) => (
                    <tr
                      key={i}
                      onClick={() => m.journal_id && onOpenVoucher(m.journal_id)}
                      className="cursor-default border-b border-border/60 hover:bg-accent/40"
                    >
                      <td className="num h-8 px-3 text-sm text-muted-foreground">{m.date}</td>
                      <td className="h-8 px-3 font-mono text-sm">{m.voucher_no}</td>
                      <td className="h-8 max-w-[320px] truncate px-2" title={m.memo}>
                        {m.memo}
                      </td>
                      <td className="h-8 truncate px-3 text-sm text-muted-foreground">{m.counterparty || "—"}</td>
                      <td className="num h-8 px-3 text-right">{Number(m.debit) ? money(m.debit) : ""}</td>
                      <td className="num h-8 px-3 text-right">{Number(m.credit) ? money(m.credit) : ""}</td>
                      <td className="num h-8 px-3 text-right">
                        {money(m.balance)}{" "}
                        <span className="text-xs text-muted-foreground">
                          {m.balance_side === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-muted">
                  <tr className="border-t-2 border-ink">
                    <td colSpan={4} className="h-9 px-3 text-right font-medium">
                      {L(lang, "Period movement / closing", "本期合計 / 期末餘額", "本期合計 / 期末餘額")}
                    </td>
                    <td className="num h-9 px-3 text-right font-medium">{moneyPlain(ledger.total_debit)}</td>
                    <td className="num h-9 px-3 text-right font-medium">{moneyPlain(ledger.total_credit)}</td>
                    <td className="num h-9 px-3 text-right text-base font-semibold">
                      {money(ledger.closing_balance)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {ledger.closing_side === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸")}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {L(lang, "Select an account", "請選擇科目", "請選擇科目")}
          </div>
        )}
      </div>
    </div>
  );
}
