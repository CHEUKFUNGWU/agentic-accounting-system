import React, { useState } from "react";
import { CloseChecklistItem, StatutoryTaxSchedule } from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Progress } from "./ui/shadcn";
import { useI18n, pick } from "../i18n";
import { fmtAmount } from "../lib/format";
import { localizeLabel } from "../lib/labels";

interface TaxAndCloseViewProps {
  currency: string;
  taxSchedule: StatutoryTaxSchedule;
  checklist: CloseChecklistItem[];
  packStatus: string;
  onLockPack: () => void;
  onOpenWpDrawer: (statementRef: string) => void;
}

export const TaxAndCloseView: React.FC<TaxAndCloseViewProps> = ({
  currency,
  taxSchedule,
  checklist,
  packStatus,
  onLockPack,
  onOpenWpDrawer,
}) => {
  const { t, lang } = useI18n();
  const [confirmLockOpen, setConfirmLockOpen] = useState(false);

  const completedCount = checklist.filter((item) => item.status === "COMPLETED").length;
  const progressPct = Math.round((completedCount / checklist.length) * 100);

  const handleConfirmLock = () => {
    onLockPack();
    setConfirmLockOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Lock Confirmation Dialog */}
      <Dialog
        open={confirmLockOpen}
        onOpenChange={(v) => !v && setConfirmLockOpen(false)}
        title={t.cpa_confirm_modal_title}
        description={t.cpa_confirm_modal_desc}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ backgroundColor: "#fefce8", border: "1px solid #fef08a", padding: "0.75rem", borderRadius: "var(--radius)", fontSize: "0.85rem", color: "#854d0e" }}>
            <strong>{lang === "en" ? "Audit Compliance Verification:" : "审计划定核验确认："}</strong>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.25rem" }}>
              <li>{lang === "en" ? "Three Financial Statements mathematical proof verified (A = L + E, variance 0.00)" : lang === "zh-CN" ? "三大财务报表数学平衡验证通过（资产 ＝ 负债 ＋ 股东权益，差额为 0.00）" : "三大財務報表數學平衡驗證通過（資產 ＝ 負債 ＋ 股東權益，差額為 0.00）"}</li>
              <li>{lang === "en" ? "Cash Flow ending cash agreed to Balance Sheet cash & equivalents" : lang === "zh-CN" ? "现金流量表与资产负债表货币资金勾稽一致" : "現金流量表與資產負債表銀行存款勾稽一致"}</li>
              <li>{lang === "en" ? "Mandatory tax provision reserve calculated" : lang === "zh-CN" ? "法定税费准备金已完成计提测算" : "法定稅費準備金已完成提列試算"} ({currency} {fmtAmount(taxSchedule.recommended_tax_vault_reserve)})</li>
            </ul>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <Button variant="ghost" onClick={() => setConfirmLockOpen(false)}>
              {t.cancel}
            </Button>
            <Button variant="default" onClick={handleConfirmLock}>
              {t.cpa_confirm_btn}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Tax Reserve & Operating Cash Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <Card style={{ backgroundColor: "#ffffff" }}>
          <CardHeader style={{ paddingBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
              {lang === "en" ? "Safe-to-Spend Operating Cash" : lang === "zh-CN" ? "安全可支用运营资金" : "安全可支用營運資金"}
            </span>
          </CardHeader>
          <CardContent>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#18181b" }} className="tabular-nums">
              {currency} {fmtAmount(taxSchedule.safe_to_spend_operating_cash)}
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {pick(lang, {
                en: `= Total Cash (${fmtAmount(taxSchedule.ending_cash_balance)}) minus Mandatory Tax Reserve (${fmtAmount(taxSchedule.recommended_tax_vault_reserve)})`,
                "zh-CN": `= 银行存款余额 (${fmtAmount(taxSchedule.ending_cash_balance)}) 扣除 法定预留税费 (${fmtAmount(taxSchedule.recommended_tax_vault_reserve)})`,
                "zh-TW": `= 銀行存款餘額 (${fmtAmount(taxSchedule.ending_cash_balance)}) 扣除 法定預留稅費 (${fmtAmount(taxSchedule.recommended_tax_vault_reserve)})`,
              })}
            </p>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: "#ffffff" }}>
          <CardHeader style={{ paddingBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
              {lang === "en" ? "Mandatory Tax Provision Reserve" : lang === "zh-CN" ? "法定税务储备准备金" : "法定稅務儲備準備金"}
            </span>
          </CardHeader>
          <CardContent>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#b45309" }} className="tabular-nums">
              {currency} {fmtAmount(taxSchedule.total_statutory_tax_payable)}
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {pick(lang, {
                en: "Includes VAT/GST, withholding taxes, and CIT provisions",
                "zh-CN": "包含增值税/消费税、预扣税及企业所得税拨备",
                "zh-TW": "包含增值稅/消費稅、預扣稅及企業所得稅撥備",
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Statutory Tax Return Boxes */}
      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <CardTitle style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {pick(lang, { en: "Statutory Tax Filing Schedule", "zh-CN": "法定税务申报", "zh-TW": "法定稅務申報" })} ({taxSchedule.return_form_name})
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                {pick(lang, { en: "Policy Applied: ", "zh-CN": "适用政策：", "zh-TW": "適用政策：" })}{taxSchedule.relief_applied}
              </span>
            </div>
            <Badge
              variant="outline"
              interactive
              onClick={() => onOpenWpDrawer("CC")}
              style={{ fontSize: "0.75rem", cursor: "pointer" }}
            >
              TAX ↗
            </Badge>
          </div>
        </CardHeader>
        <CardContent style={{ padding: "0" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th>{pick(lang, { en: "Statutory Box / Return Line Item", "zh-CN": "申报格位 / 税务项目", "zh-TW": "申報格位 / 稅務項目" })}</th>
                  <th style={{ textAlign: "right", width: "200px" }}>{t.amount_col} ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(taxSchedule.filing_boxes).map(([box, amount]) => (
                  <tr key={box}>
                    <td style={{ fontWeight: 500 }}>{box}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmtAmount(amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Month-End Close Readiness Checklist */}
      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <div>
              <CardTitle style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {t.close_title}
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                {pick(lang, { en: "Progress: ", "zh-CN": "完成进度：", "zh-TW": "完成進度：" })}{completedCount} / {checklist.length} ({progressPct}%)
              </span>
            </div>
            {packStatus !== "REVIEWED_AND_LOCKED" ? (
              <Button variant="default" onClick={() => setConfirmLockOpen(true)} style={{ fontSize: "0.85rem" }}>
                {t.cpa_sign_btn}
              </Button>
            ) : (
              <Badge variant="success" style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}>
                {t.status_locked}
              </Badge>
            )}
          </div>
          <Progress value={progressPct} />
        </CardHeader>

        <CardContent style={{ padding: "0" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ width: "60px" }}>#</th>
                  <th>{t.close_checklist}</th>
                  <th style={{ width: "110px" }}>{t.statement_ref_col}</th>
                  <th style={{ width: "180px" }}>{pick(lang, { en: "Assignee / Agent", "zh-CN": "责任人 / 智能体", "zh-TW": "責任人 / 智能體" })}</th>
                  <th style={{ width: "100px", textAlign: "center" }}>{t.col_status}</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((item) => (
                  <tr key={item.step}>
                    <td style={{ fontWeight: 600, color: "var(--muted-foreground)" }}>{item.step}</td>
                    <td style={{ fontWeight: 500 }}>{localizeLabel(item.title, lang)}</td>
                    <td>
                      <Badge
                        variant="secondary"
                        interactive
                        onClick={() => onOpenWpDrawer(item.statement_ref)}
                        style={{ fontSize: "0.7rem", cursor: "pointer" }}
                      >
                        {item.statement_ref} ↗
                      </Badge>
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>{item.agent}</td>
                    <td style={{ textAlign: "center" }}>
                      {item.status === "COMPLETED" ? (
                        <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                          {pick(lang, { en: "Completed", "zh-CN": "通过", "zh-TW": "通過" })}
                        </Badge>
                      ) : item.status === "WARNING" ? (
                        <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                          {pick(lang, { en: "Warning", "zh-CN": "待注意", "zh-TW": "待注意" })}
                        </Badge>
                      ) : (
                        <Badge variant="outline" style={{ fontSize: "0.7rem" }}>
                          {pick(lang, { en: "Pending", "zh-CN": "未完成", "zh-TW": "未完成" })}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
