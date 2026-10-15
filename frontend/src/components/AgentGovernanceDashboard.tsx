import React, { useEffect, useState } from "react";
import {
  checkLiveBackendHealth,
  fetchDesktopCompanyFileInfo,
  fetchJournals,
  fetchPendingJournals,
  fetchWorkingPaperPack,
  lockWorkingPaperPack,
  postAdjustingWorkpaperEntry,
  reviewJournal,
  triggerCompanyFileBackup,
  triggerMixedExpenseSplit,
} from "../api/client";
import {
  LeadScheduleDetail,
  ThreeStatementWorkingPaperPack,
} from "../types/accounting";
import { AJEModal } from "./AJEModal";
import { DesktopManagerView } from "./DesktopManagerView";
import { ExtendedTrialBalanceView } from "./ExtendedTrialBalanceView";
import { JournalLedgerView } from "./JournalLedgerView";
import { JournalReviewModal } from "./JournalReviewModal";
import { LeadScheduleDrawer } from "./LeadScheduleDrawer";
import { LeadSchedulesView } from "./LeadSchedulesView";
import { PersonalSplitModal } from "./PersonalSplitModal";
import { TaxAndCloseView } from "./TaxAndCloseView";
import { ThreeStatementsView } from "./ThreeStatementsView";
import { Badge, Button } from "./ui/shadcn";

const ENTITY_OPTIONS = [
  { code: "AU-OPC-01", label: "AU-OPC-01: Spark AI Studio Pty Ltd", sub: "AASB Tier 2 • 澳洲一人公司" },
  { code: "CN-OPC-01", label: "CN-OPC-01: 上海智算一人有限公司", sub: "小企業會計準則 • 中國一人有限" },
  { code: "HK-SME-01", label: "HK-SME-01: Pacific Nexus Tech Ltd", sub: "SME-FRS • 香港中小企" },
  { code: "SG-OPC-01", label: "SG-OPC-01: Merlion Autonomous Labs", sub: "SFRS Small • 新加坡私人豁免" },
  { code: "US-SOLE-01", label: "US-SOLE-01: Griffin Analytics LLC", sub: "US GAAP • 美國單一成員穿透實體" },
  { code: "EU-OPC-01", label: "EU-OPC-01: rheinAI Cloud UG", sub: "IFRS / HGB • 德國一人微型企業" },
];

