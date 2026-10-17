import * as React from "react"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { L } from "@/lib/labels"
import { term } from "@/lib/terms"
import { useI18n, type Language } from "@/i18n"
import { bookApi, type Counterparty, type TaxCode } from "@/app/api"
import { PageHeader } from "@/app/components/PageHeader"
import { ChartOfAccounts } from "@/app/pages/ChartOfAccounts"
import { Periods } from "@/app/pages/Periods"
import { useAppearance } from "@/app/appearance"
import type { Principal } from "@/app/api"

type Section = "entity" | "coa" | "tax" | "party" | "period" | "appearance"

const SECTIONS: Array<{ id: Section; en: string; cn: string; tw: string }> = [
  { id: "entity", en: "Entity", cn: "实体资料", tw: "實體資料" },
  { id: "coa", en: "Chart of accounts", cn: "科目表", tw: "科目表" },
  { id: "tax", en: "Tax codes", cn: "税码", tw: "稅碼" },
  { id: "party", en: "Counterparties", cn: "对手方", tw: "對手方" },
  { id: "period", en: "Periods", cn: "期间与结账", tw: "期間與結帳" },
  { id: "appearance", en: "Appearance", cn: "外观", tw: "外觀" },
]

export function Settings({
  entity,
  entityName,
  pack,
  lang,
  principal,
  onChanged,
}: {
  entity: string
  entityName: string
  pack: any
  lang: Language
  principal: Principal
  onChanged: () => void
}) {
  const [section, setSection] = React.useState<Section>("entity")
  const [taxCodes, setTaxCodes] = React.useState<TaxCode[]>([])
  const [parties, setParties] = React.useState<Counterparty[]>([])

  React.useEffect(() => {
    bookApi.taxCodes(entity).then((r) => setTaxCodes(r.tax_codes))
    bookApi.counterparties(entity).then((r) => setCounterparties(r.counterparties))
  }, [entity])
  const setCounterparties = setParties

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={L(lang, "Setting", "设置", "設定")} />
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 border-r p-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn("flex h-9 w-full items-center rounded-md px-3 text-left text-sm transition-colors",
                section === s.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {lang === "en" ? s.en : lang === "zh-CN" ? s.cn : s.tw}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-auto">
          {section === "entity" && <EntityPanel pack={pack} entityName={entityName} lang={lang} />}
          {section === "coa" && <ChartOfAccounts entity={entity} lang={lang} onSaved={onChanged} />}
          {section === "tax" && <TaxPanel rows={taxCodes} lang={lang} />}
          {section === "party" && <PartyPanel rows={parties} lang={lang} />}
          {section === "period" && (
            <Periods entity={entity} entityName={entityName} currentPeriod={pack?.period ?? "2026-10"} lang={lang} principal={principal} onChanged={onChanged} />
          )}
          {section === "appearance" && <AppearancePanel lang={lang} />}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-4 py-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="text-sm">{value}</div>
    </div>
  )
}

function EntityPanel({ pack, entityName, lang }: { pack: any; entityName: string; lang: Language }) {
  return (
    <div className="max-w-2xl px-4 py-4">
      <Field label={L(lang, "Legal name", "公司名称", "公司名稱")} value={pack?.legal_name ?? entityName} />
      <Separator />
      <Field label={L(lang, "Structure", "组织形式", "組織形式")} value={term(pack?.entity_structure, lang)} />
      <Separator />
      <Field label={L(lang, "Jurisdiction", "注册地", "註冊地")} value={term(pack?.jurisdiction, lang)} />
      <Separator />
      <Field label={L(lang, "Accounting standard", "会计准则", "會計準則")} value={term(pack?.accounting_standard, lang)} />
      <Separator />
      <Field label={L(lang, "Functional currency", "本位币", "本位幣")} value={pack?.currency ?? "—"} />
    </div>
  )
}

