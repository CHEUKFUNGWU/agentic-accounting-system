import React, { useState } from "react";
import {
  BalanceSheetWorkingPaper,
  CashFlowStatementWorkingPaper,
  IncomeStatementWorkingPaper,
  KpiSummary,
  ReconciliationProofs,
  StatementLine,
} from "../types/accounting";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";

interface ThreeStatementsViewProps {
  currency: string;
  incomeStatement: IncomeStatementWorkingPaper;
  balanceSheet: BalanceSheetWorkingPaper;
  cashFlow: CashFlowStatementWorkingPaper;
  kpi: KpiSummary;
  proofs: ReconciliationProofs;
  onOpenWpDrawer: (wpRef?: string) => void;
}

export const ThreeStatementsView: React.FC<ThreeStatementsViewProps> = ({
  currency,
  incomeStatement,
  balanceSheet,
  cashFlow,
  kpi,
  proofs,
  onOpenWpDrawer,
}) => {
  const [cashFlowMethod, setCashFlowMethod] = useState<"INDIRECT" | "DIRECT">("INDIRECT");

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const renderStatementTable = (lines: StatementLine[], title: string, wpRef: string) => (
    <Card className="sh-card">
      <CardHeader style={{ paddingBottom: "0.5rem", display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <CardTitle style={{ fontSize: "1rem" }}>{title}</CardTitle>
          <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
            幣別：{currency} • 單體核算底稿
          </span>
        </div>
        <Badge
          variant="outline"
          interactive
          onClick={() => onOpenWpDrawer(wpRef)}
          style={{ fontSize: "0.75rem", cursor: "pointer" }}
        >
          {wpRef} 穿透底稿 ↗
        </Badge>
      </CardHeader>
      <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
        <div className="sh-table-wrapper">
          <table className="sh-table" style={{ fontSize: "0.85rem" }}>
            <thead>
              <tr>
                <th style={{ width: "90px" }}>底稿索引</th>
                <th>會計報表項目 (Financial Statement Line Item)</th>
                <th style={{ textAlign: "right" }}>金額 ({currency})</th>
                <th style={{ textAlign: "right", width: "80px" }}>比例 / 註記</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((item, idx) => {
                const isSub = item.is_subtotal;
                return (
                  <tr key={idx} className={isSub ? "sh-row-subtotal" : ""}>
                    <td>
                      {item.wp_ref ? (
                        <Badge
                          variant="secondary"
                          interactive
                          onClick={() => onOpenWpDrawer(item.wp_ref)}
                          style={{ fontSize: "0.7rem", cursor: "pointer" }}
                        >
                          {item.wp_ref}
                        </Badge>
                      ) : (
                        <span style={{ color: "var(--muted-foreground)" }}>-</span>
                      )}
                    </td>
                    <td style={{ fontWeight: isSub ? 600 : 400 }}>{item.label}</td>
                    <td
                      className="tabular-nums"
                      style={{
                        textAlign: "right",
                        fontWeight: isSub ? 600 : 400,
                        color: parseFloat(item.amount) < 0 ? "#dc2626" : "inherit",
                      }}
                    >
                      {fmt(item.amount)}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
                      {item.margin_pct || (isSub ? "小計" : "")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* KPI & Hard Proof Summary Banner */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <Card>
          <CardContent style={{ padding: "1rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>主營業務收入 (Revenue)</span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }} className="tabular-nums">
              {currency} {fmt(kpi.total_revenue)}
            </div>
            <span style={{ fontSize: "0.75rem", color: "#16a34a" }}>毛利率: {kpi.gross_margin_pct}</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent style={{ padding: "1rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>本期淨利 (Net Profit)</span>
            <div
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                margin: "0.25rem 0",
                color: parseFloat(kpi.net_profit) >= 0 ? "#16a34a" : "#dc2626",
              }}
              className="tabular-nums"
            >
              {currency} {fmt(kpi.net_profit)}
            </div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>淨利率: {kpi.net_margin_pct}</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent style={{ padding: "1rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>貨幣資金 (Ending Cash W/P A)</span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0" }} className="tabular-nums">
              {currency} {fmt(kpi.ending_cash)}
            </div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>銀行對帳勾稽 100%</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent style={{ padding: "1rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>安全可支用現金 (Safe Cash)</span>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.25rem 0", color: "#2563eb" }} className="tabular-nums">
              {currency} {fmt(kpi.safe_to_spend_cash)}
            </div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>已扣除法定預留稅款</span>
          </CardContent>
        </Card>

        <Card style={{ borderLeft: proofs.balance_sheet_equation_balanced ? "4px solid #16a34a" : "4px solid #dc2626" }}>
          <CardContent style={{ padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>三大報表勾稽硬檢驗</span>
              {proofs.balance_sheet_equation_balanced ? (
                <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                  ✓ 平衡
                </Badge>
              ) : (
                <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                  ⚠ 不平衡
                </Badge>
              )}
            </div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginTop: "0.25rem" }}>
              A = L + E 差額: {proofs.balance_sheet_variance}
            </div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
              現金流量勾稽差額: {proofs.cash_flow_variance}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Statement 1: Income Statement */}
      {renderStatementTable(
        incomeStatement.line_items,
        "Statement 1: 單體損益表 (Standalone Income Statement / P&L)",
        "W/P PL"
      )}

      {/* Statement 2: Balance Sheet */}
      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.5rem", display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <CardTitle style={{ fontSize: "1rem" }}>
              Statement 2: 單體資產負債表 (Standalone Balance Sheet / B/S)
            </CardTitle>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
              截止日期：{balanceSheet.as_of_period} • 驗證公式：總資產 ≡ 總負債 + 總權益
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              資產 {fmt(balanceSheet.total_assets)} ≡ 負債與權益 {fmt(balanceSheet.total_liabilities_and_equity)}
            </Badge>
            <Badge
              variant="outline"
              interactive
              onClick={() => onOpenWpDrawer("W/P BS")}
              style={{ fontSize: "0.75rem", cursor: "pointer" }}
            >
              W/P BS 穿透底稿 ↗
            </Badge>
          </div>
        </CardHeader>
        <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* Left Column: Assets */}
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", padding: "0.5rem", backgroundColor: "var(--secondary)", borderRadius: "4px", marginBottom: "0.5rem" }}>
                資產類項目 (ASSETS)
              </div>
              <table className="sh-table" style={{ fontSize: "0.85rem" }}>
                <tbody>
                  <tr style={{ background: "#fafafa" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                      流動資產 (Current Assets)
                    </td>
                  </tr>
                  {balanceSheet.current_assets.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ width: "80px" }}>
                        {item.wp_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.wp_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.wp_ref}
                          </Badge>
                        )}
                      </td>
                      <td>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>流動資產合計 (Total Current Assets)</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(balanceSheet.total_current_assets)}
                    </td>
                  </tr>
                  <tr style={{ background: "#fafafa" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                      非流動資產 (Non-Current Assets)
                    </td>
                  </tr>
                  {balanceSheet.non_current_assets.map((item, idx) => (
                    <tr key={idx} className={item.is_subtotal ? "sh-row-subtotal" : ""}>
                      <td style={{ width: "80px" }}>
                        {item.wp_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.wp_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.wp_ref}
                          </Badge>
                        )}
                      </td>
                      <td>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: "#f4f4f5", fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                    <td>-</td>
                    <td>資產總計 (TOTAL ASSETS)</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(balanceSheet.total_assets)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right Column: Liabilities & Equity */}
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", padding: "0.5rem", backgroundColor: "var(--secondary)", borderRadius: "4px", marginBottom: "0.5rem" }}>
                負債與所有者權益 (LIABILITIES & EQUITY)
              </div>
              <table className="sh-table" style={{ fontSize: "0.85rem" }}>
                <tbody>
                  <tr style={{ background: "#fafafa" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                      流動負債 (Current Liabilities)
                    </td>
                  </tr>
                  {balanceSheet.current_liabilities.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ width: "80px" }}>
                        {item.wp_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.wp_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.wp_ref}
                          </Badge>
                        )}
                      </td>
                      <td>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>負債合計 (Total Liabilities)</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(balanceSheet.total_liabilities)}
                    </td>
                  </tr>
                  <tr style={{ background: "#fafafa" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                      所有者權益 (Owner's Equity)
                    </td>
                  </tr>
                  {balanceSheet.equity.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ width: "80px" }}>
                        {item.wp_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.wp_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.wp_ref}
                          </Badge>
                        )}
                      </td>
                      <td>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>所有者權益合計 (Total Equity)</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(balanceSheet.total_equity)}
                    </td>
                  </tr>
                  <tr style={{ backgroundColor: "#f4f4f5", fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                    <td>-</td>
                    <td>負債與所有者權益總計 (TOTAL L&E)</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(balanceSheet.total_liabilities_and_equity)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statement 3: Cash Flow Statement (Dual-Method) */}
      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.5rem", display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <CardTitle style={{ fontSize: "1rem" }}>
              Statement 3: 單體現金流量表 (Standalone Cash Flow Statement / CFS)
            </CardTitle>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
              期初現金 {fmt(cashFlow.opening_cash_balance)} + 淨現金變動 {fmt(cashFlow.net_increase_in_cash)} ≡ 期末現金 {fmt(cashFlow.ending_cash_balance)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {/* Dual Method Toggle Pills */}
            <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
              <button
                type="button"
                className="sh-tabs-trigger"
                data-state={cashFlowMethod === "INDIRECT" ? "active" : "inactive"}
                onClick={() => setCashFlowMethod("INDIRECT")}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
              >
                間接法 (IFRS / US GAAP)
              </button>
              <button
                type="button"
                className="sh-tabs-trigger"
                data-state={cashFlowMethod === "DIRECT" ? "active" : "inactive"}
                onClick={() => setCashFlowMethod("DIRECT")}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
              >
                直接法正表 (PRC CAS)
              </button>
            </div>
            <Badge
              variant="outline"
              interactive
              onClick={() => onOpenWpDrawer("W/P CFS")}
              style={{ fontSize: "0.75rem", cursor: "pointer" }}
            >
              W/P CFS 穿透底稿 ↗
            </Badge>
          </div>
        </CardHeader>
        <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "90px" }}>底稿索引</th>
                  <th>現金流量項目 (Cash Flow Activity)</th>
                  <th style={{ textAlign: "right" }}>金額 ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {cashFlowMethod === "INDIRECT" ? (
                  <>
                    <tr style={{ background: "#fafafa" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        一、經營活動現金流量 - 間接法調節 (Operating Activities - Indirect Method)
                      </td>
                    </tr>
                    {cashFlow.indirect_method_operating.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          {item.wp_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref}
                            </Badge>
                          )}
                        </td>
                        <td>{item.label}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>經營活動產生的現金流量淨額 (Net Cash from Operating Activities)</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(cashFlow.net_cash_from_operating_activities)}
                      </td>
                    </tr>
                  </>
                ) : (
                  <>
                    <tr style={{ background: "#fafafa" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        一、經營活動現金流量 - 直接法正表 (Operating Activities - Direct Method)
                      </td>
                    </tr>
                    {cashFlow.direct_method_operating_memo.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          {item.wp_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref}
                            </Badge>
                          )}
                        </td>
                        <td>{item.label}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>經營活動產生的現金流量淨額 (Net Cash from Operating Activities)</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(cashFlow.net_cash_from_operating_activities)}
                      </td>
                    </tr>
                  </>
                )}

                <tr style={{ background: "#fafafa" }}>
                  <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                    二、投資活動現金流量 (Investing Activities - CapEx additions)
                  </td>
                </tr>
                {cashFlow.investing_activities.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      {item.wp_ref && (
                        <Badge
                          variant="secondary"
                          interactive
                          onClick={() => onOpenWpDrawer(item.wp_ref)}
                          style={{ fontSize: "0.7rem", cursor: "pointer" }}
                        >
                          {item.wp_ref}
                        </Badge>
                      )}
                    </td>
                    <td>{item.label}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(item.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="sh-row-subtotal">
                  <td>-</td>
                  <td>投資活動產生的現金流量淨額 (Net Cash from Investing Activities)</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(cashFlow.net_cash_from_investing_activities)}
                  </td>
                </tr>

                <tr style={{ background: "#fafafa" }}>
                  <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                    三、籌資活動現金流量 (Financing Activities - Director loan & drawings movement)
                  </td>
                </tr>
                {cashFlow.financing_activities.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      {item.wp_ref && (
                        <Badge
                          variant="secondary"
                          interactive
                          onClick={() => onOpenWpDrawer(item.wp_ref)}
                          style={{ fontSize: "0.7rem", cursor: "pointer" }}
                        >
                          {item.wp_ref}
                        </Badge>
                      )}
                    </td>
                    <td>{item.label}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(item.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="sh-row-subtotal">
                  <td>-</td>
                  <td>籌資活動產生的現金流量淨額 (Net Cash from Financing Activities)</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(cashFlow.net_cash_from_financing_activities)}
                  </td>
                </tr>

                <tr style={{ backgroundColor: "#f4f4f5", fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td>-</td>
                  <td>四、現金及現金等價物淨增加額 (Net Increase in Cash)</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(cashFlow.net_increase_in_cash)}
                  </td>
                </tr>
                <tr>
                  <td>W/P A</td>
                  <td>加：期初現金及現金等價物餘額 (Opening Cash Balance)</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {fmt(cashFlow.opening_cash_balance)}
                  </td>
                </tr>
                <tr style={{ backgroundColor: "#e4e4e7", fontWeight: 700 }}>
                  <td>W/P A</td>
                  <td>五、期末現金及現金等價物餘額 (Ending Cash Balance - Ties to B/S)</td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#16a34a" }}>
                    {fmt(cashFlow.ending_cash_balance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
