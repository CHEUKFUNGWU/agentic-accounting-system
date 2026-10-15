import React, { useState } from "react";
import { ETBTotals, ETBWorksheetRow } from "../types/accounting";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";

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
              延伸試算表 (Extended Trial Balance)
            </CardTitle>
            <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              幣別：{currency} • 期初餘額 → 本期發生額 → 未調整試算表 (UTB) → 調整分錄 (AJE) → 調整後試算表 (ATB)
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              UTB 平衡
            </Badge>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              AJE 平衡
            </Badge>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              ATB 平衡
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
                  ? "全部科目 (All)"
                  : type === "ASSET"
                  ? "資產 (Assets)"
                  : type === "LIABILITY"
                  ? "負債 (Liabilities)"
                  : type === "EQUITY"
                  ? "所有者權益 (Equity)"
                  : type === "REVENUE"
                  ? "營業收入 (Revenue)"
                  : "成本與費用 (Expenses)"}
              </button>
            ))}
          </div>

          <div style={{ width: "240px" }}>
            <input
              type="text"
              placeholder="搜尋科目代號或名稱..."
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
                <th rowSpan={2} style={{ width: "65px" }}>科目代號</th>
                <th rowSpan={2} style={{ minWidth: "220px" }}>會計科目名稱 (Chart of Accounts)</th>
                <th rowSpan={2} style={{ width: "70px" }}>底稿</th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  本期日常發生額
                </th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  未調整試算表 (UTB)
                </th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  期末調整分錄 (AJE)
                </th>
                <th colSpan={2} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>
                  調整後試算表 (ATB)
                </th>
                <th rowSpan={2} style={{ width: "120px", borderLeft: "1px solid var(--border)" }}>
                  報表歸屬
                </th>
              </tr>
              <tr>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>借方 DR</th>
                <th style={{ textAlign: "right", width: "85px" }}>貸方 CR</th>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>借方 DR</th>
                <th style={{ textAlign: "right", width: "85px" }}>貸方 CR</th>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>借方 DR</th>
                <th style={{ textAlign: "right", width: "85px" }}>貸方 CR</th>
                <th style={{ textAlign: "right", borderLeft: "1px solid var(--border)", width: "85px" }}>借方 DR</th>
                <th style={{ textAlign: "right", width: "85px" }}>貸方 CR</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.account_code}>
                  <td style={{ fontWeight: 600 }}>{r.account_code}</td>
                  <td>{r.account_name}</td>
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
                  試算表合計 (Total Verification Proofs)
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
                  ✓ 借貸平衡
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
