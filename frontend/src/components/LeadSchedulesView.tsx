import React from "react";
import { LeadScheduleDetail } from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";

interface LeadSchedulesViewProps {
  currency: string;
  schedules: Record<string, LeadScheduleDetail>;
  onOpenWpDrawer: (wpRef: string) => void;
}

export const LeadSchedulesView: React.FC<LeadSchedulesViewProps> = ({
  currency,
  schedules,
  onOpenWpDrawer,
}) => {
  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const scheduleKeys = [
    "W/P A",
    "W/P B",
    "W/P C",
    "W/P DD",
    "W/P F",
    "W/P AA",
    "W/P CC",
    "W/P EQ",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
            Lead Schedules (明細底稿庫 W/P A ~ W/P EQ)
          </h2>
          <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
            對應 CPA 審計明細抽核標準底稿 • 附帶自主智能體 Reasoning 與 SHA-256 不可篡改憑證索引
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1rem" }}>
        {scheduleKeys.map((key) => {
          const sched = schedules[key];
          if (!sched) return null;
          const isBalanced = parseFloat(sched.variance) === 0;

          return (
            <Card key={key} className="sh-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <CardHeader style={{ paddingBottom: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <Badge variant="default" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    {sched.wp_ref}
                  </Badge>
                  {isBalanced ? (
                    <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                      ✓ 總分帳勾稽相符 (Variance 0.00)
                    </Badge>
                  ) : (
                    <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                      ⚠ 存在差額 ({sched.variance})
                    </Badge>
                  )}
                </div>
                <CardTitle style={{ fontSize: "0.95rem", marginTop: "0.35rem" }}>
                  {sched.title}
                </CardTitle>
              </CardHeader>

              <CardContent style={{ fontSize: "0.825rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed var(--border)", paddingBottom: "0.35rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>總帳餘額 (GL Balance):</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>
                    {currency} {fmt(sched.gl_balance)}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed var(--border)", paddingBottom: "0.35rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>子帳彙總 (Subledger):</span>
                  <span className="tabular-nums">
                    {currency} {fmt(sched.subledger_balance)}
                  </span>
                </div>

                <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                  <div>編製者 (Maker): <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{sched.prepared_by}</span></div>
                  <div>審核者 (Checker): <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{sched.reviewed_by}</span></div>
                </div>

                <div style={{ backgroundColor: "var(--secondary)", padding: "0.4rem 0.6rem", borderRadius: "4px", fontSize: "0.75rem" }}>
                  <div style={{ fontWeight: 500, color: "#16a34a", marginBottom: "0.2rem" }}>
                    {sched.tickmark}
                  </div>
                  <div style={{ color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    SHA-256: {sched.evidence_sha256}
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => onOpenWpDrawer(sched.wp_ref)}
                  style={{ width: "100%", fontSize: "0.8rem", marginTop: "0.5rem" }}
                >
                  穿透查看明細與凭據 ↗
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
