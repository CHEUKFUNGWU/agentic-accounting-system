import React, { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";

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
  onReviewJournal: (journalId: string, action: "APPROVE" | "REJECT") => void;
}

export const JournalLedgerView: React.FC<JournalLedgerViewProps> = ({
  currency,
  journals,
  onReviewJournal,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fmt = (val: string | number) => {
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const filtered = journals.filter((j) => {
    if (filterStatus === "ALL") return true;
    return j.status === filterStatus;
  });

  return (
    <Card className="sh-card">
      <CardHeader style={{ paddingBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <CardTitle style={{ fontSize: "1.1rem" }}>
              總分類帳日記帳簿 (General Ledger & Journal Audit Trail)
            </CardTitle>
            <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              具備 Maker-Checker 職責分離 (SoD) 與 SHA-256 防偽哈希鏈溯源
            </span>
          </div>

          <div className="sh-tabs-list" style={{ padding: "0.15rem" }}>
            {[
              { key: "ALL", label: "全部 (All)" },
              { key: "POSTED", label: "已過帳 (POSTED)" },
              { key: "PENDING_CHECKER", label: "待審核 (PENDING)" },
              { key: "AWAITING_CPA", label: "待會計師 (AWAITING_CPA)" },
              { key: "REJECTED", label: "已退回 (REJECTED)" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                className="sh-tabs-trigger"
                data-state={filterStatus === tab.key ? "active" : "inactive"}
                onClick={() => setFilterStatus(tab.key)}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent style={{ padding: "0 0.5rem 0.5rem" }}>
        <div className="sh-table-wrapper">
          <table className="sh-table" style={{ fontSize: "0.825rem" }}>
            <thead>
              <tr>
                <th style={{ width: "95px" }}>記帳日期</th>
                <th style={{ width: "100px" }}>來源模組</th>
                <th>業務摘要與自主 Agent 審計推理 (Reasoning)</th>
                <th style={{ textAlign: "right", width: "110px" }}>借貸金額 ({currency})</th>
                <th style={{ width: "150px" }}>編製 / 審核 (SoD)</th>
                <th style={{ width: "95px", textAlign: "center" }}>狀態</th>
                <th style={{ width: "130px", textAlign: "right" }}>操作 / 區塊鏈</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "var(--muted-foreground)" }}>
                    尚無符合條件的日記帳記錄
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
                          <div style={{ fontWeight: 500 }}>{j.ai_reasoning_summary || "日常營運會計分錄"}</div>
                          {j.entry_hash && (
                            <div style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                              Hash: {j.entry_hash.slice(0, 16)}...
                            </div>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                          {fmt(j.total_debit)}
                        </td>
                        <td style={{ fontSize: "0.75rem" }}>
                          <div>制單: {j.created_by_principal_key}</div>
                          <div>覆核: {j.approved_by_principal_key || "-"}</div>
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
                              待審核
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
                                  style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}
                                >
                                  ✓ 通過
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={() => onReviewJournal(j.journal_id, "REJECT")}
                                  style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}
                                >
                                  ✕ 駁回
                                </Button>
                              </>
                            )}
                            {j.lines && j.lines.length > 0 && (
                              <Button
                                variant="ghost"
                                onClick={() => setExpandedId(isExpanded ? null : j.journal_id)}
                                style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}
                              >
                                {isExpanded ? "收起 ▲" : "分錄 ▼"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Sub-lines */}
                      {isExpanded && j.lines && (
                        <tr style={{ background: "#fafafa" }}>
                          <td colSpan={7} style={{ padding: "0.75rem 1.5rem" }}>
                            <div style={{ fontWeight: 600, fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted-foreground)" }}>
                              借貸明細分錄 (Debit / Credit Entry Lines):
                            </div>
                            <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                                  <th style={{ textAlign: "left", width: "40px" }}>行</th>
                                  <th style={{ textAlign: "left", width: "80px" }}>科目代號</th>
                                  <th style={{ textAlign: "left" }}>行備註 (Memo)</th>
                                  <th style={{ textAlign: "right", width: "100px" }}>借方 (DR)</th>
                                  <th style={{ textAlign: "right", width: "100px" }}>貸方 (CR)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {j.lines.map((l) => (
                                  <tr key={l.line_number} style={{ borderBottom: "1px dashed var(--border)" }}>
                                    <td>{l.line_number}</td>
                                    <td style={{ fontWeight: 600 }}>{l.account_code}</td>
                                    <td>{l.memo || "-"}</td>
                                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                                      {parseFloat(l.debit) > 0 ? fmt(l.debit) : "-"}
                                    </td>
                                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                                      {parseFloat(l.credit) > 0 ? fmt(l.credit) : "-"}
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
  );
};