export const AgentGovernanceDashboard: React.FC = () => {
  const [entityCode, setEntityCode] = useState<string>("AU-OPC-01");
  const [period, setPeriod] = useState<string>("2026-10");
  const [pack, setPack] = useState<ThreeStatementWorkingPaperPack | null>(null);
  const [isLiveBackend, setIsLiveBackend] = useState<boolean>(false);
  const [dbInfo, setDbInfo] = useState<{
    storage_type: string;
    file_path: string;
    file_size_formatted: string;
    app_platform: string;
  }>({
    storage_type: "SQLite WAL",
    file_path: "~/Library/Application Support/AgenticAccounting/ledger.db",
    file_size_formatted: "48.0 KB",
    app_platform: "darwin",
  });

  const [activeTab, setActiveTab] = useState<
    "STATEMENTS" | "ETB" | "JOURNALS" | "SCHEDULES" | "TAX_CLOSE" | "DESKTOP"
  >("STATEMENTS");

  // Lead Schedule drawer state
  const [selectedWpRef, setSelectedWpRef] = useState<string | null>(null);

  // Modals state
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [ajeModalOpen, setAjeModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  // Journals state
  const [journals, setJournals] = useState<any[]>([]);
  const [pendingJournals, setPendingJournals] = useState<any[]>([]);

  const loadData = async (code: string, p: string) => {
    const isLive = await checkLiveBackendHealth();
    setIsLiveBackend(isLive);

    const [packData, journalsData, pendingData, desktopInfo] = await Promise.all([
      fetchWorkingPaperPack(code, p),
      fetchJournals(),
      fetchPendingJournals(code),
      fetchDesktopCompanyFileInfo(),
    ]);

    setPack(packData);
    setJournals(journalsData.journals || []);
    setPendingJournals(pendingData.journals || []);
    setDbInfo(desktopInfo);
  };

  useEffect(() => {
    void loadData(entityCode, period);
  }, [entityCode, period]);

  const handleOpenWpDrawer = (wpRef?: string) => {
    if (!wpRef || !pack) return;
    const normalized = wpRef.startsWith("W/P F")
      ? "W/P F"
      : wpRef.startsWith("W/P CC")
      ? "W/P CC"
      : wpRef.startsWith("W/P EQ")
      ? "W/P EQ"
      : wpRef;
    if (pack.lead_schedules[normalized]) {
      setSelectedWpRef(normalized);
    }
  };

  const handleApplyPersonalSplit = async (params: {
    description: string;
    grossAmount: string;
    businessPct: number;
  }) => {
    const taxRate = entityCode.startsWith("HK")
      ? "0.00"
      : entityCode.startsWith("CN")
      ? "0.13"
      : entityCode.startsWith("SG")
      ? "0.09"
      : "0.10";

    const res = await triggerMixedExpenseSplit({
      entity_code: entityCode,
      expense_description: params.description,
      gross_amount_paid: params.grossAmount,
      tax_rate: taxRate,
      business_use_pct: (params.businessPct / 100).toFixed(2),
    });
    setPack(res.updated_working_paper_pack);
    void loadData(entityCode, period);
  };

  const handlePostAJE = async (params: {
    debitAccountCode: string;
    creditAccountCode: string;
    amount: string;
    memo: string;
    wpRef: string;
  }) => {
    const res = await postAdjustingWorkpaperEntry({
      entity_code: entityCode,
      debit_account_code: params.debitAccountCode,
      credit_account_code: params.creditAccountCode,
      amount: params.amount,
      memo: params.memo,
      wp_ref: params.wpRef,
    });
    setPack(res.updated_working_paper_pack);
    void loadData(entityCode, period);
  };

  const handleLockPack = async () => {
    const res = await lockWorkingPaperPack(entityCode, period);
    setPack(res.updated_working_paper_pack);
    void loadData(entityCode, period);
  };

  const handleReviewJournal = async (
    journalId: string,
    action: "APPROVE" | "REJECT",
    reason?: string
  ) => {
    await reviewJournal({
      journal_id: journalId,
      action,
      rejection_reason: reason,
      reviewer_principal_key: "controller-checker-01",
    });
    void loadData(entityCode, period);
  };

  const handleBackupDb = async () => {
    const res = await triggerCompanyFileBackup();
    void loadData(entityCode, period);
    return res;
  };

  if (!pack) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "#ffffff" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            正在載入帳套資料庫...
          </div>
          <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>連接本地會計分類帳與底稿引擎</span>
        </div>
      </div>
    );
  }

  const selectedSchedule: LeadScheduleDetail | null = selectedWpRef
    ? pack.lead_schedules[selectedWpRef] || null
    : null;

  const currentEntity = ENTITY_OPTIONS.find((e) => e.code === entityCode) || ENTITY_OPTIONS[0];

  return (
    <div className="acc-shell">
      {/* Accounting Sidebar Navigation */}
      <aside className="acc-sidebar">
        {/* Company & Entity Selector Header */}
        <div className="acc-sidebar-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <div
              style={{
                width: "1.5rem",
                height: "1.5rem",
                backgroundColor: "#18181b",
                color: "#ffffff",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.8rem",
                fontWeight: 700,
              }}
            >
              A
            </div>
            <span style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "-0.01em" }}>
              Agentic Accounting
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <select
              value={entityCode}
              onChange={(e) => setEntityCode(e.target.value)}
              className="sh-select"
              style={{ fontSize: "0.8rem", padding: "0.35rem 0.5rem" }}
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", paddingLeft: "0.15rem" }}>
              {currentEntity.sub}
            </div>
          </div>
        </div>

        {/* Accounting Modules Navigation */}
        <nav className="acc-sidebar-nav">
          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "STATEMENTS"}
            onClick={() => setActiveTab("STATEMENTS")}
          >
            財務報表 (Financial Statements)
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "ETB"}
            onClick={() => setActiveTab("ETB")}
          >
            試算表 (Trial Balance / ETB)
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "JOURNALS"}
            onClick={() => setActiveTab("JOURNALS")}
            style={{ justifyContent: "space-between" }}
          >
            <span>日記帳與憑證 (Journals)</span>
            {pendingJournals.length > 0 && (
              <span
                style={{
                  backgroundColor: "#dc2626",
                  color: "#ffffff",
                  borderRadius: "9999px",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.4rem",
                  fontWeight: 600,
                }}
              >
                {pendingJournals.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "SCHEDULES"}
            onClick={() => setActiveTab("SCHEDULES")}
          >
            審計底稿 (Lead Schedules)
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "TAX_CLOSE"}
            onClick={() => setActiveTab("TAX_CLOSE")}
          >
            月末關帳與稅務 (Close & Tax)
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "DESKTOP"}
            onClick={() => setActiveTab("DESKTOP")}
          >
            帳套文件管理 (Company File)
          </button>
        </nav>

        {/* Sidebar Footer: Period & DB Status */}
        <div className="acc-sidebar-footer">
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted-foreground)", marginBottom: "0.2rem" }}>
              當前會計期間:
            </label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="sh-select"
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.4rem" }}
            >
              <option value="2026-10">2026-10 (當前月結期)</option>
              <option value="2026-09">2026-09 (前期)</option>
              <option value="2026-Q3">2026-Q3 (第三季)</option>
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.35rem", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: isLiveBackend ? "#16a34a" : "#d97706",
                }}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                {isLiveBackend ? "本地資料庫在線" : "離線模式"}
              </span>
            </div>

            {pack.pack_status === "CPA_SIGNED_LOCKED" ? (
              <Badge variant="default" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}>
                已封存
              </Badge>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "#d97706" }}>待簽核</span>
            )}
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="acc-main">
        {/* Lean Top Context Bar */}
        <header className="acc-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>
              {activeTab === "STATEMENTS" && "財務報表 (Financial Statements)"}
              {activeTab === "ETB" && "延伸試算表 (Extended Trial Balance)"}
              {activeTab === "JOURNALS" && "日記帳簿與憑證審核 (General Ledger & Journals)"}
              {activeTab === "SCHEDULES" && "審計明細底稿庫 (Audit Lead Schedules)"}
              {activeTab === "TAX_CLOSE" && "月末關帳與稅務申報 (Month-End Close & Tax)"}
              {activeTab === "DESKTOP" && "本機帳套文件管理 (Company File Management)"}
            </h1>
            <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {pack.legal_name} • {pack.currency}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {pendingJournals.length > 0 && (
              <Button
                variant="outline"
                onClick={() => setReviewModalOpen(true)}
                style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}
              >
                待覆核分錄 ({pendingJournals.length})
              </Button>
            )}

            <Button
              variant="outline"
              onClick={handleBackupDb}
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}
            >
              備份帳套
            </Button>
          </div>
        </header>

        {/* Content Workspace */}
        <main className="acc-content">
          {activeTab === "STATEMENTS" && (
            <ThreeStatementsView
              currency={pack.currency}
              incomeStatement={pack.income_statement_wp}
              balanceSheet={pack.balance_sheet_wp}
              cashFlow={pack.cash_flow_statement_wp}
              kpi={pack.kpi_summary}
              proofs={pack.reconciliation_proofs}
              onOpenWpDrawer={handleOpenWpDrawer}
            />
          )}

          {activeTab === "ETB" && (
            <ExtendedTrialBalanceView
              currency={pack.currency}
              rows={pack.etb_rows}
              totals={pack.etb_totals as any}
              onOpenWpDrawer={handleOpenWpDrawer}
            />
          )}

          {activeTab === "JOURNALS" && (
            <JournalLedgerView
              currency={pack.currency}
              journals={journals}
              onReviewJournal={handleReviewJournal}
              onOpenAjeModal={() => setAjeModalOpen(true)}
              onOpenSplitModal={() => setSplitModalOpen(true)}
            />
          )}

          {activeTab === "SCHEDULES" && (
            <LeadSchedulesView
              currency={pack.currency}
              schedules={pack.lead_schedules}
              onOpenWpDrawer={handleOpenWpDrawer}
            />
          )}

          {activeTab === "TAX_CLOSE" && (
            <TaxAndCloseView
              currency={pack.currency}
              taxWorkpaper={pack.statutory_tax_workpaper}
              checklist={pack.close_checklist}
              packStatus={pack.pack_status}
              onLockPack={handleLockPack}
              onOpenWpDrawer={handleOpenWpDrawer}
            />
          )}

          {activeTab === "DESKTOP" && (
            <DesktopManagerView
              storageType={dbInfo.storage_type}
              filePath={dbInfo.file_path}
              fileSizeFormatted={dbInfo.file_size_formatted}
              appPlatform={dbInfo.app_platform}
              onBackupDb={handleBackupDb}
            />
          )}
        </main>
      </div>

      {/* Global Modals and Drawers */}
      <PersonalSplitModal
        open={splitModalOpen}
        currency={pack.currency}
        onClose={() => setSplitModalOpen(false)}
        onSubmit={handleApplyPersonalSplit}
      />

      <AJEModal
        open={ajeModalOpen}
        currency={pack.currency}
        onClose={() => setAjeModalOpen(false)}
        onSubmit={handlePostAJE}
      />

      <JournalReviewModal
        open={reviewModalOpen}
        currency={pack.currency}
        pendingJournals={pendingJournals}
        onClose={() => setReviewModalOpen(false)}
        onReview={handleReviewJournal}
      />

      <LeadScheduleDrawer
        schedule={selectedSchedule}
        currency={pack.currency}
        onClose={() => setSelectedWpRef(null)}
      />
    </div>
  );
};
