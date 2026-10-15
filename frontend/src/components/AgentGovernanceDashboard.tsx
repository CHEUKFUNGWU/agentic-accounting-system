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
import { AppHeader } from "./AppHeader";
import { DesktopManagerView } from "./DesktopManagerView";
import { ExtendedTrialBalanceView } from "./ExtendedTrialBalanceView";
import { JournalLedgerView } from "./JournalLedgerView";
import { JournalReviewModal } from "./JournalReviewModal";
import { LeadScheduleDrawer } from "./LeadScheduleDrawer";
import { LeadSchedulesView } from "./LeadSchedulesView";
import { PersonalSplitModal } from "./PersonalSplitModal";
import { TaxAndCloseView } from "./TaxAndCloseView";
import { ThreeStatementsView } from "./ThreeStatementsView";

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
    "STATEMENTS" | "ETB" | "SCHEDULES" | "JOURNALS" | "TAX_CLOSE" | "DESKTOP"
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
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            正在加載單體財務報表底稿庫...
          </div>
          <span style={{ color: "var(--muted-foreground)" }}>連接本地 SQLite 帳套與 Stateless MCP</span>
        </div>
      </div>
    );
  }

  const selectedSchedule: LeadScheduleDetail | null = selectedWpRef
    ? pack.lead_schedules[selectedWpRef] || null
    : null;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* App Header */}
      <AppHeader
        entityCode={entityCode}
        onEntityChange={setEntityCode}
        period={period}
        onPeriodChange={setPeriod}
        packStatus={pack.pack_status}
        isLiveBackend={isLiveBackend}
        dbPathFormatted={dbInfo.file_path}
        pendingCount={pendingJournals.length}
        onOpenSplitModal={() => setSplitModalOpen(true)}
        onOpenAjeModal={() => setAjeModalOpen(true)}
        onOpenReviewModal={() => setReviewModalOpen(true)}
        onBackupDb={handleBackupDb}
        onLockPack={handleLockPack}
      />

      {/* Main Workspace Navigation Tabs */}
      <div
        style={{
          padding: "0.75rem 1.5rem",
          backgroundColor: "#fafafa",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="sh-tabs-list">
          <button
            type="button"
            className="sh-tabs-trigger"
            data-state={activeTab === "STATEMENTS" ? "active" : "inactive"}
            onClick={() => setActiveTab("STATEMENTS")}
          >
            📊 單體三大財務報表 (3 Statements)
          </button>
          <button
            type="button"
            className="sh-tabs-trigger"
            data-state={activeTab === "ETB" ? "active" : "inactive"}
            onClick={() => setActiveTab("ETB")}
          >
            📑 ETB 延伸試算表總底稿
          </button>
          <button
            type="button"
            className="sh-tabs-trigger"
            data-state={activeTab === "SCHEDULES" ? "active" : "inactive"}
            onClick={() => setActiveTab("SCHEDULES")}
          >
            🔍 明細底稿庫 (W/P A~EQ)
          </button>
          <button
            type="button"
            className="sh-tabs-trigger"
            data-state={activeTab === "JOURNALS" ? "active" : "inactive"}
            onClick={() => setActiveTab("JOURNALS")}
          >
            📜 日記帳與 SoD 防偽審批
          </button>
          <button
            type="button"
            className="sh-tabs-trigger"
            data-state={activeTab === "TAX_CLOSE" ? "active" : "inactive"}
            onClick={() => setActiveTab("TAX_CLOSE")}
          >
            ⚖ 稅務儲備與月結清單
          </button>
          <button
            type="button"
            className="sh-tabs-trigger"
            data-state={activeTab === "DESKTOP" ? "active" : "inactive"}
            onClick={() => setActiveTab("DESKTOP")}
          >
            💻 桌面端帳套文件管理
          </button>
        </div>
      </div>

      {/* Workspace Body */}
      <main style={{ flex: 1, padding: "1.5rem", maxWidth: "1600px", width: "100%", margin: "0 auto" }}>
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

        {activeTab === "SCHEDULES" && (
          <LeadSchedulesView
            currency={pack.currency}
            schedules={pack.lead_schedules}
            onOpenWpDrawer={handleOpenWpDrawer}
          />
        )}

        {activeTab === "JOURNALS" && (
          <JournalLedgerView
            currency={pack.currency}
            journals={journals}
            onReviewJournal={handleReviewJournal}
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

      {/* Slide-over Drawer for Lead Schedule Drill-down */}
      <LeadScheduleDrawer
        schedule={selectedSchedule}
        currency={pack.currency}
        onClose={() => setSelectedWpRef(null)}
      />

      {/* Personal Split Modal */}
      <PersonalSplitModal
        open={splitModalOpen}
        currency={pack.currency}
        onClose={() => setSplitModalOpen(false)}
        onSubmit={handleApplyPersonalSplit}
      />

      {/* Month-End AJE Modal */}
      <AJEModal
        open={ajeModalOpen}
        currency={pack.currency}
        onClose={() => setAjeModalOpen(false)}
        onSubmit={handlePostAJE}
      />

      {/* SoD Review Modal */}
      <JournalReviewModal
        open={reviewModalOpen}
        currency={pack.currency}
        pendingJournals={pendingJournals}
        onClose={() => setReviewModalOpen(false)}
        onReview={handleReviewJournal}
      />
    </div>
  );
};
