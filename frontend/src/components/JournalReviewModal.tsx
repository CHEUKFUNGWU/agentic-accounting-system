import React, { useState } from "react";
import { Badge, Button, Dialog } from "./ui/shadcn";

interface JournalReviewModalProps {
  open: boolean;
  currency: string;
  pendingJournals: any[];
  onClose: () => void;
  onReview: (journalId: string, action: "APPROVE" | "REJECT", reason?: string) => Promise<void>;
}

export const JournalReviewModal: React.FC<JournalReviewModalProps> = ({
  open,
  currency,
  pendingJournals,
  onClose,
  onReview,
}) => {
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleAction = async (journalId: string, action: "APPROVE" | "REJECT") => {
    setLoading(true);
    try {
      await onReview(journalId, action, rejectionReason);
      setRejectionReason("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Maker-Checker 職責分離 (SoD) 審批中心"
      description="嚴格執行制單者 (Maker) 與審核者 (Checker) 分離原則，通過後自動簽發 SHA-256 區塊防偽哈希"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {pendingJournals.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted-foreground)" }}>
            ✓ 當前無待審核分錄，所有日記帳均已完成審查過帳
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "400px", overflowY: "auto" }}>
            {pendingJournals.map((j) => (
              <div
                key={j.journal_id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  backgroundColor: "#fafafa",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <Badge variant="outline" style={{ fontSize: "0.7rem", marginRight: "0.4rem" }}>
                      {j.source_module}
                    </Badge>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{j.accounting_date}</span>
                  </div>
                  <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                    {j.status}
                  </Badge>
                </div>

                <div style={{ fontSize: "0.825rem", color: "var(--foreground)" }}>
                  {j.ai_reasoning_summary || "日常運營分錄提案"}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>
                    制單智能體: <strong>{j.created_by_principal_key}</strong>
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 700 }}>
                    {currency} {fmt(j.total_debit)}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px dashed var(--border)", paddingTop: "0.5rem" }}>
                  <Button
                    variant="secondary"
                    onClick={() => handleAction(j.journal_id, "REJECT")}
                    disabled={loading}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    ✕ 駁回
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => handleAction(j.journal_id, "APPROVE")}
                    disabled={loading}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  >
                    ✓ 批准並生成哈希鏈
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
