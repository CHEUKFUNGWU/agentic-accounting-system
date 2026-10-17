import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJournalEntry,
  computeSankeyLayout,
  calculateReconciliationSummary,
  computeTaxScheduleLiability,
  computeGeneralLedgerByAccount,
  computeTrialBalance,
  computeFinancialStatements,
  buildLivePnlSankeyDataset,
  computeBudgetVariance,
  computeRollingForecast,
  searchGlobalAccountingRecords,
  INITIAL_BUDGET_ALLOCATIONS,
  FORECAST_SCENARIO_PRESETS,
  SANKEY_DATASETS,
  PNL_SANKEY_DATASETS,
  INITIAL_JOURNAL_ENTRIES,
  INITIAL_BANK_FEED,
  INITIAL_LEDGER_CASH,
  INITIAL_TAX_SCHEDULES,
  INITIAL_AUDIT_LOGS,
  INITIAL_RECEIVABLES,
  INITIAL_PAYABLES,
  INITIAL_FIXED_ASSETS,
  INITIAL_CLOSE_CHECKLIST,
  INITIAL_AMORTIZATION_SCHEDULES,
  computeReceivablesSummary,
  computePayablesSummary,
  computeFixedAssetMetrics,
  computePeriodCloseSummary,
  generateAuditHash,
  filterAuditLogs,
} from './accountingLogic.ts';
import {
  createOverviewExportPayload,
  createJournalEntriesExportPayload,
  createGeneralLedgerExportPayload,
  createTrialBalanceExportPayload,
  createFinancialStatementsExportPayload,
  createBudgetingExportPayload,
  createForecastingExportPayload,
  createBankReconciliationExportPayload,
  createTaxReportingExportPayload,
  createAuditLogExportPayload,
  createReceivablesExportPayload,
  createPayablesExportPayload,
  createFixedAssetsExportPayload,
  createPeriodCloseExportPayload,
} from './exportUtils.ts';
import { getTranslations, FONT_SIZE_ROOT_PX } from './preferences.ts';

test('validateJournalEntry accepts balanced multi-line entry', () => {
  const result = validateJournalEntry('Enterprise SaaS recognition', 'INV-100', [
    { accountCode: '1010', debit: 15000, credit: 0 },
    { accountCode: '4010', debit: 0, credit: 12000 },
    { accountCode: '2400', debit: 0, credit: 3000 },
  ]);
  assert.equal(result.isValid, true);
  assert.equal(result.totalDebit, 15000);
  assert.equal(result.totalCredit, 15000);
  assert.equal(result.imbalance, 0);
  assert.equal(result.errors.length, 0);
});

test('validateJournalEntry rejects unbalanced debits and credits', () => {
  const result = validateJournalEntry('Unbalanced adjustment', 'ADJ-09', [
    { accountCode: '1010', debit: 10000, credit: 0 },
    { accountCode: '4010', debit: 0, credit: 8500 },
  ]);
  assert.equal(result.isValid, false);
  assert.equal(result.imbalance, 1500);
  assert.ok(result.errors.some((e) => e.includes('Out of balance')));
});

test('computeSankeyLayout generates valid coordinates for both Cash Flow and P&L Sankeys', () => {
  const cfLayout = computeSankeyLayout(SANKEY_DATASETS['Q4-2026'], 1160, 480);
  assert.equal(cfLayout.totalFlow, 1315000);
  assert.equal(cfLayout.nodes.length, 11);
  assert.equal(cfLayout.links.length, 10);

  const pnlLayout = computeSankeyLayout(PNL_SANKEY_DATASETS['Q4-2026'], 1160, 480);
  assert.equal(pnlLayout.totalFlow, 1280000);
  assert.equal(pnlLayout.nodes.length, 11);
  assert.equal(pnlLayout.links.length, 10);
});

test('calculateReconciliationSummary computes accurate delta and match rates', () => {
  const summary = calculateReconciliationSummary(INITIAL_BANK_FEED, INITIAL_LEDGER_CASH, 1420000);
  assert.equal(summary.reconciledCount, 2);
  assert.equal(summary.unmatchedCount, 3);
  assert.equal(summary.exceptionCount, 1);
  assert.equal(summary.unreconciledDelta, -4200);
});

