import React, { useState } from "react";
import { Button, Dialog } from "./ui/shadcn";
import { useI18n } from "../i18n";

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
  { code: "6100", en: "6100: Operating & Admin Expenses", zhCN: "6100: 管理与营运费用", zhTW: "6100: 管理與營運費用" },
  { code: "6410", en: "6410: Depreciation Expense", zhCN: "6410: 折旧费用", zhTW: "6410: 折舊費用" },
  { code: "7500", en: "7500: Income Tax Expense", zhCN: "7500: 所得税费用", zhTW: "7500: 所得稅費用" },
  { code: "1420", en: "1420: Prepayments & Input Tax", zhCN: "1420: 预付款项与留抵进项税", zhTW: "1420: 預付款項與留抵進項稅額" },
  { code: "1650", en: "1650: Accumulated Depreciation", zhCN: "1650: 累计折旧", zhTW: "1650: 累計折舊" },
  { code: "2110", en: "2110: Accrued Expenses & AP", zhCN: "2110: 应付账款与应计费用", zhTW: "2110: 應付賬款與應計費用" },
  { code: "2190", en: "2190: Director's Current Account", zhCN: "2190: 股东/董事往来", zhTW: "2190: 股東/董事往來" },
  { code: "2210", en: "2210: Statutory Taxes Payable", zhCN: "2210: 应交税费", zhTW: "2210: 應交稅金" },
];

export const AJEModal: React.FC<AJEModalProps> = ({
  open,
  currency,
  onClose,
  onSubmit,
}) => {
  const { lang, t } = useI18n();
  const [debitCode, setDebitCode] = useState("6100");
  const [creditCode, setCreditCode] = useState("2110");
  const [amount, setAmount] = useState("1800.0000");
  const [memo, setMemo] = useState(
    lang === "en"
      ? "Accrual of month-end audit and legal consultancy expenses"
      : lang === "zh-CN"
      ? "月底外部审计及顾问费用提列"
      : "月底外部審計及顧問費用提列"
  );
  const [wpRef, setWpRef] = useState("W/P AA");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (debitCode === creditCode) {
      setErrorMsg(
        lang === "en"
          ? "Debit and credit accounts must be different."
          : lang === "zh-CN"
          ? "借方科目与贷方科目不可相同。"
          : "借方科目與貸方科目不可相同。"
      );
      return;
    }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      setErrorMsg(
        lang === "en"
          ? "Please enter a valid amount greater than zero."
          : lang === "zh-CN"
          ? "请输入大于零的有效金额。"
          : "請輸入大於零的有效金額。"
      );
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
      setErrorMsg(
        err?.message ||
          (lang === "en"
            ? "Failed to submit adjusting entry."
            : lang === "zh-CN"
            ? "调整分录提交失败，请检查科目与金额。"
            : "調整分錄提交失敗，請檢查科目與金額。")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = lang === "en" ? "Post Adjusting Entry (AJE)" : lang === "zh-CN" ? "提列期末调整分录" : "提列期末調整分錄";
  const modalDesc = lang === "en"
    ? "Post adjustment to ETB column and update financial statements"
    : lang === "zh-CN"
    ? "计入试算表期末调整栏 (AJE)，实时联动财务报表"
    : "計入試算表期末調整欄 (AJE)，實時聯動財務報表";

  const postBtnLabel = submitting
    ? lang === "en" ? "Submitting..." : lang === "zh-CN" ? "提交中..." : "提交中..."
    : lang === "en" ? "Post Adjustment" : lang === "zh-CN" ? "确认过账" : "確認過賬";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={modalTitle}
      description={modalDesc}
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
              {lang === "en" ? "Debit Account:" : lang === "zh-CN" ? "借方科目:" : "借方科目:"}
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
                  {lang === "en" ? acc.en : lang === "zh-CN" ? acc.zhCN : acc.zhTW}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              {lang === "en" ? "Credit Account:" : lang === "zh-CN" ? "贷方科目:" : "貸方科目:"}
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
                  {lang === "en" ? acc.en : lang === "zh-CN" ? acc.zhCN : acc.zhTW}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              {lang === "en" ? `Adjustment Amount (${currency}):` : lang === "zh-CN" ? `调整金额 (${currency}):` : `調整金額 (${currency}):`}
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
              {lang === "en" ? "Lead Schedule (W/P Ref):" : lang === "zh-CN" ? "关联底稿索引 (W/P Ref):" : "關聯底稿索引 (W/P Ref):"}
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
            {lang === "en" ? "Adjustment Memo:" : lang === "zh-CN" ? "调整摘要说明:" : "調整摘要說明:"}
          </label>
          <input
            type="text"
            className="sh-input"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={lang === "en" ? "Enter business rationale..." : lang === "zh-CN" ? "请输入调整原因与依据..." : "請輸入調整原因與依據..."}
            required
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            {t.cancel}
          </Button>
          <Button variant="default" type="submit" disabled={submitting}>
            {postBtnLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
