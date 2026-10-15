import React, { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog } from "./ui/shadcn";
import { useI18n } from "../i18n";

interface JournalEntryItem {
  journal_id: string;
  entity_code: string;
  source_module: string;
  status: string;
  accounting_date: string;
  currency: string;
  total_debit: string;
  total_credit: string;
  created_by_principal_key: string;
  approved_by_principal_key?: string;
  ai_reasoning_summary?: string;
  entry_hash?: string;
  prev_entry_hash?: string;
  lines?: Array<{
    line_number: number;
    account_code: string;
    debit: string;
    credit: string;
    memo?: string;
  }>;
}

interface JournalLedgerViewProps {
  currency: string;
  journals: JournalEntryItem[];
  onReviewJournal: (journalId: string, action: "APPROVE" | "REJECT", reason?: string) => void;
  onOpenAjeModal?: () => void;
  onOpenSplitModal?: () => void;
}

export const JournalLedgerView: React.FC<JournalLedgerViewProps> = ({
  currency,
  journals,
  onReviewJournal,
  onOpenAjeModal,
  onOpenSplitModal,
}) => {
  const { t, lang } = useI18n();
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectModalJournalId, setRejectModalJournalId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>("");

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const filtered = journals.filter((j) => {
    if (filterStatus === "ALL") return true;
    return j.status === filterStatus;
  });

  const handleConfirmReject = () => {
    if (!rejectModalJournalId) return;
    onReviewJournal(rejectModalJournalId, "REJECT", rejectionReasonInput.trim());
    setRejectModalJournalId(null);
    setRejectionReasonInput("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Reject Reason Prompt Dialog */}
      <Dialog
        open={!!rejectModalJournalId}
        onOpenChange={(open) => !open && setRejectModalJournalId(null)}
        title={lang === "en" ? "Reject Journal Entry" : lang === "zh-CN" ? "驳回凭证分录" : "駁回憑證分錄"}
        description={lang === "en" ? "Please provide audit rejection reason. Entry will be marked REJECTED." : lang === "zh-CN" ? "请填写审核驳回理由，驳回后该分录将标记为 REJECTED 且不计入试算表" : "請填寫審計駁回理由，駁回後該分錄將標記為 REJECTED 且不計入試算表"}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.35rem" }}>
              {t.reject_reason_prompt}
            </label>
            <textarea
              className="sh-input"
              rows={3}
              value={rejectionReasonInput}
              onChange={(e) => setRejectionReasonInput(e.target.value)}
              placeholder={t.reject_reason_placeholder}
              style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
              required
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <Button variant="ghost" onClick={() => setRejectModalJournalId(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="default"
              style={{ backgroundColor: "#dc2626", color: "#ffffff" }}
              onClick={handleConfirmReject}
              disabled={!rejectionReasonInput.trim()}
            >
              {t.confirm_reject}
            </Button>
          </div>
        </div>
      </Dialog>

      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <div>
              <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                {t.journal_title}
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                {t.currency_label}：{currency} • {t.journal_subtitle}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {onOpenSplitModal && (
                <Button variant="outline" onClick={onOpenSplitModal} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                  {t.btn_split_expense}
                </Button>
              )}
              {onOpenAjeModal && (
                <Button variant="default" onClick={onOpenAjeModal} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                  {t.btn_add_aje}
                </Button>
              )}
            </div>
          </div>

          {/* Status Filter Tabs */}
          <div style={{ display: "flex", marginTop: "0.5rem" }}>
            <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
              {[
                { key: "ALL", label: t.filter_all },
                { key: "POSTED", label: t.filter_posted },
                { key: "PENDING_CHECKER", label: t.filter_pending },
                { key: "AWAITING_CPA", label: lang === "en" ? "Awaiting CPA" : lang === "zh-CN" ? "待会计师签核" : "待會計師簽核" },
                { key: "REJECTED", label: t.filter_rejected },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className="sh-tabs-trigger"
                  data-state={filterStatus === tab.key ? "active" : "inactive"}
                  onClick={() => setFilterStatus(tab.key)}
                  style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent style={{ padding: "0" }}>
          <div className="sh-table-wrapper">
            <table className="sh-table" style={{ fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ width: "105px" }}>{t.col_date}</th>
                  <th style={{ width: "110px" }}>{lang === "en" ? "Source" : lang === "zh-CN" ? "来源模块" : "來源模組"}</th>
                  <th>{t.col_description}</th>
                  <th style={{ textAlign: "right", width: "130px" }}>{t.amount_col} ({currency})</th>
                  <th style={{ width: "160px" }}>{lang === "en" ? "Maker / Checker" : lang === "zh-CN" ? "制单 / 复核" : "製單 / 覆核"}</th>
                  <th style={{ width: "100px", textAlign: "center" }}>{t.col_status}</th>
                  <th style={{ width: "140px", textAlign: "right" }}>{t.col_actions}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--muted-foreground)" }}>
                      {t.no_journals}
                    </td>
                  </tr>
                ) : (
                  filtered.map((j) => {
                    const isExpanded = expandedId === j.journal_id;
                    const isPending = j.status === "PENDING_CHECKER" || j.status === "AWAITING_CPA";

                    return (
                      <React.Fragment key={j.journal_id}>
                        <tr>
                          <td style={{ fontWeight: 500 }}>{j.accounting_date}</td>
                          <td>
                            <Badge variant="outline" style={{ fontSize: "0.7rem" }}>
                              {j.source_module}
                            </Badge>
                          </td>
                          <td>
                            <div style={{ fontWeight: 500 }}>{j.ai_reasoning_summary || (lang === "en" ? "General Operating Journal Entry" : lang === "zh-CN" ? "日常运营会计分录" : "日常營運會計分錄")}</div>
                            {j.entry_hash && (
                              <div style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                                {lang === "en" ? "Hash: " : "指纹: "}{j.entry_hash.slice(0, 16)}...
                              </div>
                            )}
                          </td>
                          <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                            {fmt(j.total_debit)}
                          </td>
                          <td style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                            <div>{lang === "en" ? "Maker: " : lang === "zh-CN" ? "制单: " : "製單: "}<span style={{ color: "var(--foreground)" }}>{j.created_by_principal_key}</span></div>
                            <div>{lang === "en" ? "Checker: " : lang === "zh-CN" ? "复核: " : "覆核: "}<span style={{ color: "var(--foreground)" }}>{j.approved_by_principal_key || "-"}</span></div>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {j.status === "POSTED" ? (
                              <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                                {t.filter_posted}
                              </Badge>
                            ) : j.status === "REJECTED" ? (
                              <Badge variant="warning" style={{ fontSize: "0.7rem", color: "#dc2626", borderColor: "#fca5a5" }}>
                                {t.filter_rejected}
                              </Badge>
                            ) : (
                              <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                                {t.filter_pending}
                              </Badge>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.35rem" }}>
                              {isPending && (
                                <>
                                  <Button
                                    variant="default"
                                    onClick={() => onReviewJournal(j.journal_id, "APPROVE")}
                                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                                  >
                                    {t.btn_approve}
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    onClick={() => setRejectModalJournalId(j.journal_id)}
                                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                                  >
                                    {t.btn_reject}
                                  </Button>
                                </>
                              )}
                              {j.lines && j.lines.length > 0 && (
                                <Button
                                  variant="ghost"
                                  onClick={() => setExpandedId(isExpanded ? null : j.journal_id)}
                                  style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem" }}
                                >
                                  {isExpanded ? (lang === "en" ? "Collapse" : "收起") : (lang === "en" ? "Lines" : "明细")}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Lines */}
                        {isExpanded && j.lines && (
                          <tr style={{ background: "#fcfcfc" }}>
                            <td colSpan={7} style={{ padding: "0.75rem 1.5rem" }}>
                              <div style={{ fontWeight: 600, fontSize: "0.75rem", marginBottom: "0.35rem", color: "var(--muted-foreground)" }}>
                                {lang === "en" ? "Entry Lines:" : lang === "zh-CN" ? "分录科目明细:" : "分錄科目明細:"}
                              </div>
                              <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                                    <th style={{ textAlign: "left", width: "40px" }}>#</th>
                                    <th style={{ textAlign: "left", width: "100px" }}>{t.col_acc_code}</th>
                                    <th style={{ textAlign: "left" }}>{lang === "en" ? "Memo" : lang === "zh-CN" ? "备注说明" : "備註說明"}</th>
                                    <th style={{ textAlign: "right", width: "120px" }}>{t.dr_label}</th>
                                    <th style={{ textAlign: "right", width: "120px" }}>{t.cr_label}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {j.lines.map((ln) => (
                                    <tr key={ln.line_number} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                      <td style={{ color: "var(--muted-foreground)" }}>{ln.line_number}</td>
                                      <td style={{ fontWeight: 600 }}>{ln.account_code}</td>
                                      <td>{ln.memo || "-"}</td>
                                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                                        {parseFloat(ln.debit) > 0 ? fmt(ln.debit) : "-"}
                                      </td>
                                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                                        {parseFloat(ln.credit) > 0 ? fmt(ln.credit) : "-"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