test('computeTaxScheduleLiability applies statutory rate and credits accurately', () => {
  const fed = INITIAL_TAX_SCHEDULES[0];
  const computed = computeTaxScheduleLiability(fed);
  assert.equal(computed.grossLiability, 134820);
  assert.equal(computed.netPayable, 96420);
});

test('computeGeneralLedgerByAccount aggregates account postings and running balances', () => {
  const gl = computeGeneralLedgerByAccount(INITIAL_JOURNAL_ENTRIES);
  const cashGl = gl.find((g) => g.account.code === '1010');
  assert.ok(cashGl);
  // Opening 1,469,700 + 185,000 - 40,000 - 124,000 = 1,490,700
  assert.equal(cashGl.endingBalance, 1490700);
  assert.equal(cashGl.postings.length, 3);
});

test('computeTrialBalance is strictly in balance (Debits === Credits)', () => {
  const tb = computeTrialBalance(INITIAL_JOURNAL_ENTRIES);
  assert.equal(tb.isBalanced, true);
  assert.equal(tb.totalDebitBalance, tb.totalCreditBalance);
  assert.equal(tb.totalPeriodDebits, tb.totalPeriodCredits);
});

test('computeFinancialStatements satisfies Assets === Liabilities + Equity and Cash Flow reconciliation', () => {
  const fs = computeFinancialStatements(INITIAL_JOURNAL_ENTRIES);
  assert.equal(fs.totalRevenue, 1280000);
  assert.equal(fs.totalOperatingExpenses, 690000);
  assert.equal(fs.operatingIncome, 590000);
  assert.equal(fs.taxExpense, 138000);
  assert.equal(fs.netIncome, 452000);
  assert.equal(fs.isBalanceSheetBalanced, true);
  assert.equal(fs.totalAssets, fs.totalLiabilitiesAndEquity);
  assert.equal(fs.cashFlow.netCashFromOperating, 487200);
  assert.equal(fs.cashFlow.endingCash, 2340700);
  assert.equal(fs.cashFlow.isCashReconciled, true);

  const pnlSankey = buildLivePnlSankeyDataset(fs);
  const layout = computeSankeyLayout(pnlSankey, 1160, 420);
  assert.equal(layout.totalFlow, 1280000);
  assert.equal(layout.nodes.find((n) => n.id === 'ebitda_pool')?.value, 590000);
  assert.equal(layout.nodes.find((n) => n.id === 'net_treasury')?.value, 452000);
});

test('computeBudgetVariance and computeRollingForecast derive accurate metrics from GL entries', () => {
  const bva = computeBudgetVariance(INITIAL_JOURNAL_ENTRIES, INITIAL_BUDGET_ALLOCATIONS);
  assert.equal(bva.totalBudgetRevenue, 1260000);
  assert.equal(bva.totalActualRevenue, 1280000);
  assert.equal(bva.revenueVariance, 20000);
  assert.equal(bva.totalBudgetExpense, 825000);
  assert.equal(bva.totalActualExpense, 828000);
  assert.equal(bva.expenseVariance, -3000);
  assert.equal(bva.budgetNetIncome, 435000);
  assert.equal(bva.actualNetIncome, 452000);
  assert.equal(bva.netIncomeVariance, 17000);

  const fc = computeRollingForecast(INITIAL_JOURNAL_ENTRIES, FORECAST_SCENARIO_PRESETS.base);
  assert.equal(fc.quarters.length, 5);
  assert.equal(fc.quarters[0].isActual, true);
  assert.equal(fc.quarters[0].totalRevenue, 1280000);
  assert.ok(fc.fy2027TotalRevenue > 6000000);
  assert.ok(fc.fy2027EndingCash > fc.quarters[0].endingCash);
});

