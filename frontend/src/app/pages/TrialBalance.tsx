import * as React from "react";
import { AlertTriangle, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, money, moneyPlain } from "@/lib/utils";
import { L, localizeLabel } from "@/lib/labels";
import type { Language } from "@/i18n";
import { bookApi, type BalanceProof, type FiscalPeriod, type TrialBalanceRow } from "@/app/api"
import { PageHeader } from "@/app/components/PageHeader";


const GROUPS: Array<{ type: string; en: string; cn: string; tw: string }> = [
  { type: "ASSET", en: "Assets", cn: "资产", tw: "資產" },
  { type: "LIABILITY", en: "Liabilities", cn: "负债", tw: "負債" },
  { type: "EQUITY", en: "Equity", cn: "股东权益", tw: "股東權益" },
  { type: "REVENUE", en: "Revenue", cn: "收入", tw: "收入" },
  { type: "EXPENSE", en: "Expenses", cn: "费用", tw: "費用" },
];

/** 試算表 — 期初 + 本期發生 + 調整 = 期末，全部由分錄推導。 */
export function TrialBalance({
  entity,
  period,
  periodInfo,
  lang,
  onOpenAccount,
}: {
  entity: string;
  entityName: string;
  period: string;
  periodInfo?: FiscalPeriod;
  lang: Language;
  onOpenAccount: (accountCode: string) => void;
}) {
  const [rows, setRows] = React.useState<TrialBalanceRow[]>([]);
  const [proof, setProof] = React.useState<BalanceProof | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    bookApi.trialBalance(entity, period).then((res) => {
      if (cancelled) return;
      setRows(res.rows);
      setProof(res.proof);
    });
    return () => {
      cancelled = true;
    };
  }, [entity, period]);

  const visible = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !r.account_code.toLowerCase().includes(q) && !r.account_name.toLowerCase().includes(q)) return false;
    return true;
  });

  const total = (key: keyof TrialBalanceRow) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
  const closingDr = rows.reduce((t, r) => t + Math.max(0, Number(r.closing) || 0), 0);
  const closingCr = rows.reduce((t, r) => t + Math.max(0, -(Number(r.closing) || 0)), 0);
  const balanced = Math.abs(closingDr - closingCr) < 0.005;
  const locked = periodInfo ? !periodInfo.is_writable : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader
        title="Trial Balance"
        toolbar={
          <>
            <div className="relative">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={L(lang, "Code or name", "代碼或名稱", "代碼或名稱")}
                className="h-8 w-[200px] rounded-md border bg-background pr-2 pl-7 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            {locked ? <Badge variant="secondary">已封存</Badge> : null}
            {proof && !proof.ledger_balanced ? (
              <Badge variant="destructive">
                <AlertTriangle className="size-3" />
                <span className="num">{moneyPlain(proof.ledger_difference)}</span>
              </Badge>
            ) : null}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="border-b h-8 w-[68px] pl-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Code", "代碼", "代碼")}
              </th>
              <th className="border-b h-8 px-2 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Account", "科目名稱", "科目名稱")}
              </th>
              <th className="border-b h-8 w-[122px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Opening", "期初", "期初")}
              </th>
              <th className="border-b h-8 w-[112px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Debit", "本期借", "本期借")}
              </th>
              <th className="border-b h-8 w-[112px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Credit", "本期貸", "本期貸")}
              </th>
              <th className="border-b h-8 w-[108px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Adj. Dr", "調整借", "調整借")}
              </th>
              <th className="border-b h-8 w-[108px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Adj. Cr", "調整貸", "調整貸")}
              </th>
              <th className="border-b h-8 w-[136px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Closing", "期末", "期末")}
              </th>
              <th className="border-b h-8 w-[24px]" />
            </tr>
          </thead>

          {GROUPS.map((group) => {
            const groupRows = visible.filter((r) => r.account_type === group.type);
            if (!groupRows.length) return null;
            return (
              <tbody key={group.type}>
                <tr>
                  <td colSpan={9} className="border-b bg-muted py-[3px] pl-3">
                    <span className="text-sm font-medium text-muted-foreground">{L(lang, group.en, group.cn, group.tw)}</span>
                  </td>
                </tr>
                {groupRows.map((row) => (
                  <tr
                    key={row.account_code}
                    onClick={() => onOpenAccount(row.account_code)}
                    className="group cursor-default border-b border-border/60 hover:bg-accent/50"
                  >
                    <td className="num h-[var(--row-h)] pl-3 font-mono text-sm text-muted-foreground">{row.account_code}</td>
                    <td className="h-[var(--row-h)] truncate px-2 whitespace-nowrap">{localizeLabel(row.account_name, lang)}</td>
                    <td className="h-[var(--row-h)] px-3 text-right">
                      <Num value={row.opening} side={row.opening_side} lang={lang} />
                    </td>
                    <td className="num h-[var(--row-h)] px-3 text-right">
                      {Number(row.period_debit) ? moneyPlain(row.period_debit) : <Blank />}
                    </td>
                    <td className="num h-[var(--row-h)] px-3 text-right">
                      {Number(row.period_credit) ? moneyPlain(row.period_credit) : <Blank />}
                    </td>
                    <td className="num h-[var(--row-h)] px-3 text-right text-warn">
                      {Number(row.adjustment_debit) ? moneyPlain(row.adjustment_debit) : ""}
                    </td>
                    <td className="num h-[var(--row-h)] px-3 text-right text-warn">
                      {Number(row.adjustment_credit) ? moneyPlain(row.adjustment_credit) : ""}
                    </td>
                    <td className="h-[var(--row-h)] px-3 text-right font-medium">
                      <Num value={row.closing} side={row.closing_side} lang={lang} />
                    </td>
                    <td className="h-[var(--row-h)] pr-2">
                      <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}

          <tfoot className="sticky bottom-0 bg-background">
            <tr className="border-t-2 border-ink">
              <td />
              <td className="h-9 px-2 text-sm font-semibold">
                {L(lang, "Total", "合計", "合計")}
              </td>
              <td className="num h-9 px-3 text-right font-medium">{moneyPlain(total("opening"))}</td>
              <td className="num h-9 px-3 text-right font-medium">{moneyPlain(total("period_debit"))}</td>
              <td className="num h-9 px-3 text-right font-medium">{moneyPlain(total("period_credit"))}</td>
              <td className="num h-9 px-3 text-right font-medium">{moneyPlain(total("adjustment_debit"))}</td>
              <td className="num h-9 px-3 text-right font-medium">{moneyPlain(total("adjustment_credit"))}</td>
              <td
                className={cn("num rule-double h-9 px-3 text-right font-semibold",
                  balanced ? "text-foreground" : "text-risk",
                )}
              >
                {moneyPlain(total("closing"))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Num({ value, side, lang }: { value: string; side: string; lang: Language }) {
  const zero = moneyPlain(value) === "0.00";
  if (zero) return <Blank />;
  return (
    <span className="num">
      {money(value)}
      <span className="ml-1 text-xs text-muted-foreground">
        {side === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸")}
      </span>
    </span>
  );
}

const Blank = () => <span className="text-muted-foreground/40">—</span>;
