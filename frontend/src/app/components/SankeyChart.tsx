import { ResponsiveContainer, Sankey, Tooltip } from "recharts"
import { moneyPlain } from "@/lib/utils"
import { term } from "@/lib/terms"
import { L } from "@/lib/labels"
import type { Language } from "@/i18n"

/* Flow diagrams.

   Two rules decide everything here.

   1. Colour means something, in one direction only:
        in   — money arriving (warm neutral)
        keep — what survives to the bottom line (green)
        out  — what leaves (red)
      The width of a band is the quantity; the colour is only its nature. A
      greyscale diagram would read as decoration.

   2. The numbers are on the diagram, next to the thing they describe — not in
      a sum row underneath it. A row that restates the chart is a second
      rendering of the same facts, and the reader has to check that the two
      agree. There is nothing to check: the bands are drawn from the statement's
      own figures, so every stage balances by construction. */

type Tone = "in" | "keep" | "out" | "carry" | "none"
type Side = "left" | "right" | "above"

interface Node {
  name: string
  value?: number
  /** A qualifier under the amount — share of revenue, direction of movement. */
  note?: string
  /** Recharts writes the flow total back onto the node, so hiding it has to be
      said explicitly. A junction is not a quantity. */
  hideValue?: boolean
  tone: Tone
  side: Side
}
interface Link {
  source: number
  target: number
  value: number
  tone: Tone
}

const TONE: Record<Tone, { band: string; node: string }> = {
  in: { band: "var(--flow-in)", node: "var(--flow-in)" },
  keep: { band: "var(--flow-keep)", node: "var(--flow-keep)" },
  out: { band: "var(--flow-out)", node: "var(--flow-out)" },
  carry: { band: "var(--muted-foreground)", node: "var(--muted-foreground)" },
  none: { band: "var(--border)", node: "var(--muted-foreground)" },
}

/** The band. Recharts hands over the geometry; only the colour is ours. */
const FlowLink = (props: any) => {
  const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, payload } = props
  if (!linkWidth) return null
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      style={{
        stroke: TONE[(payload?.tone as Tone) ?? "none"].band,
        strokeWidth: linkWidth,
        strokeOpacity: 0.55,
        fill: "none",
      }}
    />
  )
}

const FlowNode = (props: any) => {
  const { x, y, width, height, payload } = props
  const node = payload as Node
  const y2 = y + (height ?? 0) / 2
  const side: Side = node.side ?? "right"

  const anchor = side === "left" ? "end" : side === "right" ? "start" : "end"
  const lx = side === "left" ? x - 10 : side === "right" ? x + width + 10 : x - 10
  const ly = side === "above" ? y - 8 : y2

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3} style={{ fill: TONE[node.tone].node }} />
      <text x={lx} y={node.value === undefined || node.hideValue ? y2 : ly - 3} textAnchor={anchor} className="fill-foreground" style={{ fontSize: "var(--app-font-size)" }} fontWeight={600}>
        {node.name}
      </text>
      {node.value !== undefined && !node.hideValue ? (
        <text x={lx} y={ly + 11} textAnchor={anchor} className="fill-muted-foreground" style={{ fontSize: "calc(var(--app-font-size) - 1px)" }}>
          {moneyPlain(node.value)}
          {node.note ? ` · ${node.note}` : ""}
        </text>
      ) : null}
    </g>
  )
}

