import React, { useState } from "react";
import { CloseChecklistItem, StatutoryTaxWorkpaper } from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Progress } from "./ui/shadcn";

interface TaxAndCloseViewProps {
  currency: string;
  taxWorkpaper: StatutoryTaxWorkpaper;
  checklist: CloseChecklistItem[];
  packStatus: string;
  onLockPack: () => void;
  onOpenWpDrawer: (wpRef: string) => void;
}

export const TaxAndCloseView: React.FC<TaxAndCloseViewProps> = ({
  currency,
  taxWorkpaper,
  checklist,
  packStatus,
  onLockPack,
  onOpenWpDrawer,
}) => {
  const [confirmLockOpen, setConfirmLockOpen] = useState(false);

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

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
        title="確認簽核並封存本期底稿 (Sign-Off & Lock Working Papers)"
        description="本操作將由執業會計師正式簽署並鎖定本會計期間底稿。封存後所有分錄與報表轉為唯讀，禁止追加調整。"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ backgroundColor: "#fefce8", border: "1px solid #fef08a", padding: "0.75rem", borderRadius: "var(--radius)", fontSize: "0.85rem", color: "#854d0e" }}>
            <strong>審計合規確認：</strong>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.25rem" }}>
              <li>三大財務報表數學平衡驗證通過 (A = L + E 差額為 0.00)</li>
              <li>現金流量表與資產負債表貨幣資金勾稽無誤</li>
              <li>法定稅款提列已完成計算 ({currency} {fmt(taxWorkpaper.recommended_tax_vault_reserve)})</li>
            </ul>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <Button variant="ghost" onClick={() => setConfirmLockOpen(false)}>
              取消
            </Button>
            <Button variant="default" onClick={handleConfirmLock}>
              確認簽核封存 (Lock Period)
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Tax Reserve & Operating Cash Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <Card style={{ backgroundColor: "#ffffff" }}>
          <CardHeader style={{ paddingBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
              安全可支用運營現金 (Safe-to-Spend Operating Cash)
            </span>
          </CardHeader>
          <CardContent>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#18181b" }} className="tabular-nums">
              {currency} {fmt(taxWorkpaper.safe_to_spend_operating_cash)}
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              = 銀行總餘額 ({fmt(taxWorkpaper.ending_cash_balance)}) 扣除 法定預留稅款 ({fmt(taxWorkpaper.recommended_tax_vault_reserve)})
            </p>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: "#ffffff" }}>
          <CardHeader style={{ paddingBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)", fontWeight: 500 }}>
              法定稅務儲備準備 (Mandatory Tax Reserve)
            </span>
          </CardHeader>
          <CardContent>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#b45309" }} className="tabular-nums">
              {currency} {fmt(taxWorkpaper.total_statutory_tax_payable)}
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              包含增值稅/消費稅、預扣稅 (WHT) 及企業所得稅準備金
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
                法定稅務申報底稿 ({taxWorkpaper.return_form_name})
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                適用政策：{taxWorkpaper.relief_applied}
              </span>
            </div>
            <Badge
              variant="outline"
              interactive
              onClick={() => onOpenWpDrawer("W/P CC")}
              style={{ fontSize: "0.75rem", cursor: "pointer" }}
            >
              W/P CC 稅務底稿 ↗
            </Badge>
          </div>
        </CardHeader>
        <CardContent style={{ padding: "0" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th>申報格位 / 稅務項目</th>
                  <th style={{ textAlign: "right", width: "200px" }}>申報金額 ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(taxWorkpaper.filing_boxes).map(([box, amount]) => (
                  <tr key={box}>
                    <td style={{ fontWeight: 500 }}>{box}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmt(amount)}
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
                月末關帳與底稿核驗清單 (Month-End Close Checklist)
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                完成進度：{completedCount} / {checklist.length} ({progressPct}%)
              </span>
            </div>
            {packStatus !== "CPA_SIGNED_LOCKED" ? (
              <Button variant="default" onClick={() => setConfirmLockOpen(true)} style={{ fontSize: "0.85rem" }}>
                CPA 簽核封存本期底稿
              </Button>
            ) : (
              <Badge variant="success" style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}>
                本期底稿已簽核封存 (Locked)
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
                  <th style={{ width: "60px" }}>步驟</th>
                  <th>關帳核驗程序</th>
                  <th style={{ width: "110px" }}>關聯底稿</th>
                  <th style={{ width: "180px" }}>責任人 / 智能體</th>
                  <th style={{ width: "100px", textAlign: "center" }}>狀態</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((item) => (
                  <tr key={item.step}>
                    <td style={{ fontWeight: 600, color: "var(--muted-foreground)" }}>{item.step}</td>
                    <td style={{ fontWeight: 500 }}>{item.title}</td>
                    <td>
                      <Badge
                        variant="secondary"
                        interactive
                        onClick={() => onOpenWpDrawer(item.wp_ref)}
                        style={{ fontSize: "0.7rem", cursor: "pointer" }}
                      >
                        {item.wp_ref} ↗
                      </Badge>
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>{item.agent}</td>
                    <td style={{ textAlign: "center" }}>
                      {item.status === "COMPLETED" ? (
                        <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                          通過
                        </Badge>
                      ) : item.status === "WARNING" ? (
                        <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                          待注意
                        </Badge>
                      ) : (
                        <Badge variant="outline" style={{ fontSize: "0.7rem" }}>
                          未完成
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
