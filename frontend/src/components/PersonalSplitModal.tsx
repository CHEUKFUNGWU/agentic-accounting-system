import React, { useState } from "react";
import { Button, Dialog } from "./ui/shadcn";
import { useI18n } from "../i18n";
import { fmtAmount, parseAmount, sanitizeAmountInput, toAmountInput } from "../lib/format";

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
  const { lang, t } = useI18n();
  const [description, setDescription] = useState(
    lang === "en"
      ? "Founder broadband, mobile phone, and workstation utility expense"
      : lang === "zh-CN"
      ? "创办人居家光纤、手机话费与工作站开支"
      : "創辦人家用光纖、手機話費與工作站開支"
  );
  const [grossAmount, setGrossAmount] = useState(() => toAmountInput("2200.00"));
  const [businessPct, setBusinessPct] = useState(70);
  const [submitting, setSubmitting] = useState(false);

  const gross = parseAmount(grossAmount) ?? 0;
  const bizAmt = gross * (businessPct / 100);
  const persAmt = gross - bizAmt;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        description,
        grossAmount: toAmountInput(grossAmount),
        businessPct,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = lang === "en"
    ? "Mixed Expense Apportionment"
    : lang === "zh-CN"
    ? "公私混用支出分摊"
    : "公私混用支出分攤";

  const modalDesc = lang === "en"
    ? "Split dual-purpose expenditure between deductible business expenses and shareholder loan"
    : lang === "zh-CN"
    ? "一人公司 / 独资企业支出分摊：按业务用途比例计入费用，私人部分计入股东往来"
    : "一人公司 / 獨資企業支出分攤：按業務用途比例計入費用，私人部分記入股東往來";

  const descLabel = lang === "en" ? "Expense Description:" : lang === "zh-CN" ? "支出项目说明:" : "支出項目說明:";
  const grossLabel = lang === "en" ? `Gross Amount (${currency}):` : lang === "zh-CN" ? `含税支出总额 (${currency}):` : `含稅支出總額 (${currency}):`;
  const ratioLabel = lang === "en" ? "Business Apportionment:" : lang === "zh-CN" ? "业务扣除比例:" : "業務抵扣比例:";
  const previewTitle = lang === "en" ? "Journal Entry Preview:" : lang === "zh-CN" ? "会计分录科目预览:" : "會計分錄科目預覽:";
  const submitLabel = submitting
    ? lang === "en" ? "Generating..." : "提交中..."
    : lang === "en" ? "Generate Proposed Entry" : lang === "zh-CN" ? "生成提案凭证" : "生成提案憑證";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={modalTitle}
      description={modalDesc}
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
            {descLabel}
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
              {grossLabel}
            </label>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="sh-input tabular-nums"
              value={grossAmount}
              onChange={(e) => setGrossAmount(sanitizeAmountInput(e.target.value))}
              onBlur={() => setGrossAmount((current) => toAmountInput(current))}
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              {ratioLabel} <strong>{businessPct}%</strong>
            </label>
            <input
              type="range"
              className="sh-range"
              min="0"
              max="100"
              step="5"
              value={businessPct}
              onChange={(e) => setBusinessPct(parseInt(e.target.value, 10))}
              aria-label={ratioLabel}
              style={{ width: "100%", marginTop: "0.4rem" }}
            />
          </div>
        </div>

        {/* Calculation Preview */}
        <div style={{ backgroundColor: "#f4f4f5", padding: "0.75rem 1rem", borderRadius: "var(--radius)", fontSize: "0.8rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#27272a" }}>{previewTitle}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {lang === "en" ? `Dr: Operating & Admin Expenses (${businessPct}%):` : lang === "zh-CN" ? `借：管理与营运费用 (业务抵扣 ${businessPct}%):` : `借：管理與營運費用 (業務扣抵 ${businessPct}%):`}
              </span>
              <span className="tabular-nums" style={{ fontWeight: 600 }}>{currency} {fmtAmount(bizAmt)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#b45309" }}>
              <span>
                {lang === "en" ? `Dr: Shareholder Loan / Current Account (${100 - businessPct}%):` : lang === "zh-CN" ? `借：股东往来款项 (私人比例 ${100 - businessPct}%):` : `借：股東往來款項 (私人比例 ${100 - businessPct}%):`}
              </span>
              <span className="tabular-nums" style={{ fontWeight: 600 }}>{currency} {fmtAmount(persAmt)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #d4d4d8", paddingTop: "0.25rem" }}>
              <span>
                {lang === "en" ? "Cr: Cash & Bank (Total):" : lang === "zh-CN" ? "贷：银行存款 (支出总额):" : "貸：銀行存款 (支出總額):"}
              </span>
              <span className="tabular-nums" style={{ fontWeight: 600 }}>{currency} {fmtAmount(gross)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            {t.cancel}
          </Button>
          <Button variant="default" type="submit" disabled={submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
