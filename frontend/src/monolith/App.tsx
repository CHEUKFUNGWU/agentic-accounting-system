/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { calculateReconciliationSummary, computeTaxScheduleLiability, CHART_OF_ACCOUNTS } from './utils/accountingLogic';
import type { JournalEntry, FixedAssetItem } from './utils/accountingLogic';
import { loadWorkspace, sendCommand, type Workspace } from './api';
import { OverviewModule } from './components/OverviewModule';
import { JournalEntryModule } from './components/JournalEntryModule';
import { GeneralLedgerModule } from './components/GeneralLedgerModule';
import { TrialBalanceModule } from './components/TrialBalanceModule';
import { FinancialStatementsModule } from './components/FinancialStatementsModule';
import { BankReconciliationModule } from './components/BankReconciliationModule';
import { TaxReportingModule } from './components/TaxReportingModule';
import { BudgetingModule } from './components/BudgetingModule';
import { ForecastingModule } from './components/ForecastingModule';
import { GlobalSearchBar } from './components/GlobalSearchBar';
import { SettingsModule } from './components/SettingsModule';
import { AuditLogModule } from './components/AuditLogModule';
import { AccountsReceivableModule } from './components/AccountsReceivableModule';
import { AccountsPayableModule } from './components/AccountsPayableModule';
import { FixedAssetsModule } from './components/FixedAssetsModule';
import { PeriodCloseModule } from './components/PeriodCloseModule';
import { FONT_SIZE_ROOT_PX, getTranslations } from './utils/preferences';
import type { AppPreferences } from './utils/preferences';
import { LayoutGrid, BookOpen, Layers, Receipt, CreditCard, HardDrive, Columns3, FileSpreadsheet, Target, TrendingUp, ArrowLeftRight, Scale, Lock, ShieldCheck, Settings, Plus } from 'lucide-react';

