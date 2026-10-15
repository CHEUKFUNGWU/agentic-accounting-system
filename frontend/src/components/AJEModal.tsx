import React, { useState } from "react";
import { Button, Dialog } from "./ui/shadcn";

interface AJEModalProps {
  open: boolean;
  currency: string;
  onClose: () => void;
  onSubmit: (params: {
    debitAccountCode: string;
    creditAccountCode: string;
    amount: string;
    memo: string;
    wpRef: string;
  }) => Promise<void>;
}

const ACCOUNT_OPTIONS = [
  { code: "6100", name: "6100: Operating & Admin Expenses (管理費用)" },
  { code: "6410", name: "6410: Depreciation Expense (折舊費用)" },
  { code: "7500", name: "7500: Income Tax Expense (所得稅費用)" },
  { code: "1420", name: "1420: Prepayments & Input VAT/GST (預付及進項稅)" },
  { code: "1650", name: "1650: Accumulated Depreciation (累計折舊)" },
  { code: "2110", name: "2110: Accounts Payable & Accrued Expenses (應計費用)" },
  { code: "2190", name: "2190: Director's Loan / Current Account (股東往來)" },
  { code: "2210", name: "2210: Statutory Taxes Payable (應交稅費)" },
];

export const AJEModal: React.FC<AJEModalProps> = ({
  open,
  currency,
  onClose,
  onSubmit,
}) => {
  const [debitCode, setDebitCode] = useState("6100");
  const [creditCode, setCreditCode] = useState("2110");
  const [amount, setAmount] = useState("1800.0000");
  const [memo, setMemo] = useState("Month-end external CPA advisory & audit fee accrual");
  const [wpRef, setWpRef] = useState("W/P AA");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (debitCode === creditCode) {
      alert("借貸科目不可相同！");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        debitAccountCode: debitCode,
        creditAccountCode: creditCode,
        amount,
        memo,
        wpRef,
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
      title="提列月結調整分錄 (Month-End Adjusting Journal Entry)"
      description="由關帳智能體或執業會計師直接計入 ETB 調整欄，實時聯動三大報表"
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              借方科目 (Debit Account):
            </label>
            <select
              className="sh-select"
              value={debitCode}
              onChange={(e) => setDebitCode(e.target.value)}
              required
            >
              {ACCOUNT_OPTIONS.map((acc) => (
                <option key={`dr-${acc.code}`} value={acc.code}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              貸方科目 (Credit Account):
            </label>
            <select
              className="sh-select"
              value={creditCode}
              onChange={(e) => setCreditCode(e.target.value)}
              required
            >
              {ACCOUNT_OPTIONS.map((acc) => (
                <option key={`cr-${acc.code}`} value={acc.code}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              調整金額 ({currency}):
            </label>
            <input
              type="text"
              className="sh-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              明細底稿索引 (W/P Ref):
            </label>
            <input
              type="text"
              className="sh-input"
              value={wpRef}
              onChange={(e) => setWpRef(e.target.value)}
              placeholder="e.g. W/P AA, W/P F"
              required
            />
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
            調整摘要說明 (Memo):
          </label>
          <input
            type="text"
            className="sh-input"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            required
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="default" type="submit" disabled={submitting}>
            {submitting ? "過帳中..." : "確認過帳至 ETB 調整欄"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
