import React from "react";
import { LeadScheduleDetail } from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n } from "../i18n";
import { fmtAmount, hasAmount } from "../lib/format";
import { scheduleTitle } from "../lib/labels";

interface DetailSchedulesViewProps {
  currency: string;
  schedules: Record<string, LeadScheduleDetail>;
  onOpenWpDrawer: (statementRef: string) => void;
}

export const DetailSchedulesView: React.FC<DetailSchedulesViewProps> = ({
  currency,
  schedules,
  onOpenWpDrawer,
}) => {
  const { t, lang } = useI18n();

  const scheduleKeys = [
    "A",
    "B",
    "C",
    "DD",
    "F",
    "AA",
    "CC",
    "EQ",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
          {t.wp_title}
        </h2>
        <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
          {t.wp_subtitle}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
        {scheduleKeys.map((key) => {
          const sched = schedules[key];
          if (!sched) return null;
          const isBalanced = parseFloat(sched.variance) === 0;
          const prepared = hasAmount(sched.subledger_balance);

          return (
            <Card key={key} className="sh-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <CardHeader style={{ paddingBottom: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <Badge variant="default" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                    {sched.statement_ref}
                  </Badge>
                  {isBalanced ? (
                    <Badge variant={prepared ? "success" : "warning"} style={{ fontSize: "0.7rem" }}>
                      {prepared ? t.wp_balanced_status : t.wp_status_not_performed}
                    </Badge>
                  ) : (
                    <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                      {t.wp_variance}: {sched.variance}
                    </Badge>
                  )}
                </div>
                <CardTitle style={{ fontSize: "0.95rem", marginTop: "0.35rem", fontWeight: 600 }}>
                  {scheduleTitle(sched.statement_ref, sched.title, lang)}
                </CardTitle>
              </CardHeader>

              <CardContent style={{ fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed var(--border)", paddingBottom: "0.35rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>{t.wp_gl_balance}:</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>
                    {hasAmount(sched.gl_balance) ? `${currency} ${fmtAmount(sched.gl_balance)}` : t.wp_not_performed}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed var(--border)", paddingBottom: "0.35rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>{t.wp_subledger_balance}:</span>
                  <span className="tabular-nums">
                    {hasAmount(sched.subledger_balance) ? `${currency} ${fmtAmount(sched.subledger_balance)}` : "—"}
                  </span>
                </div>

                <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                  <div>{t.wp_prepared_by}: <span style={{ color: "var(--foreground)" }}>{sched.prepared_by}</span></div>
                  <div>{t.wp_reviewed_by}: <span style={{ color: "var(--foreground)" }}>{sched.reviewed_by}</span></div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => onOpenWpDrawer(sched.statement_ref)}
                  style={{ width: "100%", fontSize: "0.8rem", marginTop: "0.5rem" }}
                >
                  {t.wp_view_detail} ↗
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
