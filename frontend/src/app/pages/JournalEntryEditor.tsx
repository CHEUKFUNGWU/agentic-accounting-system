import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDot,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../legacy/command";
import { PopoverPanel } from "../legacy/popover";
import { useToast } from "../legacy/toast";
import { cn, money, moneyPlain } from "@/lib/utils";
import { sanitizeAmountInput, toAmountInput } from "@/lib/format";
import { L, localizeLabel } from "@/lib/labels";
import { pick, type Language } from "@/i18n";
import { bookApi, type Account, type EvidenceRecord, type Principal, type VoucherDetail } from "@/app/api";
import { voucherAmountInWords } from "@/app/money-words";

/* ==========================================================================
   The voucher (記賬憑證).

   Design decisions worth stating:

   * The form IS the voucher: number, date, per-line 摘要, attachments, amount
     in words, and the 製單/複核/記賬 signature strip. Accountants already know
     this object; reinventing it costs them muscle memory.
   * The attachment zone is the entry point, not an afterthought — bookkeeping
     starts with a document on the desk.
   * Every refusal the server can produce is surfaced next to the button that
     caused it, so the control is visible instead of mysterious.
   ========================================================================== */

export interface DraftLine {
  key: string;
  account_code: string;
  account_name: string;
  memo: string;
  debit: string;
  credit: string;
  counterparty: string;
}

let lineSeq = 0;
export function emptyLine(seed?: Partial<DraftLine>): DraftLine {
  lineSeq += 1;
  return {
    key: `line-${lineSeq}`,
    account_code: "",
    account_name: "",
    memo: "",
    debit: "",
    credit: "",
    counterparty: "",
    ...seed,
  };
}