function TaxPanel({ rows, lang }: { rows: TaxCode[]; lang: Language }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">{L(lang, "Code", "代码", "代碼")}</TableHead>
          <TableHead>{L(lang, "Description", "说明", "說明")}</TableHead>
          <TableHead className="w-[140px]">{L(lang, "Mechanism", "税制", "稅制")}</TableHead>
          <TableHead className="w-[90px] text-right">{L(lang, "Rate", "税率", "稅率")}</TableHead>
          <TableHead className="w-[100px] text-right">{L(lang, "Recoverable", "可抵扣", "可抵扣")}</TableHead>
          <TableHead className="w-[150px]">{L(lang, "Return box", "申报格位", "申報格位")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.tax_code}>
            <TableCell className="font-mono text-xs">{r.tax_code}</TableCell>
            <TableCell className="text-sm">{r.description}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{term(r.tax_mechanism, lang)}</TableCell>
            <TableCell className="num text-right text-sm">{(Number(r.rate) * 100).toFixed(2)}%</TableCell>
            <TableCell className="num text-right text-sm">{(Number(r.recoverable_pct) * 100).toFixed(0)}%</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{r.statutory_return_box || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PartyPanel({ rows, lang }: { rows: Counterparty[]; lang: Language }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{L(lang, "Name", "名称", "名稱")}</TableHead>
          <TableHead className="w-[140px]">{L(lang, "Type", "类型", "類型")}</TableHead>
          <TableHead className="w-[90px]">{L(lang, "Country", "国别", "國別")}</TableHead>
          <TableHead className="w-[160px]">{L(lang, "Tax ID", "税号", "稅號")}</TableHead>
          <TableHead className="w-[180px]">{L(lang, "Withholding", "扣缴规则", "扣繳規則")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.counterparty_id}>
            <TableCell className="text-sm">{r.legal_name}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{term(r.counterparty_type, lang)}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{term(r.country_code, lang)}</TableCell>
            <TableCell className="font-mono text-xs">{r.tax_id_number || "—"}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{r.withholding_rule === "NONE" ? "—" : r.withholding_rule}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn("h-7 rounded-sm px-3 text-sm transition-colors",
            value === o.value ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function AppearancePanel({ lang }: { lang: Language }) {
  const { theme, density, size, setTheme, setDensity, setSize } = useAppearance()
  const { lang: uiLang, setLang } = useI18n()

  return (
    <div className="max-w-2xl px-4 py-4">
      <div className="grid grid-cols-[200px_1fr] items-center gap-4 py-2">
        <Label className="text-muted-foreground">{L(lang, "Theme", "主题", "主題")}</Label>
        <Choice
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: L(lang, "Light", "浅色", "淺色") },
            { value: "dark", label: L(lang, "Dark", "深色", "深色") },
            { value: "system", label: L(lang, "System", "跟随系统", "跟隨系統") },
          ]}
        />
      </div>
      <Separator />
      <div className="grid grid-cols-[200px_1fr] items-center gap-4 py-2">
        <Label className="text-muted-foreground">{L(lang, "Density", "密度", "密度")}</Label>
        <Choice
          value={density}
          onChange={setDensity}
          options={[
            { value: "compact", label: L(lang, "Compact 24", "紧凑 24", "緊湊 24") },
            { value: "standard", label: L(lang, "Standard 32", "标准 32", "標準 32") },
            { value: "relaxed", label: L(lang, "Relaxed 40", "宽松 40", "寬鬆 40") },
          ]}
        />
      </div>
      <Separator />
      <div className="grid grid-cols-[200px_1fr] items-center gap-4 py-2">
        <Label className="text-muted-foreground">{L(lang, "Font size", "字级", "字級")}</Label>
        <Choice
          value={size}
          onChange={setSize}
          options={[
            { value: "sm", label: L(lang, "Small 13", "小 13", "小 13") },
            { value: "md", label: L(lang, "Medium 14", "中 14", "中 14") },
            { value: "lg", label: L(lang, "Large 15", "大 15", "大 15") },
          ]}
        />
      </div>
      <Separator />
      <div className="grid grid-cols-[200px_1fr] items-center gap-4 py-2">
        <Label className="text-muted-foreground">{L(lang, "Language", "语言", "語言")}</Label>
        <Choice
          value={uiLang}
          onChange={(v) => setLang(v as Language)}
          options={[
            { value: "zh-TW" as Language, label: "繁體" },
            { value: "zh-CN" as Language, label: "简体" },
            { value: "en" as Language, label: "English" },
          ]}
        />
      </div>
    </div>
  )
}
