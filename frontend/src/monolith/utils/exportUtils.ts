import type {
  JournalEntry,
  BankFeedItem,
  LedgerCashItem,
  ReconciliationSummary,
  TaxJurisdictionSchedule,
  PeriodSankeyDataset,
  AccountCategory,
  BudgetVarianceReport,
  RollingForecastReport,
  AuditLogEntry,
  ReceivableInvoice,
  PayableBill,
  FixedAssetItem,
  CloseChecklistItem,
  AmortizationScheduleItem,
} from './accountingLogic.ts';
import {
  computeGeneralLedgerByAccount,
  computeTrialBalance,
  computeFinancialStatements,
  computeTaxScheduleLiability,
  computeReceivablesSummary,
  computePayablesSummary,
  computeFixedAssetMetrics,
  computePeriodCloseSummary,
  formatCurrency,
} from './accountingLogic.ts';

export interface PdfTableSection {
  sectionTitle: string;
  headers: string[];
  columnWidths: number[]; // character widths out of ~92 chars per line in 8.5pt Courier
  alignRight?: boolean[];
  rows: (string | number)[][];
}

export interface PdfReportDocument {
  title: string;
  subtitle: string;
  metrics: { label: string; value: string }[];
  sections: PdfTableSection[];
}

/**
 * Escapes a single cell value according to RFC 4180 CSV rules.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Builds a complete CSV string from headers and rows.
 */
export function buildCsvContent(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...bodyLines].join('\r\n') + '\r\n';
}

/**
 * Escapes characters for a PDF literal string (...)
 */
function escapePdfString(text: string): string {
  // Replace non-ASCII dashes/bullets with clean ASCII equivalents for Type1 Courier
  const ascii = text
    .replace(/[—–]/g, '-')
    .replace(/·/g, '|')
    .replace(/[^\x20-\x7E]/g, '');
  return ascii
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Pads or truncates a string to a fixed character width for tabular alignment.
 */
function formatFixedColumn(
  text: string | number,
  width: number,
  alignRight = false
): string {
  const clean = String(text ?? '')
    .replace(/[—–]/g, '-')
    .replace(/·/g, '|')
    .replace(/[^\x20-\x7E]/g, '');
  if (clean.length > width) {
    return width > 2 ? clean.slice(0, width - 1) + '.' : clean.slice(0, width);
  }
  return alignRight ? clean.padStart(width, ' ') : clean.padEnd(width, ' ');
}

/**
 * Generates a valid, standards-compliant PDF 1.4 binary document (Uint8Array)
 * using Type1 Courier and Courier-Bold fonts and vector hairline rules.
 */
export function buildPdfBytes(doc: PdfReportDocument): Uint8Array {
  interface LineOp {
    text: string;
    bold?: boolean;
    size?: number;
    ruleAbove?: boolean;
    ruleBelow?: boolean;
    spacingAfter?: number;
  }

  const ops: LineOp[] = [];

  // Header
  ops.push({ text: 'MONOLITH LEDGER', bold: true, size: 13, spacingAfter: 15 });
  ops.push({ text: doc.title.toUpperCase(), bold: true, size: 11, spacingAfter: 13 });
  ops.push({
    text: `${doc.subtitle}  |  EXPORTED 2026-10-16`,
    bold: false,
    size: 8.5,
    ruleBelow: true,
    spacingAfter: 18,
  });

  // Summary Metrics Strip
  if (doc.metrics.length > 0) {
    const metricLine = doc.metrics
      .map((m) => `${m.label}: ${m.value}`)
      .join('    |    ');
    ops.push({
      text: metricLine,
      bold: true,
      size: 8.5,
      ruleBelow: true,
      spacingAfter: 18,
    });
  }

  // Sections & Tables
  for (const section of doc.sections) {
    ops.push({
      text: section.sectionTitle.toUpperCase(),
      bold: true,
      size: 9,
      spacingAfter: 13,
    });

    const headerRowText = section.headers
      .map((h, idx) =>
        formatFixedColumn(
          h,
          section.columnWidths[idx] || 14,
          section.alignRight?.[idx] ?? false
        )
      )
      .join('  ');

    ops.push({
      text: headerRowText,
      bold: true,
      size: 8,
      ruleAbove: true,
      ruleBelow: true,
      spacingAfter: 13,
    });

    for (const row of section.rows) {
      const formattedLine = row
        .map((cell, idx) =>
          formatFixedColumn(
            cell,
            section.columnWidths[idx] || 14,
            section.alignRight?.[idx] ?? false
          )
        )
        .join('  ');
      ops.push({
        text: formattedLine,
        bold: false,
        size: 8,
        spacingAfter: 11.5,
      });
    }

    ops.push({ text: '', size: 8, ruleAbove: true, spacingAfter: 14 });
  }

  // Paginate operations (US Letter: 612 x 792 pt)
  const pageStreams: string[] = [];
  let currentCommands: string[] = [];
  let y = 744;

  const flushPage = () => {
    if (currentCommands.length > 0) {
      pageStreams.push(currentCommands.join('\n'));
      currentCommands = [];
    }
    y = 744;
  };

  for (const op of ops) {
    const step = op.spacingAfter ?? 12;
    if (y - step < 48) {
      flushPage();
    }

    if (op.ruleAbove) {
      const ruleY = (y + 8.5).toFixed(1);
      currentCommands.push(`0.5 w 0.15 G 40 ${ruleY} m 572 ${ruleY} l S`);
    }

    if (op.text) {
      const fontRef = op.bold ? '/F2' : '/F1';
      const fontSize = op.size ?? 8.5;
      currentCommands.push(
        `BT ${fontRef} ${fontSize} Tf 0 g 40 ${y.toFixed(1)} Td (${escapePdfString(op.text)}) Tj ET`
      );
    }

    if (op.ruleBelow) {
      const ruleY = (y - 4.5).toFixed(1);
      currentCommands.push(`0.5 w 0.15 G 40 ${ruleY} m 572 ${ruleY} l S`);
    }

    y -= step;
  }

  if (currentCommands.length > 0 || pageStreams.length === 0) {
    flushPage();
  }

  // Assemble PDF objects
  // Obj 1: Catalog, Obj 2: Pages, Obj 3: Font /F1, Obj 4: Font /F2
  // Then for each page i: Page object + Content stream object
  const objects: string[] = [];
  const pageObjNumbers: number[] = [];

  // Placeholder for Obj 1 and Obj 2
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(''); // filled after page object numbers are known
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');

  for (const streamContent of pageStreams) {
    const pageObjNum = objects.length + 1;
    const contentObjNum = objects.length + 2;
    pageObjNumbers.push(pageObjNum);

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>`
    );
    objects.push(
      `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`
    );
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNumbers.length} >>`;

  // Serialize with accurate byte offsets
  let pdfText = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdfText.length);
    pdfText += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = pdfText.length;
  pdfText += `xref\n0 ${objects.length + 1}\n`;
  pdfText += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    const offStr = String(offsets[i]).padStart(10, '0');
    pdfText += `${offStr} 00000 n \n`;
  }

  pdfText += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdfText);
}

