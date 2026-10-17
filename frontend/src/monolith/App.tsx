/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  INITIAL_JOURNAL_ENTRIES,
  INITIAL_BANK_FEED,
  INITIAL_LEDGER_CASH,
  INITIAL_TAX_SCHEDULES,
  JournalEntry,
  BankFeedItem,
  LedgerCashItem,
  TaxJurisdictionSchedule,
  calculateReconciliationSummary,
  computeTaxScheduleLiability,
} from './utils/accountingLogic';
import { OverviewModule, AgentTask } from './components/OverviewModule';
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
import {
  AppPreferences,
  DEFAULT_PREFERENCES,
  FONT_SIZE_ROOT_PX,
  getTranslations,
} from './utils/preferences';
import {
  AuditLogEntry,
  INITIAL_AUDIT_LOGS,
  generateAuditHash,
  AuditCategory,
  AuditActorType,
  AuditAction,
  ReceivableInvoice,
  INITIAL_RECEIVABLES,
  PayableBill,
  INITIAL_PAYABLES,
  FixedAssetItem,
  INITIAL_FIXED_ASSETS,
  computeFixedAssetMetrics,
  CloseChecklistItem,
  INITIAL_CLOSE_CHECKLIST,
  AmortizationScheduleItem,
  INITIAL_AMORTIZATION_SCHEDULES,
  CHART_OF_ACCOUNTS,
  formatCurrency,
} from './utils/accountingLogic';
import {
  LayoutGrid,
  BookOpen,
  Layers,
  Receipt,
  CreditCard,
  HardDrive,
  Columns3,
  FileSpreadsheet,
  Target,
  TrendingUp,
  ArrowLeftRight,
  Scale,
  Lock,
  ShieldCheck,
  Settings,
  Plus,
} from 'lucide-react';

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

