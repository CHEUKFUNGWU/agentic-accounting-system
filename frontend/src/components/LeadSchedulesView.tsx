import React from "react";
import { LeadScheduleDetail } from "../types/accounting";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n, cleanLabel } from "../i18n";

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
  const { t, lang } = useI18n();

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

          return (
            <Card key={key} className="sh-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <CardHeader style={{ paddingBottom: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <Badge variant="default" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                    {sched.wp_ref}
                  </Badge>
                  {isBalanced ? (
                    <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                      {t.wp_balanced_status}
                    </Badge>
                  ) : (
                    <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                      {t.wp_variance}: {sched.variance}
                    </Badge>
                  )}
                </div>
                <CardTitle style={{ fontSize: "0.95rem", marginTop: "0.35rem", fontWeight: 600 }}>
                  {cleanLabel(sched.title, lang)}
                </CardTitle>
              </CardHeader>

              <CardContent style={{ fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed var(--border)", paddingBottom: "0.35rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>{t.wp_gl_balance}:</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>
                    {currency} {fmt(sched.gl_balance)}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed var(--border)", paddingBottom: "0.35rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>{t.wp_subledger_balance}:</span>
                  <span className="tabular-nums">
                    {currency} {fmt(sched.subledger_balance)}
                  </span>
                </div>

                <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                  <div>{t.wp_prepared_by}: <span style={{ color: "var(--foreground)" }}>{sched.prepared_by}</span></div>
                  <div>{t.wp_reviewed_by}: <span style={{ color: "var(--foreground)" }}>{sched.reviewed_by}</span></div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => onOpenWpDrawer(sched.wp_ref)}
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
