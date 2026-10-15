import React from "react";
import { CloseChecklistItem, StatutoryTaxWorkpaper } from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Progress } from "./ui/shadcn";

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
  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const completedCount = checklist.filter((item) => item.status === "COMPLETED").length;
  const progressPct = Math.round((completedCount / checklist.length) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Safe-to-Spend Operating Cash Vault */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
        <Card style={{ backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }}>
          <CardHeader style={{ paddingBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.8rem", color: "#1e40af", fontWeight: 600 }}>
              🛡 安全可支用運營現金 (Safe-to-Spend Operating Cash)
            </span>
          </CardHeader>
          <CardContent>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#1d4ed8" }} className="tabular-nums">
              {currency} {fmt(taxWorkpaper.safe_to_spend_operating_cash)}
            </div>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#3b82f6" }}>
              = 銀行總餘額 ({fmt(taxWorkpaper.ending_cash_balance)}) 減去 法定應預留稅款 ({fmt(taxWorkpaper.recommended_tax_vault_reserve)})
            </p>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: "#fefce8", borderColor: "#fef08a" }}>
          <CardHeader style={{ paddingBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.8rem", color: "#854d0e", fontWeight: 600 }}>
              ⚖ 法定稅務儲備小金庫 (Mandatory Tax Vault Reserve)
            </span>
          </CardHeader>
          <CardContent>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#a16207" }} className="tabular-nums">
              {currency} {fmt(taxWorkpaper.total_statutory_tax_payable)}
            </div>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#ca8a04" }}>
              包含增值稅/消費稅、預扣稅 (WHT) 及所得稅準備，嚴禁創辦人抽資或私自挪用
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Statutory Tax Return Boxes */}
      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.5rem", display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <CardTitle style={{ fontSize: "1.05rem" }}>
              W/P CC: 法定稅務申報底稿 ({taxWorkpaper.return_form_name})
            </CardTitle>
            <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              適用稅收優惠政策：{taxWorkpaper.relief_applied}
            </span>
          </div>
          <Badge
            variant="outline"
            interactive
            onClick={() => onOpenWpDrawer("W/P CC")}
            style={{ fontSize: "0.75rem", cursor: "pointer" }}
          >
            W/P CC 穿透明細 ↗
          </Badge>
        </CardHeader>
        <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th>申報格位 / 稅務項目 (Statutory Tax Box)</th>
                  <th style={{ textAlign: "right" }}>申報金額 ({currency})</th>
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
        <CardHeader style={{ paddingBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <div>
              <CardTitle style={{ fontSize: "1.05rem" }}>
                月結關帳與底稿健康度檢核清單 (Month-End Close Checklist)
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                自主智能體團隊與會計師協同把關 • 當前完成度：{completedCount} / {checklist.length} ({progressPct}%)
              </span>
            </div>
            {packStatus !== "CPA_SIGNED_LOCKED" && (
              <Button variant="default" onClick={onLockPack} style={{ fontSize: "0.825rem" }}>
                ✓ CPA 簽核封存
              </Button>
            )}
          </div>
          <Progress value={progressPct} />
        </CardHeader>

        <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "50px" }}>步驟</th>
                  <th>關帳檢核項目 (Closing Procedure)</th>
                  <th style={{ width: "90px" }}>底稿索引</th>
                  <th style={{ width: "180px" }}>負責智能體 / 會計師</th>
                  <th style={{ width: "90px", textAlign: "center" }}>檢核狀態</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((item) => (
                  <tr key={item.step}>
                    <td style={{ fontWeight: 600 }}>{item.step}</td>
                    <td>{item.title}</td>
                    <td>
                      <Badge
                        variant="secondary"
                        interactive
                        onClick={() => onOpenWpDrawer(item.wp_ref)}
                        style={{ fontSize: "0.7rem", cursor: "pointer" }}
                      >
                        {item.wp_ref}
                      </Badge>
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{item.agent}</td>
                    <td style={{ textAlign: "center" }}>
                      {item.status === "COMPLETED" ? (
                        <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                          ✓ 通過
                        </Badge>
                      ) : item.status === "WARNING" ? (
                        <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                          ⚠ 警告
                        </Badge>
                      ) : (
                        <Badge variant="outline" style={{ fontSize: "0.7rem" }}>
                          待處理
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
