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
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleApprove = async (journalId: string) => {
    setLoading(true);
    try {
      await onReview(journalId, "APPROVE");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (journalId: string) => {
    if (!rejectionReason.trim()) {
      alert("請輸入退回理由。");
      return;
    }
    setLoading(true);
    try {
      await onReview(journalId, "REJECT", rejectionReason.trim());
      setRejectId(null);
      setRejectionReason("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="待審核分錄覆核 (Journal Review)"
      description="審核並過帳會計憑證分錄，落實製單與覆核權責分離"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {pendingJournals.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--muted-foreground)" }}>
            當前無待審核憑證，所有日記帳分錄均已處理完畢。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "420px", overflowY: "auto" }}>
            {pendingJournals.map((j) => (
              <div
                key={j.journal_id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  backgroundColor: "#fafafa",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <Badge variant="outline" style={{ fontSize: "0.7rem" }}>
                      {j.source_module}
                    </Badge>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{j.accounting_date}</span>
                  </div>
                  <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                    {j.status}
                  </Badge>
                </div>

                <div style={{ fontSize: "0.85rem", color: "var(--foreground)" }}>
                  {j.ai_reasoning_summary || "日常營運分錄提案"}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  <span>
                    製單人: <strong style={{ color: "var(--foreground)" }}>{j.created_by_principal_key}</strong>
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 700, color: "var(--foreground)" }}>
                    {currency} {fmt(j.total_debit)}
                  </span>
                </div>

                {rejectId === j.journal_id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                    <input
                      type="text"
                      className="sh-input"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="請輸入退回理由說明..."
                      autoFocus
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                      <Button variant="ghost" onClick={() => setRejectId(null)} disabled={loading}>
                        取消
                      </Button>
                      <Button
                        variant="default"
                        style={{ backgroundColor: "#dc2626", color: "#fff" }}
                        onClick={() => handleReject(j.journal_id)}
                        disabled={loading || !rejectionReason.trim()}
                      >
                        確認退回
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px dashed var(--border)", paddingTop: "0.5rem" }}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setRejectId(j.journal_id);
                        setRejectionReason("");
                      }}
                      disabled={loading}
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                    >
                      退回
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => handleApprove(j.journal_id)}
                      disabled={loading}
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                    >
                      核准並過帳
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
          <Button variant="ghost" onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
