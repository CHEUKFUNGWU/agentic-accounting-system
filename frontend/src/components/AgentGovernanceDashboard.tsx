import React, { useEffect, useState } from "react";
import {
  checkLiveBackendHealth,
  fetchDesktopCompanyFileInfo,
  fetchJournals,
  fetchPendingJournals,
  fetchWorkingPaperPack,
  lockWorkingPaperPack,
  postAdjustingScheduleEntry,
  reviewJournal,
  triggerCompanyFileBackup,
  triggerMixedExpenseSplit,
} from "../api/client";
import {
  LeadScheduleDetail,
  ReportingPack,
} from "../types/accounting";
import type { Translations } from "../i18n";
import { AJEModal } from "./AJEModal";
import { DesktopManagerView } from "./DesktopManagerView";
import { ErrorBoundary } from "./ErrorBoundary";
import { TrialBalanceDetailView } from "./TrialBalanceDetailView";
import { JournalLedgerView } from "./JournalLedgerView";
import { JournalReviewModal } from "./JournalReviewModal";
import { DetailScheduleDrawer } from "./DetailScheduleDrawer";
import { DetailSchedulesView } from "./DetailSchedulesView";
import { PersonalSplitModal } from "./PersonalSplitModal";
import { TaxAndCloseView } from "./TaxAndCloseView";
import { ThreeStatementsView } from "./ThreeStatementsView";
import { Badge, Button } from "./ui/shadcn";
import { useI18n, LanguageSwitcher } from "../i18n";

const ENTITY_OPTIONS = [
  {
    code: "AU-OPC-01",
    label: "AU-OPC-01: Spark AI Studio Pty Ltd",
    sub: { "zh-CN": "AASB Tier 2 • 澳洲一人公司", "zh-TW": "AASB Tier 2 • 澳洲一人公司", en: "AASB Tier 2 • Australian single-director OPC" },
  },
  {
    code: "CN-OPC-01",
    label: "CN-OPC-01: 上海智算一人有限公司",
    sub: { "zh-CN": "小企业会计准则 • 中国一人有限公司", "zh-TW": "小企業會計準則 • 中國一人有限公司", en: "PRC CAS (Small Entities) • one-person Ltd" },
  },
  {
    code: "HK-SME-01",
    label: "HK-SME-01: Pacific Nexus Tech Ltd",
    sub: { "zh-CN": "SME-FRS • 香港中小企", "zh-TW": "SME-FRS • 香港中小企", en: "SME-FRS • Hong Kong SME" },
  },
  {
    code: "SG-OPC-01",
    label: "SG-OPC-01: Merlion Autonomous Labs",
    sub: { "zh-CN": "SFRS 小型实体 • 新加坡私人豁免公司", "zh-TW": "SFRS 小型實體 • 新加坡私人豁免公司", en: "SFRS for Small Entities • Singapore exempt Pte Ltd" },
  },
  {
    code: "US-SOLE-01",
    label: "US-SOLE-01: Griffin Analytics LLC",
    sub: { "zh-CN": "US GAAP • 美国单一成员穿透实体", "zh-TW": "US GAAP • 美國單一成員穿透實體", en: "US GAAP • single-member LLC (Schedule C)" },
  },
  {
    code: "EU-OPC-01",
    label: "EU-OPC-01: rheinAI Cloud UG",
    sub: { "zh-CN": "IFRS / HGB • 德国一人微型企业", "zh-TW": "IFRS / HGB • 德國一人微型企業", en: "IFRS / HGB • German single-shareholder UG" },
  },
];

const TAB_SCOPE_KEYS: Record<string, keyof Translations> = {
  STATEMENTS: "nav_statements",
  TRIAL_BALANCE: "nav_etb",
  JOURNALS: "nav_journals",
  SCHEDULES: "nav_schedules",
  TAX_CLOSE: "nav_close_tax",
  DESKTOP: "nav_database",
};

