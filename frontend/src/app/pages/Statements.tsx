import * as React from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn, money } from "@/lib/utils"
import { localizeLabel } from "@/lib/labels";
import type { Language } from "@/i18n"
import { PageHeader } from "@/app/components/PageHeader"

type Statement = "PL" | "BS" | "CF"
interface Line {
  label: string
  amount: string
  pct?: string
  kind: "line" | "subtotal" | "total" | "section"
}

function plRows(pack: any, lang: Language): Line[] {
  const items = pack?.income_statement?.line_items ?? []
  return items.map((it: any, i: number) => ({
    label: localizeLabel(it.label, lang),
    amount: it.amount,
    pct: it.margin_pct,
    kind: it.is_subtotal ? (i === items.length - 1 ? "total" : "subtotal") : "line",
  }))
}

function cfsRows(pack: any, lang: Language): Line[] {
  const cfs = pack?.cash_flow_statement ?? {}
  const out: Line[] = []
  const section = (label: string) => out.push({ label, amount: "", kind: "section" })
  const push = (items: any[]) =>
    (items ?? []).forEach((it) =>
      out.push({ label: localizeLabel(it.label, lang), amount: it.amount, kind: "line" }),
    )
  section(localizeLabel("Operating Activities (經營活動)", lang))
  push(cfs.indirect_method_operating)
  out.push({
    label: localizeLabel("Net Cash from Operating Activities (經營活動現金流量淨額)", lang),
    amount: cfs.net_cash_from_operating_activities,
    kind: "subtotal",
  })
  section(localizeLabel("Investing Activities (投資活動)", lang))
  push(cfs.investing_activities)
  out.push({
    label: localizeLabel("Net Cash from Investing Activities (投資活動現金流量淨額)", lang),
    amount: cfs.net_cash_from_investing_activities,
    kind: "subtotal",
  })
  section(localizeLabel("Financing Activities (籌資活動)", lang))
  push(cfs.financing_activities)
  out.push({
    label: localizeLabel("Net Cash from Financing Activities (籌資活動現金流量淨額)", lang),
    amount: cfs.net_cash_from_financing_activities,
    kind: "subtotal",
  })
  out.push({
    label: localizeLabel("Net Increase in Cash (現金及現金等價物淨增加額)", lang),
    amount: cfs.net_increase_in_cash,
    kind: "line",
  })
  out.push({
    label: localizeLabel("Opening Cash (加：期初現金餘額)", lang),
    amount: cfs.opening_cash_balance,
    kind: "line",
  })
  out.push({
    label: localizeLabel("Ending Cash (期末現金及現金等價物餘額)", lang),
    amount: cfs.ending_cash_balance,
    kind: "total",
  })
  return out
}

function bsBlocks(pack: any, lang: Language): Array<{ title: string; rows: Line[] }> {
  const bs = pack?.balance_sheet ?? {}
  const map = (items: any[]): Line[] =>
    (items ?? []).map((it: any) => ({
      label: localizeLabel(it.label, lang),
      amount: it.amount,
      kind: it.is_subtotal ? "subtotal" : "line",
    }))
  return [
    {
      title: localizeLabel("Assets (資產)", lang),
      rows: [
        ...map(bs.current_assets),
        { label: localizeLabel("Total Current Assets (流動資產合計)", lang), amount: bs.total_current_assets, kind: "subtotal" },
        ...map(bs.non_current_assets),
        { label: localizeLabel("Total Assets (資產總計)", lang), amount: bs.total_assets, kind: "total" },
      ],
    },
    {
      title: localizeLabel("Liabilities & Equity (負債及股東權益)", lang),
      rows: [
        ...map(bs.current_liabilities),
        { label: localizeLabel("Total Liabilities (負債合計)", lang), amount: bs.total_liabilities, kind: "subtotal" },
        ...map(bs.equity),
        { label: localizeLabel("Total Equity (股東權益合計)", lang), amount: bs.total_equity, kind: "subtotal" },
        {
          label: localizeLabel("Total Liabilities & Equity (負債及股東權益總計)", lang),
          amount: bs.total_liabilities_and_equity,
          kind: "total",
        },
      ],
    },
  ]
}

function StatementTable({ rows, currency }: { rows: Line[]; currency: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>項目</TableHead>
          <TableHead className="w-[160px] text-right">金額 ({currency})</TableHead>
          <TableHead className="w-[72px] text-right">比率</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) =>
          row.kind === "section" ? (
            <TableRow key={i} className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={3} className="text-xs font-medium text-muted-foreground">
                {row.label}
              </TableCell>
            </TableRow>
          ) : (
            <TableRow key={i}>
              <TableCell className={cn(row.kind !== "line" && "font-medium")}>{row.label}</TableCell>
              <TableCell
                className={cn("num text-right",
                  row.kind === "total" && "rule-double font-medium",
                  row.kind === "subtotal" && "font-medium",
                )}
              >
                {money(row.amount)}
              </TableCell>
              <TableCell className="num text-right text-xs text-muted-foreground">{row.pct ?? ""}</TableCell>
            </TableRow>
          ),
        )}
      </TableBody>
    </Table>
  )
}

/** 財務報表：三大報表，一次一張。 */
export function Statements({ pack, lang }: { pack: any; lang: Language }) {
  const [statement, setStatement] = React.useState<Statement>("PL")
  const currency = pack?.currency ?? ""

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="財務報表"
        toolbar={
          <Tabs value={statement} onValueChange={(v) => setStatement(v as Statement)}>
            <TabsList>
              <TabsTrigger value="PL">損益表</TabsTrigger>
              <TabsTrigger value="BS">資產負債表</TabsTrigger>
              <TabsTrigger value="CF">現金流量表</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {statement === "BS" ? (
          <div className="grid grid-cols-2 gap-6">
            {bsBlocks(pack, lang).map((block, i) => (
              <div key={i}>
                <div className="mb-2 text-sm font-medium text-muted-foreground">{block.title}</div>
                <StatementTable rows={block.rows} currency={currency} />
              </div>
            ))}
          </div>
        ) : (
          <StatementTable rows={statement === "PL" ? plRows(pack, lang) : cfsRows(pack, lang)} currency={currency} />
        )}
      </div>
    </div>
  )
}
