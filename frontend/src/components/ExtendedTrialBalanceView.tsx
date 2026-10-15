import React, { useState } from "react";
import { ETBTotals, ETBWorksheetRow } from "../types/accounting";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n, cleanLabel } from "../i18n";

interface ExtendedTrialBalanceViewProps {
  currency: string;
  rows: ETBWorksheetRow[];
  totals: ETBTotals;
  onOpenWpDrawer: (wpRef?: string) => void;
}

export const ExtendedTrialBalanceView: React.FC<ExtendedTrialBalanceViewProps> = ({
  currency,
  rows,
  totals,
  onOpenWpDrawer,
}) => {
  const { t, lang } = useI18n();
  const [filterType, setFilterType] = useState<string>("ALL");
  const [searchKeyword, setSearchKeyword] = useState<string>("");

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n) || n === 0) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const filteredRows = rows.filter((r) => {
    if (filterType !== "ALL" && r.account_type !== filterType) return false;
    if (searchKeyword.trim()) {
      const q = searchKeyword.toLowerCase();
      return r.account_code.toLowerCase().includes(q) || r.account_name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <Card className="sh-card">
      <CardHeader style={{ paddingBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {t.etb_title}
            </CardTitle>
            <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {t.currency_label}：{currency} • {t.etb_subtitle}
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
        <div className="sh-table-wrapper" style={{ maxHeight: "680px", overflowY: "auto" }}>
          <table className="sh-table" style={{ fontSize: "0.8rem" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "#fafafa" }}>
              <tr>
                <th rowSpan={2} style={{ width: "65px" }}>{t.col_acc_code}</th>
                <th rowSpan={2} style={{ minWidth: "220px" }}>{t.col_acc_name}</th>
                <th rowSpan={2} style={{ width: "70px" }}>{t.wp_ref_col}</th>
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
                  {lang === "en" ? "Statement" : "报表归属"}
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
                  <td style={{ fontWeight: 600 }}>{r.account_code}</td>
                  <td>{cleanLabel(r.account_name, lang)}</td>
                  <td>
                    {r.wp_ref ? (
                      <Badge
                        variant="secondary"
                        interactive
                        onClick={() => onOpenWpDrawer(r.wp_ref)}
                        style={{ fontSize: "0.7rem", cursor: "pointer" }}
                      >
                        {r.wp_ref}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                    {fmt(r.period_op_debit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(r.period_op_credit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                    {fmt(r.unadjusted_dr)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(r.unadjusted_cr)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                    {fmt(r.aje_debit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(r.aje_credit)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)", fontWeight: 500 }}>
                    {fmt(r.adjusted_dr)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 500 }}>
                    {fmt(r.adjusted_cr)}
                  </td>
                  <td style={{ borderLeft: "1px solid var(--border)", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                    {r.statement_destination}
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
                  {fmt(totals.total_op_dr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {fmt(totals.total_op_cr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                  {fmt(totals.total_unadj_dr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {fmt(totals.total_unadj_cr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)" }}>
                  {fmt(totals.total_aje_dr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {fmt(totals.total_aje_cr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", borderLeft: "1px solid var(--border)", color: "#16a34a" }}>
                  {fmt(totals.total_adjusted_dr)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", color: "#16a34a" }}>
                  {fmt(totals.total_adjusted_cr)}
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
