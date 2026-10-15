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
  { code: "6100", name: "6100: 管理與營運費用 (Operating & Admin Expenses)" },
  { code: "6410", name: "6410: 折舊費用 (Depreciation Expense)" },
  { code: "7500", name: "7500: 所得稅費用 (Income Tax Expense)" },
  { code: "1420", name: "1420: 預付款項與留抵進項稅 (Prepayments & Input Tax)" },
  { code: "1650", name: "1650: 累計折舊 (Accumulated Depreciation)" },
  { code: "2110", name: "2110: 應付帳款與應計費用 (Accrued Expenses)" },
  { code: "2190", name: "2190: 股東/董事往來 (Director's Loan / Current Account)" },
  { code: "2210", name: "2210: 應交稅費 (Statutory Taxes Payable)" },
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
  const [memo, setMemo] = useState("月底外部審計及顧問費用提列");
  const [wpRef, setWpRef] = useState("W/P AA");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (debitCode === creditCode) {
      setErrorMsg("借方科目與貸方科目不可相同。");
      return;
    }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      setErrorMsg("請輸入大於零的有效金額。");
      return;
    }

    setErrorMsg(null);
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
    } catch (err: any) {
      setErrorMsg(err?.message || "調整分錄提交失敗，請檢查科目與金額。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="提列期末調整分錄 (Adjusting Journal Entry)"
      description="計入試算表期末調整欄 (AJE)，實時聯動三大報表"
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {errorMsg && (
          <div
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius)",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              fontSize: "0.85rem",
            }}
          >
            {errorMsg}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              借方科目 (Debit):
            </label>
            <select
              className="sh-select"
              value={debitCode}
              onChange={(e) => {
                setDebitCode(e.target.value);
                setErrorMsg(null);
              }}
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
              貸方科目 (Credit):
            </label>
            <select
              className="sh-select"
              value={creditCode}
              onChange={(e) => {
                setCreditCode(e.target.value);
                setErrorMsg(null);
              }}
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
              placeholder="0.0000"
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              關聯底稿索引 (W/P Ref):
            </label>
            <input
              type="text"
              className="sh-input"
              value={wpRef}
              onChange={(e) => setWpRef(e.target.value)}
              placeholder="W/P AA"
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
            placeholder="請輸入調整原因與依據..."
            required
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="default" type="submit" disabled={submitting}>
            {submitting ? "提交中..." : "確認過帳"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