export const AgentGovernanceDashboard: React.FC = () => {
  const { t, lang } = useI18n();
  const [entityCode, setEntityCode] = useState<string>("AU-OPC-01");
  const [period, setPeriod] = useState<string>("2026-10");
  const [pack, setPack] = useState<ReportingPack | null>(null);
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
    "STATEMENTS" | "trial balance" | "JOURNALS" | "SCHEDULES" | "TAX_CLOSE" | "DESKTOP"
  >("STATEMENTS");

  // Detail schedule drawer state
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

  const handleOpenWpDrawer = (statementRef?: string) => {
    if (!statementRef || !pack) return;
    const normalized = statementRef.startsWith("F")
      ? "F"
      : statementRef.startsWith("CC")
      ? "CC"
      : statementRef.startsWith("EQ")
      ? "EQ"
      : statementRef;
    if (pack.detail_schedules[normalized]) {
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
    setPack(res.reporting_pack);
    void loadData(entityCode, period);
  };

  const handlePostAJE = async (params: {
    debitAccountCode: string;
    creditAccountCode: string;
    amount: string;
    memo: string;
    statementRef: string;
  }) => {
    const res = await postAdjustingScheduleEntry({
      entity_code: entityCode,
      debit_account_code: params.debitAccountCode,
      credit_account_code: params.creditAccountCode,
      amount: params.amount,
      memo: params.memo,
      statement_ref: params.statementRef,
    });
    setPack(res.reporting_pack);
    void loadData(entityCode, period);
  };

  const handleLockPack = async () => {
    const res = await lockWorkingPaperPack(entityCode, period);
    setPack(res.reporting_pack);
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
            正在載入賬套資料庫...
          </div>
          <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>連接本地會計分類賬與引擎</span>
        </div>
      </div>
    );
  }

  const selectedSchedule: LeadScheduleDetail | null = selectedWpRef
    ? pack.detail_schedules[selectedWpRef] || null
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
              {currentEntity.sub[lang]}
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
            {t.nav_statements}
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "trial balance"}
            onClick={() => setActiveTab("trial balance")}
          >
            {t.nav_etb}
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "JOURNALS"}
            onClick={() => setActiveTab("JOURNALS")}
            style={{ justifyContent: "space-between" }}
          >
            <span>{t.nav_journals}</span>
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
            {t.nav_schedules}
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "TAX_CLOSE"}
            onClick={() => setActiveTab("TAX_CLOSE")}
          >
            {t.nav_close_tax}
          </button>

          <button
            type="button"
            className="acc-sidebar-item"
            data-active={activeTab === "DESKTOP"}
            onClick={() => setActiveTab("DESKTOP")}
          >
            {t.nav_database}
          </button>
        </nav>

        {/* Sidebar Footer: Language, Period & DB Status */}
        <div className="acc-sidebar-footer">
          <div style={{ marginBottom: "0.6rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", color: "var(--muted-foreground)" }}>語言 / Language</span>
            <LanguageSwitcher />
          </div>

          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted-foreground)", marginBottom: "0.2rem" }}>
              {t.current_period}:
            </label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="sh-select"
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.4rem" }}
            >
              <option value="2026-10">2026-10</option>
              <option value="2026-09">2026-09</option>
              <option value="2026-Q3">2026-Q3</option>
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
                {isLiveBackend ? t.db_connected : "Offline"}
              </span>
            </div>

            {pack.reporting_status === "REVIEWED_AND_LOCKED" ? (
              <Badge variant="default" style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}>
                {t.status_locked}
              </Badge>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "#d97706" }}>{t.status_awaiting_cpa}</span>
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
              {activeTab === "STATEMENTS" && t.nav_statements}
              {activeTab === "trial balance" && t.nav_etb}
              {activeTab === "JOURNALS" && t.nav_journals}
              {activeTab === "SCHEDULES" && t.nav_schedules}
              {activeTab === "TAX_CLOSE" && t.nav_close_tax}
              {activeTab === "DESKTOP" && t.nav_database}
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
                {t.btn_review} ({pendingJournals.length})
              </Button>
            )}

            <Button
              variant="outline"
              onClick={handleBackupDb}
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}
            >
              {t.backup_btn}
            </Button>
          </div>
        </header>

        {/* Content Workspace */}
        <main className="acc-content">
          {/* One panel failing must not take the ledger down with it. */}
          <ErrorBoundary scope={t[TAB_SCOPE_KEYS[activeTab]]} key={activeTab}>
            {activeTab === "STATEMENTS" && (
              <ThreeStatementsView
                entityName={pack.legal_name}
                currency={pack.currency}
                incomeStatement={pack.income_statement}
                balanceSheet={pack.balance_sheet}
                cashFlow={pack.cash_flow_statement}
                kpi={pack.kpi_summary}
                proofs={pack.consistency_checks}
                onOpenWpDrawer={handleOpenWpDrawer}
              />
            )}

            {activeTab === "trial balance" && (
              <TrialBalanceDetailView
                entityName={pack.legal_name}
                currency={pack.currency}
                rows={pack.trial_balance_rows}
                totals={pack.trial_balance_totals as any}
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
              <DetailSchedulesView
                currency={pack.currency}
                schedules={pack.detail_schedules}
                onOpenWpDrawer={handleOpenWpDrawer}
              />
            )}

            {activeTab === "TAX_CLOSE" && (
              <TaxAndCloseView
                currency={pack.currency}
                taxSchedule={pack.statutory_tax_schedule}
                checklist={pack.close_checklist}
                packStatus={pack.reporting_status}
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
          </ErrorBoundary>
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

      <DetailScheduleDrawer
        schedule={selectedSchedule}
        currency={pack.currency}
        onClose={() => setSelectedWpRef(null)}
      />
    </div>
  );
};
