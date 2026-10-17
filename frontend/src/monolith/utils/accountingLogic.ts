export type AccountCategory = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export interface Account {
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: 'debit' | 'credit';
  openingBalance: number; // always positive in normal balance direction
}

export interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  dataUrl?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  reference: string;
  memo: string;
  source: 'Agentic Auto-Draft' | 'Manual Entry' | 'Reconciliation Adjustment' | 'System Accrual';
  status: 'Posted' | 'Draft' | 'Flagged';
  confidence?: number;
  attachments?: JournalAttachment[];
  lines: JournalLine[];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export interface BankFeedItem {
  id: string;
  date: string;
  counterparty: string;
  description: string;
  amount: number;
  bankReference: string;
  status: 'Unmatched' | 'Matched' | 'Exception';
  matchedLedgerId?: string;
  suggestedLedgerId?: string;
  matchConfidence?: number;
  agentReason?: string;
}

export interface LedgerCashItem {
  id: string;
  date: string;
  entryId: string;
  memo: string;
  amount: number;
  reconciled: boolean;
}

export interface TaxJurisdictionSchedule {
  id: string;
  jurisdiction: string;
  taxType: 'Federal Corporate Income' | 'State Sales & Use' | 'International VAT / GST' | 'Payroll & Withholding';
  authority: string;
  period: string;
  dueDate: string;
  taxableBase: number;
  statutoryRate: number;
  creditsAndDeductions: number;
  status: 'Ready to File' | 'In Review' | 'Filed' | 'Nexus Warning';
  agentAuditNotes: string;
  formCode: string;
}

export interface SankeyNodeData {
  id: string;
  label: string;
  category: 'inflow' | 'hub' | 'outflow' | 'retained';
  column: 0 | 1 | 2 | 3;
  value: number;
  shade: string;
  textColor: string;
}

export interface SankeyLinkData {
  id: string;
  source: string;
  target: string;
  value: number;
  label: string;
}

export interface ComputedSankeyNode extends SankeyNodeData {
  x: number;
  y: number;
  width: number;
  height: number;
  percentageOfTotal: number;
}

export interface ComputedSankeyLink extends SankeyLinkData {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  thickness: number;
  path: string;
}

/**
 * Balanced opening balances as of Q4 start:
 * Opening Debits (Assets + YTD Expenses):
 *   1010: 1,469,700
 *   1020:   850,000
 *   1100:   310,000
 *   1400:   140,000
 *   5010:   130,800
 *   6010:   217,500
 *   6120:   135,000
 *   6250:    45,000
 *   6800:    89,100
 *   Total Opening Debits = 3,387,100
 *
 * Opening Credits (Liabilities + Equity + YTD Revenue):
 *   2010:   112,000
 *   2150:   122,100
 *   2400:   380,000
 *   3010: 1,200,000
 *   3200:   534,400
 *   4010:   675,000
 *   4020:   243,600
 *   4030:   120,000
 *   Total Opening Credits = 3,387,100
 */
export const CHART_OF_ACCOUNTS: Account[] = [
  { code: '1010', name: 'Operating Cash — Mercury SVB', category: 'Asset', normalBalance: 'debit', openingBalance: 1469700 },
  { code: '1020', name: 'Treasury Sweep — BlackRock', category: 'Asset', normalBalance: 'debit', openingBalance: 850000 },
  { code: '1100', name: 'Accounts Receivable — Enterprise', category: 'Asset', normalBalance: 'debit', openingBalance: 310000 },
  { code: '1400', name: 'Prepaid Cloud Infrastructure', category: 'Asset', normalBalance: 'debit', openingBalance: 140000 },
  { code: '2010', name: 'Accounts Payable — Trade', category: 'Liability', normalBalance: 'credit', openingBalance: 112000 },
  { code: '2150', name: 'Accrued Tax Liability', category: 'Liability', normalBalance: 'credit', openingBalance: 122100 },
  { code: '2400', name: 'Deferred Revenue — Annual SaaS', category: 'Liability', normalBalance: 'credit', openingBalance: 380000 },
  { code: '3010', name: 'Common Stock & Paid-In Capital', category: 'Equity', normalBalance: 'credit', openingBalance: 1200000 },
  { code: '3200', name: 'Retained Earnings', category: 'Equity', normalBalance: 'credit', openingBalance: 489400 },
  { code: '4010', name: 'Enterprise SaaS Subscriptions', category: 'Revenue', normalBalance: 'credit', openingBalance: 675000 },
  { code: '4020', name: 'Usage & Compute Overages', category: 'Revenue', normalBalance: 'credit', openingBalance: 243600 },
  { code: '4030', name: 'Implementation & Advisory Services', category: 'Revenue', normalBalance: 'credit', openingBalance: 120000 },
  { code: '5010', name: 'Cloud & GPU Inference Hosting', category: 'Expense', normalBalance: 'debit', openingBalance: 130800 },
  { code: '6010', name: 'R&D Payroll & Engineering', category: 'Expense', normalBalance: 'debit', openingBalance: 217500 },
  { code: '6120', name: 'Go-To-Market & Demand Gen', category: 'Expense', normalBalance: 'debit', openingBalance: 90000 },
  { code: '6250', name: 'General, Legal & Audit Operations', category: 'Expense', normalBalance: 'debit', openingBalance: 45000 },
  { code: '6800', name: 'Corporate Tax Provision Expense', category: 'Expense', normalBalance: 'debit', openingBalance: 89100 },
];

export const INITIAL_JOURNAL_ENTRIES: JournalEntry[] = [
  {
    id: 'JE-2026-0942',
    date: '2026-10-16',
    reference: 'INV-ENT-8841',
    memo: 'Enterprise annual contract recognition — Vaneck Global Corp',
    source: 'Agentic Auto-Draft',
    status: 'Posted',
    confidence: 99.4,
    attachments: [
      {
        id: 'att-942-1',
        name: 'Vaneck_MSA_Invoice_8841.pdf',
        sizeBytes: 248320,
        mimeType: 'application/pdf',
        uploadedAt: '2026-10-16',
      },
    ],
    lines: [
      { id: 'L-1', accountCode: '1010', accountName: 'Operating Cash — Mercury SVB', description: 'Wire settlement #8841', debit: 185000, credit: 0 },
      { id: 'L-2', accountCode: '4010', accountName: 'Enterprise SaaS Subscriptions', description: 'Q4 recognized portion', debit: 0, credit: 145000 },
      { id: 'L-3', accountCode: '2400', accountName: 'Deferred Revenue — Annual SaaS', description: 'Deferred multi-quarter obligation', debit: 0, credit: 40000 },
    ],
  },
  {
    id: 'JE-2026-0941',
    date: '2026-10-15',
    reference: 'AWS-OCT-2026',
    memo: 'Production cluster GPU & H100 inference compute amortization',
    source: 'Agentic Auto-Draft',
    status: 'Posted',
    confidence: 98.8,
    attachments: [
      {
        id: 'att-941-1',
        name: 'AWS_Oct2026_Settlement.pdf',
        sizeBytes: 184320,
        mimeType: 'application/pdf',
        uploadedAt: '2026-10-15',
      },
    ],
    lines: [
      { id: 'L-4', accountCode: '5010', accountName: 'Cloud & GPU Inference Hosting', description: 'October compute cluster usage', debit: 64200, credit: 0 },
      { id: 'L-5', accountCode: '1400', accountName: 'Prepaid Cloud Infrastructure', description: 'Drawdown on committed spend', debit: 0, credit: 24200 },
      { id: 'L-6', accountCode: '1010', accountName: 'Operating Cash — Mercury SVB', description: 'Net ACH settlement to AWS', debit: 0, credit: 40000 },
    ],
  },
  {
    id: 'JE-2026-0940',
    date: '2026-10-14',
    reference: 'PAY-2026-20',
    memo: 'Bi-weekly engineering & product R&D payroll disbursement',
    source: 'System Accrual',
    status: 'Posted',
    confidence: 100,
    attachments: [
      {
        id: 'att-940-1',
        name: 'Rippling_Batch_20_Register.csv',
        sizeBytes: 62400,
        mimeType: 'text/csv',
        uploadedAt: '2026-10-14',
      },
    ],
    lines: [
      { id: 'L-7', accountCode: '6010', accountName: 'R&D Payroll & Engineering', description: 'Gross salaries & employer taxes', debit: 142500, credit: 0 },
      { id: 'L-8', accountCode: '1010', accountName: 'Operating Cash — Mercury SVB', description: 'Rippling batch disbursement', debit: 0, credit: 124000 },
      { id: 'L-9', accountCode: '2150', accountName: 'Accrued Tax Liability', description: 'Federal & state payroll tax withholding', debit: 0, credit: 18500 },
    ],
  },
  {
    id: 'JE-2026-0939',
    date: '2026-10-12',
    reference: 'USG-BATCH-10',
    memo: 'Metered API token overage billings — Tier-1 financial clients',
    source: 'Agentic Auto-Draft',
    status: 'Posted',
    confidence: 97.6,
    lines: [
      { id: 'L-10', accountCode: '1100', accountName: 'Accounts Receivable — Enterprise', description: 'Stripe Invoicing metered batch', debit: 96400, credit: 0 },
      { id: 'L-11', accountCode: '4020', accountName: 'Usage & Compute Overages', description: 'October metered API usage', debit: 0, credit: 96400 },
    ],
  },
  {
    id: 'JE-2026-0938',
    date: '2026-10-10',
    reference: 'TAX-PROV-Q3',
    memo: 'Quarterly corporate income & state nexus tax provision accrual',
    source: 'System Accrual',
    status: 'Posted',
    confidence: 99.1,
    lines: [
      { id: 'L-12', accountCode: '6800', accountName: 'Corporate Tax Provision Expense', description: 'Estimated Federal & DE/CA/NY provision', debit: 48900, credit: 0 },
      { id: 'L-13', accountCode: '2150', accountName: 'Accrued Tax Liability', description: 'Tax reserve liability accrual', debit: 0, credit: 48900 },
    ],
  },
];

