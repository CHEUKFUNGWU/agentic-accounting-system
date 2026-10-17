import React, { useState } from "react";
import { TrialBalanceSheetTotals, TrialBalanceSheetRow } from "../types/accounting";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n, pick } from "../i18n";
import { fmtAmount } from "../lib/format";
import { localizeLabel, localizeDestination } from "../lib/labels";

interface TrialBalanceDetailViewProps {
  /** Legal entity name, printed on the working-paper header. */
  entityName?: string;
  currency: string;
  rows: TrialBalanceSheetRow[];
  totals: TrialBalanceSheetTotals;
  onOpenWpDrawer: (statementRef?: string) => void;
}

export const TrialBalanceDetailView: React.FC<TrialBalanceDetailViewProps> = ({
  entityName,
  currency,
  rows,
  totals,
  onOpenWpDrawer,
}) => {
  const { t, lang } = useI18n();
  /** Trial-balance columns: a zero balance is blank, not "0.00". */
  const cell = (value: unknown) => fmtAmount(value, { blankZero: true });
  const [filterType, setFilterType] = useState<string>("ALL");
  const [searchKeyword, setSearchKeyword] = useState<string>("");

  const filteredRows = rows.filter((r) => {
    if (filterType !== "ALL" && r.account_type !== filterType) return false;
    if (searchKeyword.trim()) {
      const q = searchKeyword.toLowerCase();
      return r.account_code.toLowerCase().includes(q) || r.account_name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <Card className="sh-card print-landscape">
      {/* Print-only working-paper header. */}
      <div className="print-only print-header">
        <div className="print-header-title">{entityName ?? t.tb_detail_title}</div>
        <div className="print-header-meta">
          {t.tb_detail_title}　|　{t.currency_label}：{currency}　|　{t.statement_ref_col}： · B · C · DD · F · AA · CC · EQ
        </div>
      </div>
      <CardHeader className="no-print" style={{ paddingBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {t.tb_detail_title}
            </CardTitle>            <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {t.currency_label}：{currency} • {t.tb_detail_subtitle}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              UTB {t.balanced}
            </Badge>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              AJE {t.balanced}
            </Badge>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              ATB {t.balanced}
            </Badge>
          </div>
        </div>

        {/* Filters & Search */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
            {["ALL", "ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"].map((type) => (
              <button
                key={type}
                type="button"
                className="sh-tabs-trigger"
                data-state={filterType === type ? "active" : "inactive"}
                onClick={() => setFilterType(type)}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
              >
                {type === "ALL"
                  ? lang === "en" ? "All" : "全部科目"
                  : type === "ASSET"
                  ? lang === "en" ? "Assets" : lang === "zh-CN" ? "资产" : "資產"
                  : type === "LIABILITY"
                  ? lang === "en" ? "Liabilities" : lang === "zh-CN" ? "负债" : "負債"
                  : type === "EQUITY"
                  ? lang === "en" ? "Equity" : lang === "zh-CN" ? "股东权益" : "股東權益"
                  : type === "REVENUE"
                  ? lang === "en" ? "Revenue" : "收入"
                  : lang === "en" ? "Expenses" : lang === "zh-CN" ? "费用" : "費用"}
              </button>
            ))}
          </div>

          <div style={{ width: "240px" }}>
            <input
              type="text"
              placeholder={lang === "en" ? "Search account code or name..." : lang === "zh-CN" ? "搜索科目代码或名称..." : "搜尋科目代碼或名稱..."}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="sh-input"
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
        <div className="sh-table-wrapper" style={{ maxHeight: "680px", overflowY: "auto" }}>          <table className="sh-table" style={{ fontSize: "0.8rem" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "#fafafa" }}>
              <tr>
                <th rowSpan={2} className="etb-col-sticky etb-col-code" style={{ width: "65px", zIndex: 20 }}>{t.col_acc_code}</th>
                <th rowSpan={2} className="etb-col-sticky etb-col-name" style={{ minWidth: "200px", zIndex: 20 }}>{t.col_acc_name}</th>
                <th rowSpan={2} style={{ width: "70px" }}>{t.statement_ref_col}</th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  {t.col_period_activity}
                </th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  UTB
                </th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  {t.col_aje}
                </th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  {t.col_ending_tb}
                </th>
                <th rowSpan={2} style={{ width: "120px", borderLeft: "1px solid var(--border)" }}>
                  {pick(lang, { en: "Statement", "zh-CN": "报表归属", "zh-TW": "報表歸屬" })}
                </th>
              </tr>
              <tr>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>{t.dr_label}</th>
                <th style={{ textAlign: "right", width: "85px" }}>{t.cr_label}</th>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>{t.dr_label}</th>
                <th style={{ textAlign: "right", width: "85px" }}>{t.cr_label}</th>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>{t.dr_label}</th>
                <th style={{ textAlign: "right", width: "85px" }}>{t.cr_label}</th>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>{t.dr_label}</th>
                <th style={{ textAlign: "right", width: "85px" }}>{t.cr_label}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.account_code}>
                  <td className="etb-col-sticky etb-col-code" style={{ fontWeight: 600 }}>{r.account_code}</td>
                  <td className="etb-col-sticky etb-col-name">{localizeLabel(r.account_name, lang)}</td>
                  <td>
                    {r.statement_ref ? (
                      <Badge
                        variant="secondary"
                        interactive
                        onClick={() => onOpenWpDrawer(r.statement_ref)}
                        style={{ fontSize: "0.7rem", cursor: "pointer" }}
                      >
                        {r.statement_ref}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                    {cell(r.period_op_debit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {cell(r.period_op_credit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                    {cell(r.unadjusted_debit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {cell(r.unadjusted_credit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                    {cell(r.adjustment_debit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {cell(r.adjustment_credit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)", fontWeight: 500 }}>
                    {cell(r.adjusted_debit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 500 }}>
                    {cell(r.adjusted_credit)}
                  </td>
                  <td style={{ borderLeft: "1px solid var(--border)", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                    {localizeDestination(r.statement_destination, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot style={{ position: "sticky", bottom: 0, zIndex: 10, background: "#f4f4f5", fontWeight: 700 }}>
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td colSpan={3} style={{ textAlign: "center" }}>
                  {t.total_label}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                  {fmtAmount(totals.total_period_debit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {fmtAmount(totals.total_period_credit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                  {fmtAmount(totals.total_unadjusted_debit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {fmtAmount(totals.total_unadjusted_credit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                  {fmtAmount(totals.total_adjustment_debit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {fmtAmount(totals.total_adjustment_credit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)", color: "#16a34a" }}>
                  {fmtAmount(totals.total_adjusted_debit)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", color: "#16a34a" }}>
                  {fmtAmount(totals.total_adjusted_credit)}
                </td>
                <td style={{ borderLeft: "1px solid var(--border)", color: "#16a34a" }}>
                  ✓ {t.balanced}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
