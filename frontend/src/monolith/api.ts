import type { Account, JournalEntry, BankFeedItem, LedgerCashItem, TaxJurisdictionSchedule, AuditLogEntry, ReceivableInvoice, PayableBill, FixedAssetItem, CloseChecklistItem, AmortizationScheduleItem, BudgetAllocationItem, ForecastDrivers } from './utils/accountingLogic';
import type { AgentTask } from './components/OverviewModule';
import type { AppPreferences } from './utils/preferences';

export interface Workspace {
  workspaceId: string;
  entityName: string;
  currency: string;
  period: string;
  dataOrigin: string;
  revision: number;
  accounts: Account[];
  journalEntries: JournalEntry[];
  bankItems: BankFeedItem[];
  ledgerCashItems: LedgerCashItem[];
  taxSchedules: TaxJurisdictionSchedule[];
  agentTasks: AgentTask[];
  auditLogs: AuditLogEntry[];
  receivables: ReceivableInvoice[];
  payables: PayableBill[];
  fixedAssets: FixedAssetItem[];
  closeChecklist: CloseChecklistItem[];
  amortizationSchedules: AmortizationScheduleItem[];
  isPeriodLocked: boolean;
  preferences: AppPreferences;
  budgetAllocations: BudgetAllocationItem[];
  forecastDrivers: ForecastDrivers;
  forecastOverrides: Record<string, number>;
}

const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
async function request(path: string, init?: RequestInit): Promise<Workspace> {
  const response = await fetch(`${base}/monolith${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Backend request failed (${response.status}).`);
  }
  return response.json();
}
export const loadWorkspace = () => request('/workspace');
export const sendCommand = (action: string, payload: object, revision: number) => request('/commands', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, payload, revision, commandId: crypto.randomUUID() }),
});