export const INITIAL_BANK_FEED: BankFeedItem[] = [
  {
    id: 'BF-901',
    date: '2026-10-16',
    counterparty: 'VANECK GLOBAL CORP',
    description: 'FEDWIRE INCOMING #88419022 SAAS ANNUAL',
    amount: 185000,
    bankReference: 'FW-88419022',
    status: 'Matched',
    matchedLedgerId: 'LC-01',
    matchConfidence: 99.8,
  },
  {
    id: 'BF-902',
    date: '2026-10-15',
    counterparty: 'AMAZON WEB SERVICES INC',
    description: 'ACH DEBIT AWS CLOUD SERVICES OCT-26',
    amount: -40000,
    bankReference: 'ACH-2940118',
    status: 'Matched',
    matchedLedgerId: 'LC-02',
    matchConfidence: 99.4,
  },
  {
    id: 'BF-903',
    date: '2026-10-15',
    counterparty: 'STRIPE SETTLEMENT BATCH',
    description: 'STRIPE TRANSFER INSTANT PAYOUT #ST-992',
    amount: 68450,
    bankReference: 'STR-9920411',
    status: 'Unmatched',
    suggestedLedgerId: 'LC-04',
    matchConfidence: 96.5,
  },
  {
    id: 'BF-904',
    date: '2026-10-14',
    counterparty: 'RIPPLING PAYROLL',
    description: 'ACH BATCH DISBURSEMENT PAY-2026-20',
    amount: -124000,
    bankReference: 'ACH-7731904',
    status: 'Unmatched',
    suggestedLedgerId: 'LC-03',
    matchConfidence: 99.9,
  },
  {
    id: 'BF-905',
    date: '2026-10-13',
    counterparty: 'COOLEY LLP LEGAL',
    description: 'WIRE OUTGOING SERIES B GOVERNANCE & IP',
    amount: -18750,
    bankReference: 'FW-5520194',
    status: 'Unmatched',
    suggestedLedgerId: 'LC-05',
    matchConfidence: 94.2,
  },
  {
    id: 'BF-906',
    date: '2026-10-12',
    counterparty: 'DELAWARE SECRETARY OF STATE',
    description: 'FRANCHISE TAX AUTOPAY Q4 ESTIMATED',
    amount: -4200,
    bankReference: 'ACH-1102940',
    status: 'Exception',
    matchConfidence: 62.0,
  },
];

export const INITIAL_LEDGER_CASH: LedgerCashItem[] = [
  { id: 'LC-01', date: '2026-10-16', entryId: 'JE-2026-0942', memo: 'Vaneck Global Corp — Wire settlement #8841', amount: 185000, reconciled: true },
  { id: 'LC-02', date: '2026-10-15', entryId: 'JE-2026-0941', memo: 'AWS net ACH settlement after prepaid drawdown', amount: -40000, reconciled: true },
  { id: 'LC-03', date: '2026-10-14', entryId: 'JE-2026-0940', memo: 'Rippling bi-weekly engineering payroll disbursement', amount: -124000, reconciled: false },
  { id: 'LC-04', date: '2026-10-14', entryId: 'JE-2026-0936', memo: 'Stripe enterprise AR collection batch #ST-992', amount: 68450, reconciled: false },
  { id: 'LC-05', date: '2026-10-13', entryId: 'JE-2026-0935', memo: 'Cooley LLP — Corporate governance & IP counsel', amount: -18750, reconciled: false },
];

export const INITIAL_TAX_SCHEDULES: TaxJurisdictionSchedule[] = [
  {
    id: 'TAX-FED-1120',
    jurisdiction: 'United States — Federal',
    taxType: 'Federal Corporate Income',
    authority: 'Internal Revenue Service (IRS)',
    period: 'Q4 2026 Estimated',
    dueDate: '2026-12-15',
    taxableBase: 642000,
    statutoryRate: 21.0,
    creditsAndDeductions: 38400,
    status: 'Ready to File',
    agentAuditNotes: '',
    formCode: 'Form 1120-W',
  },
  {
    id: 'TAX-NY-SALES',
    jurisdiction: 'New York State',
    taxType: 'State Sales & Use',
    authority: 'NYS Dept. of Taxation & Finance',
    period: 'Q3–Q4 2026',
    dueDate: '2026-11-20',
    taxableBase: 418000,
    statutoryRate: 8.875,
    creditsAndDeductions: 0,
    status: 'Ready to File',
    agentAuditNotes: '',
    formCode: 'Form ST-100',
  },
  {
    id: 'TAX-CA-FRAN',
    jurisdiction: 'California',
    taxType: 'State Sales & Use',
    authority: 'CA Franchise Tax Board (FTB)',
    period: 'FY 2026 Apportioned',
    dueDate: '2026-11-15',
    taxableBase: 312000,
    statutoryRate: 8.84,
    creditsAndDeductions: 6200,
    status: 'In Review',
    agentAuditNotes: '',
    formCode: 'Form 100-ES',
  },
  {
    id: 'TAX-EU-VAT',
    jurisdiction: 'European Union (OSS)',
    taxType: 'International VAT / GST',
    authority: 'Irish Revenue / EU One-Stop-Shop',
    period: 'Q3 2026 Return',
    dueDate: '2026-10-31',
    taxableBase: 194000,
    statutoryRate: 20.0,
    creditsAndDeductions: 4150,
    status: 'Ready to File',
    agentAuditNotes: '',
    formCode: 'VAT OSS-Q3',
  },
];

export interface PeriodSankeyDataset {
  periodLabel: string;
  subtitle: string;
  nodes: SankeyNodeData[];
  links: SankeyLinkData[];
}

export const SANKEY_DATASETS: Record<string, PeriodSankeyDataset> = {
  'Q4-2026': {
    periodLabel: 'Q4 2026',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS Cash', category: 'inflow', column: 0, value: 860000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Metered API Collections', category: 'inflow', column: 0, value: 310000, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory & Retainers', category: 'inflow', column: 0, value: 145000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'gross_inflow', label: 'Gross Cash Inflow', category: 'hub', column: 1, value: 1315000, shade: '#18181b', textColor: '#ffffff' },
      { id: 'ebitda_pool', label: 'Operating Cash Surplus', category: 'retained', column: 2, value: 650000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Cash Operating Outflows', category: 'outflow', column: 2, value: 665000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'net_treasury', label: 'Net Free Cash Flow', category: 'retained', column: 3, value: 487200, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax & Reserve Holdback', category: 'outflow', column: 3, value: 162800, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll Disbursed', category: 'outflow', column: 3, value: 341500, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU ACH', category: 'outflow', column: 3, value: 188500, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & Vendor Wires', category: 'outflow', column: 3, value: 135000, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: 860000, label: 'Enterprise Wires' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: 310000, label: 'Stripe Payouts' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: 145000, label: 'Advisory Cash' },
      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: 650000, label: 'Operating Cash Surplus' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: 665000, label: 'Cash Outflows' },
      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: 487200, label: 'Net Free Cash Flow' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: 162800, label: 'Tax & Escrow' },
      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: 341500, label: 'Payroll ACH' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: 188500, label: 'AWS Settlement' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: 135000, label: 'Vendor Wires' },
    ],
  },
  'Q3-2026': {
    periodLabel: 'Q3 2026',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS Cash', category: 'inflow', column: 0, value: 710000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Metered API Collections', category: 'inflow', column: 0, value: 275000, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory & Retainers', category: 'inflow', column: 0, value: 95000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'gross_inflow', label: 'Gross Cash Inflow', category: 'hub', column: 1, value: 1080000, shade: '#18181b', textColor: '#ffffff' },
      { id: 'ebitda_pool', label: 'Operating Cash Surplus', category: 'retained', column: 2, value: 465000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Cash Operating Outflows', category: 'outflow', column: 2, value: 615000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'net_treasury', label: 'Net Free Cash Flow', category: 'retained', column: 3, value: 353000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax & Reserve Holdback', category: 'outflow', column: 3, value: 112000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll Disbursed', category: 'outflow', column: 3, value: 330000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU ACH', category: 'outflow', column: 3, value: 165000, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & Vendor Wires', category: 'outflow', column: 3, value: 120000, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: 710000, label: 'Enterprise Wires' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: 275000, label: 'Stripe Payouts' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: 95000, label: 'Advisory Cash' },
      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: 465000, label: 'Operating Cash Surplus' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: 615000, label: 'Cash Outflows' },
      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: 353000, label: 'Net Free Cash Flow' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: 112000, label: 'Tax & Escrow' },
      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: 330000, label: 'Payroll ACH' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: 165000, label: 'AWS Settlement' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: 120000, label: 'Vendor Wires' },
    ],
  },
  'FY-2026': {
    periodLabel: 'FY 2026',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS Cash', category: 'inflow', column: 0, value: 3120000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Metered API Collections', category: 'inflow', column: 0, value: 1240000, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory & Retainers', category: 'inflow', column: 0, value: 440000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'gross_inflow', label: 'Gross Cash Inflow', category: 'hub', column: 1, value: 4800000, shade: '#18181b', textColor: '#ffffff' },
      { id: 'ebitda_pool', label: 'Operating Cash Surplus', category: 'retained', column: 2, value: 2180000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Cash Operating Outflows', category: 'outflow', column: 2, value: 2620000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'net_treasury', label: 'Net Free Cash Flow', category: 'retained', column: 3, value: 1670000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax & Reserve Holdback', category: 'outflow', column: 3, value: 510000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll Disbursed', category: 'outflow', column: 3, value: 1380000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU ACH', category: 'outflow', column: 3, value: 740000, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & Vendor Wires', category: 'outflow', column: 3, value: 500000, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: 3120000, label: 'Enterprise Wires' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: 1240000, label: 'Stripe Payouts' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: 440000, label: 'Advisory Cash' },
      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: 2180000, label: 'Operating Cash Surplus' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: 2620000, label: 'Cash Outflows' },
      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: 1670000, label: 'Net Free Cash Flow' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: 510000, label: 'Tax & Escrow' },
      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: 1380000, label: 'Payroll ACH' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: 740000, label: 'AWS Settlement' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: 500000, label: 'Vendor Wires' },
    ],
  },
};