test('all 9 module export builders produce valid CSV and PDF-1.4 documents', () => {
  const recon = calculateReconciliationSummary(INITIAL_BANK_FEED, INITIAL_LEDGER_CASH, 1420000);
  const bva = computeBudgetVariance(INITIAL_JOURNAL_ENTRIES, INITIAL_BUDGET_ALLOCATIONS);
  const fc = computeRollingForecast(INITIAL_JOURNAL_ENTRIES, FORECAST_SCENARIO_PRESETS.base);

  const payloads = [
    createOverviewExportPayload(SANKEY_DATASETS['Q4-2026'], 'cashflow', recon, 189549, INITIAL_JOURNAL_ENTRIES),
    createJournalEntriesExportPayload(INITIAL_JOURNAL_ENTRIES),
    createGeneralLedgerExportPayload(INITIAL_JOURNAL_ENTRIES),
    createTrialBalanceExportPayload(INITIAL_JOURNAL_ENTRIES),
    createFinancialStatementsExportPayload(INITIAL_JOURNAL_ENTRIES, 'pl'),
    createBudgetingExportPayload(bva),
    createForecastingExportPayload(fc),
    createBankReconciliationExportPayload(INITIAL_BANK_FEED, INITIAL_LEDGER_CASH, recon),
    createTaxReportingExportPayload(INITIAL_TAX_SCHEDULES),
  ];

  const decoder = new TextDecoder();
  for (const p of payloads) {
    assert.ok(p.filenameBase.startsWith('monolith-'));
    assert.ok(p.csv.includes('\r\n'));
    const pdfStr = decoder.decode(p.pdf);
    assert.ok(pdfStr.startsWith('%PDF-1.4\n'));
    assert.ok(pdfStr.trimEnd().endsWith('%%EOF'));
  }
});

test('searchGlobalAccountingRecords matches journal entries, GL accounts, and bank transactions', () => {
  const emptyRes = searchGlobalAccountingRecords('   ', INITIAL_JOURNAL_ENTRIES, INITIAL_BANK_FEED);
  assert.equal(emptyRes.totalCount, 0);

  // Search by account code "1010" matches account 1010 and journal entries touching 1010
  const cashRes = searchGlobalAccountingRecords('1010', INITIAL_JOURNAL_ENTRIES, INITIAL_BANK_FEED);
  assert.equal(cashRes.accounts.length, 1);
  assert.equal(cashRes.accounts[0].code, '1010');
  assert.equal(cashRes.accounts[0].closingBalance, 1490700);
  assert.ok(cashRes.journalEntries.length >= 3);

  // Search by counterparty/keyword "Stripe" or "AWS" or "Rippling"
  const awsRes = searchGlobalAccountingRecords('AWS', INITIAL_JOURNAL_ENTRIES, INITIAL_BANK_FEED);
  assert.ok(awsRes.journalEntries.length >= 1);
  assert.ok(awsRes.bankTransactions.length >= 1);
});

test('getTranslations and FONT_SIZE_ROOT_PX support all locales and font scales', () => {
  assert.equal(getTranslations('en').nav.overview, 'Overview');
  assert.ok(getTranslations('zh').nav.overview.includes('财务总览'));
  assert.equal(getTranslations('es').nav.overview, 'Resumen');
  assert.ok(getTranslations('ja').nav.overview.includes('概要'));
  assert.equal(getTranslations('en').nav.auditLog, 'Audit Log');
  assert.equal(getTranslations('zh').nav.auditLog, '审计日志');
  assert.equal(getTranslations('es').nav.auditLog, 'Auditoría');
  assert.equal(getTranslations('ja').nav.auditLog, '監査ログ');
  assert.equal(FONT_SIZE_ROOT_PX.sm, '14.5px');
  assert.equal(FONT_SIZE_ROOT_PX.md, '16px');
  assert.equal(FONT_SIZE_ROOT_PX.lg, '17.5px');
});

