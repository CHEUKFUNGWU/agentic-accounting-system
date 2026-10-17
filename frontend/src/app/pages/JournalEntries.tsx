import * as React from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, Paperclip, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "../legacy/toast";
import { cn, moneyPlain } from "@/lib/utils";
import type { Language } from "@/i18n";
import { L } from "@/lib/labels";
import { bookApi, type Principal, type VoucherSummary } from "@/app/api";
import { statusLabel } from "@/app/pages/JournalEntryEditor"
import { PageHeader } from "@/app/components/PageHeader";


const STATUS_TONE: Record<string, "secondary" | "outline" | "default" | "destructive"> = {
  DRAFT: "secondary",
  PENDING_CHECKER: "outline",
  AWAITING_CPA: "outline",
  POSTED: "secondary",
  REJECTED: "destructive",
  REVERSED: "default",
};

const FILTERS = ["ALL", "DRAFT", "PENDING_CHECKER", "POSTED", "REJECTED", "REVERSED"] as const;

export function JournalEntries({
  entity,
  period,
  lang,
  principal,
  onOpen,
  onNew,
}: {
  entity: string;
  period: string;
  lang: Language;
  principal: Principal;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [vouchers, setVouchers] = React.useState<VoucherSummary[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const reload = React.useCallback(async () => {
    const res = await bookApi.vouchers(entity, period);
    setVouchers(res.vouchers);
    setCounts(res.counts);
  }, [entity, period]);
  React.useEffect(() => {
    void reload();
  }, [reload]);
  const onRefresh = () => void reload();
  const toast = useToast();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("ALL");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const rows = filter === "ALL" ? vouchers : vouchers.filter((v) => v.status === filter);

  const act = async (id: string, kind: "approve" | "reject", e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(id);
    setError(null);
    try {
      if (kind === "approve") {
        const res = await bookApi.approve(id, principal.principal_key);
        toast.push({
          title: L(lang, "Posted to the ledger", "已過賬至總帳", "已過賬至總帳"),
          description: res.entry_status,
          tone: "ok",
        });
      } else {
        const reason = window.prompt(L(lang, "Rejection reason (required)", "駁回理由（必填）", "駁回理由（必填）"), "");
        if (!reason?.trim()) return;
        await bookApi.reject(id, principal.principal_key, reason);
        toast.push({ title: L(lang, "Returned to the maker", "已退回製單人", "已退回製單人"), tone: "ok" });
      }
      onRefresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
      toast.push({ title: L(lang, "Refused", "系統拒絕", "系統拒絕"), description: String(err?.message ?? err), tone: "warn" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader
        title="Journal Entry"
        actions={
          <Button size="sm" onClick={onNew}>
            <Plus /> {L(lang, "New entry", "新增分錄", "新增分錄")}
          </Button>
        }
        toolbar={
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => {
              const label = f === "ALL" ? L(lang, "All", "全部", "全部") : statusLabel(f, lang)
              const count = f === "ALL" ? vouchers.length : counts[f] ?? 0
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-sm transition-colors",
                    filter === f ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {count > 0 && <span className="num text-xs text-muted-foreground">{count}</span>}
                </button>
              )
            })}
          </div>
        }
      />

      {error && (
        <div className="border-b flex items-start gap-2 bg-risk-bg px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-risk" />
          <span className="text-sm text-risk">{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="border-b h-8 w-[150px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Voucher", "憑證號", "憑證號")}
              </th>
              <th className="border-b h-8 w-[100px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Date", "日期", "日期")}
              </th>
              <th className="border-b h-8 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Summary", "摘要", "摘要")}
              </th>
              <th className="border-b h-8 w-[64px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Lines", "行", "行")}
              </th>
              <th className="border-b h-8 w-[64px] px-3 text-center text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Docs", "附件", "附件")}
              </th>
              <th className="border-b h-8 w-[130px] px-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Amount", "金額", "金額")}
              </th>
              <th className="border-b h-8 w-[110px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Status", "狀態", "狀態")}
              </th>
              <th className="border-b h-8 w-[190px] px-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                {L(lang, "Prepared / Reviewed", "製單 / 複核", "製單 / 複核")}
              </th>
              <th className="border-b h-8 w-[150px] px-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="h-32 text-center text-sm text-muted-foreground">
                  {L(lang, "No vouchers in this view", "這個檢視下沒有憑證", "這個檢視下沒有憑證")}
                </td>
              </tr>
            )}
            {rows.map((v) => {
              const actionable =
                (v.status === "PENDING_CHECKER" || v.status === "AWAITING_CPA") &&
                principal.can_approve &&
                v.created_by_principal_key !== principal.principal_key;
              const mine = v.created_by_principal_key === principal.principal_key;
              return (
                <tr
                  key={v.journal_id}
                  onClick={() => onOpen(v.journal_id)}
                  className="cursor-default border-b border-border/70 hover:bg-accent/40"
                >
                  <td className="h-8 px-3 font-mono text-sm">{v.voucher_no}</td>
                  <td className="num h-8 px-3 text-sm text-muted-foreground">{v.accounting_date}</td>
                  <td className="h-8 max-w-[280px] truncate px-3" title={v.memo}>
                    {v.memo || "—"}
                    {v.reject_reason && (
                      <span className="ml-2 text-xs text-risk">
                        {L(lang, "rejected:", "已駁回：", "已駁回：")}
                        {v.reject_reason.slice(0, 24)}
                      </span>
                    )}
                  </td>
                  <td className="num h-8 px-3 text-right text-sm text-muted-foreground">{v.line_count}</td>
                  <td className="h-8 px-3 text-center">
                    {v.attachment_count > 0 ? (
                      <span className="num inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Paperclip className="size-3" />
                        {v.attachment_count}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="num h-8 px-3 text-right">{moneyPlain(v.total_debit)}</td>
                  <td className="h-8 px-3">
                    <Badge variant={STATUS_TONE[v.status] ?? "neutral"}>{statusLabel(v.status, lang)}</Badge>
                  </td>
                  <td className="h-8 px-3 text-sm text-muted-foreground">
                    <span className={cn(mine && "font-medium text-foreground")}>
                      {v.created_by_principal_key?.replace(/-\d+$/, "")}
                    </span>
                    <span className="text-muted-foreground"> / </span>
                    <span>{v.approved_by_principal_key?.replace(/-\d+$/, "") ?? "—"}</span>
                  </td>
                  <td className="h-8 px-3">
                    <div className="flex items-center justify-end gap-1">
                      {actionable && (
                        <>
                          <Button variant="outline" size="xs" disabled={busy === v.journal_id} onClick={(e) => act(v.journal_id, "reject", e)}>
                            <X /> {L(lang, "Reject", "駁回", "駁回")}
                          </Button>
                          <Button variant="default" size="xs" disabled={busy === v.journal_id} onClick={(e) => act(v.journal_id, "approve", e)}>
                            {busy === v.journal_id ? <Loader2 className="animate-spin" /> : <Check />}
                            {L(lang, "Approve", "核准", "核准")}
                          </Button>
                        </>
                      )}
                      {!actionable && (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>


    </div>
  );
}