function Flow({ title, subtitle, nodes, links }: { title: string; subtitle: string; nodes: Node[]; links: Link[] }) {
  return (
    <div>
      <div className="px-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes, links }}
            node={<FlowNode />}
            link={<FlowLink />}
            nodeWidth={16}
            nodePadding={40}
            margin={{ top: 28, right: 190, bottom: 28, left: 150 }}
          >
            <Tooltip
              formatter={(value: any) => moneyPlain(value)}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--app-font-size)",
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/* Lines are addressed by key, never by matching their captions: a reworded
   label used to empty a band with no error anywhere. */
const KEYS = [
  "REVENUE",
  "COGS",
  "GROSS_PROFIT",
  "OPEX",
  "EBITDA",
  "DEPRECIATION",
  "PBT",
  "TAX_EXPENSE",
  "NET_PROFIT",
] as const

function plFigures(pack: any): Record<(typeof KEYS)[number], number> {
  const items: any[] = pack?.income_statement?.line_items ?? []
  const out = {} as Record<(typeof KEYS)[number], number>
  for (const key of KEYS) {
    const hit = items.find((it) => it.key === key)
    out[key] = hit ? Math.abs(Number(hit.amount)) : 0
  }
  return out
}

export function IncomeFlow({ pack, lang, period, entityName }: { pack: any; lang: Language; period: string; entityName: string }) {
  const f = plFigures(pack)
  if (!f.REVENUE) return <Empty lang={lang} />

  // A band 1% of the width is nearly invisible; the share of revenue says how
  // small it is without distorting the geometry to make it look bigger.
  const share = (v: number) => (f.REVENUE ? `${((v / f.REVENUE) * 100).toFixed(1)}%` : undefined)

  const nodes: Node[] = [
    { name: L(lang, "Revenue", "收入", "收入"), value: f.REVENUE, tone: "in", side: "left" },
    { name: L(lang, "Gross profit", "毛利", "毛利"), value: f.GROSS_PROFIT, tone: "keep", side: "above" },
    { name: "EBITDA", value: f.EBITDA, tone: "keep", side: "above" },
    { name: L(lang, "Profit before tax", "税前利润", "稅前利潤"), value: f.PBT, tone: "keep", side: "above" },
    { name: L(lang, "Net profit", "净利润", "淨利潤"), value: f.NET_PROFIT, tone: "keep", side: "right" },
    { name: term("COGS", lang), value: f.COGS, note: share(f.COGS), tone: "out", side: "right" },
    { name: term("OPEX", lang), value: f.OPEX, note: share(f.OPEX), tone: "out", side: "right" },
    { name: term("DEPRECIATION", lang), value: f.DEPRECIATION, note: share(f.DEPRECIATION), tone: "out", side: "right" },
    { name: term("TAX_EXPENSE", lang), value: f.TAX_EXPENSE, note: share(f.TAX_EXPENSE), tone: "out", side: "right" },
  ]
  const links: Link[] = ([
    { source: 0, target: 1, value: f.GROSS_PROFIT, tone: "keep" },
    { source: 0, target: 5, value: f.COGS, tone: "out" },
    { source: 1, target: 2, value: f.EBITDA, tone: "keep" },
    { source: 1, target: 6, value: f.OPEX, tone: "out" },
    { source: 2, target: 3, value: f.PBT, tone: "keep" },
    { source: 2, target: 7, value: f.DEPRECIATION, tone: "out" },
    { source: 3, target: 4, value: f.NET_PROFIT, tone: "keep" },
    { source: 3, target: 8, value: f.TAX_EXPENSE, tone: "out" },
  ] as Link[]).filter((l) => l.value > 0)

  return (
    <Flow
      title={L(lang, "Income structure", "损益结构", "損益結構")}
      subtitle={`${period} · ${entityName}`}
      nodes={nodes}
      links={links}
    />
  )
}

export function CashFlow({ breakdown, lang, period, entityName }: { breakdown: any; lang: Language; period: string; entityName: string }) {
  if (!breakdown) return <Empty lang={lang} />

  const opening = Number(breakdown.opening) || 0
  const closing = Number(breakdown.closing) || 0
  const nodes: Node[] = [
    { name: L(lang, "Opening cash", "期初现金", "期初現金"), value: opening, tone: "carry", side: "left" },
    // 255,500 is the amount that passed through the period, not a balance, and
    // printing it beside "cash" invites reading it as one.
    { name: L(lang, "Cash", "现金", "現金"), tone: "keep", side: "above", hideValue: true },
    { name: L(lang, "Closing cash", "期末现金", "期末現金"), value: closing, tone: "keep", side: "right" },
  ]
  const links: Link[] = []
  if (opening) links.push({ source: 0, target: 1, value: opening, tone: "carry" })
  for (const row of breakdown.inflows ?? []) {
    nodes.push({ name: movement(row, true, lang), value: Number(row.amount), tone: "in", side: "left" })
    links.push({ source: nodes.length - 1, target: 1, value: Number(row.amount), tone: "in" })
  }
  for (const row of breakdown.outflows ?? []) {
    nodes.push({ name: movement(row, false, lang), value: Number(row.amount), tone: "out", side: "right" })
    links.push({ source: 1, target: nodes.length - 1, value: Number(row.amount), tone: "out" })
  }
  if (closing) links.push({ source: 1, target: 2, value: closing, tone: "keep" })

  return (
    <Flow
      title={L(lang, "Where the cash went", "现金流向", "現金流向")}
      subtitle={`${period} · ${entityName}`}
      nodes={nodes}
      links={links}
    />
  )
}

/**
 * A bare account name on the red side reads as "money went to receivables",
 * which is not what happened. What happened is that receivables grew, and
 * growth in an asset consumes cash. Say the movement, not the account.
 */
function movement(row: { fs_category: string; account_type?: string }, inflow: boolean, lang: Language): string {
  const name = term(row.fs_category, lang)
  const kind = row.account_type ?? ""
  const isBalanceSheet = kind === "ASSET" || kind === "LIABILITY" || kind === "EQUITY"
  if (!isBalanceSheet) return name
  // Cash rising means assets fell and liabilities rose.
  const rose = kind === "ASSET" ? !inflow : inflow
  return name + (rose ? L(lang, "↑", "增加", "增加") : L(lang, "↓", "减少", "減少"))
}

const Empty = ({ lang }: { lang: Language }) => (
  <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
    {L(lang, "Nothing to show for this period", "本期没有数据", "本期沒有資料")}
  </div>
)
