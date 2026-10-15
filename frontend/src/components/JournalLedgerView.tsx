import React, { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog } from "./ui/shadcn";

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
        title="退回憑證分錄 (Reject Journal Entry)"
        description="請填寫審計退回理由，退回後該分錄將標記為 REJECTED 且不計入試算表"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.35rem" }}>
              退回理由說明 (Audit Rejection Reason):
            </label>
            <textarea
              className="sh-input"
              rows={3}
              value={rejectionReasonInput}
              onChange={(e) => setRejectionReasonInput(e.target.value)}
              placeholder="例：單據憑證不足、個人開支拆分比例需補件、科目選用有誤..."
              style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
              required
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <Button variant="ghost" onClick={() => setRejectModalJournalId(null)}>
              取消
            </Button>
            <Button
              variant="default"
              style={{ backgroundColor: "#dc2626", color: "#ffffff" }}
              onClick={handleConfirmReject}
              disabled={!rejectionReasonInput.trim()}
            >
              確認退回
            </Button>
          </div>
        </div>
      </Dialog>

      <Card className="sh-card">
        <CardHeader style={{ paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <div>
              <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                日記帳與憑證審核 (General Ledger & Audit Trail)
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                幣別：{currency} • 嚴格落實製單 (Maker) 與審核 (Checker) 權責分離
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {onOpenSplitModal && (
                <Button variant="outline" onClick={onOpenSplitModal} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                  公私費用拆分
                </Button>
              )}
              {onOpenAjeModal && (
                <Button variant="default" onClick={onOpenAjeModal} style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
                  + 提列調整分錄 (AJE)
                </Button>
              )}
            </div>
          </div>

          {/* Status Filter Tabs */}
          <div style={{ display: "flex", marginTop: "0.5rem" }}>
            <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
              {[
                { key: "ALL", label: "全部" },
                { key: "POSTED", label: "已過帳 (Posted)" },
                { key: "PENDING_CHECKER", label: "待覆核 (Pending)" },
                { key: "AWAITING_CPA", label: "待會計師 (Awaiting CPA)" },
                { key: "REJECTED", label: "已退回 (Rejected)" },
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
                  <th style={{ width: "105px" }}>記帳日期</th>
                  <th style={{ width: "110px" }}>來源模組</th>
                  <th>憑證摘要與審計說明</th>
                  <th style={{ textAlign: "right", width: "130px" }}>金額 ({currency})</th>
                  <th style={{ width: "160px" }}>製單 / 覆核</th>
                  <th style={{ width: "100px", textAlign: "center" }}>狀態</th>
                  <th style={{ width: "140px", textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--muted-foreground)" }}>
                      無符合條件之日記帳記錄
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
                            <div style={{ fontWeight: 500 }}>{j.ai_reasoning_summary || "日常運營會計分錄"}</div>
                            {j.entry_hash && (
                              <div style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                                指紋: {j.entry_hash.slice(0, 16)}...
                              </div>
                            )}
                          </td>
                          <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                            {fmt(j.total_debit)}
                          </td>
                          <td style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                            <div>製單: <span style={{ color: "var(--foreground)" }}>{j.created_by_principal_key}</span></div>
                            <div>覆核: <span style={{ color: "var(--foreground)" }}>{j.approved_by_principal_key || "-"}</span></div>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {j.status === "POSTED" ? (
                              <Badge variant="success" style={{ fontSize: "0.7rem" }}>
                                已過帳
                              </Badge>
                            ) : j.status === "REJECTED" ? (
                              <Badge variant="warning" style={{ fontSize: "0.7rem", color: "#dc2626", borderColor: "#fca5a5" }}>
                                已退回
                              </Badge>
                            ) : (
                              <Badge variant="warning" style={{ fontSize: "0.7rem" }}>
                                待覆核
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
                                    通過
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    onClick={() => setRejectModalJournalId(j.journal_id)}
                                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                                  >
                                    退回
                                  </Button>
                                </>
                              )}
                              {j.lines && j.lines.length > 0 && (
                                <Button
                                  variant="ghost"
                                  onClick={() => setExpandedId(isExpanded ? null : j.journal_id)}
                                  style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem" }}
                                >
                                  {isExpanded ? "收合" : "明細"}
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
                                分錄科目明細 (Entry Lines):
                              </div>
                              <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                                    <th style={{ textAlign: "left", width: "40px" }}>#</th>
                                    <th style={{ textAlign: "left", width: "100px" }}>科目代碼</th>
                                    <th style={{ textAlign: "left" }}>備註說明</th>
                                    <th style={{ textAlign: "right", width: "120px" }}>借方 (DR)</th>
                                    <th style={{ textAlign: "right", width: "120px" }}>貸方 (CR)</th>
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