/**
 * Triggers a client-side file download in the browser without window.open or window.alert.
 */
export function triggerBrowserDownload(
  filename: string,
  data: string | Uint8Array,
  mimeType: string
): void {
  if (typeof document === 'undefined') return;

  const blob =
    typeof data === 'string'
      ? new Blob(['\uFEFF' + data], { type: mimeType })
      : new Blob([new Uint8Array(data)], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================================
 * MODULE-SPECIFIC EXPORT PAYLOAD BUILDERS (CSV & PDF)
 * ========================================================================== */

export function createOverviewExportPayload(
  dataset: PeriodSankeyDataset,
  chartMode: 'cashflow' | 'pnl',
  reconSummary: ReconciliationSummary,
  totalNetTaxLiability: number,
  entries: JournalEntry[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const modeLabel = chartMode === 'cashflow' ? 'Cash Flow' : 'P&L';
  const gross = dataset.nodes.find((n) => n.id === 'gross_inflow')?.value ?? 0;
  const net = dataset.nodes.find((n) => n.id === 'net_treasury')?.value ?? 0;

  const csvRows: (string | number)[][] = [
    ['OVERVIEW KPI', 'Gross Inflow / Revenue', '', gross],
    ['OVERVIEW KPI', 'Net Surplus / Income', '', net],
    ['OVERVIEW KPI', 'Ledger Cash Balance', '', reconSummary.ledgerEndingBalance],
    ['OVERVIEW KPI', 'Accrued Tax Reserve', '', totalNetTaxLiability],
    ...dataset.nodes.map((n) => [
      `${modeLabel.toUpperCase()} SANKEY NODE`,
      n.label,
      n.category,
      n.value,
    ]),
    ...entries.map((e) => [
      'RECENT JOURNAL',
      `${e.id} (${e.date})`,
      e.memo,
      e.lines.reduce((s, l) => s + l.debit, 0),
    ]),
  ];

  const csv = buildCsvContent(['SECTION', 'ITEM', 'CATEGORY / MEMO', 'AMOUNT (USD)'], csvRows);

  const pdf = buildPdfBytes({
    title: `Executive Overview — ${modeLabel} (${dataset.periodLabel})`,
    subtitle: 'Monolith Agentic Accounting System',
    metrics: [
      { label: modeLabel === 'Cash Flow' ? 'Gross Inflow' : 'Total Revenue', value: formatCurrency(gross) },
      { label: modeLabel === 'Cash Flow' ? 'Net Free Cash' : 'Net Income', value: formatCurrency(net) },
      { label: 'Cash Balance', value: formatCurrency(reconSummary.ledgerEndingBalance) },
      { label: 'Tax Reserve', value: formatCurrency(totalNetTaxLiability) },
    ],
    sections: [
      {
        sectionTitle: `${modeLabel} Sankey Nodes (${dataset.periodLabel})`,
        headers: ['NODE ID', 'LABEL', 'STAGE', 'AMOUNT'],
        columnWidths: [16, 34, 14, 16],
        alignRight: [false, false, false, true],
        rows: dataset.nodes.map((n) => [
          n.id,
          n.label,
          n.category.toUpperCase(),
          formatCurrency(n.value),
        ]),
      },
      {
        sectionTitle: 'Recent General Ledger Entries',
        headers: ['ENTRY ID', 'DATE', 'MEMO', 'TOTAL'],
        columnWidths: [14, 12, 38, 16],
        alignRight: [false, false, false, true],
        rows: entries.slice(0, 10).map((e) => [
          e.id,
          e.date,
          e.memo,
          formatCurrency(e.lines.reduce((s, l) => s + l.debit, 0)),
        ]),
      },
    ],
  });

  return {
    filenameBase: `monolith-overview-${chartMode}-${dataset.periodLabel.toLowerCase().replace(/\s+/g, '-')}`,
    csv,
    pdf,
  };
}

export function createJournalEntriesExportPayload(
  entries: JournalEntry[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const flatRows: (string | number)[][] = [];
  for (const entry of entries) {
    const attachmentNames =
      entry.attachments && entry.attachments.length > 0
        ? entry.attachments.map((a) => a.name).join('; ')
        : '';
    for (const line of entry.lines) {
      flatRows.push([
        entry.id,
        entry.date,
        entry.reference,
        entry.source,
        entry.memo,
        line.accountCode,
        line.accountName,
        line.description,
        line.debit,
        line.credit,
        attachmentNames,
      ]);
    }
  }

  const csv = buildCsvContent(
    [
      'ENTRY ID',
      'DATE',
      'REFERENCE',
      'SOURCE',
      'MEMO',
      'ACCOUNT CODE',
      'ACCOUNT NAME',
      'LINE DESCRIPTION',
      'DEBIT',
      'CREDIT',
      'ATTACHMENTS',
    ],
    flatRows
  );

  const totalVolume = entries.reduce(
    (sum, e) => sum + e.lines.reduce((s, l) => s + l.debit, 0),
    0
  );

  const pdf = buildPdfBytes({
    title: 'Double-Entry Journal Register',
    subtitle: `${entries.length} Posted Journal Entries`,
    metrics: [
      { label: 'Posted Entries', value: String(entries.length) },
      { label: 'Total Debit Volume', value: formatCurrency(totalVolume) },
      { label: 'Total Credit Volume', value: formatCurrency(totalVolume) },
    ],
    sections: [
      {
        sectionTitle: 'Journal Entry Line Postings',
        headers: ['ENTRY ID', 'DATE', 'ACCT', 'ACCOUNT / MEMO', 'DEBIT', 'CREDIT'],
        columnWidths: [13, 10, 6, 27, 12, 12],
        alignRight: [false, false, false, false, true, true],
        rows: flatRows.map((r) => [
          r[0],
          r[1],
          r[5],
          `${r[6]} (${r[4]})`,
          Number(r[8]) > 0 ? formatCurrency(Number(r[8])) : '-',
          Number(r[9]) > 0 ? formatCurrency(Number(r[9])) : '-',
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-journal-entries-q4-2026',
    csv,
    pdf,
  };
}

export function createGeneralLedgerExportPayload(
  entries: JournalEntry[],
  categoryFilter: 'ALL' | AccountCategory = 'ALL',
  accountFilter = 'ALL'
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const allLedgers = computeGeneralLedgerByAccount(entries).filter((gl) => {
    if (categoryFilter !== 'ALL' && gl.account.category !== categoryFilter) return false;
    if (accountFilter !== 'ALL' && gl.account.code !== accountFilter) return false;
    return true;
  });

  const csvRows: (string | number)[][] = [];
  for (const gl of allLedgers) {
    csvRows.push([
      gl.account.code,
      gl.account.name,
      gl.account.category,
      'OPENING',
      '',
      'Opening Balance',
      0,
      0,
      gl.openingBalance,
    ]);
    for (const p of [...gl.postings].reverse()) {
      csvRows.push([
        gl.account.code,
        gl.account.name,
        gl.account.category,
        p.date,
        p.entryId,
        p.memo,
        p.debit,
        p.credit,
        p.runningBalance,
      ]);
    }
    csvRows.push([
      gl.account.code,
      gl.account.name,
      gl.account.category,
      'CLOSING',
      '',
      'Ending Balance',
      gl.periodDebits,
      gl.periodCredits,
      gl.endingBalance,
    ]);
  }

  const csv = buildCsvContent(
    [
      'ACCOUNT CODE',
      'ACCOUNT NAME',
      'CATEGORY',
      'DATE',
      'ENTRY ID',
      'MEMO',
      'DEBIT',
      'CREDIT',
      'RUNNING BALANCE',
    ],
    csvRows
  );

  const pdf = buildPdfBytes({
    title: 'General Ledger Report',
    subtitle: `Filter: ${categoryFilter} | Accounts: ${allLedgers.length}`,
    metrics: [
      { label: 'Accounts Included', value: String(allLedgers.length) },
      { label: 'Posted Journals', value: String(entries.length) },
    ],
    sections: [
      {
        sectionTitle: 'Account Balances & Period Activity',
        headers: ['CODE', 'ACCOUNT NAME', 'TYPE', 'OPENING', 'DR', 'CR', 'ENDING'],
        columnWidths: [6, 26, 9, 11, 10, 10, 11],
        alignRight: [false, false, false, true, true, true, true],
        rows: allLedgers.map((g) => [
          g.account.code,
          g.account.name,
          g.account.category,
          formatCurrency(g.openingBalance),
          formatCurrency(g.periodDebits),
          formatCurrency(g.periodCredits),
          formatCurrency(g.endingBalance),
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-general-ledger-q4-2026',
    csv,
    pdf,
  };
}

export function createTrialBalanceExportPayload(
  entries: JournalEntry[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const report = computeTrialBalance(entries);

  const csvRows: (string | number)[][] = [
    ...report.rows.map((r) => [
      r.code,
      r.name,
      r.category,
      r.openingBalance,
      r.periodDebits,
      r.periodCredits,
      r.debitBalance,
      r.creditBalance,
    ]),
    [
      'TOTAL',
      'Trial Balance Totals',
      '',
      '',
      report.totalPeriodDebits,
      report.totalPeriodCredits,
      report.totalDebitBalance,
      report.totalCreditBalance,
    ],
  ];

  const csv = buildCsvContent(
    [
      'ACCOUNT CODE',
      'ACCOUNT NAME',
      'CATEGORY',
      'OPENING BALANCE',
      'PERIOD DEBITS',
      'PERIOD CREDITS',
      'ENDING DEBIT',
      'ENDING CREDIT',
    ],
    csvRows
  );

  const pdf = buildPdfBytes({
    title: 'Trial Balance Schedule — Q4 2026',
    subtitle: report.isBalanced ? 'Status: Strictly In Balance (Debits = Credits)' : 'Status: Out of Balance',
    metrics: [
      { label: 'Ending Debits', value: formatCurrency(report.totalDebitBalance) },
      { label: 'Ending Credits', value: formatCurrency(report.totalCreditBalance) },
      { label: 'Period Activity', value: formatCurrency(report.totalPeriodDebits) },
    ],
    sections: [
      {
        sectionTitle: 'Trial Balance by General Ledger Account',
        headers: ['CODE', 'ACCOUNT NAME', 'TYPE', 'PERIOD DR', 'PERIOD CR', 'END DEBIT', 'END CREDIT'],
        columnWidths: [6, 26, 9, 10, 10, 11, 11],
        alignRight: [false, false, false, true, true, true, true],
        rows: [
          ...report.rows.map((r) => [
            r.code,
            r.name,
            r.category,
            r.periodDebits > 0 ? formatCurrency(r.periodDebits) : '-',
            r.periodCredits > 0 ? formatCurrency(r.periodCredits) : '-',
            r.debitBalance > 0 ? formatCurrency(r.debitBalance) : '-',
            r.creditBalance > 0 ? formatCurrency(r.creditBalance) : '-',
          ]),
          [
            'TOTAL',
            'ALL ACCOUNTS',
            '',
            formatCurrency(report.totalPeriodDebits),
            formatCurrency(report.totalPeriodCredits),
            formatCurrency(report.totalDebitBalance),
            formatCurrency(report.totalCreditBalance),
          ],
        ],
      },
    ],
  });

  return {
    filenameBase: 'monolith-trial-balance-q4-2026',
    csv,
    pdf,
  };
}

export function createFinancialStatementsExportPayload(
  entries: JournalEntry[],
  activeStatement: 'pl' | 'bs' | 'cf'
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const fs = computeFinancialStatements(entries);

  const csvRows: (string | number)[][] = [
    ...fs.revenues.map((r) => ['Income Statement (P&L)', 'Revenue', r.code, r.name, r.amount]),
    ['Income Statement (P&L)', 'Subtotal', '', 'Total Revenue', fs.totalRevenue],
    ...fs.operatingExpenses.map((e) => ['Income Statement (P&L)', 'Operating Expense', e.code, e.name, e.amount]),
    ['Income Statement (P&L)', 'Subtotal', '', 'Total Operating Expenses', fs.totalOperatingExpenses],
    ['Income Statement (P&L)', 'Subtotal', '', 'Operating Income (EBITDA)', fs.operatingIncome],
    ['Income Statement (P&L)', 'Tax', '6800', 'Corporate Tax Provision Expense', -fs.taxExpense],
    ['Income Statement (P&L)', 'Total', '', 'Net Income', fs.netIncome],
    ...fs.assets.map((a) => ['Balance Sheet', 'Asset', a.code, a.name, a.amount]),
    ['Balance Sheet', 'Total', '', 'Total Assets', fs.totalAssets],
    ...fs.liabilities.map((l) => ['Balance Sheet', 'Liability', l.code, l.name, l.amount]),
    ['Balance Sheet', 'Subtotal', '', 'Total Liabilities', fs.totalLiabilities],
    ...fs.equity.map((e) => ['Balance Sheet', 'Equity', e.code, e.name, e.amount]),
    ['Balance Sheet', 'Subtotal', '', 'Total Equity', fs.totalEquity],
    ['Balance Sheet', 'Total', '', 'Total Liabilities & Equity', fs.totalLiabilitiesAndEquity],
    ['Cash Flow Statement', 'Operating', '3900', 'Net Income', fs.cashFlow.netIncome],
    ...fs.cashFlow.workingCapitalAdjustments.map((w) => ['Cash Flow Statement', 'Working Capital', w.code, w.name, w.amount]),
    ['Cash Flow Statement', 'Subtotal', '', 'Net Cash Provided by Operating Activities', fs.cashFlow.netCashFromOperating],
    ['Cash Flow Statement', 'Summary', '', 'Beginning Cash & Equivalents', fs.cashFlow.beginningCash],
    ['Cash Flow Statement', 'Total', '', 'Ending Cash & Equivalents', fs.cashFlow.endingCash],
  ];

  const csv = buildCsvContent(
    ['STATEMENT', 'SECTION', 'ACCOUNT CODE', 'LINE ITEM', 'AMOUNT (USD)'],
    csvRows
  );

  const statementTitle =
    activeStatement === 'pl'
      ? 'Income Statement (P&L)'
      : activeStatement === 'bs'
      ? 'Balance Sheet'
      : 'Cash Flow Statement';

  const pdf = buildPdfBytes({
    title: `Financial Statements — ${statementTitle}`,
    subtitle: 'Complete Three-Statement Package (P&L, Balance Sheet, Cash Flow)',
    metrics: [
      { label: 'Total Revenue', value: formatCurrency(fs.totalRevenue) },
      { label: 'Net Income', value: formatCurrency(fs.netIncome) },
      { label: 'Total Assets', value: formatCurrency(fs.totalAssets) },
      { label: 'Ending Cash', value: formatCurrency(fs.cashFlow.endingCash) },
    ],
    sections: [
      {
        sectionTitle: '1. Income Statement (P&L)',
        headers: ['CODE', 'LINE ITEM', 'CATEGORY', 'AMOUNT'],
        columnWidths: [8, 42, 16, 16],
        alignRight: [false, false, false, true],
        rows: [
          ...fs.revenues.map((r) => [r.code, r.name, 'Revenue', formatCurrency(r.amount)]),
          ['', 'Total Revenue', 'Subtotal', formatCurrency(fs.totalRevenue)],
          ...fs.operatingExpenses.map((e) => [e.code, e.name, 'OpEx', formatCurrency(e.amount)]),
          ['', 'Operating Income (EBITDA)', 'Subtotal', formatCurrency(fs.operatingIncome)],
          ['6800', 'Corporate Tax Provision', 'Tax', `-${formatCurrency(fs.taxExpense)}`],
          ['', `Net Income (${fs.netMarginPct}% Margin)`, 'Bottom Line', formatCurrency(fs.netIncome)],
        ],
      },
      {
        sectionTitle: '2. Balance Sheet',
        headers: ['CODE', 'LINE ITEM', 'SECTION', 'BALANCE'],
        columnWidths: [8, 42, 16, 16],
        alignRight: [false, false, false, true],
        rows: [
          ...fs.assets.map((a) => [a.code, a.name, 'Asset', formatCurrency(a.amount)]),
          ['', 'Total Assets', 'Total', formatCurrency(fs.totalAssets)],
          ...fs.liabilities.map((l) => [l.code, l.name, 'Liability', formatCurrency(l.amount)]),
          ...fs.equity.map((e) => [e.code, e.name, 'Equity', formatCurrency(e.amount)]),
          ['', 'Total Liabilities & Equity', 'Total', formatCurrency(fs.totalLiabilitiesAndEquity)],
        ],
      },
      {
        sectionTitle: '3. Cash Flow Statement',
        headers: ['CODE', 'LINE ITEM', 'ACTIVITY', 'CASH FLOW'],
        columnWidths: [8, 42, 16, 16],
        alignRight: [false, false, false, true],
        rows: [
          ['3900', 'Net Income', 'Operating', formatCurrency(fs.cashFlow.netIncome, true)],
          ...fs.cashFlow.workingCapitalAdjustments.map((w) => [
            w.code,
            w.name,
            'Working Cap',
            formatCurrency(w.amount, true),
          ]),
          ['', 'Net Cash from Operating Activities', 'Subtotal', formatCurrency(fs.cashFlow.netCashFromOperating, true)],
          ['', 'Beginning Cash & Equivalents', 'Opening', formatCurrency(fs.cashFlow.beginningCash)],
          ['', 'Ending Cash & Equivalents', 'Closing', formatCurrency(fs.cashFlow.endingCash)],
        ],
      },
    ],
  });

  return {
    filenameBase: `monolith-financial-statements-${activeStatement}-q4-2026`,
    csv,
    pdf,
  };
}

export function createBankReconciliationExportPayload(
  bankItems: BankFeedItem[],
  ledgerCashItems: LedgerCashItem[],
  summary: ReconciliationSummary
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const csvRows: (string | number)[][] = [
    ...bankItems.map((b) => [
      'BANK FEED',
      b.id,
      b.date,
      b.bankReference,
      b.counterparty,
      b.status,
      b.matchedLedgerId || b.suggestedLedgerId || '',
      b.amount,
    ]),
    ...ledgerCashItems.map((l) => [
      'GL CASH (1010)',
      l.id,
      l.date,
      l.entryId,
      l.memo,
      l.reconciled ? 'Cleared' : 'Open',
      '',
      l.amount,
    ]),
  ];

  const csv = buildCsvContent(
    [
      'SOURCE',
      'ID',
      'DATE',
      'REFERENCE / ENTRY',
      'COUNTERPARTY / MEMO',
      'STATUS',
      'MATCHED / SUGGESTED GL',
      'AMOUNT (USD)',
    ],
    csvRows
  );

  const pdf = buildPdfBytes({
    title: 'Bank Reconciliation Schedule — Account 1010',
    subtitle: `Reconciled: ${summary.reconciliationRate}%  |  Variance: ${formatCurrency(summary.unreconciledDelta)}`,
    metrics: [
      { label: 'Bank Ending', value: formatCurrency(summary.bankEndingBalance) },
      { label: 'Ledger Ending', value: formatCurrency(summary.ledgerEndingBalance) },
      { label: 'Variance', value: formatCurrency(summary.unreconciledDelta) },
      { label: 'Reconciled', value: `${summary.reconciliationRate}%` },
    ],
    sections: [
      {
        sectionTitle: 'Bank Statement Feed Lines',
        headers: ['ID', 'DATE', 'REFERENCE', 'COUNTERPARTY', 'STATUS', 'AMOUNT'],
        columnWidths: [8, 10, 13, 25, 11, 13],
        alignRight: [false, false, false, false, false, true],
        rows: bankItems.map((b) => [
          b.id,
          b.date,
          b.bankReference,
          b.counterparty,
          b.status,
          formatCurrency(b.amount, true),
        ]),
      },
      {
        sectionTitle: 'General Ledger Cash Lines (1010)',
        headers: ['ID', 'DATE', 'ENTRY ID', 'MEMO', 'STATUS', 'AMOUNT'],
        columnWidths: [8, 10, 13, 25, 11, 13],
        alignRight: [false, false, false, false, false, true],
        rows: ledgerCashItems.map((l) => [
          l.id,
          l.date,
          l.entryId,
          l.memo,
          l.reconciled ? 'Cleared' : 'Open',
          formatCurrency(l.amount, true),
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-bank-reconciliation-q4-2026',
    csv,
    pdf,
  };
}

export function createTaxReportingExportPayload(
  schedules: TaxJurisdictionSchedule[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const rowsWithComputed = schedules.map((s) => ({
    s,
    c: computeTaxScheduleLiability(s),
  }));

  const csvRows: (string | number)[][] = rowsWithComputed.map(({ s, c }) => [
    s.id,
    s.jurisdiction,
    s.formCode,
    s.taxType,
    s.period,
    s.dueDate,
    s.taxableBase,
    s.statutoryRate,
    c.grossLiability,
    s.creditsAndDeductions,
    c.netPayable,
    c.effectiveRate,
    s.status,
  ]);

  const csv = buildCsvContent(
    [
      'SCHEDULE ID',
      'JURISDICTION',
      'FORM',
      'TAX TYPE',
      'PERIOD',
      'DUE DATE',
      'TAXABLE BASE',
      'STATUTORY RATE (%)',
      'GROSS LIABILITY',
      'CREDITS',
      'NET PAYABLE',
      'EFFECTIVE RATE (%)',
      'STATUS',
    ],
    csvRows
  );

  const totalGross = rowsWithComputed.reduce((sum, r) => sum + r.c.grossLiability, 0);
  const totalCredits = rowsWithComputed.reduce((sum, r) => sum + r.s.creditsAndDeductions, 0);
  const totalNet = rowsWithComputed.reduce((sum, r) => sum + r.c.netPayable, 0);

  const pdf = buildPdfBytes({
    title: 'Multi-Jurisdiction Tax Provision & Filing Schedule',
    subtitle: 'FY / Q4 2026 Statutory Tax Workpapers',
    metrics: [
      { label: 'Gross Liability', value: formatCurrency(totalGross) },
      { label: 'Tax Credits', value: `-${formatCurrency(totalCredits)}` },
      { label: 'Net Tax Payable', value: formatCurrency(totalNet) },
    ],
    sections: [
      {
        sectionTitle: 'Jurisdiction Tax Schedules',
        headers: ['FORM', 'JURISDICTION', 'DUE', 'BASE', 'RATE', 'CREDITS', 'NET PAYABLE', 'STATUS'],
        columnWidths: [10, 20, 10, 10, 6, 9, 11, 10],
        alignRight: [false, false, false, true, true, true, true, false],
        rows: rowsWithComputed.map(({ s, c }) => [
          s.formCode,
          s.jurisdiction,
          s.dueDate,
          formatCurrency(s.taxableBase),
          `${s.statutoryRate}%`,
          formatCurrency(s.creditsAndDeductions),
          formatCurrency(c.netPayable),
          s.status,
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-tax-schedules-q4-2026',
    csv,
    pdf,
  };
}

export function createBudgetingExportPayload(
  report: BudgetVarianceReport
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const csvRows: (string | number)[][] = report.rows.map((r) => [
    r.accountCode,
    r.accountName,
    r.department,
    r.category,
    r.budget,
    r.actual,
    r.favorableDollar,
    `${r.utilizationPct}%`,
    r.status,
  ]);

  csvRows.push([
    'TOTAL-REV',
    'Total Revenue vs. Budget',
    'Revenue',
    'Revenue',
    report.totalBudgetRevenue,
    report.totalActualRevenue,
    report.revenueVariance,
    `${Math.round((report.totalActualRevenue / Math.max(1, report.totalBudgetRevenue)) * 1000) / 10}%`,
    report.revenueVariance >= 0 ? 'Favorable' : 'Below Target',
  ]);
  csvRows.push([
    'TOTAL-EXP',
    'Total Expenses vs. Budget',
    'All Departments',
    'Expense',
    report.totalBudgetExpense,
    report.totalActualExpense,
    report.expenseVariance,
    `${Math.round((report.totalActualExpense / Math.max(1, report.totalBudgetExpense)) * 1000) / 10}%`,
    report.expenseVariance >= 0 ? 'Favorable' : 'Over Budget',
  ]);
  csvRows.push([
    'NET-INC',
    'Net Income vs. Budget',
    'Consolidated',
    'Net Income',
    report.budgetNetIncome,
    report.actualNetIncome,
    report.netIncomeVariance,
    `${Math.round((report.actualNetIncome / Math.max(1, report.budgetNetIncome)) * 1000) / 10}%`,
    report.netIncomeVariance >= 0 ? 'Favorable' : 'Below Target',
  ]);

  const csv = buildCsvContent(
    [
      'CODE',
      'ACCOUNT NAME',
      'DEPARTMENT',
      'CATEGORY',
      'Q4 BUDGET',
      'Q4 ACTUAL (GL)',
      'FAVORABLE VARIANCE ($)',
      'UTILIZATION (%)',
      'STATUS',
    ],
    csvRows
  );

  const pdf = buildPdfBytes({
    title: 'Budget vs. Actual (BvA) Variance Report — Q4 2026',
    subtitle: 'Live General Ledger Actuals vs. Operating Budget Allocations',
    metrics: [
      { label: 'Budget Net Income', value: formatCurrency(report.budgetNetIncome) },
      { label: 'Actual Net Income', value: formatCurrency(report.actualNetIncome) },
      { label: 'Net Variance', value: formatCurrency(report.netIncomeVariance, true) },
    ],
    sections: [
      {
        sectionTitle: 'Department & Account Budget Variance Schedule',
        headers: ['CODE', 'ACCOUNT NAME', 'DEPT', 'BUDGET', 'ACTUAL', 'VAR ($)', 'UTIL%', 'STATUS'],
        columnWidths: [6, 24, 12, 10, 10, 10, 7, 11],
        alignRight: [false, false, false, true, true, true, true, false],
        rows: report.rows.map((r) => [
          r.accountCode,
          r.accountName,
          r.department,
          formatCurrency(r.budget),
          formatCurrency(r.actual),
          formatCurrency(r.favorableDollar, true),
          `${r.utilizationPct}%`,
          r.status,
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-budget-variance-q4-2026',
    csv,
    pdf,
  };
}

export function createForecastingExportPayload(
  forecast: RollingForecastReport
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const headers = ['LINE ITEM', ...forecast.quarters.map((q) => q.period)];

  const rows: (string | number)[][] = [
    ['Enterprise SaaS (4010)', ...forecast.quarters.map((q) => q.saasRevenue)],
    ['Usage & Advisory (4020/4030)', ...forecast.quarters.map((q) => q.usageAndServicesRevenue)],
    ['Total Revenue', ...forecast.quarters.map((q) => q.totalRevenue)],
    ['Cloud & GPU COGS (5010)', ...forecast.quarters.map((q) => q.cloudCogs)],
    ['Gross Profit', ...forecast.quarters.map((q) => q.grossProfit)],
    ['Gross Margin (%)', ...forecast.quarters.map((q) => `${q.grossMarginPct}%`)],
    ['R&D, GTM & G&A OpEx', ...forecast.quarters.map((q) => q.rndAndGtmOpex)],
    ['Total Operating Expenses', ...forecast.quarters.map((q) => q.totalOperatingExpenses)],
    ['Operating Income (EBITDA)', ...forecast.quarters.map((q) => q.ebitda)],
    ['EBITDA Margin (%)', ...forecast.quarters.map((q) => `${q.ebitdaMarginPct}%`)],
    ['Tax Provision (6800)', ...forecast.quarters.map((q) => q.taxProvision)],
    ['Net Income', ...forecast.quarters.map((q) => q.netIncome)],
    ['Projected Ending Cash', ...forecast.quarters.map((q) => q.endingCash)],
  ];

  const csv = buildCsvContent(headers, rows);

  const pdfRows: (string | number)[][] = [
    ['Total Revenue', ...forecast.quarters.map((q) => formatCurrency(q.totalRevenue))],
    ['Cloud & GPU COGS', ...forecast.quarters.map((q) => formatCurrency(q.cloudCogs))],
    ['Gross Profit', ...forecast.quarters.map((q) => formatCurrency(q.grossProfit))],
    ['R&D, GTM & G&A OpEx', ...forecast.quarters.map((q) => formatCurrency(q.rndAndGtmOpex))],
    ['Operating Income (EBITDA)', ...forecast.quarters.map((q) => formatCurrency(q.ebitda))],
    ['Tax Provision', ...forecast.quarters.map((q) => formatCurrency(q.taxProvision))],
    ['Net Income', ...forecast.quarters.map((q) => formatCurrency(q.netIncome))],
    ['Ending Cash Balance', ...forecast.quarters.map((q) => formatCurrency(q.endingCash))],
  ];

  const pdf = buildPdfBytes({
    title: `Rolling 4-Quarter Financial Forecast (${forecast.drivers.scenarioName})`,
    subtitle: `QoQ Rev Growth: ${forecast.drivers.quarterlyRevGrowthPct}% | Cloud COGS: ${forecast.drivers.cloudCogsRatioPct}% | OpEx Growth: ${forecast.drivers.quarterlyOpexGrowthPct}%`,
    metrics: [
      { label: 'FY 2027E Revenue', value: formatCurrency(forecast.fy2027TotalRevenue) },
      { label: 'FY 2027E Net Income', value: formatCurrency(forecast.fy2027TotalNetIncome) },
      { label: 'Exit Q4 2027E Cash', value: formatCurrency(forecast.fy2027EndingCash) },
    ],
    sections: [
      {
        sectionTitle: 'Quarterly Projection Schedule (Q4 2026 Actual -> Q4 2027E)',
        headers: ['METRIC', ...forecast.quarters.map((q) => q.period)],
        columnWidths: [24, 13, 13, 13, 13, 13],
        alignRight: [false, true, true, true, true, true],
        rows: pdfRows,
      },
    ],
  });

  return {
    filenameBase: `monolith-rolling-forecast-${forecast.drivers.scenarioId}-fy2027`,
    csv,
    pdf,
  };
}

export function createAuditLogExportPayload(
  logs: AuditLogEntry[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const headers = [
    'AUDIT ID',
    'TIMESTAMP (UTC)',
    'ACTOR TYPE',
    'ACTOR ID',
    'CATEGORY',
    'ACTION',
    'TARGET RECORD',
    'REFERENCE',
    'IMPACT AMOUNT',
    'SUMMARY',
    'DETAILS',
    'INTEGRITY HASH',
  ];

  const rows = logs.map((log) => [
    log.id,
    log.timestamp,
    log.actorType,
    log.actorId,
    log.category,
    log.action,
    log.targetId,
    log.targetReference || '—',
    log.impactAmount !== undefined ? log.impactAmount : '',
    log.summary,
    log.details || '',
    log.hash,
  ]);

  const csv = buildCsvContent(headers, rows);

  const totalModifications = logs.length;
  const journalActions = logs.filter((l) => l.category === 'Journal Entry').length;
  const reconActions = logs.filter((l) => l.category === 'Bank Reconciliation').length;
  const totalImpact = logs.reduce((sum, l) => sum + Math.abs(l.impactAmount || 0), 0);

  const pdf = buildPdfBytes({
    title: 'Monolith Ledger — Cryptographic Audit Trail',
    subtitle: 'Immutable Event Register | Generated: 2026-10-16 UTC',
    metrics: [
      { label: 'Total Events Logged', value: String(totalModifications) },
      { label: 'Journal Modifications', value: String(journalActions) },
      { label: 'Reconciliation Events', value: String(reconActions) },
      { label: 'Cumulative Impact', value: formatCurrency(totalImpact) },
    ],
    sections: [
      {
        sectionTitle: 'Audit Events Ledger (Chronological Descending)',
        headers: ['TIMESTAMP (UTC)', 'AUDIT ID', 'ACTOR', 'ACTION', 'TARGET', 'IMPACT', 'SUMMARY'],
        columnWidths: [18, 14, 16, 15, 12, 12, 28],
        alignRight: [false, false, false, false, false, true, false],
        rows: logs.slice(0, 50).map((l) => [
          l.timestamp.replace(' UTC', ''),
          l.id,
          l.actorId.length > 15 ? l.actorId.slice(0, 14) + '.' : l.actorId,
          l.action,
          l.targetId,
          l.impactAmount !== undefined ? formatCurrency(l.impactAmount, true) : '—',
          l.summary,
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-audit-trail-register',
    csv,
    pdf,
  };
}

export function createReceivablesExportPayload(
  invoices: ReceivableInvoice[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const summary = computeReceivablesSummary(invoices);
  const headers = [
    'INVOICE ID',
    'CUSTOMER',
    'ISSUE DATE',
    'DUE DATE',
    'AGING',
    'REVENUE GL',
    'AMOUNT',
    'PAID',
    'BALANCE DUE',
    'STATUS',
  ];

  const rows = invoices.map((inv) => [
    inv.id,
    inv.customer,
    inv.issueDate,
    inv.dueDate,
    inv.agingBucket,
    inv.revenueAccountCode,
    inv.amount,
    inv.paidAmount,
    Math.max(0, inv.amount - inv.paidAmount),
    inv.status,
  ]);

  const csv = buildCsvContent(headers, rows);

  const pdf = buildPdfBytes({
    title: 'Monolith Ledger — Accounts Receivable Schedule',
    subtitle: 'Customer Invoice Register & Aging | Q4 2026',
    metrics: [
      { label: 'Total AR', value: formatCurrency(summary.totalOutstanding) },
      { label: 'Current', value: formatCurrency(summary.currentAmount) },
      { label: 'Past Due', value: formatCurrency(summary.pastDueAmount) },
      { label: 'Collected', value: formatCurrency(summary.collectedAmount) },
    ],
    sections: [
      {
        sectionTitle: 'Accounts Receivable Subledger',
        headers: ['INVOICE ID', 'CUSTOMER', 'ISSUE', 'DUE', 'AGING', 'AMOUNT', 'BALANCE', 'STATUS'],
        columnWidths: [11, 24, 11, 11, 8, 12, 12, 9],
        alignRight: [false, false, false, false, false, true, true, false],
        rows: invoices.map((inv) => [
          inv.id,
          inv.customer,
          inv.issueDate,
          inv.dueDate,
          inv.agingBucket,
          formatCurrency(inv.amount),
          formatCurrency(Math.max(0, inv.amount - inv.paidAmount)),
          inv.status,
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-accounts-receivable-q4-2026',
    csv,
    pdf,
  };
}

export function createPayablesExportPayload(
  bills: PayableBill[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const summary = computePayablesSummary(bills);
  const headers = [
    'BILL ID',
    'VENDOR',
    'REFERENCE',
    'BILL DATE',
    'DUE DATE',
    'GL CODE',
    'GL ACCOUNT',
    'AMOUNT',
    'STATUS',
  ];

  const rows = bills.map((b) => [
    b.id,
    b.vendor,
    b.reference,
    b.billDate,
    b.dueDate,
    b.expenseAccountCode,
    b.expenseAccountName,
    b.amount,
    b.status,
  ]);

  const csv = buildCsvContent(headers, rows);

  const pdf = buildPdfBytes({
    title: 'Monolith Ledger — Accounts Payable Schedule',
    subtitle: 'Vendor Bills & Disbursement Register | Q4 2026',
    metrics: [
      { label: 'Total Open AP', value: formatCurrency(summary.totalOpenAp) },
      { label: 'Approved', value: formatCurrency(summary.approvedAmount) },
      { label: 'Pending', value: formatCurrency(summary.pendingAmount) },
      { label: 'Paid', value: formatCurrency(summary.paidAmount) },
    ],
    sections: [
      {
        sectionTitle: 'Accounts Payable Subledger',
        headers: ['BILL ID', 'VENDOR', 'REF', 'DUE DATE', 'GL', 'AMOUNT', 'STATUS'],
        columnWidths: [11, 24, 14, 12, 8, 14, 11],
        alignRight: [false, false, false, false, false, true, false],
        rows: bills.map((b) => [
          b.id,
          b.vendor,
          b.reference,
          b.dueDate,
          b.expenseAccountCode,
          formatCurrency(b.amount),
          b.status,
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-accounts-payable-q4-2026',
    csv,
    pdf,
  };
}

export function createFixedAssetsExportPayload(
  assets: FixedAssetItem[]
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const summary = computeFixedAssetMetrics(assets);
  const headers = [
    'ASSET ID',
    'NAME',
    'CATEGORY',
    'IN SERVICE',
    'LIFE (MO)',
    'COST BASIS',
    'SALVAGE',
    'MONTHLY DEPR',
    'ACCUM DEPR',
    'NET BOOK VALUE',
    'STATUS',
  ];

  const rows = summary.rows.map((r) => [
    r.id,
    r.name,
    r.category,
    r.inServiceDate,
    r.usefulLifeMonths,
    r.costBasis,
    r.salvageValue,
    r.monthlyDepreciation,
    r.accumulatedDepreciation,
    r.netBookValue,
    r.status,
  ]);

  const csv = buildCsvContent(headers, rows);

  const pdf = buildPdfBytes({
    title: 'Monolith Ledger — Fixed Assets & Depreciation',
    subtitle: 'Capital Asset Register (Straight-Line) | Q4 2026',
    metrics: [
      { label: 'Cost Basis', value: formatCurrency(summary.totalCostBasis) },
      { label: 'Accum. Depr.', value: formatCurrency(summary.totalAccumulatedDepreciation) },
      { label: 'Net Book Value', value: formatCurrency(summary.totalNetBookValue) },
      { label: 'Monthly Depr.', value: formatCurrency(summary.totalMonthlyDepreciation) },
    ],
    sections: [
      {
        sectionTitle: 'Fixed Asset Depreciation Schedule',
        headers: ['ID', 'ASSET', 'CATEGORY', 'COST', 'MONTHLY', 'ACCUM DEPR', 'NBV'],
        columnWidths: [9, 25, 15, 13, 11, 13, 13],
        alignRight: [false, false, false, true, true, true, true],
        rows: summary.rows.map((r) => [
          r.id,
          r.name,
          r.category,
          formatCurrency(r.costBasis),
          formatCurrency(r.monthlyDepreciation),
          formatCurrency(r.accumulatedDepreciation),
          formatCurrency(r.netBookValue),
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-fixed-assets-q4-2026',
    csv,
    pdf,
  };
}

export function createPeriodCloseExportPayload(
  checklist: CloseChecklistItem[],
  schedules: AmortizationScheduleItem[],
  isLocked: boolean
): { filenameBase: string; csv: string; pdf: Uint8Array } {
  const summary = computePeriodCloseSummary(checklist, schedules, isLocked);
  const headers = ['CODE', 'CATEGORY', 'TASK', 'OWNER', 'STATUS'];
  const rows = checklist.map((c) => [
    c.code,
    c.category,
    c.task,
    c.owner,
    c.completed ? 'Completed' : 'Open',
  ]);

  const csv = buildCsvContent(headers, rows);

  const pdf = buildPdfBytes({
    title: 'Monolith Ledger — Fiscal Period Close & Schedules',
    subtitle: `Period 2026-10 | Status: ${isLocked ? 'Locked' : 'Open'}`,
    metrics: [
      { label: 'Close Progress', value: `${summary.completedTasks}/${summary.totalTasks} (${summary.completionPct}%)` },
      { label: 'Period Lock', value: isLocked ? 'Locked' : 'Open' },
      { label: 'Deferred Rev.', value: formatCurrency(summary.unamortizedDeferredRevenue) },
      { label: 'Prepaid Balance', value: formatCurrency(summary.unamortizedPrepaidExpense) },
    ],
    sections: [
      {
        sectionTitle: 'Period Close Checklist',
        headers: ['CODE', 'CATEGORY', 'TASK', 'OWNER', 'STATUS'],
        columnWidths: [10, 16, 42, 16, 12],
        alignRight: [false, false, false, false, false],
        rows: checklist.map((c) => [
          c.code,
          c.category,
          c.task,
          c.owner,
          c.completed ? 'Completed' : 'Open',
        ]),
      },
    ],
  });

  return {
    filenameBase: 'monolith-period-close-2026-10',
    csv,
    pdf,
  };
}



