import React, { useState } from "react";
import {
  BalanceSheetWorkingPaper,
  CashFlowStatementWorkingPaper,
  IncomeStatementWorkingPaper,
  ReconciliationProofs,
} from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n } from "../i18n";
import { fmtAmount } from "../lib/format";
import { localizeLabel } from "../lib/labels";

interface ThreeStatementsViewProps {
  /** Legal entity name, printed on the working-paper header. */
  entityName?: string;
  currency: string;
  incomeStatement: IncomeStatementWorkingPaper;
  balanceSheet: BalanceSheetWorkingPaper;
  cashFlow: CashFlowStatementWorkingPaper;
  kpi?: any;
  proofs: ReconciliationProofs;
  onOpenWpDrawer: (statementRef?: string) => void;
}

export const ThreeStatementsView: React.FC<ThreeStatementsViewProps> = ({
  entityName,
  currency,
  incomeStatement,
  balanceSheet,
  cashFlow,
  kpi: _kpi,
  proofs,
  onOpenWpDrawer,
}) => {
  const { t, lang } = useI18n();
  const [activeStatement, setActiveStatement] = useState<"PL" | "BS" | "CF">("PL");
  const [cashFlowMethod, setCashFlowMethod] = useState<"INDIRECT" | "DIRECT">("INDIRECT");

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Print-only working-paper header: the printed pack must identify itself. */}
      <div className="print-only print-header">
        <div className="print-header-title">{entityName}</div>
        <div className="print-header-meta">{t.pnl_title} · {t.bs_title} · {t.cfs_title}</div>
        <div className="print-header-meta">
          {t.accounting_period}：{incomeStatement.period}　|　{t.currency_label}：{currency}　|　{t.statement_ref_col}：PL · BS · CFS
        </div>
      </div>

      {/* Statement Sub-navigation & Header Bar */}
      <div
        className="no-print"
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
              data-state={activeStatement === "CF" ? "active" : "inactive"}
              onClick={() => setActiveStatement("CF")}
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
      {/* Rendered for every tab so the printed pack is complete; only the active statement is visible on screen. */}
      <div className={`stmt-panel${activeStatement === "PL" ? "" : " stmt-panel-hidden"}`}>
          <Card className="sh-card stmt-card">
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
                onClick={() => onOpenWpDrawer("PL")}
                style={{ fontSize: "0.75rem", cursor: "pointer" }}
              >
                PL ↗
              </Badge>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div className="sh-table-wrapper">
              <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ width: "110px" }}>{t.statement_ref_col}</th>
                    <th>{t.account_name_col}</th>
                    <th style={{ textAlign: "right", width: "160px" }}>{t.amount_col} ({currency})</th>
                    <th style={{ textAlign: "right", width: "100px" }}>{t.ratio_col}</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeStatement.line_items.map((item, idx) => {
                    const isSub = item.is_subtotal;
                    // Identify the bottom line by dictionary identity, not by
                    // substring-matching a label whose wording comes from the API.
                    const isNet = localizeLabel(item.label, lang) === t.row_net_profit;
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
                          {item.statement_ref ? (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.statement_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.statement_ref} ↗
                            </Badge>
                          ) : (
                            <span style={{ color: "var(--muted-foreground)" }}>-</span>
                          )}
                        </td>
                        <td style={{ paddingLeft: isSub ? "0.75rem" : "1.5rem" }}>{localizeLabel(item.label, lang)}</td>
                        <td
                          className={`tabular-nums ${isNet ? "acc-double-underline" : ""}`}
                          style={{
                            textAlign: "right",
                            color: parseFloat(item.amount) < 0 ? "#dc2626" : "inherit",
                          }}
                        >
                          {fmtAmount(item.amount)}
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
      </div>

      {/* Rendered for every tab so the printed pack is complete; only the active statement is visible on screen. */}
      <div className={`stmt-panel${activeStatement === "BS" ? "" : " stmt-panel-hidden"}`}>
          <Card className="sh-card stmt-card">
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
                onClick={() => onOpenWpDrawer("BS")}
                style={{ fontSize: "0.75rem", cursor: "pointer" }}
              >
                BS ↗
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
                          {item.statement_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.statement_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.statement_ref} ↗
                            </Badge>
                          )}
                        </td>
                        <td>{localizeLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmtAmount(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>{t.row_total_current_assets}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmtAmount(balanceSheet.total_current_assets)}
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
                          {item.statement_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.statement_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.statement_ref} ↗
                            </Badge>
                          )}
                        </td>
                        <td>{localizeLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmtAmount(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                      <td>-</td>
                      <td style={{ fontWeight: 700 }}>{t.row_total_assets}</td>
                      <td className="tabular-nums acc-double-underline" style={{ textAlign: "right", fontWeight: 700 }}>
                        {fmtAmount(balanceSheet.total_assets)}
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
                          {item.statement_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.statement_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.statement_ref} ↗
                            </Badge>
                          )}
                        </td>
                        <td>{localizeLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmtAmount(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>{t.row_total_liabilities}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmtAmount(balanceSheet.total_liabilities)}
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
                          {item.statement_ref && (
                            <Badge
                              variant="secondary"
                              interactive
                              onClick={() => onOpenWpDrawer(item.statement_ref)}
                              style={{ fontSize: "0.7rem", cursor: "pointer" }}
                            >
                              {item.statement_ref} ↗
                            </Badge>
                          )}
                        </td>
                        <td>{localizeLabel(item.label, lang)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {fmtAmount(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="sh-row-subtotal">
                      <td>-</td>
                      <td>{t.row_total_equity}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmtAmount(balanceSheet.total_equity)}
                      </td>
                    </tr>
                    <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                      <td>-</td>
                      <td style={{ fontWeight: 700 }}>{t.row_total_liabilities_equity}</td>
                      <td className="tabular-nums acc-double-underline" style={{ textAlign: "right", fontWeight: 700 }}>
                        {fmtAmount(balanceSheet.total_liabilities_and_equity)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rendered for every tab so the printed pack is complete; only the active statement is visible on screen. */}
      <div className={`stmt-panel${activeStatement === "CF" ? "" : " stmt-panel-hidden"}`}>
          <Card className="sh-card stmt-card">
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
                  onClick={() => onOpenWpDrawer("CFS")}
                  style={{ fontSize: "0.75rem", cursor: "pointer" }}
                >
                  CFS ↗
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "0" }}>
            <div className="sh-table-wrapper">
              <table className="sh-table" style={{ fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ width: "110px" }}>{t.statement_ref_col}</th>
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
                        {item.statement_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.statement_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.statement_ref} ↗
                          </Badge>
                        )}
                      </td>
                      <td style={{ paddingLeft: "1.5rem" }}>{localizeLabel(item.label, lang)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmtAmount(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>{t.row_cfs_op}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmtAmount(cashFlow.net_cash_from_operating_activities)}
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
                        {item.statement_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.statement_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.statement_ref} ↗
                          </Badge>
                        )}
                      </td>
                      <td style={{ paddingLeft: "1.5rem" }}>{localizeLabel(item.label, lang)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmtAmount(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>{t.row_cfs_inv}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmtAmount(cashFlow.net_cash_from_investing_activities)}
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
                        {item.statement_ref && (
                          <Badge
                            variant="secondary"
                            interactive
                            onClick={() => onOpenWpDrawer(item.statement_ref)}
                            style={{ fontSize: "0.7rem", cursor: "pointer" }}
                          >
                            {item.statement_ref} ↗
                          </Badge>
                        )}
                      </td>
                      <td style={{ paddingLeft: "1.5rem" }}>{localizeLabel(item.label, lang)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {fmtAmount(item.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="sh-row-subtotal">
                    <td>-</td>
                    <td>{t.row_cfs_fin}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmtAmount(cashFlow.net_cash_from_financing_activities)}
                    </td>
                  </tr>

                  <tr className="sh-row-subtotal" style={{ borderTop: "2px solid var(--border)" }}>
                    <td>-</td>
                    <td style={{ fontWeight: 600 }}>{t.row_cfs_net_change}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmtAmount(cashFlow.net_increase_in_cash)}
                    </td>
                  </tr>
                  <tr>
                    <td>-</td>
                    <td>{t.row_cfs_open_cash}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {fmtAmount(cashFlow.opening_cash_balance)}
                    </td>
                  </tr>
                  <tr className="sh-row-subtotal" style={{ borderTop: "1px solid var(--border)" }}>
                    <td>CASH</td>
                    <td style={{ fontWeight: 700 }}>{t.row_cfs_close_cash}</td>
                    <td className="tabular-nums acc-double-underline" style={{ textAlign: "right", fontWeight: 700 }}>
                      {fmtAmount(cashFlow.ending_cash_balance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