test('AuditLogEntry integrity, filtering, and export builder', () => {
  assert.ok(INITIAL_AUDIT_LOGS.length >= 5);

  // Deterministic hash generation
  const hash1 = generateAuditHash('AUD-01', '2026-10-16 12:00:00 UTC', 'user@test.com', 'JE-100', 'Test memo');
  const hash2 = generateAuditHash('AUD-01', '2026-10-16 12:00:00 UTC', 'user@test.com', 'JE-100', 'Test memo');
  assert.equal(hash1, hash2);
  assert.ok(hash1.startsWith('sha256-'));

  // Filtering by category
  const journalLogs = filterAuditLogs(INITIAL_AUDIT_LOGS, { category: 'Journal Entry' });
  assert.ok(journalLogs.every((l) => l.category === 'Journal Entry'));
  assert.ok(journalLogs.length >= 3);

  const reconLogs = filterAuditLogs(INITIAL_AUDIT_LOGS, { category: 'Bank Reconciliation' });
  assert.ok(reconLogs.every((l) => l.category === 'Bank Reconciliation'));
  assert.ok(reconLogs.length >= 2);

  // Filtering by actorType
  const userLogs = filterAuditLogs(INITIAL_AUDIT_LOGS, { actorType: 'User' });
  assert.ok(userLogs.every((l) => l.actorType === 'User'));
  assert.ok(userLogs.length >= 1);

  // Filtering by search query
  const queryLogs = filterAuditLogs(INITIAL_AUDIT_LOGS, { searchQuery: 'Vaneck' });
  assert.ok(queryLogs.length >= 2);

  // Export payload generation
  const payload = createAuditLogExportPayload(INITIAL_AUDIT_LOGS);
  assert.equal(payload.filenameBase, 'monolith-audit-trail-register');
  assert.ok(payload.csv.includes('AUDIT ID,TIMESTAMP (UTC),ACTOR TYPE'));
  assert.ok(payload.csv.includes('AUD-2026-1005'));
  assert.ok(payload.csv.includes('\r\n'));

  const decoder = new TextDecoder();
  const pdfStr = decoder.decode(payload.pdf);
  assert.ok(pdfStr.startsWith('%PDF-1.4\n'));
  assert.ok(pdfStr.trimEnd().endsWith('%%EOF'));
});

test('Receivables, Payables, Fixed Assets, and Period Close summaries and exports', () => {
  // 1. AR Summary
  const ar = computeReceivablesSummary(INITIAL_RECEIVABLES);
  assert.equal(ar.totalOutstanding, 375000);
  assert.equal(ar.currentAmount, 215000);
  assert.equal(ar.pastDueAmount, 160000);
  assert.equal(ar.collectedAmount, 185000);
  assert.equal(ar.openCount, 2);
  assert.equal(ar.overdueCount, 2);
  assert.equal(ar.paidCount, 1);

  // 2. AP Summary
  const ap = computePayablesSummary(INITIAL_PAYABLES);
  assert.equal(ap.totalOpenAp, 112000);
  assert.equal(ap.approvedAmount, 84500);
  assert.equal(ap.pendingAmount, 27500);
  assert.equal(ap.paidAmount, 24000);
  assert.equal(ap.approvedCount, 2);
  assert.equal(ap.pendingCount, 2);
  assert.equal(ap.paidCount, 1);

  // 3. Fixed Assets
  const fa = computeFixedAssetMetrics(INITIAL_FIXED_ASSETS);
  assert.equal(fa.totalCostBasis, 600000);
  assert.equal(fa.totalAccumulatedDepreciation, 124600);
  assert.equal(fa.totalNetBookValue, 475400);
  assert.equal(fa.totalMonthlyDepreciation, 13600);

  // 4. Period Close
  const pc = computePeriodCloseSummary(
    INITIAL_CLOSE_CHECKLIST,
    INITIAL_AMORTIZATION_SCHEDULES,
    false
  );
  assert.equal(pc.completedTasks, 3);
  assert.equal(pc.totalTasks, 6);
  assert.equal(pc.completionPct, 50);
  assert.equal(pc.unamortizedDeferredRevenue, 230000);
  assert.equal(pc.unamortizedPrepaidExpense, 72000);
  assert.equal(pc.pendingRecognitionTotal, 47000);

  // 5. Translations
  assert.equal(getTranslations('en').nav.receivables, 'Receivables');
  assert.equal(getTranslations('zh').nav.payables, '应付账款');
  assert.equal(getTranslations('es').nav.fixedAssets, 'Activos Fijos');
  assert.equal(getTranslations('ja').nav.periodClose, '月次決算');

  // 6. Export payloads
  const exports = [
    createReceivablesExportPayload(INITIAL_RECEIVABLES),
    createPayablesExportPayload(INITIAL_PAYABLES),
    createFixedAssetsExportPayload(INITIAL_FIXED_ASSETS),
    createPeriodCloseExportPayload(
      INITIAL_CLOSE_CHECKLIST,
      INITIAL_AMORTIZATION_SCHEDULES,
      false
    ),
  ];
  const decoder = new TextDecoder();
  for (const exp of exports) {
    assert.ok(exp.filenameBase.startsWith('monolith-'));
    assert.ok(exp.csv.includes('\r\n'));
    const pdfStr = decoder.decode(exp.pdf);
    assert.ok(pdfStr.startsWith('%PDF-1.4\n'));
    assert.ok(pdfStr.trimEnd().endsWith('%%EOF'));
  }
});






