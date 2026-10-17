import * as React from "react";
import { AlertTriangle, ArrowRight, Check, Lock, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, moneyPlain } from "@/lib/utils";
import type { Language } from "@/i18n";
import { L } from "@/lib/labels";
import { bookApi, type BalanceProof, type CloseResult, type FiscalPeriod, type Principal, type VoucherSummary } from "@/app/api";


const STATUS: Record<string, { tone: "secondary" | "default"; en: string; cn: string; tw: string }> = {
  FUTURE: { tone: "secondary", en: "Future", cn: "未開啟", tw: "未開啟" },
  OPEN: { tone: "secondary", en: "Open", cn: "開放", tw: "開放" },
  SOFT_CLOSE: { tone: "secondary", en: "Soft close", cn: "軟關", tw: "軟關" },
  HARD_CLOSE: { tone: "secondary", en: "Hard close", cn: "硬關", tw: "硬關" },
  LOCKED: { tone: "default", en: "Locked", cn: "已封存", tw: "已封存" },
};

/** 期間與結帳 — 期間狀態、結帳前置條件、結轉結果。 */
export function Periods({
  entity,
  currentPeriod,
  lang,
  principal,
  onChanged,
}: {
  entity: string;
  entityName: string;
  currentPeriod: string;
  lang: Language;
  principal: Principal;
  onChanged: () => void;
}) {
  const [periods, setPeriods] = React.useState<FiscalPeriod[]>([]);
  const [selected, setSelected] = React.useState<string>(currentPeriod);
  const [vouchers, setVouchers] = React.useState<VoucherSummary[]>([]);
  const [proof, setProof] = React.useState<BalanceProof | null>(null);
  const [closing, setClosing] = React.useState(false);
  const [result, setResult] = React.useState<CloseResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [p, v, tb] = await Promise.all([
      bookApi.periods(entity),
      bookApi.vouchers(entity, selected),
      bookApi.trialBalance(entity, selected),
    ]);
    setPeriods(p.periods);
    setVouchers(v.vouchers);
    setProof(tb.proof);
  }, [entity, selected]);

  React.useEffect(() => {
    setResult(null);
    setError(null);
    void load();
  }, [load]);

  const period = periods.find((p) => p.period_code === selected);
  const unposted = vouchers.filter((v) => ["DRAFT", "PENDING_CHECKER", "AWAITING_CPA"].includes(v.status));
  const authorised = principal.can_approve || Boolean((principal as any).is_human);
  const isLocked = period?.status === "LOCKED";

  const blockers = [
    unposted.length > 0 && `${unposted.length} ${L(lang, "unposted", "張未過賬", "張未過賬")}`,
    proof && !proof.ledger_balanced && L(lang, `ledger difference ${proof.ledger_difference}`, `借貸差額 ${proof.ledger_difference}`, `借貸差額 ${proof.ledger_difference}`),
    !authorised && L(lang, "not authorised", "無結帳權限", "無結帳權限"),
  ].filter(Boolean) as string[];

  const doClose = async () => {
    setClosing(true);
    setError(null);
    try {
      setResult(await bookApi.closePeriod(entity, selected, principal.principal_key));
      await load();
      onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="border-r flex w-[280px] shrink-0 flex-col bg-background">
        <header className="border-b flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-sm font-semibold">{L(lang, "Periods", "會計期間", "會計期間")}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => void load()} aria-label="refresh">
            <RefreshCw />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {periods.map((p) => {
            const meta = STATUS[p.status] ?? STATUS.OPEN;
            return (
              <button
                key={p.period_code}
                type="button"
                onClick={() => setSelected(p.period_code)}
                className={cn("flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left",
                  selected === p.period_code ? "bg-accent" : "hover:bg-accent/50",
                )}
                style={selected === p.period_code ? { boxShadow: "inset 2px 0 0 var(--color-ink)" } : undefined}
              >
                <span className="num flex-1 font-mono text-sm">{p.period_code}</span>
                <Badge variant={meta.tone}>{L(lang, meta.en, meta.cn, meta.tw)}</Badge>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {period && (
            <dl className="grid max-w-[560px] grid-cols-4 gap-4">
              {[
                [L(lang, "Start", "開始", "開始"), period.start_date],
                [L(lang, "End", "結束", "結束"), period.end_date],
                [L(lang, "Fiscal year", "年度", "年度"), String(period.fiscal_year)],
                [L(lang, "Vouchers", "憑證", "憑證"), `${vouchers.length}`],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-sm font-medium text-muted-foreground">{k}</dt>
                  <dd className="num mt-1 text-sm font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <section className="mt-5 max-w-[560px]">
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2">
                {unposted.length === 0 ? (
                  <Check className="size-4 shrink-0 text-ok" strokeWidth={2.5} />
                ) : (
                  <X className="size-4 shrink-0 text-risk" strokeWidth={2.5} />
                )}
                <span className="text-sm">
                  {L(lang, "All vouchers posted", "憑證全部過賬", "憑證全部過賬")}
                </span>
                {unposted.length > 0 && (
                  <span className="num ml-auto text-sm text-muted-foreground">
                    {unposted.map((v) => v.voucher_no).slice(0, 3).join(", ")}
                    {unposted.length > 3 ? " …" : ""}
                  </span>
                )}
              </li>
              <li className="flex items-center gap-2">
                {proof?.ledger_balanced ? (
                  <Check className="size-4 shrink-0 text-ok" strokeWidth={2.5} />
                ) : (
                  <X className="size-4 shrink-0 text-risk" strokeWidth={2.5} />
                )}
                <span className="text-sm">{L(lang, "Ledger balanced", "借貸平衡", "借貸平衡")}</span>
                {proof && (
                  <span className="num ml-auto text-sm text-muted-foreground">
                    {moneyPlain(proof.ledger_debit)} / {moneyPlain(proof.ledger_credit)}
                  </span>
                )}
              </li>
            </ul>
          </section>

          <section className="mt-5 max-w-[560px] border-t border-border pt-4">
            {isLocked ? (
              <div className="flex items-center gap-3">
                <Lock className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  {L(lang, "Locked by", "已由", "已由")} <strong>{period?.closed_by_principal_key}</strong>
                </span>
                <span className="num text-sm text-muted-foreground">
                  {period?.closed_at ? new Date(period.closed_at).toLocaleString() : ""}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="default" size="sm" disabled={blockers.length > 0 || closing} onClick={() => void doClose()}>
                  <Lock />
                  {closing ? L(lang, "Closing…", "結帳中…", "結帳中…") : L(lang, "Close period", "執行結帳", "執行結帳")}
                </Button>
                {blockers.map((b, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-sm text-warn">
                    <AlertTriangle className="size-3.5" />
                    {b}
                  </span>
                ))}
              </div>
            )}

            {error && <div className="mt-3 max-w-[560px] rounded-sm border border-risk-line bg-risk-bg px-2 py-1.5 text-sm text-risk">{error}</div>}
          </section>

          {result && (
            <section className="mt-5 max-w-[560px] border-t border-border pt-4">
              <div className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-ok" strokeWidth={2.5} />
                <span className="num font-mono">
                  {result.period_code} → {result.next_period}
                </span>
                <span className="num ml-auto text-sm text-muted-foreground">
                  {moneyPlain(result.carried_forward_total)}
                </span>
              </div>

              <table className="mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b h-7 px-2 text-left text-xs font-semibold text-muted-foreground uppercase">
                      {L(lang, "Account", "科目", "科目")}
                    </th>
                    <th className="border-b h-7 px-2 text-right text-xs font-semibold text-muted-foreground uppercase">
                      {result.period_code}
                    </th>
                    <th className="border-b h-7 w-[28px]" />
                    <th className="border-b h-7 px-2 text-right text-xs font-semibold text-muted-foreground uppercase">
                      {result.next_period}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.carried_forward.slice(0, 10).map((row) => (
                    <tr key={row.account_code} className="border-b border-border/60">
                      <td className="num h-7 px-2 font-mono">{row.account_code}</td>
                      <td className="num h-7 px-2 text-right text-muted-foreground">{moneyPlain(row.opening)}</td>
                      <td className="h-7 text-center text-muted-foreground">
                        <ArrowRight className="mx-auto size-3" />
                      </td>
                      <td className="num h-7 px-2 text-right font-medium">{moneyPlain(row.opening)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.carried_forward.length > 10 && (
                <p className="num mt-1 text-xs text-muted-foreground">+{result.carried_forward.length - 10}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
