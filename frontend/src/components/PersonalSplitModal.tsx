import React, { useState } from "react";
import { Button, Dialog } from "./ui/shadcn";

interface PersonalSplitModalProps {
  open: boolean;
  currency: string;
  onClose: () => void;
  onSubmit: (params: {
    description: string;
    grossAmount: string;
    businessPct: number;
  }) => Promise<void>;
}

export const PersonalSplitModal: React.FC<PersonalSplitModalProps> = ({
  open,
  currency,
  onClose,
  onSubmit,
}) => {
  const [description, setDescription] = useState(
    "Founder Home Office Fibre, Mobile & AI Cloud Workstation"
  );
  const [grossAmount, setGrossAmount] = useState("2200.0000");
  const [businessPct, setBusinessPct] = useState(70);
  const [submitting, setSubmitting] = useState(false);

  const gross = parseFloat(grossAmount) || 0;
  const bizAmt = (gross * (businessPct / 100)).toFixed(2);
  const persAmt = (gross - parseFloat(bizAmt)).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        description,
        grossAmount,
        businessPct,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="公私混用支出自動拆分 (Mixed Expense Apportionment)"
      description="一人公司 / 獨資東主專用：自動計算業務抵扣比例與私人佔款，嚴防資金混同風險"
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
            支出項目說明 (Description):
          </label>
          <input
            type="text"
            className="sh-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              含稅付款總額 ({currency}):
            </label>
            <input
              type="text"
              className="sh-input"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              業務抵扣比例: <strong>{businessPct}%</strong>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={businessPct}
              onChange={(e) => setBusinessPct(parseInt(e.target.value, 10))}
              style={{ width: "100%", marginTop: "0.4rem" }}
            />
          </div>
        </div>

        {/* Calculation Preview */}
        <div style={{ backgroundColor: "#f4f4f5", padding: "0.75rem", borderRadius: "var(--radius)", fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>自動拆帳預覽 (Ledger Routing):</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
            <span>🏢 業務可抵扣部分 ({businessPct}%):</span>
            <span style={{ fontWeight: 600, color: "#16a34a" }} className="tabular-nums">
              {currency} {bizAmt} (計入費用與進項稅抵扣)
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>🏠 創辦人私人部分 ({100 - businessPct}%):</span>
            <span style={{ fontWeight: 600, color: "#d97706" }} className="tabular-nums">
              {currency} {persAmt} (路由至 2190 股東往來 / W/P DD)
            </span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="default" type="submit" disabled={submitting}>
            {submitting ? "分錄處理中..." : "確認拆分並過帳至 W/P DD"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