export const PNL_SANKEY_DATASETS: Record<string, PeriodSankeyDataset> = {
  'Q4-2026': {
    periodLabel: 'Q4 2026',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS (4010)', category: 'inflow', column: 0, value: 820000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Usage & Overages (4020)', category: 'inflow', column: 0, value: 340000, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory Services (4030)', category: 'inflow', column: 0, value: 120000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'gross_inflow', label: 'Total Revenue', category: 'hub', column: 1, value: 1280000, shade: '#18181b', textColor: '#ffffff' },
      { id: 'ebitda_pool', label: 'Operating Income (EBITDA)', category: 'retained', column: 2, value: 590000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Operating Expenses', category: 'outflow', column: 2, value: 690000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'net_treasury', label: 'Net Income', category: 'retained', column: 3, value: 452000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax Provision (6800)', category: 'outflow', column: 3, value: 138000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll (6010)', category: 'outflow', column: 3, value: 360000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU (5010)', category: 'outflow', column: 3, value: 195000, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & G&A (6120/6250)', category: 'outflow', column: 3, value: 135000, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: 820000, label: 'Enterprise ARR' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: 340000, label: 'Compute Overages' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: 120000, label: 'Advisory' },
      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: 590000, label: 'Operating Margin' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: 690000, label: 'Operating Costs' },
      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: 452000, label: 'Net Income' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: 138000, label: 'Tax Provision' },
      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: 360000, label: 'R&D Payroll' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: 195000, label: 'Cloud & GPU' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: 135000, label: 'GTM & G&A' },
    ],
  },
  'Q3-2026': {
    periodLabel: 'Q3 2026',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS (4010)', category: 'inflow', column: 0, value: 685000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Usage & Overages (4020)', category: 'inflow', column: 0, value: 260000, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory Services (4030)', category: 'inflow', column: 0, value: 95000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'gross_inflow', label: 'Total Revenue', category: 'hub', column: 1, value: 1040000, shade: '#18181b', textColor: '#ffffff' },
      { id: 'ebitda_pool', label: 'Operating Income (EBITDA)', category: 'retained', column: 2, value: 440000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Operating Expenses', category: 'outflow', column: 2, value: 600000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'net_treasury', label: 'Net Income', category: 'retained', column: 3, value: 336000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax Provision (6800)', category: 'outflow', column: 3, value: 104000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll (6010)', category: 'outflow', column: 3, value: 320000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU (5010)', category: 'outflow', column: 3, value: 160000, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & G&A (6120/6250)', category: 'outflow', column: 3, value: 120000, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: 685000, label: 'Enterprise ARR' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: 260000, label: 'Compute Overages' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: 95000, label: 'Advisory' },
      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: 440000, label: 'Operating Margin' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: 600000, label: 'Operating Costs' },
      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: 336000, label: 'Net Income' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: 104000, label: 'Tax Provision' },
      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: 320000, label: 'R&D Payroll' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: 160000, label: 'Cloud & GPU' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: 120000, label: 'GTM & G&A' },
    ],
  },
  'FY-2026': {
    periodLabel: 'FY 2026',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS (4010)', category: 'inflow', column: 0, value: 3010000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Usage & Overages (4020)', category: 'inflow', column: 0, value: 1180000, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory Services (4030)', category: 'inflow', column: 0, value: 410000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'gross_inflow', label: 'Total Revenue', category: 'hub', column: 1, value: 4600000, shade: '#18181b', textColor: '#ffffff' },
      { id: 'ebitda_pool', label: 'Operating Income (EBITDA)', category: 'retained', column: 2, value: 2040000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Operating Expenses', category: 'outflow', column: 2, value: 2560000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'net_treasury', label: 'Net Income', category: 'retained', column: 3, value: 1550000, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax Provision (6800)', category: 'outflow', column: 3, value: 490000, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll (6010)', category: 'outflow', column: 3, value: 1350000, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU (5010)', category: 'outflow', column: 3, value: 720000, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & G&A (6120/6250)', category: 'outflow', column: 3, value: 490000, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: 3010000, label: 'Enterprise ARR' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: 1180000, label: 'Compute Overages' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: 410000, label: 'Advisory' },
      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: 2040000, label: 'Operating Margin' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: 2560000, label: 'Operating Costs' },
      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: 1550000, label: 'Net Income' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: 490000, label: 'Tax Provision' },
      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: 1350000, label: 'R&D Payroll' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: 720000, label: 'Cloud & GPU' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: 490000, label: 'GTM & G&A' },
    ],
  },
};

export interface JournalValidationResult {
  isValid: boolean;
  totalDebit: number;
  totalCredit: number;
  imbalance: number;
  errors: string[];
}

