import React, { useState } from "react";
import {
  BalanceSheetWorkingPaper,
  CashFlowStatementWorkingPaper,
  IncomeStatementWorkingPaper,
  ReconciliationProofs,
} from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";

interface ThreeStatementsViewProps {
  currency: string;
  incomeStatement: IncomeStatementWorkingPaper;
  balanceSheet: BalanceSheetWorkingPaper;
  cashFlow: CashFlowStatementWorkingPaper;
  kpi?: any;
  proofs: ReconciliationProofs;
  onOpenWpDrawer: (wpRef?: string) => void;
}

export const ThreeStatementsView: React.FC<ThreeStatementsViewProps> = ({
  currency,
  incomeStatement,
  balanceSheet,
  cashFlow,
  kpi: _kpi,
  proofs,
  onOpenWpDrawer,
}) => {
  const [activeStatement, setActiveStatement] = useState<"PL" | "BS" | "CFS">("PL");
  const [cashFlowMethod, setCashFlowMethod] = useState<"INDIRECT" | "DIRECT">("INDIRECT");

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    if (n < 0) {
      return `(${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    }
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Statement Sub-navigation & Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          backgroundColor: "#ffffff",
          padding: "0.75rem 1rem",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
            <button
              type="button"
              className="sh-tabs-trigger"
              data-state={activeStatement === "PL" ? "active" : "inactive"}
              onClick={() => setActiveStatement("PL")}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
            >
              損益表 (Income Statement)
            </button>
            <button
              type="button"
              className="sh-tabs-trigger"
              data-state={activeStatement === "BS" ? "active" : "inactive"}
              onClick={() => setActiveStatement("BS")}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
            >
              資產負債表 (Balance Sheet)
            </button>
            <button
              type="button"
              className="sh-tabs-trigger"
              data-state={activeStatement === "CFS" ? "active" : "inactive"}
              onClick={() => setActiveStatement("CFS")}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
            >
              現金流量表 (Cash Flow)
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Audit Proof Validation Badge */}
          {proofs.balance_sheet_equation_balanced ? (
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              平衡: 資產 ≡ 負債與權益
            </Badge>
          ) : (
            <Badge variant="warning" style={{ fontSize: "0.75rem" }}>
              不平衡 (差異: {proofs.balance_sheet_variance})
            </Badge>
          )}

          <Button variant="outline" onClick={handlePrint} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
            列印報表
          </Button>
        </div>
      </div>

      {/* Statement Content */}
      {activeStatement === "PL" && (
        <Card className="sh-card">
          <CardHeader style={{ paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                  單體損益表 (Income Statement)
                </CardTitle>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  會計期間：{incomeStatement.period} • 幣別：{currency}
                </span>
              </div>
              <Badge
                variant="outline"
                interactive
                onClick={() => onOpenWpDrawer("W/P PL")}
                style={{ fontSize: "0.75rem", cursor: "pointer" }}
              >
                W/P PL 總審計底稿 ↗
              </Badge>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div className="sh-table-wrapper">
              <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ width: "110px" }}>底稿索引</th>
                    <th>會計報表項目</th>
                    <th style={{ textAlign: "right", width: "160px" }}>金額 ({currency})</th>
                    <th style={{ textAlign: "right", width: "100px" }}>比率</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeStatement.line_items.map((item, idx) => {
                    const isSub = item.is_subtotal;
                    const isNet = item.label.includes("Net Profit") || item.label.includes("本期淨利");
                    return (
                      <tr
                        key={idx}
                        className={isSub ? "sh-row-subtotal" : ""}
                        style={{
                          backgroundColor: isNet ? "#fcfcfc" : undefined,
                          fontWeight: isNet ? 700 : isSub ? 600 : 400,
                        }}
                      >
                        <td>
                          {item.wp_ref ? (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref} ↗
                            </Badge>
                          ) : (
                            <span style={{ color: "var(--muted-foreground)" }}>-</span>
                          )}
                        </td>
                        <td style={{ paddingLeft: isSub ? "0.75rem" : "1.5rem" }}>{item.label}</td>
                        <td
                          className={`tabular-nums ${isNet ? "acc-double-underline" : ""}`}
                          style={{
                            textAlign: "right",
                            color: parseFloat(item.amount) < 0 ? "#dc2626" : "inherit",
                          }}
                        >
                          {fmt(item.amount)}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--muted-foreground)", fontSize: "0.8rem" }}>
                          {item.margin_pct || ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeStatement === "BS" && (
        <Card className="sh-card">
          <CardHeader style={{ paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                  單體資產負債表 (Balance Sheet)
                </CardTitle>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  截止日期：{balanceSheet.as_of_period} • 幣別：{currency}
                </span>
              </div>
              <Badge
                variant="outline"
                interactive
                onClick={() => onOpenWpDrawer("W/P BS")}
                style={{ fontSize: "0.75rem", cursor: "pointer" }}
              >
                W/P BS 總審計底稿 ↗
              </Badge>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }}>
              {/* Assets Column */}
              <div style={{ borderRight: "1px solid var(--border)" }}>
                <div
                  style={{
                    padding: "0.6rem 1rem",
                    backgroundColor: "#fafafa",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  資產 (ASSETS)
                </div>
                <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                  <tbody>
                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        流動資產 (Current Assets)
                      </td>
                    </tr>
                    {balanceSheet.current_assets.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ width: "90px" }}>
                          {item.wp_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref} ↗
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
                      <td>流動資產小計</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(balanceSheet.total_current_assets)}
                      </td>
                    </tr>

                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                        非流動資產 (Non-Current Assets)
                      </td>
                    </tr>
                    {balanceSheet.non_current_assets.map((item, idx) => (
                      <tr key={idx} className={item.is_subtotal ? "sh-row-subtotal" : ""}>
                        <td style={{ width: "90px" }}>
                          {item.wp_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref} ↗
                            </Badge>
                          )}
                        </td>
                        <td>{item.label}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                      <td>-</td>
                      <td style={{ fontWeight: 700 }}>總資產 (Total Assets)</td>
                      <td className="tabular-nums acc-double-underline" style={{ textAlign: "right", fontWeight: 700 }}>
                        {fmt(balanceSheet.total_assets)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Liabilities & Equity Column */}
              <div>
                <div
                  style={{
                    padding: "0.6rem 1rem",
                    backgroundColor: "#fafafa",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  負債與所有者權益 (LIABILITIES & EQUITY)
                </div>
                <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                  <tbody>
                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        流動負債 (Current Liabilities)
                      </td>
                    </tr>
                    {balanceSheet.current_liabilities.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ width: "90px" }}>
                          {item.wp_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref} ↗
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
                      <td>負債總額 (Total Liabilities)</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(balanceSheet.total_liabilities)}
                      </td>
                    </tr>

                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                        所有者權益 (Equity)
                      </td>
                    </tr>
                    {balanceSheet.equity.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ width: "90px" }}>
                          {item.wp_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.wp_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.wp_ref} ↗
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
                      <td>權益總額 (Total Equity)</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(balanceSheet.total_equity)}
                      </td>
                    </tr>
                    <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                      <td>-</td>
                      <td style={{ fontWeight: 700 }}>總負債與權益 (Total Liabilities & Equity)</td>
                      <td className="tabular-nums acc-double-underline" style={{ textAlign: "right", fontWeight: 700 }}>
                        {fmt(balanceSheet.total_liabilities_and_equity)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeStatement === "CFS" && (
        <Card className="sh-card">
          <CardHeader style={{ paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                  單體現金流量表 (Cash Flow Statement)
                </CardTitle>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  會計期間：{cashFlow.period} • 幣別：{currency}
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
                  <button
                    type="button"
                    className="sh-tabs-trigger"
                    data-state={cashFlowMethod === "INDIRECT" ? "active" : "inactive"}
                    onClick={() => setCashFlowMethod("INDIRECT")}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    間接法 (IAS 7 / US GAAP)
                  </button>
                  <button
                    type="button"
                    className="sh-tabs-trigger"
                    data-state={cashFlowMethod === "DIRECT" ? "active" : "inactive"}
                    onClick={() => setCashFlowMethod("DIRECT")}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    直接法 (CAS / SME)
                  </button>
                </div>
                <Badge
                  variant="outline"
                  interactive
                  onClick={() => onOpenWpDrawer("W/P CFS")}
                  style={{ fontSize: "0.75rem", cursor: "pointer" }}
                >
                  W/P CFS 底稿 ↗
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div className="sh-table-wrapper">
              <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ width: "110px" }}>底稿索引</th>
                    <th>現金流量項目</th>
                    <th style={{ textAlign: "right", width: "160px" }}>金額 ({currency})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "#fdfdfd" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                      一、經營活動現金流量 (Operating Activities)
                    </td>
                  </tr>
                  {(cashFlowMethod === "INDIRECT"
                    ? cashFlow.indirect_method_operating
                    : cashFlow.direct_method_operating_memo
                  ).map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        {item.wp_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.wp_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.wp_ref} ↗
                          </Badge>
                        )}
                      </td>
                      <td style={{ paddingLeft: "1.5rem" }}>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>經營活動產生之現金流量淨額</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.net_cash_from_operating_activities)}
                    </td>
                  </tr>

                  <tr style={{ background: "#fdfdfd" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                      二、投資活動現金流量 (Investing Activities)
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
                            {item.wp_ref} ↗
                          </Badge>
                        )}
                      </td>
                      <td style={{ paddingLeft: "1.5rem" }}>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>投資活動產生之現金流量淨額</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.net_cash_from_investing_activities)}
                    </td>
                  </tr>

                  <tr style={{ background: "#fdfdfd" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                      三、籌資活動現金流量 (Financing Activities)
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
                            {item.wp_ref} ↗
                          </Badge>
                        )}
                      </td>
                      <td style={{ paddingLeft: "1.5rem" }}>{item.label}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>籌資活動產生之現金流量淨額</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.net_cash_from_financing_activities)}
                    </td>
                  </tr>

                  <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                    <td>-</td>
                    <td style={{ fontWeight: 600 }}>本期現金及約當現金淨增加額</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmt(cashFlow.net_increase_in_cash)}
                    </td>
                  </tr>
                  <tr>
                    <td>-</td>
                    <td>期初現金餘額</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.opening_cash_balance)}
                    </td>
                  </tr>
                  <tr className="sh-row-subtotal" style={{ borderTop: "1px solid var(--border)" }}>
                    <td>W/P A</td>
                    <td style={{ fontWeight: 700 }}>期末現金餘額 (Agreed to Balance Sheet)</td>
                    <td className="tabular-nums acc-double-underline" style={{ textAlign: "right", fontWeight: 700 }}>
                      {fmt(cashFlow.ending_cash_balance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
