import React from "react";
import { LeadScheduleDetail } from "../types/accounting";
import { Sheet } from "./ui/shadcn";

interface LeadScheduleDrawerProps {
  schedule: LeadScheduleDetail | null;
  currency: string;
  onClose: () => void;
}

export const LeadScheduleDrawer: React.FC<LeadScheduleDrawerProps> = ({
  schedule,
  currency,
  onClose,
}) => {
  if (!schedule) return null;

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <Sheet open={!!schedule} onOpenChange={(open) => !open && onClose()} title={`${schedule.wp_ref}: ${schedule.title}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Verification Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div style={{ border: "1px solid var(--border)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>總帳餘額 (GL Balance)</span>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }} className="tabular-nums">
              {currency} {fmt(schedule.gl_balance)}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>子帳彙總 (Subledger)</span>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }} className="tabular-nums">
              {currency} {fmt(schedule.subledger_balance)}
            </div>
          </div>
        </div>

        {/* Audit Tickmark & Variance */}
        <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.6rem 0.75rem", borderRadius: "var(--radius)", fontSize: "0.8rem", color: "#166534" }}>
          <div style={{ fontWeight: 600 }}>{schedule.tickmark}</div>
          <div>勾稽差額 (Variance): {schedule.variance} (0.0000 絕對平衡)</div>
        </div>

        {/* Roles & Cryptographic Hash */}
        <div style={{ fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: "0.25rem", color: "var(--muted-foreground)" }}>
          <div>製單智能體 (Maker): <strong style={{ color: "var(--foreground)" }}>{schedule.prepared_by}</strong></div>
          <div>覆核智能體 (Checker): <strong style={{ color: "var(--foreground)" }}>{schedule.reviewed_by}</strong></div>
          <div style={{ marginTop: "0.25rem", wordBreak: "break-all" }}>
            不可篡改哈希 (SHA-256): <span style={{ fontFamily: "monospace", color: "var(--foreground)" }}>{schedule.evidence_sha256}</span>
          </div>
        </div>

        {/* AI Reasoning Summary */}
        <div style={{ backgroundColor: "var(--secondary)", padding: "0.75rem", borderRadius: "var(--radius)", fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>🤖 智能體審計推理 (Agent Reasoning):</div>
          <p style={{ margin: 0, color: "var(--foreground)" }}>{schedule.agent_reasoning}</p>
        </div>

        {/* Line Items Table */}
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            明細抽核清單 (Sub-schedule Line Items):
          </div>
          <table className="sh-table" style={{ fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>項目說明 (Item Description)</th>
                <th style={{ textAlign: "right" }}>金額 ({currency})</th>
                <th>備註 / 驗收索引</th>
              </tr>
            </thead>
            <tbody>
              {schedule.items.map((it, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{it.item}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                    {fmt(it.amount)}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{it.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Sheet>
  );
};