export function validateJournalEntry(
  memo: string,
  reference: string,
  lines: Pick<JournalLine, 'accountCode' | 'debit' | 'credit'>[]
): JournalValidationResult {
  const errors: string[] = [];
  if (!memo || memo.trim().length < 4) {
    errors.push('Entry memo is required (minimum 4 characters).');
  }
  if (!reference || reference.trim().length < 2) {
    errors.push('Document reference code is required.');
  }

  const activeLines = lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (activeLines.length < 2) {
    errors.push('A double-entry journal requires at least two active ledger lines.');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of activeLines) {
    if (!line.accountCode) {
      errors.push('Every active journal line must specify a general ledger account code.');
    }
    if (line.debit < 0 || line.credit < 0) {
      errors.push('Debit and credit amounts must be non-negative.');
    }
    if (line.debit > 0 && line.credit > 0) {
      errors.push(`Account ${line.accountCode} cannot have both a debit and credit on the same line.`);
    }
    totalDebit += Number(line.debit) || 0;
    totalCredit += Number(line.credit) || 0;
  }

  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  const imbalance = Math.round((totalDebit - totalCredit) * 100) / 100;

  if (totalDebit <= 0 && totalCredit <= 0) {
    errors.push('Total transaction value must be greater than $0.00.');
  } else if (Math.abs(imbalance) >= 0.01) {
    errors.push(
      `Out of balance by $${Math.abs(imbalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
    );
  }

  return {
    isValid: errors.length === 0,
    totalDebit,
    totalCredit,
    imbalance,
    errors,
  };
}

export function computeSankeyLayout(
  dataset: PeriodSankeyDataset,
  width = 1160,
  height = 480,
  nodeWidth = 18,
  paddingY = 36,
  paddingX = 18
): { nodes: ComputedSankeyNode[]; links: ComputedSankeyLink[]; totalFlow: number } {
  const hubNode = dataset.nodes.find((n) => n.column === 1);
  const totalFlow = hubNode ? hubNode.value : dataset.nodes.filter((n) => n.column === 0).reduce((acc, n) => acc + n.value, 0);

  const columns: [number, SankeyNodeData[]][] = [0, 1, 2, 3].map((col) => [
    col,
    dataset.nodes.filter((n) => n.column === col),
  ]);

  const usableHeight = height - paddingY * 2;
  const scale = (usableHeight * 0.58) / Math.max(totalFlow, 1);

  const colXPositions = [
    paddingX,
    Math.round(width * 0.30),
    Math.round(width * 0.56),
    width - paddingX - nodeWidth,
  ];

  const computedNodesMap = new Map<string, ComputedSankeyNode>();

  for (const [colIdx, colNodes] of columns) {
    const totalNodeHeight = colNodes.reduce((sum, n) => sum + Math.max(n.value * scale, 22), 0);
    const maxBlockSpan = usableHeight * 0.88;
    const gap =
      colNodes.length > 1
        ? Math.min(24, Math.max(12, (maxBlockSpan - totalNodeHeight) / (colNodes.length - 1)))
        : 0;
    const blockHeight = totalNodeHeight + gap * Math.max(0, colNodes.length - 1);
    let currentY = paddingY + Math.max(0, (usableHeight - blockHeight) / 2);

    for (const node of colNodes) {
      const h = Math.max(node.value * scale, 22);
      const computed: ComputedSankeyNode = {
        ...node,
        x: colXPositions[colIdx],
        y: Math.round(currentY * 10) / 10,
        width: nodeWidth,
        height: Math.round(h * 10) / 10,
        percentageOfTotal: Math.round((node.value / Math.max(totalFlow, 1)) * 1000) / 10,
      };
      computedNodesMap.set(node.id, computed);
      currentY += h + gap;
    }
  }

  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();

  const computedLinks: ComputedSankeyLink[] = dataset.links.map((link) => {
    const src = computedNodesMap.get(link.source);
    const tgt = computedNodesMap.get(link.target);
    if (!src || !tgt) {
      throw new Error(`Invalid Sankey link endpoints: ${link.source} -> ${link.target}`);
    }

    const srcUsed = sourceOffsets.get(src.id) ?? 0;
    const tgtUsed = targetOffsets.get(tgt.id) ?? 0;

    const rawThickness = link.value * scale;
    const thickness = Math.max(4, Math.round(rawThickness * 10) / 10);

    const sourceX = src.x + src.width;
    const sourceY = src.y + srcUsed + thickness / 2;

    const targetX = tgt.x;
    const targetY = tgt.y + tgtUsed + thickness / 2;

    sourceOffsets.set(src.id, srcUsed + thickness);
    targetOffsets.set(tgt.id, tgtUsed + thickness);

    const curvature = 0.48;
    const cp1x = Math.round(sourceX + (targetX - sourceX) * curvature);
    const cp2x = Math.round(targetX - (targetX - sourceX) * curvature);
    const sy = Math.round(sourceY * 10) / 10;
    const ty = Math.round(targetY * 10) / 10;

    const path = `M ${sourceX} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ty}, ${targetX} ${ty}`;

    return {
      ...link,
      sourceX,
      sourceY: sy,
      targetX,
      targetY: ty,
      thickness,
      path,
    };
  });

  return {
    nodes: Array.from(computedNodesMap.values()),
    links: computedLinks,
    totalFlow,
  };
}

export interface ReconciliationSummary {
  bankEndingBalance: number;
  ledgerEndingBalance: number;
  reconciledCount: number;
  unmatchedCount: number;
  exceptionCount: number;
  unreconciledDelta: number;
  reconciliationRate: number;
}

export function calculateReconciliationSummary(
  bankItems: BankFeedItem[],
  ledgerItems: LedgerCashItem[],
  openingBalance = 1420000
): ReconciliationSummary {
  const bankNet = bankItems.reduce((sum, item) => sum + item.amount, 0);
  const ledgerNet = ledgerItems.reduce((sum, item) => sum + item.amount, 0);

  const bankEndingBalance = openingBalance + bankNet;
  const ledgerEndingBalance = openingBalance + ledgerNet;

  const reconciledCount = bankItems.filter((b) => b.status === 'Matched').length;
  const unmatchedCount = bankItems.filter((b) => b.status === 'Unmatched').length;
  const exceptionCount = bankItems.filter((b) => b.status === 'Exception').length;

  const unreconciledDelta = bankEndingBalance - ledgerEndingBalance;
  const reconciliationRate =
    bankItems.length > 0 ? Math.round((reconciledCount / bankItems.length) * 1000) / 10 : 100;

  return {
    bankEndingBalance,
    ledgerEndingBalance,
    reconciledCount,
    unmatchedCount,
    exceptionCount,
    unreconciledDelta,
    reconciliationRate,
  };
}

export interface ComputedTaxSummary {
  grossLiability: number;
  netPayable: number;
  effectiveRate: number;
}

export function computeTaxScheduleLiability(schedule: TaxJurisdictionSchedule): ComputedTaxSummary {
  const grossLiability = Math.round(schedule.taxableBase * (schedule.statutoryRate / 100));
  const netPayable = Math.max(0, grossLiability - schedule.creditsAndDeductions);
  const effectiveRate =
    schedule.taxableBase > 0 ? Math.round((netPayable / schedule.taxableBase) * 10000) / 100 : 0;

  return {
    grossLiability,
    netPayable,
    effectiveRate,
  };
}

export interface AccountLedgerPosting {
  id: string;
  entryId: string;
  date: string;
  reference: string;
  memo: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountGeneralLedger {
  account: Account;
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  endingBalance: number; // signed in normalBalance direction
  postings: AccountLedgerPosting[];
}

/**
 * Aggregates all journal entry lines by account into a full General Ledger with running balances.
 */
export function computeGeneralLedgerByAccount(
  entries: JournalEntry[],
  accounts: Account[] = CHART_OF_ACCOUNTS
): AccountGeneralLedger[] {
  // Sort entries chronologically ascending to compute accurate running balances
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  return accounts.map((account) => {
    let running = account.openingBalance;
    let periodDebits = 0;
    let periodCredits = 0;
    const postings: AccountLedgerPosting[] = [];

    for (const entry of sortedEntries) {
      for (const line of entry.lines) {
        if (line.accountCode === account.code) {
          periodDebits += line.debit;
          periodCredits += line.credit;
          const delta =
            account.normalBalance === 'debit'
              ? line.debit - line.credit
              : line.credit - line.debit;
          running += delta;

          postings.push({
            id: `${entry.id}-${line.id}`,
            entryId: entry.id,
            date: entry.date,
            reference: entry.reference,
            memo: line.description || entry.memo,
            debit: line.debit,
            credit: line.credit,
            runningBalance: running,
          });
        }
      }
    }

    return {
      account,
      openingBalance: account.openingBalance,
      periodDebits,
      periodCredits,
      endingBalance: running,
      postings: postings.reverse(), // most recent first for display
    };
  });
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  category: AccountCategory;
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceReport {
  rows: TrialBalanceRow[];
  totalPeriodDebits: number;
  totalPeriodCredits: number;
  totalDebitBalance: number;
  totalCreditBalance: number;
  isBalanced: boolean;
}

/**
 * Computes the Trial Balance across all accounts.
 */
export function computeTrialBalance(
  entries: JournalEntry[],
  accounts: Account[] = CHART_OF_ACCOUNTS
): TrialBalanceReport {
  const glList = computeGeneralLedgerByAccount(entries, accounts);

  let totalPeriodDebits = 0;
  let totalPeriodCredits = 0;
  let totalDebitBalance = 0;
  let totalCreditBalance = 0;

  const rows: TrialBalanceRow[] = glList.map((item) => {
    const { account, openingBalance, periodDebits, periodCredits, endingBalance } = item;

    let debitBalance = 0;
    let creditBalance = 0;

    if (account.normalBalance === 'debit') {
      if (endingBalance >= 0) debitBalance = endingBalance;
      else creditBalance = Math.abs(endingBalance);
    } else {
      if (endingBalance >= 0) creditBalance = endingBalance;
      else debitBalance = Math.abs(endingBalance);
    }

    totalPeriodDebits += periodDebits;
    totalPeriodCredits += periodCredits;
    totalDebitBalance += debitBalance;
    totalCreditBalance += creditBalance;

    return {
      code: account.code,
      name: account.name,
      category: account.category,
      openingBalance,
      periodDebits,
      periodCredits,
      debitBalance,
      creditBalance,
    };
  });

  return {
    rows,
    totalPeriodDebits,
    totalPeriodCredits,
    totalDebitBalance,
    totalCreditBalance,
    isBalanced: Math.abs(totalDebitBalance - totalCreditBalance) < 0.01,
  };
}

export interface CashFlowStatementData {
  netIncome: number;
  workingCapitalAdjustments: { code: string; name: string; amount: number }[];
  netCashFromOperating: number;
  investingItems: { code: string; name: string; amount: number }[];
  netCashFromInvesting: number;
  financingItems: { code: string; name: string; amount: number }[];
  netCashFromFinancing: number;
  netChangeInCash: number;
  beginningCash: number;
  endingCash: number;
  isCashReconciled: boolean;
}

export interface FinancialStatementsReport {
  revenues: { code: string; name: string; amount: number }[];
  totalRevenue: number;
  operatingExpenses: { code: string; name: string; amount: number }[];
  totalOperatingExpenses: number;
  operatingIncome: number;
  taxExpense: number;
  netIncome: number;
  netMarginPct: number;

  assets: { code: string; name: string; amount: number }[];
  totalAssets: number;
  liabilities: { code: string; name: string; amount: number }[];
  totalLiabilities: number;
  equity: { code: string; name: string; amount: number }[];
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanceSheetBalanced: boolean;

  cashFlow: CashFlowStatementData;
}

/**
 * Derives Income Statement (P&L), Balance Sheet (BS), and Cash Flow Statement (CFS)
 * directly from the General Ledger.
 */
export function computeFinancialStatements(
  entries: JournalEntry[],
  accounts: Account[] = CHART_OF_ACCOUNTS
): FinancialStatementsReport {
  const glList = computeGeneralLedgerByAccount(entries, accounts);

  const revenues = glList
    .filter((g) => g.account.category === 'Revenue')
    .map((g) => ({ code: g.account.code, name: g.account.name, amount: g.endingBalance }));
  const totalRevenue = revenues.reduce((s, r) => s + r.amount, 0);

  const operatingExpenses = glList
    .filter((g) => g.account.category === 'Expense' && g.account.code !== '6800')
    .map((g) => ({ code: g.account.code, name: g.account.name, amount: g.endingBalance }));
  const totalOperatingExpenses = operatingExpenses.reduce((s, e) => s + e.amount, 0);

  const operatingIncome = totalRevenue - totalOperatingExpenses;

  const taxGl = glList.find((g) => g.account.code === '6800');
  const taxExpense = taxGl ? taxGl.endingBalance : 0;

  const netIncome = operatingIncome - taxExpense;
  const netMarginPct =
    totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 1000) / 10 : 0;

  const assets = glList
    .filter((g) => g.account.category === 'Asset')
    .map((g) => ({ code: g.account.code, name: g.account.name, amount: g.endingBalance }));
  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);

  const liabilities = glList
    .filter((g) => g.account.category === 'Liability')
    .map((g) => ({ code: g.account.code, name: g.account.name, amount: g.endingBalance }));
  const totalLiabilities = liabilities.reduce((s, l) => s + l.amount, 0);

  const baseEquity = glList
    .filter((g) => g.account.category === 'Equity')
    .map((g) => ({ code: g.account.code, name: g.account.name, amount: g.endingBalance }));

  const equity = [
    ...baseEquity,
    { code: '3900', name: 'Current Period Net Income', amount: netIncome },
  ];
  const totalEquity = equity.reduce((s, e) => s + e.amount, 0);
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  // Cash Flow Statement (Indirect Method)
  const getGl = (code: string) => glList.find((g) => g.account.code === code);
  const arGl = getGl('1100');
  const prepaidGl = getGl('1400');
  const apGl = getGl('2010');
  const taxLiabGl = getGl('2150');
  const defRevGl = getGl('2400');
  const stockGl = getGl('3010');

  const workingCapitalAdjustments = [
    {
      code: '1100',
      name: 'Change in Accounts Receivable',
      amount: arGl ? -(arGl.endingBalance - arGl.openingBalance) : 0,
    },
    {
      code: '1400',
      name: 'Change in Prepaid Cloud Infrastructure',
      amount: prepaidGl ? -(prepaidGl.endingBalance - prepaidGl.openingBalance) : 0,
    },
    {
      code: '2010',
      name: 'Change in Accounts Payable',
      amount: apGl ? apGl.endingBalance - apGl.openingBalance : 0,
    },
    {
      code: '2150',
      name: 'Change in Accrued Tax Liability',
      amount: taxLiabGl ? taxLiabGl.endingBalance - taxLiabGl.openingBalance : 0,
    },
    {
      code: '2400',
      name: 'Change in Deferred Revenue',
      amount: defRevGl ? defRevGl.endingBalance - defRevGl.openingBalance : 0,
    },
  ];

  const netCashFromOperating =
    netIncome + workingCapitalAdjustments.reduce((s, item) => s + item.amount, 0);

  const investingItems = [
    { code: '1020', name: 'Short-Term Treasury Sweep Activity', amount: 0 },
  ];
  const netCashFromInvesting = 0;

  const financingDelta = stockGl ? stockGl.endingBalance - stockGl.openingBalance : 0;
  const financingItems = [
    { code: '3010', name: 'Common Stock & Paid-In Capital Issuance', amount: financingDelta },
  ];
  const netCashFromFinancing = financingDelta;

  const netChangeInCash =
    netCashFromOperating + netCashFromInvesting + netCashFromFinancing;

  const cash1010 = getGl('1010')?.endingBalance ?? 0;
  const cash1020 = getGl('1020')?.endingBalance ?? 0;
  const endingCash = cash1010 + cash1020;
  const beginningCash = 1853500;

  return {
    revenues,
    totalRevenue,
    operatingExpenses,
    totalOperatingExpenses,
    operatingIncome,
    taxExpense,
    netIncome,
    netMarginPct,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanceSheetBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
    cashFlow: {
      netIncome,
      workingCapitalAdjustments,
      netCashFromOperating,
      investingItems,
      netCashFromInvesting,
      financingItems,
      netCashFromFinancing,
      netChangeInCash,
      beginningCash,
      endingCash,
      isCashReconciled: Math.abs(beginningCash + netChangeInCash - endingCash) < 0.01,
    },
  };
}

/**
 * Builds a live P&L (Income Statement) Sankey dataset directly from the computed FinancialStatementsReport.
 */
export function buildLivePnlSankeyDataset(
  fs: FinancialStatementsReport
): PeriodSankeyDataset {
  const revSaas = fs.revenues.find((r) => r.code === '4010')?.amount ?? 0;
  const revUsage = fs.revenues.find((r) => r.code === '4020')?.amount ?? 0;
  const revServices = fs.revenues.find((r) => r.code === '4030')?.amount ?? 0;

  const costCloud = fs.operatingExpenses.find((e) => e.code === '5010')?.amount ?? 0;
  const costRnd = fs.operatingExpenses.find((e) => e.code === '6010')?.amount ?? 0;
  const costGtm = fs.operatingExpenses.find((e) => e.code === '6120')?.amount ?? 0;
  const costGa = fs.operatingExpenses.find((e) => e.code === '6250')?.amount ?? 0;
  const costGtmAndGa = costGtm + costGa;

  const totalRev = Math.max(1, fs.totalRevenue);
  const opexPool = Math.max(0, fs.totalOperatingExpenses);
  const ebitdaPool = Math.max(0, fs.operatingIncome);
  const taxReserve = Math.max(0, fs.taxExpense);
  const netProfit = Math.max(0, fs.netIncome);

  return {
    periodLabel: 'Q4 2026 Live P&L',
    subtitle: '',
    nodes: [
      { id: 'rev_saas', label: 'Enterprise SaaS (4010)', category: 'inflow', column: 0, value: revSaas, shade: '#09090b', textColor: '#ffffff' },
      { id: 'rev_usage', label: 'Usage & Overages (4020)', category: 'inflow', column: 0, value: revUsage, shade: '#27272a', textColor: '#ffffff' },
      { id: 'rev_services', label: 'Advisory Services (4030)', category: 'inflow', column: 0, value: revServices, shade: '#52525b', textColor: '#ffffff' },

      { id: 'gross_inflow', label: 'Total Revenue', category: 'hub', column: 1, value: totalRev, shade: '#18181b', textColor: '#ffffff' },

      { id: 'ebitda_pool', label: 'Operating Income (EBITDA)', category: 'retained', column: 2, value: ebitdaPool, shade: '#09090b', textColor: '#ffffff' },
      { id: 'opex_pool', label: 'Operating Expenses', category: 'outflow', column: 2, value: opexPool, shade: '#3f3f46', textColor: '#ffffff' },

      { id: 'net_treasury', label: 'Net Income', category: 'retained', column: 3, value: netProfit, shade: '#09090b', textColor: '#ffffff' },
      { id: 'tax_reserve', label: 'Tax Provision (6800)', category: 'outflow', column: 3, value: taxReserve, shade: '#3f3f46', textColor: '#ffffff' },
      { id: 'cost_rnd', label: 'R&D Payroll (6010)', category: 'outflow', column: 3, value: costRnd, shade: '#52525b', textColor: '#ffffff' },
      { id: 'cost_cloud', label: 'Cloud & GPU (5010)', category: 'outflow', column: 3, value: costCloud, shade: '#71717a', textColor: '#ffffff' },
      { id: 'cost_gtm', label: 'GTM & G&A (6120/6250)', category: 'outflow', column: 3, value: costGtmAndGa, shade: '#a1a1aa', textColor: '#09090b' },
    ],
    links: [
      { id: 'l1', source: 'rev_saas', target: 'gross_inflow', value: revSaas, label: 'Enterprise SaaS' },
      { id: 'l2', source: 'rev_usage', target: 'gross_inflow', value: revUsage, label: 'Usage & Overages' },
      { id: 'l3', source: 'rev_services', target: 'gross_inflow', value: revServices, label: 'Advisory Services' },

      { id: 'l5', source: 'gross_inflow', target: 'ebitda_pool', value: ebitdaPool, label: 'Operating Margin' },
      { id: 'l4', source: 'gross_inflow', target: 'opex_pool', value: opexPool, label: 'Operating Costs' },

      { id: 'l10', source: 'ebitda_pool', target: 'net_treasury', value: netProfit, label: 'Net Income' },
      { id: 'l9', source: 'ebitda_pool', target: 'tax_reserve', value: taxReserve, label: 'Tax Provision' },

      { id: 'l6', source: 'opex_pool', target: 'cost_rnd', value: costRnd, label: 'R&D Payroll' },
      { id: 'l7', source: 'opex_pool', target: 'cost_cloud', value: costCloud, label: 'Cloud & GPU' },
      { id: 'l8', source: 'opex_pool', target: 'cost_gtm', value: costGtmAndGa, label: 'GTM & G&A' },
    ],
  };
}

export function formatCurrency(amount: number, showSign = false): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  if (amount < 0) return `-$${formatted}`;
  if (showSign && amount > 0) return `+$${formatted}`;
  return `$${formatted}`;
}

export interface BudgetAllocationItem {
  accountCode: string;
  accountName: string;
  department: 'Revenue' | 'Infrastructure' | 'Engineering' | 'GTM & Growth' | 'G&A & Legal' | 'Tax';
  category: 'Revenue' | 'Expense';
  q4Budget: number;
  customActual?: number;
}

export interface BudgetVarianceRow {
  accountCode: string;
  accountName: string;
  department: string;
  category: 'Revenue' | 'Expense';
  budget: number;
  actual: number;
  varianceDollar: number; // actual - budget
  favorableDollar: number; // positive = favorable to net income
  utilizationPct: number; // (actual / budget) * 100
  status: 'Favorable' | 'On Track' | 'Over Budget' | 'Below Target';
}

export interface BudgetVarianceReport {
  rows: BudgetVarianceRow[];
  totalBudgetRevenue: number;
  totalActualRevenue: number;
  revenueVariance: number;
  totalBudgetExpense: number;
  totalActualExpense: number;
  expenseVariance: number; // budget - actual (positive = cost savings)
  budgetNetIncome: number;
  actualNetIncome: number;
  netIncomeVariance: number;
}

export const INITIAL_BUDGET_ALLOCATIONS: BudgetAllocationItem[] = [
  {
    accountCode: '4010',
    accountName: 'Enterprise SaaS Subscriptions',
    department: 'Revenue',
    category: 'Revenue',
    q4Budget: 800000,
  },
  {
    accountCode: '4020',
    accountName: 'Usage & API Overage Revenue',
    department: 'Revenue',
    category: 'Revenue',
    q4Budget: 320000,
  },
  {
    accountCode: '4030',
    accountName: 'Implementation & Advisory Services',
    department: 'Revenue',
    category: 'Revenue',
    q4Budget: 140000,
  },
  {
    accountCode: '5010',
    accountName: 'Cloud & GPU Inference Hosting',
    department: 'Infrastructure',
    category: 'Expense',
    q4Budget: 180000,
  },
  {
    accountCode: '6010',
    accountName: 'R&D & Core Engineering Payroll',
    department: 'Engineering',
    category: 'Expense',
    q4Budget: 360000,
  },
  {
    accountCode: '6120',
    accountName: 'Enterprise GTM & Performance Marketing',
    department: 'GTM & Growth',
    category: 'Expense',
    q4Budget: 90000,
  },
  {
    accountCode: '6250',
    accountName: 'Legal, Audit & Corporate Advisory',
    department: 'G&A & Legal',
    category: 'Expense',
    q4Budget: 60000,
  },
  {
    accountCode: '6800',
    accountName: 'Corporate Tax Provision Expense',
    department: 'Tax',
    category: 'Expense',
    q4Budget: 135000,
  },
];

export function computeBudgetVariance(
  entries: JournalEntry[],
  allocations: BudgetAllocationItem[]
): BudgetVarianceReport {
  const fs = computeFinancialStatements(entries);

  const actualMap = new Map<string, number>();
  for (const r of fs.revenues) actualMap.set(r.code, r.amount);
  for (const e of fs.operatingExpenses) actualMap.set(e.code, e.amount);
  actualMap.set('6800', fs.taxExpense);

  const rows: BudgetVarianceRow[] = allocations.map((item) => {
    const actual = item.customActual ?? actualMap.get(item.accountCode) ?? 0;
    const budget = Math.max(1, item.q4Budget);
    const varianceDollar = actual - item.q4Budget;
    const favorableDollar =
      item.category === 'Revenue' ? actual - item.q4Budget : item.q4Budget - actual;
    const utilizationPct = Math.round((actual / budget) * 1000) / 10;

    let status: BudgetVarianceRow['status'] = 'On Track';
    if (item.category === 'Revenue') {
      if (actual >= item.q4Budget * 1.01) status = 'Favorable';
      else if (actual <= item.q4Budget * 0.98) status = 'Below Target';
    } else {
      if (actual > item.q4Budget * 1.01) status = 'Over Budget';
      else if (actual < item.q4Budget * 0.98) status = 'Favorable';
    }

    return {
      accountCode: item.accountCode,
      accountName: item.accountName,
      department: item.department,
      category: item.category,
      budget: item.q4Budget,
      actual,
      varianceDollar,
      favorableDollar,
      utilizationPct,
      status,
    };
  });

  const totalBudgetRevenue = rows
    .filter((r) => r.category === 'Revenue')
    .reduce((s, r) => s + r.budget, 0);
  const totalActualRevenue = rows
    .filter((r) => r.category === 'Revenue')
    .reduce((s, r) => s + r.actual, 0);
  const revenueVariance = totalActualRevenue - totalBudgetRevenue;

  const totalBudgetExpense = rows
    .filter((r) => r.category === 'Expense')
    .reduce((s, r) => s + r.budget, 0);
  const totalActualExpense = rows
    .filter((r) => r.category === 'Expense')
    .reduce((s, r) => s + r.actual, 0);
  const expenseVariance = totalBudgetExpense - totalActualExpense;

  const budgetNetIncome = totalBudgetRevenue - totalBudgetExpense;
  const actualNetIncome = totalActualRevenue - totalActualExpense;
  const netIncomeVariance = actualNetIncome - budgetNetIncome;

  return {
    rows,
    totalBudgetRevenue,
    totalActualRevenue,
    revenueVariance,
    totalBudgetExpense,
    totalActualExpense,
    expenseVariance,
    budgetNetIncome,
    actualNetIncome,
    netIncomeVariance,
  };
}

export type ForecastScenarioId = 'base' | 'bull' | 'conservative';

export interface ForecastDrivers {
  scenarioId: ForecastScenarioId;
  scenarioName: string;
  quarterlyRevGrowthPct: number;
  cloudCogsRatioPct: number;
  quarterlyOpexGrowthPct: number;
  effectiveTaxRatePct: number;
}

export interface ForecastQuarterPoint {
  period: string;
  isActual: boolean;
  saasRevenue: number;
  usageAndServicesRevenue: number;
  totalRevenue: number;
  cloudCogs: number;
  grossProfit: number;
  grossMarginPct: number;
  rndAndGtmOpex: number;
  totalOperatingExpenses: number;
  ebitda: number;
  ebitdaMarginPct: number;
  taxProvision: number;
  netIncome: number;
  endingCash: number;
}

export interface RollingForecastReport {
  drivers: ForecastDrivers;
  quarters: ForecastQuarterPoint[];
  fy2027TotalRevenue: number;
  fy2027TotalEbitda: number;
  fy2027TotalNetIncome: number;
  fy2027EndingCash: number;
  arrExitQ4_2027: number;
}

export const FORECAST_SCENARIO_PRESETS: Record<ForecastScenarioId, ForecastDrivers> = {
  base: {
    scenarioId: 'base',
    scenarioName: 'Base Operating Plan',
    quarterlyRevGrowthPct: 11.5,
    cloudCogsRatioPct: 14.5,
    quarterlyOpexGrowthPct: 5.0,
    effectiveTaxRatePct: 21.0,
  },
  bull: {
    scenarioId: 'bull',
    scenarioName: 'AI Enterprise Expansion',
    quarterlyRevGrowthPct: 16.5,
    cloudCogsRatioPct: 13.5,
    quarterlyOpexGrowthPct: 6.5,
    effectiveTaxRatePct: 21.0,
  },
  conservative: {
    scenarioId: 'conservative',
    scenarioName: 'Downside Preservation',
    quarterlyRevGrowthPct: 6.0,
    cloudCogsRatioPct: 15.5,
    quarterlyOpexGrowthPct: 2.0,
    effectiveTaxRatePct: 21.0,
  },
};

export function computeRollingForecast(
  entries: JournalEntry[],
  drivers: ForecastDrivers
): RollingForecastReport {
  const fs = computeFinancialStatements(entries);

  const actSaas = fs.revenues.find((r) => r.code === '4010')?.amount ?? 820000;
  const actUsage = fs.revenues.find((r) => r.code === '4020')?.amount ?? 310000;
  const actServices = fs.revenues.find((r) => r.code === '4030')?.amount ?? 150000;
  const actTotalRev = fs.totalRevenue;

  const actCloud = fs.operatingExpenses.find((e) => e.code === '5010')?.amount ?? 194200;
  const actNonCloudOpex = Math.max(0, fs.totalOperatingExpenses - actCloud);
  const actGrossProfit = actTotalRev - actCloud;
  const actEbitda = fs.operatingIncome;
  const actTax = fs.taxExpense;
  const actNetIncome = fs.netIncome;
  const actEndingCash = fs.cashFlow.endingCash;

  const q4Actual: ForecastQuarterPoint = {
    period: 'Q4 2026 (Act)',
    isActual: true,
    saasRevenue: actSaas,
    usageAndServicesRevenue: actUsage + actServices,
    totalRevenue: actTotalRev,
    cloudCogs: actCloud,
    grossProfit: actGrossProfit,
    grossMarginPct: Math.round((actGrossProfit / Math.max(1, actTotalRev)) * 1000) / 10,
    rndAndGtmOpex: actNonCloudOpex,
    totalOperatingExpenses: fs.totalOperatingExpenses,
    ebitda: actEbitda,
    ebitdaMarginPct: Math.round((actEbitda / Math.max(1, actTotalRev)) * 1000) / 10,
    taxProvision: actTax,
    netIncome: actNetIncome,
    endingCash: actEndingCash,
  };

  const quarters: ForecastQuarterPoint[] = [q4Actual];
  const futureLabels = ['Q1 2027E', 'Q2 2027E', 'Q3 2027E', 'Q4 2027E'];

  let prevSaas = actSaas;
  let prevOtherRev = actUsage + actServices;
  let prevNonCloudOpex = actNonCloudOpex;
  let runningCash = actEndingCash;

  const revGrowthFactor = 1 + drivers.quarterlyRevGrowthPct / 100;
  const opexGrowthFactor = 1 + drivers.quarterlyOpexGrowthPct / 100;
  const cogsRatio = drivers.cloudCogsRatioPct / 100;
  const taxRate = drivers.effectiveTaxRatePct / 100;

  for (const label of futureLabels) {
    const saasRevenue = Math.round(prevSaas * revGrowthFactor);
    const usageAndServicesRevenue = Math.round(prevOtherRev * revGrowthFactor);
    const totalRevenue = saasRevenue + usageAndServicesRevenue;

    const cloudCogs = Math.round(totalRevenue * cogsRatio);
    const grossProfit = totalRevenue - cloudCogs;
    const grossMarginPct = Math.round((grossProfit / Math.max(1, totalRevenue)) * 1000) / 10;

    const rndAndGtmOpex = Math.round(prevNonCloudOpex * opexGrowthFactor);
    const totalOperatingExpenses = cloudCogs + rndAndGtmOpex;

    const ebitda = totalRevenue - totalOperatingExpenses;
    const ebitdaMarginPct = Math.round((ebitda / Math.max(1, totalRevenue)) * 1000) / 10;

    const taxProvision = ebitda > 0 ? Math.round(ebitda * taxRate) : 0;
    const netIncome = ebitda - taxProvision;

    // Operating cash conversion ~ 104% of Net Income due to deferred annual SaaS billings
    const cashGenerated = Math.round(netIncome * 1.04);
    runningCash += cashGenerated;

    quarters.push({
      period: label,
      isActual: false,
      saasRevenue,
      usageAndServicesRevenue,
      totalRevenue,
      cloudCogs,
      grossProfit,
      grossMarginPct,
      rndAndGtmOpex,
      totalOperatingExpenses,
      ebitda,
      ebitdaMarginPct,
      taxProvision,
      netIncome,
      endingCash: runningCash,
    });

    prevSaas = saasRevenue;
    prevOtherRev = usageAndServicesRevenue;
    prevNonCloudOpex = rndAndGtmOpex;
  }

  const projectedQuarters = quarters.slice(1);
  const fy2027TotalRevenue = projectedQuarters.reduce((s, q) => s + q.totalRevenue, 0);
  const fy2027TotalEbitda = projectedQuarters.reduce((s, q) => s + q.ebitda, 0);
  const fy2027TotalNetIncome = projectedQuarters.reduce((s, q) => s + q.netIncome, 0);
  const fy2027EndingCash = projectedQuarters[projectedQuarters.length - 1].endingCash;
  const arrExitQ4_2027 = projectedQuarters[projectedQuarters.length - 1].totalRevenue * 4;

  return {
    drivers,
    quarters,
    fy2027TotalRevenue,
    fy2027TotalEbitda,
    fy2027TotalNetIncome,
    fy2027EndingCash,
    arrExitQ4_2027,
  };
}

export interface GlobalSearchJournalHit {
  id: string;
  date: string;
  reference: string;
  memo: string;
  source: JournalEntry['source'];
  totalAmount: number;
  matchedAccountCodes: string[];
}

export interface GlobalSearchAccountHit {
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: 'debit' | 'credit';
  closingBalance: number;
  transactionCount: number;
}

export interface GlobalSearchBankHit {
  id: string;
  date: string;
  counterparty: string;
  description: string;
  bankReference: string;
  amount: number;
  status: BankFeedItem['status'];
}

export interface GlobalSearchResults {
  query: string;
  journalEntries: GlobalSearchJournalHit[];
  accounts: GlobalSearchAccountHit[];
  bankTransactions: GlobalSearchBankHit[];
  totalCount: number;
}

export function searchGlobalAccountingRecords(
  rawQuery: string,
  entries: JournalEntry[],
  bankItems: BankFeedItem[]
): GlobalSearchResults {
  const query = rawQuery.trim();
  if (!query) {
    return {
      query: '',
      journalEntries: [],
      accounts: [],
      bankTransactions: [],
      totalCount: 0,
    };
  }

  const normalized = query.toLowerCase();
  const numericQuery = normalized.replace(/[$,]/g, '');

  const journalHits: GlobalSearchJournalHit[] = [];
  for (const entry of entries) {
    const totalAmount = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    const amountStr = String(totalAmount);
    const headerMatch =
      entry.id.toLowerCase().includes(normalized) ||
      entry.reference.toLowerCase().includes(normalized) ||
      entry.memo.toLowerCase().includes(normalized) ||
      entry.source.toLowerCase().includes(normalized) ||
      entry.date.toLowerCase().includes(normalized) ||
      (numericQuery.length >= 2 && amountStr.includes(numericQuery));

    const matchingLines = entry.lines.filter(
      (l) =>
        l.accountCode.toLowerCase().includes(normalized) ||
        l.accountName.toLowerCase().includes(normalized) ||
        l.description.toLowerCase().includes(normalized) ||
        (numericQuery.length >= 2 &&
          (String(l.debit).includes(numericQuery) || String(l.credit).includes(numericQuery)))
    );

    if (headerMatch || matchingLines.length > 0) {
      const codes = Array.from(
        new Set(
          (matchingLines.length > 0 ? matchingLines : entry.lines).map((l) => l.accountCode)
        )
      );
      journalHits.push({
        id: entry.id,
        date: entry.date,
        reference: entry.reference,
        memo: entry.memo,
        source: entry.source,
        totalAmount,
        matchedAccountCodes: codes,
      });
    }
  }

  const accountLedgers = computeGeneralLedgerByAccount(entries);
  const accountHits: GlobalSearchAccountHit[] = [];
  for (const gl of accountLedgers) {
    const { account, endingBalance, postings } = gl;
    const balanceStr = String(Math.abs(endingBalance));
    const matches =
      account.code.toLowerCase().includes(normalized) ||
      account.name.toLowerCase().includes(normalized) ||
      account.category.toLowerCase().includes(normalized) ||
      account.normalBalance.toLowerCase().includes(normalized) ||
      (numericQuery.length >= 2 && balanceStr.includes(numericQuery));

    if (matches) {
      accountHits.push({
        code: account.code,
        name: account.name,
        category: account.category,
        normalBalance: account.normalBalance,
        closingBalance: endingBalance,
        transactionCount: postings.length,
      });
    }
  }

  const bankHits: GlobalSearchBankHit[] = [];
  for (const item of bankItems) {
    const absAmountStr = String(Math.abs(item.amount));
    const matches =
      item.id.toLowerCase().includes(normalized) ||
      item.counterparty.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      item.bankReference.toLowerCase().includes(normalized) ||
      item.status.toLowerCase().includes(normalized) ||
      item.date.toLowerCase().includes(normalized) ||
      (numericQuery.length >= 2 && absAmountStr.includes(numericQuery));

    if (matches) {
      bankHits.push({
        id: item.id,
        date: item.date,
        counterparty: item.counterparty,
        description: item.description,
        bankReference: item.bankReference,
        amount: item.amount,
        status: item.status,
      });
    }
  }

  return {
    query,
    journalEntries: journalHits,
    accounts: accountHits,
    bankTransactions: bankHits,
    totalCount: journalHits.length + accountHits.length + bankHits.length,
  };
}

export type AuditActorType = 'User' | 'Agent' | 'System';
export type AuditCategory =
  | 'Journal Entry'
  | 'Bank Reconciliation'
  | 'Tax Provision'
  | 'Accounts Receivable'
  | 'Accounts Payable'
  | 'Fixed Assets'
  | 'Period Close';
export type AuditAction =
  | 'Create Entry'
  | 'Upload Attachment'
  | 'Reconcile Match'
  | 'Batch Reconcile'
  | 'Book Exception'
  | 'Post Tax Accrual'
  | 'Auto-Draft Post'
  | 'Issue Invoice'
  | 'Collect Payment'
  | 'Record Bill'
  | 'Approve Bill'
  | 'Pay Bill'
  | 'Register Asset'
  | 'Run Depreciation'
  | 'Post Amortization'
  | 'Lock Period'
  | 'Unlock Period';

export interface AuditLogEntry {
  id: string; // e.g. "AUD-2026-1005"
  timestamp: string; // e.g. "2026-10-16 14:22:18 UTC"
  actorType: AuditActorType;
  actorId: string; // e.g. "auslifegriffin@gmail.com", "Agent REV-01", "Agent REC-02", "System Accrual", "Rule-Engine"
  category: AuditCategory;
  action: AuditAction;
  targetId: string; // e.g. "JE-2026-0942", "BF-901"
  targetReference?: string;
  impactAmount?: number;
  summary: string;
  details?: string;
  hash: string;
}

export function generateAuditHash(
  id: string,
  timestamp: string,
  actorId: string,
  targetId: string,
  summary: string
): string {
  // Simple deterministic fnv1a-style 64-bit hex digest
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  const str = `${id}|${timestamp}|${actorId}|${targetId}|${summary}`;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x01000197);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `sha256-${part1}${part2}`;
}

export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'AUD-2026-1005',
    timestamp: '2026-10-16 14:22:18 UTC',
    actorType: 'Agent',
    actorId: 'Agent REV-01',
    category: 'Bank Reconciliation',
    action: 'Reconcile Match',
    targetId: 'BF-901',
    targetReference: 'FW-88419022',
    impactAmount: 185000,
    summary: 'Matched incoming wire BF-901 ($185,000.00) to ledger cash item LC-01',
    details: 'Auto-matched with 99.8% confidence against INV-ENT-8841 wire remittance for Vaneck Global Corp',
    hash: generateAuditHash('AUD-2026-1005', '2026-10-16 14:22:18 UTC', 'Agent REV-01', 'BF-901', 'Matched incoming wire BF-901 to LC-01'),
  },
  {
    id: 'AUD-2026-1004',
    timestamp: '2026-10-16 11:05:40 UTC',
    actorType: 'Agent',
    actorId: 'Agent REV-01',
    category: 'Journal Entry',
    action: 'Auto-Draft Post',
    targetId: 'JE-2026-0942',
    targetReference: 'INV-ENT-8841',
    impactAmount: 185000,
    summary: 'Posted enterprise SaaS contract recognition for Vaneck Global Corp',
    details: 'Debits: $185,000.00 | Credits: $185,000.00. 1 attachment uploaded (Vaneck_MSA_Invoice_8841.pdf)',
    hash: generateAuditHash('AUD-2026-1004', '2026-10-16 11:05:40 UTC', 'Agent REV-01', 'JE-2026-0942', 'Posted enterprise SaaS contract recognition'),
  },
  {
    id: 'AUD-2026-1003',
    timestamp: '2026-10-15 16:30:12 UTC',
    actorType: 'System',
    actorId: 'Rule-Engine',
    category: 'Bank Reconciliation',
    action: 'Reconcile Match',
    targetId: 'BF-902',
    targetReference: 'ACH-2940118',
    impactAmount: -40000,
    summary: 'Reconciled ACH debit BF-902 to ledger cash item LC-02 ($40,000.00)',
    details: 'ACH reference matched AWS infrastructure recurring monthly settlement',
    hash: generateAuditHash('AUD-2026-1003', '2026-10-15 16:30:12 UTC', 'Rule-Engine', 'BF-902', 'Reconciled ACH debit BF-902 to LC-02'),
  },
  {
    id: 'AUD-2026-1002',
    timestamp: '2026-10-15 14:10:05 UTC',
    actorType: 'User',
    actorId: 'auslifegriffin@gmail.com',
    category: 'Journal Entry',
    action: 'Create Entry',
    targetId: 'JE-2026-0941',
    targetReference: 'AWS-OCT-2026',
    impactAmount: 64200,
    summary: 'Amortized production cluster GPU compute across prepaid infrastructure',
    details: 'Debits: $64,200.00 | Credits: $64,200.00. 1 attachment uploaded (AWS_Oct2026_Settlement.pdf)',
    hash: generateAuditHash('AUD-2026-1002', '2026-10-15 14:10:05 UTC', 'auslifegriffin@gmail.com', 'JE-2026-0941', 'Amortized production cluster GPU compute'),
  },
  {
    id: 'AUD-2026-1001',
    timestamp: '2026-10-14 09:15:30 UTC',
    actorType: 'System',
    actorId: 'System Accrual',
    category: 'Journal Entry',
    action: 'Create Entry',
    targetId: 'JE-2026-0940',
    targetReference: 'PAY-2026-20',
    impactAmount: 142500,
    summary: 'Processed bi-weekly engineering & product payroll disbursement register',
    details: 'Debits: $142,500.00 | Credits: $142,500.00. 1 attachment uploaded (Rippling_Batch_20_Register.csv)',
    hash: generateAuditHash('AUD-2026-1001', '2026-10-14 09:15:30 UTC', 'System Accrual', 'JE-2026-0940', 'Processed bi-weekly payroll register'),
  },
];

export function filterAuditLogs(
  logs: AuditLogEntry[],
  filters: {
    category?: string;
    actorType?: string;
    searchQuery?: string;
  }
): AuditLogEntry[] {
  const normQuery = (filters.searchQuery || '').trim().toLowerCase();
  return logs.filter((log) => {
    if (filters.category && filters.category !== 'All' && log.category !== filters.category) {
      return false;
    }
    if (filters.actorType && filters.actorType !== 'All' && log.actorType !== filters.actorType) {
      return false;
    }
    if (normQuery) {
      const matchText = [
        log.id,
        log.timestamp,
        log.actorType,
        log.actorId,
        log.category,
        log.action,
        log.targetId,
        log.targetReference || '',
        log.summary,
        log.details || '',
        log.hash,
        String(log.impactAmount ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (!matchText.includes(normQuery)) {
        return false;
      }
    }
    return true;
  });
}

// ============================================================================
// 1. ACCOUNTS RECEIVABLE (AR) & INVOICING SUBLEDGER
// ============================================================================

export type InvoiceStatus = 'Open' | 'Overdue' | 'Paid';
export type AgingBucket = 'Current' | '1-30d' | '31-60d' | '61-90d' | '90+d';

export interface ReceivableInvoice {
  id: string;
  customer: string;
  issueDate: string;
  dueDate: string;
  agingBucket: AgingBucket;
  revenueAccountCode: string;
  amount: number;
  paidAmount: number;
  status: InvoiceStatus;
}

export const INITIAL_RECEIVABLES: ReceivableInvoice[] = [
  {
    id: 'INV-9012',
    customer: 'Citadel Quantitative Systems',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    agingBucket: 'Current',
    revenueAccountCode: '4010',
    amount: 145000,
    paidAmount: 0,
    status: 'Open',
  },
  {
    id: 'INV-9015',
    customer: 'Millennium Partners LP',
    issueDate: '2026-08-25',
    dueDate: '2026-09-24',
    agingBucket: '31-60d',
    revenueAccountCode: '4010',
    amount: 95000,
    paidAmount: 0,
    status: 'Overdue',
  },
  {
    id: 'INV-9018',
    customer: 'Point72 Asset Management',
    issueDate: '2026-10-05',
    dueDate: '2026-11-04',
    agingBucket: 'Current',
    revenueAccountCode: '4020',
    amount: 70000,
    paidAmount: 0,
    status: 'Open',
  },
  {
    id: 'INV-9021',
    customer: 'Jane Street Capital',
    issueDate: '2026-07-30',
    dueDate: '2026-08-29',
    agingBucket: '61-90d',
    revenueAccountCode: '4030',
    amount: 65000,
    paidAmount: 0,
    status: 'Overdue',
  },
  {
    id: 'INV-9008',
    customer: 'Vaneck Global Corp',
    issueDate: '2026-10-02',
    dueDate: '2026-10-16',
    agingBucket: 'Current',
    revenueAccountCode: '4010',
    amount: 185000,
    paidAmount: 185000,
    status: 'Paid',
  },
];

export interface ReceivablesSummary {
  totalOutstanding: number;
  currentAmount: number;
  pastDueAmount: number;
  collectedAmount: number;
  openCount: number;
  overdueCount: number;
  paidCount: number;
}

export function computeReceivablesSummary(invoices: ReceivableInvoice[]): ReceivablesSummary {
  let totalOutstanding = 0;
  let currentAmount = 0;
  let pastDueAmount = 0;
  let collectedAmount = 0;
  let openCount = 0;
  let overdueCount = 0;
  let paidCount = 0;

  for (const inv of invoices) {
    const balance = Math.max(0, inv.amount - inv.paidAmount);
    collectedAmount += inv.paidAmount;
    if (inv.status === 'Paid' || balance === 0) {
      paidCount++;
    } else {
      totalOutstanding += balance;
      if (inv.status === 'Overdue' || inv.agingBucket !== 'Current') {
        pastDueAmount += balance;
        overdueCount++;
      } else {
        currentAmount += balance;
        openCount++;
      }
    }
  }

  return {
    totalOutstanding,
    currentAmount,
    pastDueAmount,
    collectedAmount,
    openCount,
    overdueCount,
    paidCount,
  };
}

// ============================================================================
// 2. ACCOUNTS PAYABLE (AP) & VENDOR BILLS SUBLEDGER
// ============================================================================

export type BillStatus = 'Pending' | 'Approved' | 'Paid';

export interface PayableBill {
  id: string;
  vendor: string;
  billDate: string;
  dueDate: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  amount: number;
  status: BillStatus;
  reference: string;
}

export const INITIAL_PAYABLES: PayableBill[] = [
  {
    id: 'BILL-401',
    vendor: 'Amazon Web Services',
    billDate: '2026-10-03',
    dueDate: '2026-10-28',
    expenseAccountCode: '5010',
    expenseAccountName: 'Cloud & GPU Inference Hosting',
    amount: 48500,
    status: 'Approved',
    reference: 'AWS-INV-10992',
  },
  {
    id: 'BILL-402',
    vendor: 'CoreWeave GPU Cloud',
    billDate: '2026-10-06',
    dueDate: '2026-10-30',
    expenseAccountCode: '5010',
    expenseAccountName: 'Cloud & GPU Inference Hosting',
    amount: 36000,
    status: 'Approved',
    reference: 'CW-H100-882',
  },
  {
    id: 'BILL-403',
    vendor: 'Cooley LLP',
    billDate: '2026-10-09',
    dueDate: '2026-11-08',
    expenseAccountCode: '6250',
    expenseAccountName: 'General, Legal & Audit Advisory',
    amount: 18500,
    status: 'Pending',
    reference: 'CLY-88410',
  },
  {
    id: 'BILL-404',
    vendor: 'Snowflake Inc.',
    billDate: '2026-10-11',
    dueDate: '2026-11-10',
    expenseAccountCode: '6120',
    expenseAccountName: 'Enterprise GTM & Growth Operations',
    amount: 9000,
    status: 'Pending',
    reference: 'SNW-44109',
  },
  {
    id: 'BILL-400',
    vendor: 'Datadog Monitoring Corp',
    billDate: '2026-09-28',
    dueDate: '2026-10-12',
    expenseAccountCode: '5010',
    expenseAccountName: 'Cloud & GPU Inference Hosting',
    amount: 24000,
    status: 'Paid',
    reference: 'DD-90214',
  },
];

export interface PayablesSummary {
  totalOpenAp: number;
  approvedAmount: number;
  pendingAmount: number;
  paidAmount: number;
  approvedCount: number;
  pendingCount: number;
  paidCount: number;
}

export function computePayablesSummary(bills: PayableBill[]): PayablesSummary {
  let totalOpenAp = 0;
  let approvedAmount = 0;
  let pendingAmount = 0;
  let paidAmount = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let paidCount = 0;

  for (const b of bills) {
    if (b.status === 'Paid') {
      paidAmount += b.amount;
      paidCount++;
    } else if (b.status === 'Approved') {
      totalOpenAp += b.amount;
      approvedAmount += b.amount;
      approvedCount++;
    } else {
      totalOpenAp += b.amount;
      pendingAmount += b.amount;
      pendingCount++;
    }
  }

  return {
    totalOpenAp,
    approvedAmount,
    pendingAmount,
    paidAmount,
    approvedCount,
    pendingCount,
    paidCount,
  };
}

// ============================================================================
// 3. FIXED ASSETS & DEPRECIATION SCHEDULE
// ============================================================================

export type AssetStatus = 'Active' | 'Fully Depreciated';

export interface FixedAssetItem {
  id: string;
  name: string;
  category: 'Compute Cluster' | 'Networking' | 'Leasehold' | 'Workstations';
  inServiceDate: string;
  usefulLifeMonths: number;
  costBasis: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  lastDepreciatedPeriod: string;
  status: AssetStatus;
}

export const INITIAL_FIXED_ASSETS: FixedAssetItem[] = [
  {
    id: 'FA-101',
    name: 'NVIDIA H100 8x Node Cluster',
    category: 'Compute Cluster',
    inServiceDate: '2026-01-15',
    usefulLifeMonths: 36,
    costBasis: 360000,
    salvageValue: 36000,
    accumulatedDepreciation: 81000,
    lastDepreciatedPeriod: '2026-09',
    status: 'Active',
  },
  {
    id: 'FA-102',
    name: 'Arista 7050X3 Spine Switches',
    category: 'Networking',
    inServiceDate: '2026-02-01',
    usefulLifeMonths: 48,
    costBasis: 72000,
    salvageValue: 4800,
    accumulatedDepreciation: 11200,
    lastDepreciatedPeriod: '2026-09',
    status: 'Active',
  },
  {
    id: 'FA-103',
    name: 'SF HQ Vault & Fiber Buildout',
    category: 'Leasehold',
    inServiceDate: '2025-10-01',
    usefulLifeMonths: 60,
    costBasis: 120000,
    salvageValue: 0,
    accumulatedDepreciation: 24000,
    lastDepreciatedPeriod: '2026-09',
    status: 'Active',
  },
  {
    id: 'FA-104',
    name: 'Mac Studio M3 Ultra Fleet',
    category: 'Workstations',
    inServiceDate: '2026-03-01',
    usefulLifeMonths: 36,
    costBasis: 48000,
    salvageValue: 4800,
    accumulatedDepreciation: 8400,
    lastDepreciatedPeriod: '2026-09',
    status: 'Active',
  },
];

export interface ComputedFixedAssetRow extends FixedAssetItem {
  depreciableBase: number;
  monthlyDepreciation: number;
  netBookValue: number;
  depreciatedPct: number;
}

export interface FixedAssetsSummary {
  rows: ComputedFixedAssetRow[];
  totalCostBasis: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  totalMonthlyDepreciation: number;
}

export function computeFixedAssetMetrics(assets: FixedAssetItem[]): FixedAssetsSummary {
  let totalCostBasis = 0;
  let totalAccumulatedDepreciation = 0;
  let totalNetBookValue = 0;
  let totalMonthlyDepreciation = 0;

  const rows: ComputedFixedAssetRow[] = assets.map((asset) => {
    const depreciableBase = Math.max(0, asset.costBasis - asset.salvageValue);
    const rawMonthly =
      asset.usefulLifeMonths > 0 ? Math.round(depreciableBase / asset.usefulLifeMonths) : 0;
    const remainingDepreciable = Math.max(0, depreciableBase - asset.accumulatedDepreciation);
    const monthlyDepreciation =
      asset.status === 'Fully Depreciated' ? 0 : Math.min(rawMonthly, remainingDepreciable);
    const netBookValue = Math.max(0, asset.costBasis - asset.accumulatedDepreciation);
    const depreciatedPct =
      depreciableBase > 0
        ? Math.min(100, Math.round((asset.accumulatedDepreciation / depreciableBase) * 1000) / 10)
        : 100;

    totalCostBasis += asset.costBasis;
    totalAccumulatedDepreciation += asset.accumulatedDepreciation;
    totalNetBookValue += netBookValue;
    totalMonthlyDepreciation += monthlyDepreciation;

    return {
      ...asset,
      depreciableBase,
      monthlyDepreciation,
      netBookValue,
      depreciatedPct,
    };
  });

  return {
    rows,
    totalCostBasis,
    totalAccumulatedDepreciation,
    totalNetBookValue,
    totalMonthlyDepreciation,
  };
}

// ============================================================================
// 4. PERIOD CLOSE & DEFERRAL / ACCRUAL SCHEDULES
// ============================================================================

export interface AmortizationScheduleItem {
  id: string;
  type: 'Deferred Revenue' | 'Prepaid Expense';
  counterparty: string;
  contractRef: string;
  balanceSheetAccount: string;
  pnlAccount: string;
  totalContractAmount: number;
  recognizedToDate: number;
  monthlyRecognition: number;
  remainingMonths: number;
  status: 'Scheduled' | 'Posted Q4';
}

export interface CloseChecklistItem {
  id: string;
  code: string;
  task: string;
  category: 'Subledger' | 'Reconciliation' | 'Accruals' | 'Reporting';
  owner: string;
  completed: boolean;
}

export const INITIAL_AMORTIZATION_SCHEDULES: AmortizationScheduleItem[] = [
  {
    id: 'SCH-DEF-01',
    type: 'Deferred Revenue',
    counterparty: 'Vaneck Global Corp',
    contractRef: 'MSA-8841',
    balanceSheetAccount: '2400',
    pnlAccount: '4010',
    totalContractAmount: 240000,
    recognizedToDate: 100000,
    monthlyRecognition: 20000,
    remainingMonths: 7,
    status: 'Scheduled',
  },
  {
    id: 'SCH-DEF-02',
    type: 'Deferred Revenue',
    counterparty: 'Two Sigma Investments',
    contractRef: 'MSA-8790',
    balanceSheetAccount: '2400',
    pnlAccount: '4010',
    totalContractAmount: 180000,
    recognizedToDate: 90000,
    monthlyRecognition: 15000,
    remainingMonths: 6,
    status: 'Scheduled',
  },
  {
    id: 'SCH-PRE-01',
    type: 'Prepaid Expense',
    counterparty: 'Amazon Web Services',
    contractRef: 'RI-2026-ANNUAL',
    balanceSheetAccount: '1400',
    pnlAccount: '5010',
    totalContractAmount: 144000,
    recognizedToDate: 72000,
    monthlyRecognition: 12000,
    remainingMonths: 6,
    status: 'Scheduled',
  },
];

export const INITIAL_CLOSE_CHECKLIST: CloseChecklistItem[] = [
  {
    id: 'CLS-01',
    code: 'SUB-AR',
    task: 'Reconcile AR Subledger to GL 1100',
    category: 'Subledger',
    owner: 'Controller',
    completed: true,
  },
  {
    id: 'CLS-02',
    code: 'SUB-AP',
    task: 'Cut off AP Vendor Bills & Accruals (GL 2010)',
    category: 'Subledger',
    owner: 'AP Lead',
    completed: true,
  },
  {
    id: 'CLS-03',
    code: 'REC-CASH',
    task: 'Complete Mercury SVB Bank Reconciliation (GL 1010)',
    category: 'Reconciliation',
    owner: 'Agent REC-02',
    completed: true,
  },
  {
    id: 'CLS-04',
    code: 'ACR-REV',
    task: 'Post ASC 606 Deferred Revenue Amortization (GL 2400)',
    category: 'Accruals',
    owner: 'Agent REV-01',
    completed: false,
  },
  {
    id: 'CLS-05',
    code: 'ACR-DEP',
    task: 'Run Monthly Fixed Asset Depreciation Schedule',
    category: 'Accruals',
    owner: 'Controller',
    completed: false,
  },
  {
    id: 'CLS-06',
    code: 'RPT-LOCK',
    task: 'Verify Trial Balance & Lock Fiscal Period 2026-10',
    category: 'Reporting',
    owner: 'CFO',
    completed: false,
  },
];

export interface PeriodCloseSummary {
  completedTasks: number;
  totalTasks: number;
  completionPct: number;
  unamortizedDeferredRevenue: number;
  unamortizedPrepaidExpense: number;
  pendingRecognitionTotal: number;
  isLocked: boolean;
}

export function computePeriodCloseSummary(
  checklist: CloseChecklistItem[],
  schedules: AmortizationScheduleItem[],
  isLocked: boolean
): PeriodCloseSummary {
  const totalTasks = checklist.length;
  const completedTasks = checklist.filter((c) => c.completed).length;
  const completionPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

  let unamortizedDeferredRevenue = 0;
  let unamortizedPrepaidExpense = 0;
  let pendingRecognitionTotal = 0;

  for (const s of schedules) {
    const remaining = Math.max(0, s.totalContractAmount - s.recognizedToDate);
    if (s.type === 'Deferred Revenue') {
      unamortizedDeferredRevenue += remaining;
    } else {
      unamortizedPrepaidExpense += remaining;
    }
    if (s.status === 'Scheduled') {
      pendingRecognitionTotal += s.monthlyRecognition;
    }
  }

  return {
    completedTasks,
    totalTasks,
    completionPct,
    unamortizedDeferredRevenue,
    unamortizedPrepaidExpense,
    pendingRecognitionTotal,
    isLocked,
  };
}




