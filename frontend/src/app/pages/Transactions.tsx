import * as React from "react"
import { FileText, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { bookApi, type Account, type DocumentRecord } from "@/app/api"
import { moneyPlain } from "@/lib/utils"
import { L } from "@/lib/labels"
import { term } from "@/lib/terms"
import type { Language } from "@/i18n"
import { PageHeader } from "@/app/components/PageHeader"

const DOC_TYPES = ["INVOICE", "RECEIPT", "BILL", "BANK_SLIP", "CONTRACT", "OTHER"]

/**
 * Transaction — 單據。
 * 先有單據，後有分錄：這裡收單，這裡轉分錄；過賬仍然只能在 Journal Entry 做。
 */
export function Transactions({
  entity,
  principalKey,
  lang,
  onCreated,
  onOpenVoucher,
}: {
  entity: string
  principalKey: string
  lang: Language
  onCreated: () => void
  onOpenVoucher: (journalId: string) => void
}) {
  const [docs, setDocs] = React.useState<DocumentRecord[]>([])
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [adding, setAdding] = React.useState(false)
  const [posting, setPosting] = React.useState<DocumentRecord | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [docType, setDocType] = React.useState("INVOICE")
  const [docDate, setDocDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [counterparty, setCounterparty] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)

  const [debit, setDebit] = React.useState("")
  const [credit, setCredit] = React.useState("")

  const load = React.useCallback(async () => {
    const [d, c] = await Promise.all([bookApi.documents(entity), bookApi.chart(entity)])
    setDocs(d.documents)
    setAccounts(c.accounts)
  }, [entity])

  React.useEffect(() => {
    void load()
  }, [load])

  const upload = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await bookApi.uploadDocument(entity, file, {
        doc_type: docType,
        doc_date: docDate,
        counterparty_name: counterparty,
        amount: amount || "0",
        uploaded_by: principalKey,
      })
      setAdding(false)
      setFile(null)
      setAmount("")
      setCounterparty("")
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const toVoucher = async () => {
    if (!posting) return
    setBusy(true)
    setError(null)
    try {
      const res = await bookApi.documentToVoucher(posting.document_id, {
        principal_key: principalKey,
        debit_account_code: debit,
        credit_account_code: credit,
      })
      setPosting(null)
      await load()
      onCreated()
      // Same editor as the Journal Entry page; a document is a way in, not a
      // separate workflow.
      onOpenVoucher(res.journal_id)
      return res
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const open = docs.filter((d) => d.status === "NEW")

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={L(lang, "Transaction", "单据", "單據")}
        toolbar={
          open.length > 0 ? (
            <span className="num text-sm text-muted-foreground">
              {open.length} {L(lang, "open", "待处理", "待處理")}
            </span>
          ) : undefined
        }
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Upload /> {L(lang, "Add document", "新增单据", "新增單據")}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">{L(lang, "Date", "日期", "日期")}</TableHead>
              <TableHead className="w-[110px]">{L(lang, "Type", "类型", "類型")}</TableHead>
              <TableHead>{L(lang, "Counterparty", "对方", "對方")}</TableHead>
              <TableHead className="w-[140px] text-right">{L(lang, "Amount", "金额", "金額")}</TableHead>
              <TableHead className="w-[120px]">{L(lang, "Status", "状态", "狀態")}</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.document_id}>
                <TableCell className="num text-sm">{d.doc_date}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{term(d.doc_type, lang)}</TableCell>
                <TableCell className="text-sm">{d.counterparty_name || d.filename}</TableCell>
                <TableCell className="num text-right text-sm">{moneyPlain(d.amount)}</TableCell>
                <TableCell>
                  <Badge variant={d.status === "NEW" ? "secondary" : "outline"}>{term(d.status, lang)}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {d.status === "NEW" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPosting(d)
                        setDebit("")
                        setCredit("")
                      }}
                    >
                      {L(lang, "To entry", "转分录", "轉分錄")}
                    </Button>
                  ) : (
                    <a
                      href={bookApi.documentUrl(d.document_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <FileText className="size-3.5" /> {L(lang, "Document", "单据", "單據")}
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!docs.length && (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  {L(lang, "No documents", "尚无单据", "尚無單據")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 收單 */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L(lang, "Add document", "新增单据", "新增單據")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 px-4 py-3">
            <div className="grid gap-1.5">
              <Label htmlFor="doc-file">{L(lang, "File", "档案", "檔案")}</Label>
              <Input
                id="doc-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{L(lang, "Type", "类型", "類型")}</Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="doc-date">{L(lang, "Date", "日期", "日期")}</Label>
                <Input id="doc-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="doc-cp">{L(lang, "Counterparty", "对方", "對方")}</Label>
                <Input id="doc-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="doc-amt">{L(lang, "Amount", "金额", "金額")}</Label>
                <Input
                  id="doc-amt"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {L(lang, "Cancel", "取消", "取消")}
            </Button>
            <Button onClick={() => void upload()} disabled={!file || busy}>
              {L(lang, "File it", "收单", "收單")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 轉分錄 */}
      <Dialog open={Boolean(posting)} onOpenChange={(v) => !v && setPosting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L(lang, "Turn into a journal entry", "转为分录", "轉為分錄")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 px-4 py-3">
            <div className="num flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{posting?.counterparty_name || posting?.filename}</span>
              <span>{moneyPlain(posting?.amount)}</span>
            </div>
            <div className="grid gap-1.5">
              <Label>{L(lang, "Debit account", "借方科目", "借方科目")}</Label>
              <Select value={debit} onValueChange={setDebit}>
                <SelectTrigger>
                  <SelectValue placeholder={L(lang, "Choose an account", "选择科目", "選擇科目")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.account_code} value={a.account_code}>
                      {a.account_code} {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{L(lang, "Credit account", "贷方科目", "貸方科目")}</Label>
              <Select value={credit} onValueChange={setCredit}>
                <SelectTrigger>
                  <SelectValue placeholder={L(lang, "Choose an account", "选择科目", "選擇科目")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.account_code} value={a.account_code}>
                      {a.account_code} {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPosting(null)}>
              {L(lang, "Cancel", "取消", "取消")}
            </Button>
            <Button onClick={() => void toVoucher()} disabled={!debit || !credit || busy}>
              {L(lang, "Create draft entry", "产生草稿分录", "產生草稿分錄")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