export function linesFromVoucher(v: VoucherDetail): DraftLine[] {
  return v.lines.map((l) =>
    emptyLine({
      account_code: l.account_code,
      account_name: l.account_name ?? "",
      memo: l.memo ?? "",
      debit: Number(l.debit) ? toAmountInput(l.debit) : "",
      credit: Number(l.credit) ? toAmountInput(l.credit) : "",
      counterparty: l.counterparty ?? "",
    }),
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<string, "secondary" | "outline" | "default" | "destructive"> = {
  DRAFT: "secondary",
  PENDING_CHECKER: "outline",
  AWAITING_CPA: "outline",
  POSTED: "secondary",
  REJECTED: "destructive",
  REVERSED: "default",
};

export function statusLabel(status: string, lang: Language): string {
  return pick(lang, {
    en: {
      DRAFT: "Draft",
      PENDING_CHECKER: "Pending review",
      AWAITING_CPA: "Awaiting CPA",
      POSTED: "Posted",
      REJECTED: "Rejected",
      REVERSED: "Reversed",
    }[status] ?? status,"zh-CN": {
      DRAFT: "草稿",
      PENDING_CHECKER: "待复核",
      AWAITING_CPA: "待会计师签核",
      POSTED: "已过账",
      REJECTED: "已驳回",
      REVERSED: "已冲销",
    }[status] ?? status,"zh-TW": {
      DRAFT: "草稿",
      PENDING_CHECKER: "待複核",
      AWAITING_CPA: "待會計師簽核",
      POSTED: "已過賬",
      REJECTED: "已駁回",
      REVERSED: "已沖銷",
    }[status] ?? status,
  });
}


const DR_CR = (lang: Language, side: "DEBIT" | "CREDIT") =>
  side === "DEBIT" ? L(lang, "Dr", "借", "借") : L(lang, "Cr", "貸", "貸");

/* -------------------------------------------------------------------------- */

function AccountCell({
  accounts,
  line,
  lang,
  readOnly,
  onChange,
}: {
  accounts: Account[];
  line: DraftLine;
  lang: Language;
  readOnly: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const account = accounts.find((a) => a.account_code === line.account_code);

  if (readOnly) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground">{line.account_code}</span>
        <span className="truncate">{localizeLabel(line.account_name, lang)}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("flex h-6 w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left transition-colors hover:bg-accent",
          !line.account_code && "text-muted-foreground",
        )}
      >
        {line.account_code ? (
          <>
            <span className="font-mono text-sm text-muted-foreground">{line.account_code}</span>
            <span className="truncate">{localizeLabel(line.account_name, lang)}</span>
            {account?.is_control_account && (
              <Badge variant="secondary" className="shrink-0">
                {L(lang, "control", "子帳", "子帳")}
              </Badge>
            )}
          </>
        ) : (
          <span className="text-sm">{L(lang, "Select account…", "選擇科目…", "選擇科目…")}</span>
        )}
      </button>

      <PopoverPanel open={open} onClose={() => setOpen(false)} className="w-[420px]">
        <Command>
          <CommandInput placeholder={L(lang, "Search code or name…", "搜尋科目代碼或名稱…", "搜尋科目代碼或名稱…")} />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>{L(lang, "No matching account", "沒有相符科目", "沒有相符科目")}</CommandEmpty>
            {accounts.map((a) => (
              <CommandItem
                key={a.account_code}
                value={`${a.account_code} ${a.account_name}`}
                onSelect={() => {
                  onChange({ account_code: a.account_code, account_name: a.account_name });
                  setOpen(false);
                }}
              >
                <span className="w-[38px] shrink-0 font-mono text-xs text-muted-foreground">{a.account_code}</span>
                <span className="min-w-0 flex-1 truncate">{localizeLabel(a.account_name, lang)}</span>
                <Badge variant="outline" className="shrink-0">
                  {DR_CR(lang, a.normal_balance)}
                </Badge>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverPanel>
    </div>
  );
}

function AmountCell({
  value,
  readOnly,
  disabled,
  onChange,
  autoFocus,
  onEnter,
}: {
  value: string;
  readOnly: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  if (readOnly) {
    return <span className="num block px-2 text-right">{value ? money(value) : ""}</span>;
  }
  return (
    <input
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="decimal"
      autoComplete="off"
      placeholder={disabled ? "" : "0.00"}
      onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
      onBlur={() => value && onChange(toAmountInput(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter?.();
        }
      }}
      className={cn("num h-6 w-full rounded-sm bg-transparent px-2 text-right outline-none","hover:bg-accent focus:bg-background focus:ring-1 focus:ring-ring",
        disabled && "cursor-not-allowed text-muted-foreground/40",
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */

export function JournalEntryEditor({
  entity,
  period,
  currency,
  principal,
  voucher,
  lang,
  onChanged,
  onClose,
  onOpenPrincipalSwitcher,
}: {
  entity: string;
  period: string;
  currency: string;
  principal: Principal;
  voucher: VoucherDetail | null;
  lang: Language;
  onChanged: () => void;
  onClose?: () => void;
  onOpenPrincipalSwitcher?: () => void;
}) {
  const toast = useToast();
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  React.useEffect(() => {
    bookApi.chart(entity).then((r) => setAccounts(r.accounts));
  }, [entity]);
  const readOnly = voucher ? voucher.status !== "DRAFT" && voucher.status !== "REJECTED" : false;

  const [date, setDate] = React.useState(voucher?.accounting_date ?? new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = React.useState(voucher?.memo ?? "");
  const [lines, setLines] = React.useState<DraftLine[]>(
    voucher ? linesFromVoucher(voucher) : [emptyLine(), emptyLine()],
  );
  const [evidence, setEvidence] = React.useState<EvidenceRecord[]>(voucher?.evidence_uris ?? []);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [current, setCurrent] = React.useState<VoucherDetail | null>(voucher);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = React.useMemo(() => {
    const dr = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    return { dr, cr, diff: dr - cr, balanced: dr > 0 && Math.abs(dr - cr) < 0.005 };
  }, [lines]);

  const payloadLines = () =>
    lines
      .filter((l) => l.account_code && (Number(l.debit) || Number(l.credit)))
      .map((l) => ({
        account_code: l.account_code,
        debit: toAmountInput(l.debit || "0"),
        credit: toAmountInput(l.credit || "0"),
        memo: l.memo,
        counterparty: l.counterparty,
      }));

  const run = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      if (res && typeof res === "object" && "voucher" in (res as any)) {
        setCurrent((res as any).voucher);
      }
      toast.push({ title: success, tone: "ok" });
      onChanged();
      return res;
    } catch (e: any) {
      setError(String(e?.message ?? e));
      toast.push({ title: L(lang, "Refused", "系統拒絕", "系統拒絕"), description: String(e?.message ?? e), tone: "warn" });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    if (!current) {
      return run("save",
        () =>
          bookApi.create({
            entity_code: entity,
            period,
            accounting_date: date,
            memo,
            created_by_principal_key: principal.principal_key,
            lines: payloadLines(),
          }),
        L(lang, "Draft saved", "已儲存草稿", "已儲存草稿"),
      );
    }
    return run("save",
      () => bookApi.update(current.journal_id, { accounting_date: date, memo, lines: payloadLines() }),
      L(lang, "Draft saved", "已儲存草稿", "已儲存草稿"),
    );
  };

  const submit = async () => {
    let id = current?.journal_id;
    if (!id) {
      const created: any = await run("save",
        () =>
          bookApi.create({
            entity_code: entity,
            period,
            accounting_date: date,
            memo,
            created_by_principal_key: principal.principal_key,
            lines: payloadLines(),
          }),
        L(lang, "Draft saved", "已儲存草稿", "已儲存草稿"),
      );
      id = created?.voucher?.journal_id;
      if (!id) return;
    }
    await run("submit", () => bookApi.submit(id!, principal.principal_key), L(lang, "Submitted for review", "已提交複核", "已提交複核"));
  };

  const approve = () =>
    run("approve", () => bookApi.approve(current!.journal_id, principal.principal_key), L(lang, "Posted to the ledger", "已過賬至總帳", "已過賬至總帳"));

  const reject = () => {
    const reason = window.prompt(L(lang, "Rejection reason (required)", "駁回理由（必填）", "駁回理由（必填）"), "");
    if (!reason?.trim()) return;
    void run("reject", () => bookApi.reject(current!.journal_id, principal.principal_key, reason), L(lang, "Returned to the maker", "已退回製單人", "已退回製單人"));
  };

  const reverse = () =>
    run("reverse", () => bookApi.reverse(current!.journal_id, principal.principal_key), L(lang, "Reversal voucher created", "已建立沖銷憑證", "已建立沖銷憑證"));

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let id = current?.journal_id;
    if (!id) {
      const created: any = await saveDraft();
      id = created?.voucher?.journal_id;
      if (!id) return;
    }
    for (const file of Array.from(files)) {
      await run(
        `upload:${file.name}`,
        async () => {
          const res = await bookApi.upload(id!, file);
          setEvidence((prev) => [...prev, res.attachment]);
          return res;
        },
        L(lang, "Receipt attached", "已附加單據", "已附加單據"),
      );
    }
  };

  const removeEvidence = async (storedName: string) => {
    if (!current) return;
    await run("detach",
      async () => {
        await bookApi.detach(current.journal_id, storedName);
        setEvidence((prev) => prev.filter((e) => e.stored_name !== storedName));
        return null;
      },
      L(lang, "Detached (recorded)", "已移除（留下紀錄）", "已移除（留下紀錄）"),
    );
  };

  /* ---- action availability, and the reason why not -------------------- */
  const accountFor = (code: string) => accounts.find((a) => a.account_code === code);
  const controlAccountInManual = lines.some(
    (l) => l.account_code && accountFor(l.account_code)?.is_control_account && (current?.source_module ?? "GL_MANUAL") === "GL_MANUAL",
  );
  const isMaker = current?.created_by_principal_key === principal.principal_key;
  const canCreate = principal.can_create;
  const canApprove = principal.can_approve;
  const actionNote = (() => {
    if (readOnly && current) {
      if (current.status === "POSTED")
        return L(lang, "Posted vouchers cannot be edited — reverse it instead.", "已過賬憑證不可修改，請用沖銷分錄更正。", "已過賬憑證不可修改，請用沖銷分錄更正。");
      if (current.status === "PENDING_CHECKER")
        return L(lang, "Waiting for a reviewer. The maker cannot approve their own voucher.", "等待複核。製單人不可複核自己編制的憑證（職責分離）。", "等待複核。製單人不可複核自己編制的憑證（職責分離）。");
      return L(lang, "This voucher is closed.", "此憑證已結案。", "此憑證已結案。");
    }
    if (!canCreate) return L(lang, "This principal cannot create vouchers.", "此身份沒有製單權限。", "此身份沒有製單權限。");
    if (!evidence.length) return L(lang, "At least one receipt is required before review.", "提交複核前必須附上至少一張原始單據。", "提交複核前必須附上至少一張原始單據。");
    if (!totals.balanced) return L(lang, "Debits and credits must agree.", "借貸必須平衡才能提交。", "借貸必須平衡才能提交。");
    if (controlAccountInManual)
      return L(lang, "Control accounts cannot be posted manually.", "子帳控制科目不可用一般分錄直接過賬。", "子帳控制科目不可用一般分錄直接過賬。");
    return null;
  })();

  const canSubmit = !readOnly && canCreate && !actionNote;
  const canApproveNow = Boolean(current && current.status !== "DRAFT" && current.status !== "REJECTED" && canApprove && !isMaker && current.status !== "POSTED" && current.status !== "REVERSED");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <article className="sheet-shadow mx-auto w-full max-w-[1040px] rounded-sm border border-border bg-background">
          {/* ---- voucher header ------------------------------------------ */}
          <header className="border-b-2 border-ink px-6 py-4">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold tracking-[-0.01em]">
                  {L(lang, "Journal Voucher", "記賬憑證", "記賬憑證")}
                </h2>
                {current && <Badge variant={STATUS_TONE[current.status] ?? "neutral"}>{statusLabel(current.status, lang)}</Badge>}
                {current?.reversal_of_journal_id && (
                  <Badge variant="default">{L(lang, "Reversal", "沖銷", "沖銷")}</Badge>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-muted-foreground">{L(lang, "Voucher No.", "憑證號", "憑證號")}</div>
                <div className="font-mono text-base font-medium">
                  {current?.voucher_no ?? L(lang, "(assigned on save)", "（儲存後自動編號）", "（儲存後自動編號）")}
                </div>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-[1fr_1fr_1fr_1fr] gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{L(lang, "Accounting date", "記賬日期", "記賬日期")}</dt>
                <dd className="mt-1">
                  {readOnly ? (
                    <span className="num text-sm">{date}</span>
                  ) : (
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="num h-7 w-full rounded-sm border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{L(lang, "Period", "會計期間", "會計期間")}</dt>
                <dd className="num mt-1 text-sm">{current?.period ?? period}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{L(lang, "Currency", "幣別", "幣別")}</dt>
                <dd className="num mt-1 text-sm">{current?.currency ?? currency}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">{L(lang, "Attachments", "附單據", "附單據")}</dt>
                <dd className="num mt-1 text-sm">
                  {evidence.filter((e) => e.kind === "voucher_attachment").length} {L(lang, "sheet(s)", "張", "張")}
                </dd>
              </div>
            </dl>

            <div className="mt-3">
              <div className="text-sm font-medium text-muted-foreground">{L(lang, "Summary", "摘要", "摘要")}</div>
              {readOnly ? (
                <p className="mt-1 text-sm">{memo || "—"}</p>
              ) : (
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder={L(lang, "What is this voucher for?", "這張憑證是為了什麼？", "這張憑證是為了什麼？")}
                  className="mt-1 h-7 w-full rounded-sm border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>
          </header>

          {/* ---- attachments: the entry point ---------------------------- */}
          <section className="border-b border-border px-6 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{L(lang, "Source documents", "原始單據", "原始單據")}</span>

            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {evidence.map((e, i) => (
                <div
                  key={`${e.stored_name}-${i}`}
                  className={cn("flex items-center gap-2 rounded-sm border px-2 py-1",
                    e.kind === "reversal_of" ? "border-border bg-muted" : "border-border bg-background",
                  )}
                >
                  {e.kind === "reversal_of" ? <FileText className="size-3.5 text-muted-foreground" /> : <Paperclip className="size-3.5 text-muted-foreground" />}
                  <a
                    href={e.kind === "reversal_of" ? undefined : bookApi.attachmentUrl(entity, e.stored_name)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm hover:underline"
                  >
                    {e.name}
                  </a>
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.size ? `${(e.size / 1024).toFixed(1)}KB · ` : ""}
                    {e.sha256.slice(0, 8)}
                  </span>
                  {!readOnly && e.kind === "voucher_attachment" && (
                    <button
                      type="button"
                      onClick={() => removeEvidence(e.stored_name)}
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={L(lang, "Detach", "移除", "移除")}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                  className={cn("flex items-center gap-2 rounded-sm border border-dashed px-3 py-1.5 text-sm transition-colors",
                    dragging ? "border-ink bg-accent text-foreground" : "border-border text-muted-foreground hover:border-ink hover:text-foreground",
                  )}
                >
                  <Plus className="size-3.5" />
                  {busy?.startsWith("upload") ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    L(lang, "Drop receipts / invoices / bank slips", "拖入收據／發票／銀行水單", "拖入收據／發票／銀行水單")
                  )}
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </section>

          {/* ---- lines --------------------------------------------------- */}
          <section className="px-6 py-3">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-8 px-1 text-left text-xs font-semibold text-muted-foreground uppercase">#</th>
                  <th className="px-2 text-left text-xs font-semibold text-muted-foreground uppercase">
                    {L(lang, "Line summary", "摘要", "摘要")}
                  </th>
                  <th className="w-[300px] px-2 text-left text-xs font-semibold text-muted-foreground uppercase">
                    {L(lang, "Account", "會計科目", "會計科目")}
                  </th>
                  <th className="w-[130px] px-2 text-right text-xs font-semibold text-muted-foreground uppercase">
                    {L(lang, "Debit", "借方金額", "借方金額")}
                  </th>
                  <th className="w-[130px] px-2 text-right text-xs font-semibold text-muted-foreground uppercase">
                    {L(lang, "Credit", "貸方金額", "貸方金額")}
                  </th>
                  <th className="w-[150px] px-2 text-left text-xs font-semibold text-muted-foreground uppercase">
                    {L(lang, "Counterparty", "對方單位", "對方單位")}
                  </th>
                  {!readOnly && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className="border-b border-border/70">
                    <td className="num px-1 py-0.5 text-sm text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-0.5">
                      {readOnly ? (
                        <span className="text-sm">{line.memo}</span>
                      ) : (
                        <input
                          value={line.memo}
                          onChange={(e) => patchLine(line.key, { memo: e.target.value })}
                          placeholder={L(lang, "same as summary", "同上", "同上")}
                          className="h-6 w-full rounded-sm bg-transparent px-1.5 outline-none hover:bg-accent focus:bg-background focus:ring-1 focus:ring-ring"
                        />
                      )}
                    </td>
                    <td className="px-2 py-0.5">
                      <AccountCell accounts={accounts} line={line} lang={lang} readOnly={readOnly} onChange={(patch) => patchLine(line.key, patch)} />
                    </td>
                    <td className="px-2 py-0.5">
                      <AmountCell
                        value={line.debit}
                        readOnly={readOnly}
                        onChange={(v) => patchLine(line.key, { debit: v, credit: v ? "" : line.credit })}
                        onEnter={() => setLines((prev) => [...prev, emptyLine({ memo: line.memo, counterparty: line.counterparty })])}
                      />
                    </td>
                    <td className="px-2 py-0.5">
                      <AmountCell
                        value={line.credit}
                        readOnly={readOnly}
                        disabled={Boolean(line.debit)}
                        onChange={(v) => patchLine(line.key, { credit: v, debit: v ? "" : line.debit })}
                        onEnter={() => setLines((prev) => [...prev, emptyLine({ memo: line.memo, counterparty: line.counterparty })])}
                      />
                    </td>
                    <td className="px-2 py-0.5">
                      {readOnly ? (
                        <span className="text-sm text-muted-foreground">{line.counterparty}</span>
                      ) : (
                        <input
                          value={line.counterparty}
                          onChange={(e) => patchLine(line.key, { counterparty: e.target.value })}
                          className="h-6 w-full rounded-sm bg-transparent px-1.5 text-sm outline-none hover:bg-accent focus:bg-background focus:ring-1 focus:ring-ring"
                        />
                      )}
                    </td>
                    {!readOnly && (
                      <td className="px-1">
                        <button
                          type="button"
                          onClick={() => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== line.key) : prev))}
                          className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={L(lang, "Delete line", "刪除這行", "刪除這行")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {!readOnly && (
              <div className="mt-2 flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setLines((prev) => [...prev, emptyLine({ memo: prev.at(-1)?.memo, counterparty: prev.at(-1)?.counterparty })])}
                >
                  <Plus /> {L(lang, "Add line", "新增一行", "新增一行")}
                  <kbd className="ml-1 rounded-xs border border-border px-1 font-mono text-xs">↵</kbd>
                </Button>
                {Math.abs(totals.diff) > 0.004 && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      const diff = Number((totals.dr - totals.cr).toFixed(2));
                      const target = lines.at(-1)!.key;
                      patchLine(target, diff > 0 ? { credit: toAmountInput(String(diff)), debit: "" } : { debit: toAmountInput(String(-diff)), credit: "" });
                    }}
                  >
                    <ArrowRight /> {L(lang, "Post the difference to the last line", "把差額補到最後一行", "把差額補到最後一行")}
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* ---- totals + amount in words -------------------------------- */}
          <section className="border-t border-border bg-muted px-6 py-3">
            <div className="flex items-end justify-between gap-6">
              <div className="min-w-0">
                <div className="text-sm font-medium text-muted-foreground">{L(lang, "Amount in words", "金額大寫", "金額大寫")}</div>
                <div className="mt-1 text-sm font-medium">
                  {totals.dr > 0 ? voucherAmountInWords(totals.dr, current?.currency ?? currency) : "—"}
                </div>
              </div>
              <div className="flex shrink-0 items-end gap-8">
                <div className="text-right">
                  <div className="text-sm font-medium text-muted-foreground">{L(lang, "Debit total", "借方合計", "借方合計")}</div>
                  <div className="num mt-1 text-base font-semibold">{moneyPlain(totals.dr)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-muted-foreground">{L(lang, "Credit total", "貸方合計", "貸方合計")}</div>
                  <div className="num mt-1 text-base font-semibold">{moneyPlain(totals.cr)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-muted-foreground">{L(lang, "Difference", "差額", "差額")}</div>
                  <div
                    className={cn("num mt-1 flex items-center justify-end gap-1.5 text-base font-semibold",
                      totals.balanced ? "text-ok" : "text-risk",
                    )}
                  >
                    {totals.balanced ? <Check className="size-4" strokeWidth={2.5} /> : <AlertTriangle className="size-4" />}
                    {money(Math.abs(totals.diff))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ---- signature strip ----------------------------------------- */}
          <section className="border-t border-border px-6 py-3">
            <div className="grid grid-cols-4 gap-6">
              {[
                {
                  label: L(lang, "Prepared by", "製單人", "製單人"),
                  value: current?.created_by_agent_name ?? principal.agent_name,
                  active: true,
                },
                {
                  label: L(lang, "Reviewed by", "複核人", "複核人"),
                  value: current?.approved_by_agent_name,
                  active: Boolean(current?.approved_by_agent_name),
                },
                {
                  label: L(lang, "Posted at", "記賬時間", "記賬時間"),
                  value: current?.posted_at ? new Date(current.posted_at).toLocaleString() : null,
                  active: Boolean(current?.posted_at),
                },
                {
                  label: L(lang, "Block / hash", "區塊 / 雜湊", "區塊 / 雜湊"),
                  value: current?.entry_hash ? `#${current.block_index} ${current.entry_hash.slice(0, 10)}…` : null,
                  active: Boolean(current?.entry_hash),
                  mono: true,
                },
              ].map((slot, i) => (
                <div key={i}>
                  <div className="text-sm font-medium text-muted-foreground">{slot.label}</div>
                  <div className={cn("mt-3 border-b border-dotted pb-1", slot.active ? "border-border" : "border-border")}>
                    {slot.value ? (
                      <span className={cn("text-sm", slot.mono && "font-mono")}>{slot.value}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CircleDot className="size-3" />
                        {L(lang, "pending", "待處理", "待處理")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {current?.entry_hash && (
              <p className="mt-3 font-mono text-xs break-all text-muted-foreground">
                prev {current.prev_entry_hash?.slice(0, 16)}… → this {current.entry_hash.slice(0, 16)}…
              </p>
            )}
          </section>

          {current?.reject_reason && (
            <section className="border-t border-risk-line bg-risk-bg px-6 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-risk" />
                <div>
                  <div className="text-sm font-medium text-risk">{L(lang, "Rejected", "駁回理由", "駁回理由")}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{current.reject_reason}</p>
                </div>
              </div>
            </section>
          )}
        </article>
      </div>

      {/* ---- action bar -------------------------------------------------- */}
      <footer className="border-t flex h-12 shrink-0 items-center justify-between gap-4 bg-background px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onOpenPrincipalSwitcher}
            className="flex items-center gap-2 rounded-sm border border-border bg-muted px-2 py-1 text-sm hover:border-border"
          >
            <span className="text-muted-foreground">{L(lang, "I am:", "当前身份：", "當前身份：")}</span>
            <span className="font-medium">{principal.agent_name}</span>
            <Badge variant={principal.can_approve ? "default" : "secondary"}>{principal.role}</Badge>
          </button>
          {actionNote && (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-warn">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="truncate">{actionNote}</span>
            </span>
          )}
          {error && !actionNote && <span className="truncate text-sm text-risk">{error}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              {L(lang, "Close", "關閉", "關閉")}
            </Button>
          )}

          {!readOnly && (
            <>
              <Button variant="outline" size="sm" onClick={() => void saveDraft()} disabled={busy === "save"}>
                {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
                {L(lang, "Save draft", "儲存草稿", "儲存草稿")}
              </Button>
              <Button variant="default" size="sm" onClick={() => void submit()} disabled={!canSubmit || busy === "submit"}>
                {busy === "submit" ? <Loader2 className="animate-spin" /> : <Send />}
                {L(lang, "Submit for review", "提交複核", "提交複核")}
              </Button>
            </>
          )}

          {current && current.status !== "POSTED" && current.status !== "REVERSED" && (
            <>
              <Button variant="outline" size="sm" onClick={reject} disabled={!canApproveNow || busy === "reject"}>
                <X /> {L(lang, "Reject", "駁回", "駁回")}
              </Button>
              <Button variant="default" size="sm" onClick={approve} disabled={!canApproveNow || busy === "approve"}>
                {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
                {L(lang, "Approve & post", "核准過賬", "核准過賬")}
              </Button>
            </>
          )}

          {current?.status === "POSTED" && (
            <Button variant="outline" size="sm" onClick={reverse} disabled={!canCreate || busy === "reverse"}>
              <ArrowRight /> {L(lang, "Reverse (no delete)", "沖銷分錄（不刪不改）", "沖銷分錄（不刪不改）")}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