const INITIAL_AGENT_TASKS: AgentTask[] = [
  {
    id: 'AGT-101',
    code: 'REV-01',
    title: 'Citadel Quant — ASC 606 Split',
    impactAmount: 240000,
    confidence: 99.6,
    category: 'Revenue Recognition',
    description: '',
    resolved: false,
    targetTab: 'journal',
  },
  {
    id: 'AGT-102',
    code: 'REC-02',
    title: 'Delaware Franchise Tax Autopay',
    impactAmount: 4200,
    confidence: 98.4,
    category: 'Bank Reconciliation',
    description: '',
    resolved: false,
    targetTab: 'reconciliation',
  },
  {
    id: 'AGT-103',
    code: 'TAX-03',
    title: 'California Form 100-ES Provision',
    impactAmount: 21381,
    confidence: 97.9,
    category: 'Tax Nexus',
    description: '',
    resolved: false,
    targetTab: 'tax',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveModule>('overview');
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(
    INITIAL_JOURNAL_ENTRIES
  );
  const [bankItems, setBankItems] = useState<BankFeedItem[]>(INITIAL_BANK_FEED);
  const [ledgerCashItems, setLedgerCashItems] =
    useState<LedgerCashItem[]>(INITIAL_LEDGER_CASH);
  const [taxSchedules, setTaxSchedules] =
    useState<TaxJurisdictionSchedule[]>(INITIAL_TAX_SCHEDULES);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>(INITIAL_AGENT_TASKS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [receivables, setReceivables] = useState<ReceivableInvoice[]>(INITIAL_RECEIVABLES);
  const [payables, setPayables] = useState<PayableBill[]>(INITIAL_PAYABLES);
  const [fixedAssets, setFixedAssets] = useState<FixedAssetItem[]>(INITIAL_FIXED_ASSETS);
  const [closeChecklist, setCloseChecklist] = useState<CloseChecklistItem[]>(
    INITIAL_CLOSE_CHECKLIST
  );
  const [amortizationSchedules, setAmortizationSchedules] = useState<AmortizationScheduleItem[]>(
    INITIAL_AMORTIZATION_SCHEDULES
  );
  const [isPeriodLocked, setIsPeriodLocked] = useState<boolean>(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [focusedAccountCode, setFocusedAccountCode] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    try {
      const saved = localStorage.getItem('monolith_preferences_v1');
      if (saved) {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_PREFERENCES;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = FONT_SIZE_ROOT_PX[preferences.fontSize] || '16px';
    root.lang = preferences.language;
    root.dataset.font = preferences.fontFamily || 'inter';
    root.classList.toggle('dark', preferences.theme === 'dark');
    try {
      localStorage.setItem('monolith_preferences_v1', JSON.stringify(preferences));
    } catch {
      // ignore storage errors
    }
  }, [preferences]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeTab]);

  const handleUpdatePreferences = (updates: Partial<AppPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...updates }));
  };

  const t = getTranslations(preferences.language);

  const logAuditEvent = (params: {
    category: AuditCategory;
    action: AuditAction;
    actorType: AuditActorType;
    actorId: string;
    targetId: string;
    summary: string;
    details?: string;
    impactAmount?: number;
    targetReference?: string;
  }) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
    setAuditLogs((prev) => {
      const id = `AUD-2026-${1001 + prev.length}`;
      const hash = generateAuditHash(
        id,
        timestamp,
        params.actorId,
        params.targetId,
        params.summary
      );
      const newEntry: AuditLogEntry = {
        id,
        timestamp,
        actorType: params.actorType,
        actorId: params.actorId,
        category: params.category,
        action: params.action,
        targetId: params.targetId,
        targetReference: params.targetReference,
        impactAmount: params.impactAmount,
        summary: params.summary,
        details: params.details,
        hash,
      };
      return [newEntry, ...prev];
    });
  };

  const reconSummary = useMemo(
    () => calculateReconciliationSummary(bankItems, ledgerCashItems, 1420000),
    [bankItems, ledgerCashItems]
  );

  const totalNetTaxLiability = useMemo(() => {
    return taxSchedules.reduce(
      (sum, sched) => sum + computeTaxScheduleLiability(sched).netPayable,
      0
    );
  }, [taxSchedules]);

  const handleAddJournalEntry = (newEntry: JournalEntry) => {
    setJournalEntries((prev) => [newEntry, ...prev]);

    const cashLine = newEntry.lines.find((l) => l.accountCode === '1010');
    if (cashLine) {
      const netCashAmount = cashLine.debit - cashLine.credit;
      if (netCashAmount !== 0) {
        const newCashItem: LedgerCashItem = {
          id: `LC-0${ledgerCashItems.length + 1}`,
          date: newEntry.date,
          entryId: newEntry.id,
          memo: newEntry.memo,
          amount: netCashAmount,
          reconciled: false,
        };
        setLedgerCashItems((prev) => [newCashItem, ...prev]);
      }
    }

    const totalDebits = newEntry.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = newEntry.lines.reduce((s, l) => s + l.credit, 0);
    const actorType: AuditActorType =
      newEntry.source === 'Agentic Auto-Draft'
        ? 'Agent'
        : newEntry.source === 'System Accrual'
        ? 'System'
        : 'User';
    const actorId =
      newEntry.source === 'Agentic Auto-Draft'
        ? 'Agent REV-01'
        : newEntry.source === 'System Accrual'
        ? 'System Accrual'
        : 'auslifegriffin@gmail.com';
    const action: AuditAction =
      newEntry.source === 'Agentic Auto-Draft' ? 'Auto-Draft Post' : 'Create Entry';

    logAuditEvent({
      category: 'Journal Entry',
      action,
      actorType,
      actorId,
      targetId: newEntry.id,
      targetReference: newEntry.reference,
      impactAmount: totalDebits,
      summary: `Posted journal entry ${newEntry.id}: ${newEntry.memo}`,
      details: `Debits: ${formatCurrency(totalDebits)} | Credits: ${formatCurrency(totalCredits)}${
        newEntry.attachments?.length
          ? ` | ${newEntry.attachments.length} attachment(s) uploaded (${newEntry.attachments.map((a) => a.name).join(', ')})`
          : ''
      }`,
    });
  };

  const handleReconcileItem = (bankId: string, ledgerId: string) => {
    const targetBank = bankItems.find((item) => item.id === bankId);
    const targetLedger = ledgerCashItems.find((l) => l.id === ledgerId);

    setBankItems((prev) =>
      prev.map((item) =>
        item.id === bankId
          ? { ...item, status: 'Matched', matchedLedgerId: ledgerId }
          : item
      )
    );
    setLedgerCashItems((prev) =>
      prev.map((l) => (l.id === ledgerId ? { ...l, reconciled: true } : l))
    );

    logAuditEvent({
      category: 'Bank Reconciliation',
      action: 'Reconcile Match',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: bankId,
      targetReference: targetBank?.bankReference,
      impactAmount: targetBank?.amount,
      summary: `Matched bank transaction ${bankId} (${targetBank?.counterparty || 'Feed'}) to ledger cash ${ledgerId}`,
      details: `Matched amount: ${formatCurrency(targetBank?.amount || 0, true)} against ${
        targetLedger?.memo || ledgerId
      }`,
    });
  };

  const handleBatchReconcileSuggested = () => {
    const suggestedPairs = bankItems
      .filter((b) => b.status === 'Unmatched' && b.suggestedLedgerId)
      .map((b) => ({ bankId: b.id, ledgerId: b.suggestedLedgerId! }));

    if (suggestedPairs.length === 0) return;

    const matchedBankIds = new Set(suggestedPairs.map((p) => p.bankId));
    const matchedLedgerIds = new Set(suggestedPairs.map((p) => p.ledgerId));

    const totalBatchAmount = suggestedPairs.reduce((sum, p) => {
      const b = bankItems.find((item) => item.id === p.bankId);
      return sum + Math.abs(b?.amount || 0);
    }, 0);

    setBankItems((prev) =>
      prev.map((b) =>
        matchedBankIds.has(b.id)
          ? { ...b, status: 'Matched', matchedLedgerId: b.suggestedLedgerId }
          : b
      )
    );

    setLedgerCashItems((prev) =>
      prev.map((l) =>
        matchedLedgerIds.has(l.id) ? { ...l, reconciled: true } : l
      )
    );

    logAuditEvent({
      category: 'Bank Reconciliation',
      action: 'Batch Reconcile',
      actorType: 'System',
      actorId: 'Agent REC-02',
      targetId: 'BATCH-MATCH',
      impactAmount: totalBatchAmount,
      summary: `Batch reconciled ${suggestedPairs.length} suggested bank transaction(s) against general ledger`,
      details: `Matched items: ${suggestedPairs.map((p) => p.bankId).join(', ')}`,
    });
  };

  const handleBookExceptionToLedger = (bankId: string) => {
    const targetBank = bankItems.find((b) => b.id === bankId);
    if (!targetBank || targetBank.status === 'Matched') return;

    const absAmount = Math.abs(targetBank.amount);
    const newEntryId = `JE-2026-0${943 + journalEntries.length}`;
    const newLedgerCashId = `LC-0${ledgerCashItems.length + 1}`;

    const adjustmentEntry: JournalEntry = {
      id: newEntryId,
      date: targetBank.date,
      reference: targetBank.bankReference,
      memo: `${targetBank.counterparty}`,
      source: 'Reconciliation Adjustment',
      status: 'Posted',
      confidence: 99.2,
      lines: [
        {
          id: `L-exc-1-${Date.now()}`,
          accountCode: '6800',
          accountName: 'Corporate Tax Provision Expense',
          description: targetBank.description,
          debit: absAmount,
          credit: 0,
        },
        {
          id: `L-exc-2-${Date.now()}`,
          accountCode: '1010',
          accountName: 'Operating Cash — Mercury SVB',
          description: targetBank.bankReference,
          debit: 0,
          credit: absAmount,
        },
      ],
    };

    const newLedgerItem: LedgerCashItem = {
      id: newLedgerCashId,
      date: targetBank.date,
      entryId: newEntryId,
      memo: targetBank.counterparty,
      amount: targetBank.amount,
      reconciled: true,
    };

    setJournalEntries((prev) => [adjustmentEntry, ...prev]);
    setLedgerCashItems((prev) => [newLedgerItem, ...prev]);
    setBankItems((prev) =>
      prev.map((b) =>
        b.id === bankId
          ? {
              ...b,
              status: 'Matched',
              matchedLedgerId: newLedgerCashId,
              matchConfidence: 100,
            }
          : b
      )
    );
    setAgentTasks((prev) =>
      prev.map((t) => (t.id === 'AGT-102' ? { ...t, resolved: true } : t))
    );

    logAuditEvent({
      category: 'Bank Reconciliation',
      action: 'Book Exception',
      actorType: 'Agent',
      actorId: 'Agent REC-02',
      targetId: bankId,
      targetReference: targetBank.bankReference,
      impactAmount: targetBank.amount,
      summary: `Booked bank exception ${bankId} (${targetBank.counterparty}) to GL Expense & Cash via ${newEntryId}`,
      details: `Created adjusting entry ${newEntryId} for ${formatCurrency(absAmount)} against Account 6800`,
    });
  };

  const handleUpdateTaxSchedule = (
    id: string,
    updates: Partial<
      Pick<TaxJurisdictionSchedule, 'taxableBase' | 'creditsAndDeductions' | 'status'>
    >
  ) => {
    setTaxSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  const handlePostTaxProvisionJournal = (
    amount: number,
    jurisdiction: string,
    formCode: string
  ) => {
    const newEntry: JournalEntry = {
      id: `JE-2026-0${943 + journalEntries.length}`,
      date: '2026-10-16',
      reference: formCode,
      memo: `${jurisdiction} (${formCode})`,
      source: 'System Accrual',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-tax-1-${Date.now()}`,
          accountCode: '6800',
          accountName: 'Corporate Tax Provision Expense',
          description: formCode,
          debit: amount,
          credit: 0,
        },
        {
          id: `L-tax-2-${Date.now()}`,
          accountCode: '2150',
          accountName: 'Accrued Tax Liability',
          description: formCode,
          debit: 0,
          credit: amount,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);

    logAuditEvent({
      category: 'Journal Entry',
      action: 'Post Tax Accrual',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: newEntry.id,
      targetReference: formCode,
      impactAmount: amount,
      summary: `Posted tax provision accrual for ${jurisdiction} (${formCode})`,
      details: `Debits: ${formatCurrency(amount)} to Accrued Tax Liability (2150)`,
    });
  };

  const handleResolveAgentTask = (taskId: string) => {
    const task = agentTasks.find((t) => t.id === taskId);
    if (!task || task.resolved) return;

    if (taskId === 'AGT-101') {
      handleAddJournalEntry({
        id: `JE-2026-0${943 + journalEntries.length}`,
        date: '2026-10-16',
        reference: 'INV-9012',
        memo: 'Citadel Quantitative Systems — Annual SaaS',
        source: 'Agentic Auto-Draft',
        status: 'Posted',
        confidence: 99.6,
        lines: [
          {
            id: `L-agt-1`,
            accountCode: '1010',
            accountName: 'Operating Cash — Mercury SVB',
            description: 'Wire settlement',
            debit: 240000,
            credit: 0,
          },
          {
            id: `L-agt-2`,
            accountCode: '4010',
            accountName: 'Enterprise SaaS Subscriptions',
            description: 'Q4 recognized',
            debit: 0,
            credit: 60000,
          },
          {
            id: `L-agt-3`,
            accountCode: '2400',
            accountName: 'Deferred Revenue — Annual SaaS',
            description: 'Deferred ARR',
            debit: 0,
            credit: 180000,
          },
        ],
      });
    } else if (taskId === 'AGT-102') {
      handleBookExceptionToLedger('BF-906');
    } else if (taskId === 'AGT-103') {
      handleUpdateTaxSchedule('TAX-CA-FRAN', { status: 'Ready to File' });
    }

    setAgentTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, resolved: true } : t))
    );
  };

  // --- Accounts Receivable Handlers ---
  const handleCreateInvoice = (params: {
    customer: string;
    dueDate: string;
    revenueAccountCode: string;
    amount: number;
  }) => {
    const newId = `INV-${9025 + receivables.length}`;
    const revAccount =
      CHART_OF_ACCOUNTS.find((a) => a.code === params.revenueAccountCode) ||
      CHART_OF_ACCOUNTS.find((a) => a.code === '4010')!;

    const newInvoice: ReceivableInvoice = {
      id: newId,
      customer: params.customer,
      issueDate: '2026-10-16',
      dueDate: params.dueDate,
      agingBucket: 'Current',
      revenueAccountCode: revAccount.code,
      amount: params.amount,
      paidAmount: 0,
      status: 'Open',
    };

    setReceivables((prev) => [newInvoice, ...prev]);

    const jeId = `JE-2026-0${943 + journalEntries.length}`;
    const newEntry: JournalEntry = {
      id: jeId,
      date: '2026-10-16',
      reference: newId,
      memo: `${params.customer} — Invoice ${newId}`,
      source: 'Manual Entry',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-ar-1-${Date.now()}`,
          accountCode: '1100',
          accountName: 'Accounts Receivable — Enterprise',
          description: newId,
          debit: params.amount,
          credit: 0,
        },
        {
          id: `L-ar-2-${Date.now()}`,
          accountCode: revAccount.code,
          accountName: revAccount.name,
          description: newId,
          debit: 0,
          credit: params.amount,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);

    logAuditEvent({
      category: 'Accounts Receivable',
      action: 'Issue Invoice',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: newId,
      targetReference: jeId,
      impactAmount: params.amount,
      summary: `Issued invoice ${newId} to ${params.customer}`,
      details: `DR 1100 / CR ${revAccount.code} (${formatCurrency(params.amount)}) via ${jeId}`,
    });
  };

  const handleCollectInvoice = (invoiceId: string) => {
    const target = receivables.find((inv) => inv.id === invoiceId);
    if (!target || target.status === 'Paid') return;

    const collectAmount = Math.max(0, target.amount - target.paidAmount);
    setReceivables((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId
          ? { ...inv, paidAmount: inv.amount, status: 'Paid', agingBucket: 'Current' }
          : inv
      )
    );

    const jeId = `JE-2026-0${943 + journalEntries.length}`;
    const newEntry: JournalEntry = {
      id: jeId,
      date: '2026-10-16',
      reference: invoiceId,
      memo: `Cash Collection — ${target.customer} (${invoiceId})`,
      source: 'Manual Entry',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-col-1-${Date.now()}`,
          accountCode: '1010',
          accountName: 'Operating Cash — Mercury SVB',
          description: invoiceId,
          debit: collectAmount,
          credit: 0,
        },
        {
          id: `L-col-2-${Date.now()}`,
          accountCode: '1100',
          accountName: 'Accounts Receivable — Enterprise',
          description: invoiceId,
          debit: 0,
          credit: collectAmount,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);
    setLedgerCashItems((prev) => [
      {
        id: `LC-0${prev.length + 1}`,
        date: '2026-10-16',
        entryId: jeId,
        memo: `${target.customer} (${invoiceId})`,
        amount: collectAmount,
        reconciled: false,
      },
      ...prev,
    ]);

    logAuditEvent({
      category: 'Accounts Receivable',
      action: 'Collect Payment',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: invoiceId,
      targetReference: jeId,
      impactAmount: collectAmount,
      summary: `Collected payment on ${invoiceId} (${target.customer})`,
      details: `DR 1010 / CR 1100 (${formatCurrency(collectAmount)}) via ${jeId}`,
    });
  };

  // --- Accounts Payable Handlers ---
  const handleCreateBill = (params: {
    vendor: string;
    reference: string;
    dueDate: string;
    expenseAccountCode: string;
    amount: number;
  }) => {
    const newId = `BILL-${405 + payables.length}`;
    const expAccount =
      CHART_OF_ACCOUNTS.find((a) => a.code === params.expenseAccountCode) ||
      CHART_OF_ACCOUNTS.find((a) => a.code === '5010')!;

    const newBill: PayableBill = {
      id: newId,
      vendor: params.vendor,
      billDate: '2026-10-16',
      dueDate: params.dueDate,
      expenseAccountCode: expAccount.code,
      expenseAccountName: expAccount.name,
      amount: params.amount,
      status: 'Pending',
      reference: params.reference,
    };

    setPayables((prev) => [newBill, ...prev]);

    const jeId = `JE-2026-0${943 + journalEntries.length}`;
    const newEntry: JournalEntry = {
      id: jeId,
      date: '2026-10-16',
      reference: params.reference,
      memo: `${params.vendor} — Bill ${newId}`,
      source: 'Manual Entry',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-ap-1-${Date.now()}`,
          accountCode: expAccount.code,
          accountName: expAccount.name,
          description: params.reference,
          debit: params.amount,
          credit: 0,
        },
        {
          id: `L-ap-2-${Date.now()}`,
          accountCode: '2010',
          accountName: 'Accounts Payable — Trade',
          description: params.reference,
          debit: 0,
          credit: params.amount,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);

    logAuditEvent({
      category: 'Accounts Payable',
      action: 'Record Bill',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: newId,
      targetReference: params.reference,
      impactAmount: params.amount,
      summary: `Recorded vendor bill ${newId} from ${params.vendor}`,
      details: `DR ${expAccount.code} / CR 2010 (${formatCurrency(params.amount)}) via ${jeId}`,
    });
  };

  const handleApproveBill = (billId: string) => {
    const target = payables.find((b) => b.id === billId);
    if (!target || target.status !== 'Pending') return;

    setPayables((prev) =>
      prev.map((b) => (b.id === billId ? { ...b, status: 'Approved' } : b))
    );

    logAuditEvent({
      category: 'Accounts Payable',
      action: 'Approve Bill',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: billId,
      targetReference: target.reference,
      impactAmount: target.amount,
      summary: `Approved vendor bill ${billId} (${target.vendor})`,
      details: `Authorized ${formatCurrency(target.amount)} for payment`,
    });
  };

  const handlePayBill = (billId: string) => {
    const target = payables.find((b) => b.id === billId);
    if (!target || target.status === 'Paid') return;

    setPayables((prev) =>
      prev.map((b) => (b.id === billId ? { ...b, status: 'Paid' } : b))
    );

    const jeId = `JE-2026-0${943 + journalEntries.length}`;
    const newEntry: JournalEntry = {
      id: jeId,
      date: '2026-10-16',
      reference: target.reference,
      memo: `AP Disbursement — ${target.vendor} (${billId})`,
      source: 'Manual Entry',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-pay-1-${Date.now()}`,
          accountCode: '2010',
          accountName: 'Accounts Payable — Trade',
          description: billId,
          debit: target.amount,
          credit: 0,
        },
        {
          id: `L-pay-2-${Date.now()}`,
          accountCode: '1010',
          accountName: 'Operating Cash — Mercury SVB',
          description: billId,
          debit: 0,
          credit: target.amount,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);
    setLedgerCashItems((prev) => [
      {
        id: `LC-0${prev.length + 1}`,
        date: '2026-10-16',
        entryId: jeId,
        memo: `${target.vendor} (${billId})`,
        amount: -target.amount,
        reconciled: false,
      },
      ...prev,
    ]);

    logAuditEvent({
      category: 'Accounts Payable',
      action: 'Pay Bill',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: billId,
      targetReference: jeId,
      impactAmount: -target.amount,
      summary: `Disbursed payment for ${billId} (${target.vendor})`,
      details: `DR 2010 / CR 1010 (${formatCurrency(target.amount)}) via ${jeId}`,
    });
  };

  // --- Fixed Assets Handlers ---
  const handleRegisterAsset = (params: {
    name: string;
    category: FixedAssetItem['category'];
    usefulLifeMonths: number;
    costBasis: number;
    salvageValue: number;
  }) => {
    const newId = `FA-${105 + fixedAssets.length}`;
    const newAsset: FixedAssetItem = {
      id: newId,
      name: params.name,
      category: params.category,
      inServiceDate: '2026-10-16',
      usefulLifeMonths: params.usefulLifeMonths,
      costBasis: params.costBasis,
      salvageValue: params.salvageValue,
      accumulatedDepreciation: 0,
      lastDepreciatedPeriod: '2026-09',
      status: 'Active',
    };
    setFixedAssets((prev) => [newAsset, ...prev]);

    logAuditEvent({
      category: 'Fixed Assets',
      action: 'Register Asset',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: newId,
      impactAmount: params.costBasis,
      summary: `Registered capital asset ${newId}: ${params.name}`,
      details: `Cost: ${formatCurrency(params.costBasis)} · Life: ${params.usefulLifeMonths}m`,
    });
  };

  const handleRunMonthlyDepreciation = () => {
    const summary = computeFixedAssetMetrics(fixedAssets);
    if (summary.totalMonthlyDepreciation <= 0) return;

    const deprAmount = summary.totalMonthlyDepreciation;
    setFixedAssets((prev) =>
      prev.map((asset) => {
        const depreciableBase = Math.max(0, asset.costBasis - asset.salvageValue);
        const rawMonthly =
          asset.usefulLifeMonths > 0
            ? Math.round(depreciableBase / asset.usefulLifeMonths)
            : 0;
        const remaining = Math.max(0, depreciableBase - asset.accumulatedDepreciation);
        const addDepr = Math.min(rawMonthly, remaining);
        const nextAccum = asset.accumulatedDepreciation + addDepr;
        return {
          ...asset,
          accumulatedDepreciation: nextAccum,
          lastDepreciatedPeriod: '2026-10',
          status: nextAccum >= depreciableBase ? 'Fully Depreciated' : 'Active',
        };
      })
    );

    const jeId = `JE-2026-0${943 + journalEntries.length}`;
    const newEntry: JournalEntry = {
      id: jeId,
      date: '2026-10-16',
      reference: 'DEPR-2026-10',
      memo: 'Monthly Fixed Asset Straight-Line Depreciation',
      source: 'System Accrual',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-dep-1-${Date.now()}`,
          accountCode: '5010',
          accountName: 'Cloud & GPU Inference Hosting',
          description: 'DEPR-2026-10',
          debit: deprAmount,
          credit: 0,
        },
        {
          id: `L-dep-2-${Date.now()}`,
          accountCode: '1400',
          accountName: 'Prepaid Cloud Infrastructure',
          description: 'DEPR-2026-10',
          debit: 0,
          credit: deprAmount,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);
    setCloseChecklist((prev) =>
      prev.map((c) => (c.id === 'CLS-05' ? { ...c, completed: true } : c))
    );

    logAuditEvent({
      category: 'Fixed Assets',
      action: 'Run Depreciation',
      actorType: 'System',
      actorId: 'System Accrual',
      targetId: 'DEPR-2026-10',
      targetReference: jeId,
      impactAmount: deprAmount,
      summary: `Posted monthly straight-line depreciation run (${formatCurrency(deprAmount)})`,
      details: `Updated ${fixedAssets.length} assets via ${jeId}`,
    });
  };

  // --- Period Close Handlers ---
  const handleToggleChecklistTask = (id: string) => {
    setCloseChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const handlePostAmortizationSchedule = (scheduleId: string) => {
    if (isPeriodLocked) return;
    const target = amortizationSchedules.find((s) => s.id === scheduleId);
    if (!target || target.status === 'Posted Q4') return;

    setAmortizationSchedules((prev) =>
      prev.map((s) =>
        s.id === scheduleId
          ? {
              ...s,
              recognizedToDate: Math.min(
                s.totalContractAmount,
                s.recognizedToDate + s.monthlyRecognition
              ),
              remainingMonths: Math.max(0, s.remainingMonths - 1),
              status: 'Posted Q4',
            }
          : s
      )
    );

    const jeId = `JE-2026-0${943 + journalEntries.length}`;
    const isDefRev = target.type === 'Deferred Revenue';
    const debitCode = isDefRev ? target.balanceSheetAccount : target.pnlAccount;
    const creditCode = isDefRev ? target.pnlAccount : target.balanceSheetAccount;
    const debitAcc = CHART_OF_ACCOUNTS.find((a) => a.code === debitCode)!;
    const creditAcc = CHART_OF_ACCOUNTS.find((a) => a.code === creditCode)!;

    const newEntry: JournalEntry = {
      id: jeId,
      date: '2026-10-16',
      reference: target.contractRef,
      memo: `${target.type} Amortization — ${target.counterparty}`,
      source: 'System Accrual',
      status: 'Posted',
      confidence: 100,
      lines: [
        {
          id: `L-sch-1-${Date.now()}`,
          accountCode: debitAcc.code,
          accountName: debitAcc.name,
          description: target.id,
          debit: target.monthlyRecognition,
          credit: 0,
        },
        {
          id: `L-sch-2-${Date.now()}`,
          accountCode: creditAcc.code,
          accountName: creditAcc.name,
          description: target.id,
          debit: 0,
          credit: target.monthlyRecognition,
        },
      ],
    };
    setJournalEntries((prev) => [newEntry, ...prev]);

    if (isDefRev) {
      setCloseChecklist((prev) =>
        prev.map((c) => (c.id === 'CLS-04' ? { ...c, completed: true } : c))
      );
    }

    logAuditEvent({
      category: 'Period Close',
      action: 'Post Amortization',
      actorType: 'System',
      actorId: 'Agent REV-01',
      targetId: scheduleId,
      targetReference: jeId,
      impactAmount: target.monthlyRecognition,
      summary: `Recognized ${target.type.toLowerCase()} schedule ${scheduleId} (${target.counterparty})`,
      details: `DR ${debitAcc.code} / CR ${creditAcc.code} (${formatCurrency(target.monthlyRecognition)}) via ${jeId}`,
    });
  };

  const handleTogglePeriodLock = () => {
    const nextLocked = !isPeriodLocked;
    setIsPeriodLocked(nextLocked);
    setCloseChecklist((prev) =>
      prev.map((c) => (c.id === 'CLS-06' ? { ...c, completed: nextLocked } : c))
    );

    logAuditEvent({
      category: 'Period Close',
      action: nextLocked ? 'Lock Period' : 'Unlock Period',
      actorType: 'User',
      actorId: 'auslifegriffin@gmail.com',
      targetId: 'PERIOD-2026-10',
      summary: `${nextLocked ? 'Locked' : 'Unlocked'} fiscal period 2026-10`,
    });
  };

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
            <BudgetingModule entries={journalEntries} />
          )}

          {activeTab === 'forecasting' && (
            <ForecastingModule entries={journalEntries} />
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
