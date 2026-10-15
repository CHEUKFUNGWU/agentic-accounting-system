import React, { useState } from "react";
import {
  BalanceSheetWorkingPaper,
  CashFlowStatementWorkingPaper,
  IncomeStatementWorkingPaper,
  ReconciliationProofs,
} from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n, cleanLabel } from "../i18n";

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
  const { t, lang } = useI18n();
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
              {t.tab_pnl}
            </button>
            <button
              type="button"
              className="sh-tabs-trigger"
              data-state={activeStatement === "BS" ? "active" : "inactive"}
              onClick={() => setActiveStatement("BS")}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
            >
              {t.tab_bs}
            </button>
            <button
              type="button"
              className="sh-tabs-trigger"
              data-state={activeStatement === "CFS" ? "active" : "inactive"}
              onClick={() => setActiveStatement("CFS")}
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
            >
              {t.tab_cfs}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Audit Proof Validation Badge */}
          {proofs.balance_sheet_equation_balanced ? (
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              {t.balance_proof_balanced}
            </Badge>
          ) : (
            <Badge variant="warning" style={{ fontSize: "0.75rem" }}>
              {t.balance_proof_imbalanced}
            </Badge>
          )}

          <Button variant="outline" onClick={handlePrint} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
            {t.print_report}
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
                  {t.pnl_title}
                </CardTitle>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {t.accounting_period}：{incomeStatement.period} • {t.currency_label}：{currency}
                </span>
              </div>
              <Badge
                variant="outline"
                interactive
                onClick={() => onOpenWpDrawer("W/P PL")}
                style={{ fontSize: "0.75rem", cursor: "pointer" }}
              >
                W/P PL ↗
              </Badge>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div className="sh-table-wrapper">
              <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ width: "110px" }}>{t.wp_ref_col}</th>
                    <th>{t.account_name_col}</th>
                    <th style={{ textAlign: "right", width: "160px" }}>{t.amount_col} ({currency})</th>
                    <th style={{ textAlign: "right", width: "100px" }}>{t.ratio_col}</th>
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
                        <td style={{ paddingLeft: isSub ? "0.75rem" : "1.5rem" }}>{cleanLabel(item.label, lang)}</td>
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
                  {t.bs_title}
                </CardTitle>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {t.accounting_period}：{balanceSheet.as_of_period} • {t.currency_label}：{currency}
                </span>
              </div>
              <Badge
                variant="outline"
                interactive
                onClick={() => onOpenWpDrawer("W/P BS")}
                style={{ fontSize: "0.75rem", cursor: "pointer" }}
              >
                W/P BS ↗
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
                  {lang === "en" ? "Assets" : lang === "zh-CN" ? "资产" : "資產"}
                </div>
                <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                  <tbody>
                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        {t.row_current_assets}
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
                        <td>{cleanLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>{t.row_total_current_assets}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(balanceSheet.total_current_assets)}
                      </td>
                    </tr>

                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                        {t.row_non_current_assets}
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
                        <td>{cleanLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                      <td>-</td>
                      <td style={{ fontWeight: 700 }}>{t.row_total_assets}</td>
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
                  {t.row_total_liabilities_equity}
                </div>
                <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                  <tbody>
                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                        {t.row_current_liabilities}
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
                        <td>{cleanLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>{t.row_total_liabilities}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(balanceSheet.total_liabilities)}
                      </td>
                    </tr>

                    <tr style={{ background: "#fdfdfd" }}>
                      <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                        {t.row_equity}
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
                        <td>{cleanLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmt(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>{t.row_total_equity}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(balanceSheet.total_equity)}
                      </td>
                    </tr>
                    <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                      <td>-</td>
                      <td style={{ fontWeight: 700 }}>{t.row_total_liabilities_equity}</td>
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
                  {t.cfs_title}
                </CardTitle>
                <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {t.accounting_period}：{cashFlow.period} • {t.currency_label}：{currency}
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
                    {lang === "en" ? "Indirect Method" : lang === "zh-CN" ? "间接法" : "間接法"}
                  </button>
                  <button
                    type="button"
                    className="sh-tabs-trigger"
                    data-state={cashFlowMethod === "DIRECT" ? "active" : "inactive"}
                    onClick={() => setCashFlowMethod("DIRECT")}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    {lang === "en" ? "Direct Method" : lang === "zh-CN" ? "直接法" : "直接法"}
                  </button>
                </div>
                <Badge
                  variant="outline"
                  interactive
                  onClick={() => onOpenWpDrawer("W/P CFS")}
                  style={{ fontSize: "0.75rem", cursor: "pointer" }}
                >
                  W/P CFS ↗
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div className="sh-table-wrapper">
              <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ width: "110px" }}>{t.wp_ref_col}</th>
                    <th>{t.account_name_col}</th>
                    <th style={{ textAlign: "right", width: "160px" }}>{t.amount_col} ({currency})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "#fdfdfd" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                      {lang === "en" ? "1. Operating Activities" : lang === "zh-CN" ? "一、经营活动现金流量" : "一、營業活動現金流量"}
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
                      <td style={{ paddingLeft: "1.5rem" }}>{cleanLabel(item.label, lang)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>{t.row_cfs_op}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.net_cash_from_operating_activities)}
                    </td>
                  </tr>

                  <tr style={{ background: "#fdfdfd" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                      {lang === "en" ? "2. Investing Activities" : lang === "zh-CN" ? "二、投资活动现金流量" : "二、投資活動現金流量"}
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
                      <td style={{ paddingLeft: "1.5rem" }}>{cleanLabel(item.label, lang)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>{t.row_cfs_inv}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.net_cash_from_investing_activities)}
                    </td>
                  </tr>

                  <tr style={{ background: "#fdfdfd" }}>
                    <td colSpan={3} style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--muted-foreground)", paddingTop: "0.75rem" }}>
                      {lang === "en" ? "3. Financing Activities" : lang === "zh-CN" ? "三、筹资活动现金流量" : "三、籌資活動現金流量"}
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
                      <td style={{ paddingLeft: "1.5rem" }}>{cleanLabel(item.label, lang)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>{t.row_cfs_fin}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.net_cash_from_financing_activities)}
                    </td>
                  </tr>

                  <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                    <td>-</td>
                    <td style={{ fontWeight: 600 }}>{t.row_cfs_net_change}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmt(cashFlow.net_increase_in_cash)}
                    </td>
                  </tr>
                  <tr>
                    <td>-</td>
                    <td>{t.row_cfs_open_cash}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmt(cashFlow.opening_cash_balance)}
                    </td>
                  </tr>
                  <tr className="sh-row-subtotal" style={{ borderTop: "1px solid var(--border)" }}>
                    <td>W/P A</td>
                    <td style={{ fontWeight: 700 }}>{t.row_cfs_close_cash}</td>
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
