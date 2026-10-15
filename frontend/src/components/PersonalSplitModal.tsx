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
    "創辦人家用光纖、手機話費與工作站開支"
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
      title="公私混用支出分攤 (Mixed Expense Apportionment)"
      description="一人公司 / 獨資企業支出分攤：按業務用途比例計入費用，私人部分記入股東往來"
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
            支出項目說明:
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
              含稅支出總額 ({currency}):
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
        <div style={{ backgroundColor: "#f4f4f5", padding: "0.75rem 1rem", borderRadius: "var(--radius)", fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#27272a" }}>會計分錄科目預覽:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>借：管理與營運費用 (業務扣抵 {businessPct}%):</span>
              <span className="tabular-nums" style={{ fontWeight: 600 }}>{currency} {bizAmt}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#b45309" }}>
              <span>借：股東往來款項 (私人比例 {100 - businessPct}%):</span>
              <span className="tabular-nums" style={{ fontWeight: 600 }}>{currency} {persAmt}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #d4d4d8", paddingTop: "0.25rem" }}>
              <span>貸：銀行存款 (支出總額):</span>
              <span className="tabular-nums" style={{ fontWeight: 600 }}>{currency} {gross.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="default" type="submit" disabled={submitting}>
            {submitting ? "提交中..." : "生成提案憑證"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