test('draft journals do not affect the ledger, trial balance, or cash statements', () => {
  const draft = { ...INITIAL_JOURNAL_ENTRIES[0], id: 'DRAFT-TEST', status: 'Draft' as const };
  assert.deepEqual(computeTrialBalance([...INITIAL_JOURNAL_ENTRIES, draft]), computeTrialBalance(INITIAL_JOURNAL_ENTRIES));
  assert.deepEqual(computeFinancialStatements([...INITIAL_JOURNAL_ENTRIES, draft]), computeFinancialStatements(INITIAL_JOURNAL_ENTRIES));
});

test('non-cash depreciation reduces net assets and profit while preserving cash reconciliation', async () => {
  const { CHART_OF_ACCOUNTS } = await import('./accountingLogic.ts');
  const accounts = [...CHART_OF_ACCOUNTS,
    { code: '1590', name: 'Accumulated depreciation', category: 'Asset' as const, normalBalance: 'credit' as const, openingBalance: 0 },
    { code: '6900', name: 'Depreciation expense', category: 'Expense' as const, normalBalance: 'debit' as const, openingBalance: 0 }];
  const entry = { id: 'DEPR-TEST', date: '2026-10-17', reference: 'DEPR', memo: 'Depreciation', source: 'System Accrual' as const, status: 'Posted' as const,
    lines: [{ id: 'a', accountCode: '6900', accountName: 'Depreciation expense', description: 'Monthly', debit: 100, credit: 0 },
      { id: 'b', accountCode: '1590', accountName: 'Accumulated depreciation', description: 'Monthly', debit: 0, credit: 100 }] };
  const before = computeFinancialStatements(INITIAL_JOURNAL_ENTRIES, accounts);
  const after = computeFinancialStatements([...INITIAL_JOURNAL_ENTRIES, entry], accounts);
  assert.equal(after.totalAssets, before.totalAssets - 100);
  assert.equal(after.netIncome, before.netIncome - 100);
  assert.equal(after.cashFlow.endingCash, before.cashFlow.endingCash);
  assert.equal(after.isBalanceSheetBalanced, true);
  assert.equal(after.cashFlow.isCashReconciled, true);
});

test('live cash Sankey changes only for posted cash movements', async () => {
  const { buildLiveCashSankeyDataset } = await import('./accountingLogic.ts');
  const dataset = buildLiveCashSankeyDataset(INITIAL_JOURNAL_ENTRIES);
  const draft = { ...INITIAL_JOURNAL_ENTRIES[0], id: 'DRAFT', status: 'Draft' as const };
  assert.deepEqual(buildLiveCashSankeyDataset([...INITIAL_JOURNAL_ENTRIES, draft]), dataset);
  for (const link of dataset.links) {
    assert(link.value > 0);
    assert(dataset.nodes.some(node => node.id === link.source));
    assert(dataset.nodes.some(node => node.id === link.target));
  }
});