export type ActiveModule =
  | 'overview'
  | 'journal'
  | 'ledger'
  | 'receivables'
  | 'payables'
  | 'fixed-assets'
  | 'trial-balance'
  | 'statements'
  | 'budgeting'
  | 'forecasting'
  | 'reconciliation'
  | 'tax'
  | 'period-close'
  | 'audit-log'
  | 'settings';

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const queueEpoch = useRef(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveModule>('overview');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [focusedAccountCode, setFocusedAccountCode] = useState<string | null>(null);

  const receive = (next: Workspace) => {
    workspaceRef.current = next;
    // Existing report and editor components read this shared account list.
    CHART_OF_ACCOUNTS.splice(0, CHART_OF_ACCOUNTS.length, ...next.accounts);
    setWorkspace(next);
  };
  useEffect(() => {
    let active = true;
    loadWorkspace().then(next => { if (active) receive(next); })
      .catch(reason => { if (active) setError(String(reason.message || reason)); });
    return () => { active = false; };
  }, []);

  const command = (action: string, payload: object = {}) => {
    setPending(n => n + 1);
    const epoch = queueEpoch.current;
    const job = queue.current.then(async () => {
      if (epoch !== queueEpoch.current) throw new Error('Pending edits canceled after a save failed. Review the refreshed records.');
      const current = workspaceRef.current;
      if (!current) throw new Error('The accounting workspace has not loaded.');
      try {
        const next = await sendCommand(action, payload, current.revision);
        receive(next);
        setError('');
        return next;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to save the change.';
        queueEpoch.current += 1;
        setError(message);
        // Discard stale browser data after a conflict; never silently replay financial actions.
        try { receive(await loadWorkspace()); } catch { /* Keep the error and last confirmed state. */ }
        throw reason;
      }
    });
    queue.current = job.catch(() => undefined);
    void job.finally(() => setPending(n => n - 1)).catch(() => undefined);
    return job;
  };
  const act = (action: string, payload: object = {}) => { void command(action, payload).catch(() => undefined); };
  const preferences = workspace?.preferences;
  useEffect(() => {
    if (!preferences) return;
    const root = document.documentElement;
    root.style.fontSize = FONT_SIZE_ROOT_PX[preferences.fontSize];
    root.lang = preferences.language;
    root.dataset.font = preferences.fontFamily || 'inter';
    root.classList.toggle('dark', preferences.theme === 'dark');
  }, [preferences]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [activeTab]);
  const reconSummary = useMemo(() => calculateReconciliationSummary(workspace?.bankItems || [], workspace?.ledgerCashItems || [], 1420000), [workspace]);
  const totalNetTaxLiability = useMemo(() => workspace?.taxSchedules.reduce((sum, schedule) => sum + computeTaxScheduleLiability(schedule).netPayable, 0) || 0, [workspace]);

  if (!workspace || !preferences) return (
    <main className="min-h-screen bg-zinc-50 p-8 text-zinc-950">
      <h1 className="text-base font-extrabold">MONOLITH</h1>
      <p role={error ? 'alert' : 'status'} className="mt-6 text-sm">{error || 'Loading accounting workspace…'}</p>
      {error && <button className="mt-4 bg-zinc-950 px-4 py-2 text-sm text-white" onClick={() => window.location.reload()}>Retry connection</button>}
    </main>
  );
  const { journalEntries, bankItems, ledgerCashItems, taxSchedules, agentTasks, auditLogs, receivables, payables, fixedAssets, closeChecklist, amortizationSchedules, isPeriodLocked } = workspace;
  const t = getTranslations(preferences.language);
  const handleUpdatePreferences = (updates: Partial<AppPreferences>) => act('preferences.update', updates);
  const handleAddJournalEntry = async (entry: JournalEntry) => {
    const next = await command('journal.create', entry);
    return next.journalEntries[0];
  };
  const handleReconcileItem = (bankId: string, ledgerId: string) => act('bank.reconcile', { bankId, ledgerId });
  const handleBatchReconcileSuggested = () => act('bank.batch');
  const handleBookExceptionToLedger = (id: string) => act('bank.exception', { id });
  const handleUpdateTaxSchedule = (id: string, updates: object) => act('tax.update', { id, updates });
  const handlePostTaxProvisionJournal = (amount: number, jurisdiction: string, formCode: string) => act('tax.provision', { amount, jurisdiction, formCode });
  const handleResolveAgentTask = (id: string) => act('agent.resolve', { id });
  const handleCreateInvoice = (params: object) => command('invoice.create', params);
  const handleCollectInvoice = (id: string) => act('invoice.collect', { id });
  const handleCreateBill = (params: object) => command('bill.create', params);
  const handleApproveBill = (id: string) => act('bill.approve', { id });
  const handlePayBill = (id: string) => act('bill.pay', { id });
  const handleRegisterAsset = (params: { name: string; category: FixedAssetItem['category']; usefulLifeMonths: number; costBasis: number; salvageValue: number }) => command('asset.register', params);
  const handleRunMonthlyDepreciation = () => act('asset.depreciate');
  const handleToggleChecklistTask = (id: string) => act('close.checklist', { id });
  const handlePostAmortizationSchedule = (id: string) => act('close.amortize', { id });
  const handleTogglePeriodLock = () => act(isPeriodLocked ? 'period.unlock' : 'period.lock');

  const navItems: {
    id: ActiveModule;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'overview', label: t.nav.overview, icon: LayoutGrid },
    { id: 'journal', label: t.nav.journal, icon: BookOpen },
    { id: 'ledger', label: t.nav.ledger, icon: Layers },
    { id: 'receivables', label: t.nav.receivables, icon: Receipt },
    { id: 'payables', label: t.nav.payables, icon: CreditCard },
    { id: 'fixed-assets', label: t.nav.fixedAssets, icon: HardDrive },
    { id: 'trial-balance', label: t.nav.trialBalance, icon: Columns3 },
    { id: 'statements', label: t.nav.statements, icon: FileSpreadsheet },
    { id: 'budgeting', label: t.nav.budgeting, icon: Target },
    { id: 'forecasting', label: t.nav.forecasting, icon: TrendingUp },
    { id: 'reconciliation', label: t.nav.reconciliation, icon: ArrowLeftRight },
    { id: 'tax', label: t.nav.tax, icon: Scale },
    { id: 'period-close', label: t.nav.periodClose, icon: Lock },
    { id: 'audit-log', label: t.nav.auditLog, icon: ShieldCheck },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-zinc-50 text-zinc-950">
      {/* Left Sidebar Navigation Pane (Desktop) */}
      <aside
        aria-label="Sidebar Navigation"
        className="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 md:left-0 bg-white border-r border-zinc-200 z-30 justify-between"
      >
        <div className="flex-1 flex flex-col min-h-0">
          <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-200 shrink-0">
            <a
              href="#overview"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('overview');
              }}
              className="text-base font-extrabold tracking-tight text-zinc-950 whitespace-nowrap font-display"
            >
              MONOLITH
            </a>
            <span className="text-[10px] font-medium text-zinc-400 border border-zinc-200 px-1.5 py-0.5 uppercase">
              {preferences.language}
            </span>
          </div>

          <nav
            aria-label="Primary Accounting Modules"
            className="flex-1 overflow-y-auto p-2.5 space-y-0.5"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-zinc-200">
          <button
            type="button"
            onClick={() => setActiveTab('journal')}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-zinc-950 hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.nav.newEntry}</span>
          </button>
        </div>
      </aside>

      {/* Mobile Compact Header & Switcher (<md) */}
      <div className="md:hidden bg-white border-b border-zinc-200 sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-extrabold tracking-tight text-zinc-950 font-display">
            MONOLITH
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('journal')}
            className="px-3 py-1 text-xs font-semibold text-white bg-zinc-950 cursor-pointer"
          >
            + {t.nav.newEntry}
          </button>
        </div>
        <div
          aria-label="Mobile Module Switcher"
          className="flex overflow-x-auto border-t border-zinc-200 divide-x divide-zinc-200"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer text-center ${
                  isActive
                    ? 'bg-zinc-950 text-white'
                    : 'bg-white text-zinc-500 hover:text-zinc-950'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Viewport */}
      <main className="flex-1 md:pl-56 min-w-0">
        <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 py-8">
          {error && <div role="alert" className="mb-4 flex items-center justify-between gap-4 border border-zinc-300 bg-white p-4 text-sm"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">Dismiss</button></div>}
          {pending > 0 && <p role="status" className="mb-2 text-xs text-zinc-500">Saving to company file…</p>}
          <p className="mb-3 text-[11px] text-zinc-500">{workspace.entityName} · {workspace.currency} · {workspace.period} · {workspace.dataOrigin}</p>
          <GlobalSearchBar
            query={globalSearchQuery}
            onQueryChange={(q) => {
              setGlobalSearchQuery(q);
              if (!q.trim()) {
                setFocusedAccountCode(null);
              }
            }}
            entries={journalEntries}
            bankItems={bankItems}
            onSelectJournalEntry={(entryId) => {
              setGlobalSearchQuery(entryId);
              setActiveTab('journal');
            }}
            onSelectAccount={(accountCode) => {
              setFocusedAccountCode(accountCode);
              setActiveTab('ledger');
            }}
            onSelectBankTransaction={(bankId) => {
              setGlobalSearchQuery(bankId);
              setActiveTab('reconciliation');
            }}
            preferences={preferences}
          />

          {activeTab === 'overview' && (
            <OverviewModule
              journalEntries={journalEntries}
              reconSummary={reconSummary}
              totalNetTaxLiability={totalNetTaxLiability}
              agentTasks={agentTasks}
              onResolveAgentTask={handleResolveAgentTask}
              onNavigateTab={setActiveTab}
            />
          )}

          {activeTab === 'journal' && (
            <JournalEntryModule
              entries={journalEntries}
              onAddEntry={handleAddJournalEntry}
              onReviewEntry={(id) => act('journal.review', { id })}
              globalSearchQuery={globalSearchQuery}
            />
          )}

          {activeTab === 'ledger' && (
            <GeneralLedgerModule
              entries={journalEntries}
              focusedAccountCode={focusedAccountCode}
              globalSearchQuery={globalSearchQuery}
            />
          )}

          {activeTab === 'receivables' && (
            <AccountsReceivableModule
              invoices={receivables}
              onCollectInvoice={handleCollectInvoice}
              onCreateInvoice={handleCreateInvoice}
            />
          )}

          {activeTab === 'payables' && (
            <AccountsPayableModule
              bills={payables}
              onApproveBill={handleApproveBill}
              onPayBill={handlePayBill}
              onCreateBill={handleCreateBill}
            />
          )}

          {activeTab === 'fixed-assets' && (
            <FixedAssetsModule
              assets={fixedAssets}
              period={workspace.period}
              onRunMonthlyDepreciation={handleRunMonthlyDepreciation}
              onRegisterAsset={handleRegisterAsset}
            />
          )}

          {activeTab === 'trial-balance' && (
            <TrialBalanceModule entries={journalEntries} />
          )}

          {activeTab === 'statements' && (
            <FinancialStatementsModule entries={journalEntries} />
          )}

          {activeTab === 'budgeting' && (
            <BudgetingModule entries={journalEntries} saving={pending > 0} savedAllocations={workspace.budgetAllocations} onSave={(allocations) => act('budget.save', { allocations })} />
          )}

          {activeTab === 'forecasting' && (
            <ForecastingModule entries={journalEntries} saving={pending > 0} savedDrivers={workspace.forecastDrivers} savedOverrides={workspace.forecastOverrides} onSave={(drivers, overrides) => act('forecast.save', { drivers, overrides })} />
          )}

          {activeTab === 'reconciliation' && (
            <BankReconciliationModule
              bankItems={bankItems}
              ledgerCashItems={ledgerCashItems}
              summary={reconSummary}
              onReconcileItem={handleReconcileItem}
              onBatchReconcileSuggested={handleBatchReconcileSuggested}
              onBookExceptionToLedger={handleBookExceptionToLedger}
              globalSearchQuery={globalSearchQuery}
            />
          )}

          {activeTab === 'tax' && (
            <TaxReportingModule
              schedules={taxSchedules}
              onUpdateSchedule={handleUpdateTaxSchedule}
              onPostTaxProvisionJournal={handlePostTaxProvisionJournal}
            />
          )}

          {activeTab === 'period-close' && (
            <PeriodCloseModule
              checklist={closeChecklist}
              schedules={amortizationSchedules}
              isPeriodLocked={isPeriodLocked}
              onToggleChecklistTask={handleToggleChecklistTask}
              onPostAmortizationSchedule={handlePostAmortizationSchedule}
              onTogglePeriodLock={handleTogglePeriodLock}
            />
          )}

          {activeTab === 'audit-log' && (
            <AuditLogModule
              logs={auditLogs}
              onNavigateToRecord={(category, targetId) => {
                if (category === 'Journal Entry') {
                  setGlobalSearchQuery(targetId);
                  setActiveTab('journal');
                } else if (category === 'Bank Reconciliation') {
                  setGlobalSearchQuery(targetId);
                  setActiveTab('reconciliation');
                } else if (category === 'Accounts Receivable') {
                  setActiveTab('receivables');
                } else if (category === 'Accounts Payable') {
                  setActiveTab('payables');
                } else if (category === 'Fixed Assets') {
                  setActiveTab('fixed-assets');
                } else if (category === 'Period Close') {
                  setActiveTab('period-close');
                } else if (category === 'Tax Provision') {
                  setActiveTab('tax');
                }
              }}
              globalSearchQuery={globalSearchQuery}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsModule
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
            />
          )}
        </div>
      </main>
    </div>
  );
}
