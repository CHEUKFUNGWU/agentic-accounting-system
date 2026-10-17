import React from "react";
import { LeadScheduleDetail } from "../types/accounting";
import { Sheet } from "./ui/shadcn";
import { useI18n } from "../i18n";
import { fmtAmount, hasAmount } from "../lib/format";
import { localizeLabel, scheduleTitle } from "../lib/labels";

interface DetailScheduleDrawerProps {
  schedule: LeadScheduleDetail | null;
  currency: string;
  onClose: () => void;
}

export const DetailScheduleDrawer: React.FC<DetailScheduleDrawerProps> = ({
  schedule,
  currency,
  onClose,
}) => {
  const { t, lang } = useI18n();

  if (!schedule) return null;

  const isBalanced = parseFloat(schedule.variance) === 0;
  const hasSubledger = hasAmount(schedule.subledger_balance);
  const hasHash = Boolean(schedule.evidence_sha256 && schedule.evidence_sha256.trim());

  return (
    <Sheet
      open={!!schedule}
      onOpenChange={(open) => !open && onClose()}
      title={`${schedule.statement_ref}: ${scheduleTitle(schedule.statement_ref, schedule.title, lang)}`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Verification Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div style={{ border: "1px solid var(--border)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{t.wp_gl_balance}</span>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }} className="tabular-nums">
              {currency} {fmtAmount(schedule.gl_balance)}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{t.wp_subledger_balance}</span>
            <div
              style={{ fontSize: hasSubledger ? "1.1rem" : "0.85rem", fontWeight: hasSubledger ? 600 : 500, color: hasSubledger ? undefined : "var(--muted-foreground)" }}
              className={hasSubledger ? "tabular-nums" : undefined}
            >
              {hasSubledger ? `${currency} ${fmtAmount(schedule.subledger_balance)}` : t.wp_not_performed}
            </div>
          </div>
        </div>

        {/* Audit Tickmark & Variance */}
        <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.6rem 0.75rem", borderRadius: "var(--radius)", fontSize: "0.8rem", color: "#166534" }}>
          <div style={{ fontWeight: 600 }}>{localizeLabel(schedule.note, lang)}</div>
          <div>
            {isBalanced ? t.wp_variance_tied : `${t.wp_variance}: ${schedule.variance}`}
          </div>
        </div>

        {/* Roles & Verification Hash */}
        <div style={{ fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: "0.25rem", color: "var(--muted-foreground)" }}>
          <div>{t.wp_prepared_by}: <strong style={{ color: "var(--foreground)" }}>{schedule.prepared_by}</strong></div>
          <div>{t.wp_reviewed_by}: <strong style={{ color: "var(--foreground)" }}>{schedule.reviewed_by}</strong></div>
          {hasHash && (
            <div style={{ marginTop: "0.25rem", wordBreak: "break-all" }}>
              {t.wp_evidence_hash} (SHA-256):{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "var(--foreground)", fontSize: "0.75rem" }}>
                {schedule.evidence_sha256}
              </span>
            </div>
          )}
        </div>

        {/* Audit Notes */}
        <div style={{ backgroundColor: "var(--secondary)", padding: "0.75rem", borderRadius: "var(--radius)", fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{t.wp_notes_title}:</div>
          <p style={{ margin: 0, color: "var(--foreground)" }}>{localizeLabel(schedule.agent_reasoning, lang)}</p>
        </div>

        {/* Line Items Table */}
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            {t.wp_items_title}:
          </div>
          <table className="sh-table" style={{ fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>{t.wp_col_desc}</th>
                <th style={{ textAlign: "right" }}>{t.wp_col_amount} ({currency})</th>
                <th>{t.wp_col_notes}</th>
              </tr>
            </thead>
            <tbody>
              {schedule.items.map((it, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{localizeLabel(it.item, lang)}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                    {fmtAmount(it.amount)}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{localizeLabel(it.note, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Sheet>
  );
};
