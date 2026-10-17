import React, { useState } from 'react';
import {
  BankFeedItem,
  LedgerCashItem,
  ReconciliationSummary,
  formatCurrency,
} from '../utils/accountingLogic';
import { createBankReconciliationExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Check } from 'lucide-react';

interface BankReconciliationModuleProps {
  bankItems: BankFeedItem[];
  ledgerCashItems: LedgerCashItem[];
  summary: ReconciliationSummary;
  onReconcileItem: (bankId: string, ledgerId: string) => void;
  onBatchReconcileSuggested: () => void;
  onBookExceptionToLedger: (bankId: string) => void;
  globalSearchQuery?: string;
}

export const BankReconciliationModule: React.FC<BankReconciliationModuleProps> = ({
  bankItems,
  ledgerCashItems,
  summary,
  onReconcileItem,
  onBatchReconcileSuggested,
  onBookExceptionToLedger,
  globalSearchQuery = '',
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Unmatched' | 'Matched' | 'Exception'>('ALL');

  const q = globalSearchQuery.trim().toLowerCase();
  const filteredBankItems = bankItems.filter((item) => {
    if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
    if (!q) return true;
    return (
      item.id.toLowerCase().includes(q) ||
      item.counterparty.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.bankReference.toLowerCase().includes(q) ||
      item.status.toLowerCase().includes(q) ||
      String(Math.abs(item.amount)).includes(q.replace(/[$,]/g, ''))
    );
  });

  const unmatchedWithSuggestionCount = bankItems.filter(
    (b) => b.status === 'Unmatched' && b.suggestedLedgerId
  ).length;

  return (
    <div className="space-y-8">
      {/* Minimal Summary Strip */}
      <section
        aria-label="Reconciliation Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Bank Ending</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.bankEndingBalance)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Ledger Ending</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.ledgerEndingBalance)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Variance</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.unreconciledDelta)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Reconciled</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {summary.reconciliationRate}%
          </div>
        </div>
      </section>

      {/* Split Workspace */}
      <section aria-label="Reconciliation" className="bg-white border border-zinc-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-100">
          <h2 className="text-base font-bold text-zinc-950">Bank Reconciliation</h2>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200">
              {(['ALL', 'Unmatched', 'Exception', 'Matched'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-zinc-950 text-white'
                      : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st}
                </button>
              ))}
            </div>

            {unmatchedWithSuggestionCount > 0 && (
              <button
                type="button"
                onClick={onBatchReconcileSuggested}
                className="px-3 py-1 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                Reconcile All ({unmatchedWithSuggestionCount})
              </button>
            )}

            <ExportActionsBar
              onGenerateExport={() =>
                createBankReconciliationExportPayload(bankItems, ledgerCashItems, summary)
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-5">
          {/* Bank Feed */}
          <div className="lg:col-span-7">
            <div className="text-[11px] font-mono text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
              <span>BANK FEED</span>
              <span>AMOUNT / ACTION</span>
            </div>

            <div className="divide-y divide-zinc-100">
              {filteredBankItems.map((bItem) => (
                <div
                  key={bItem.id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                      <span>{bItem.date}</span>
                      <span aria-hidden="true">·</span>
                      <span>{bItem.bankReference}</span>
                    </div>
                    <div className="text-xs font-semibold text-zinc-950 truncate mt-0.5">
                      {bItem.counterparty}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs font-mono font-bold text-zinc-950 tabular-nums">
                      {formatCurrency(bItem.amount, true)}
                    </span>

                    {bItem.status === 'Matched' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400 w-28 justify-end">
                        <Check className="w-3.5 h-3.5 text-zinc-950" />
                        <span>{bItem.matchedLedgerId}</span>
                      </span>
                    ) : bItem.status === 'Unmatched' && bItem.suggestedLedgerId ? (
                      <button
                        type="button"
                        onClick={() => onReconcileItem(bItem.id, bItem.suggestedLedgerId!)}
                        className="px-2.5 py-1 text-xs font-mono bg-zinc-950 text-white hover:bg-zinc-800 cursor-pointer w-28 text-center"
                      >
                        Match {bItem.suggestedLedgerId}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onBookExceptionToLedger(bItem.id)}
                        className="px-2.5 py-1 text-xs font-mono border border-zinc-950 text-zinc-950 hover:bg-zinc-950 hover:text-white cursor-pointer w-28 text-center"
                      >
                        Book Entry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* GL Cash Account */}
          <div className="lg:col-span-5">
            <div className="text-[11px] font-mono text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
              <span>GL CASH (1010)</span>
              <span>BALANCE</span>
            </div>

            <div className="divide-y divide-zinc-100">
              {ledgerCashItems.map((lItem) => (
                <div
                  key={lItem.id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                      <span className="text-zinc-900 font-medium">{lItem.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{lItem.entryId}</span>
                    </div>
                    <div className="text-xs text-zinc-700 truncate mt-0.5">
                      {lItem.memo}
                    </div>
                  </div>

                  <div className="text-right font-mono shrink-0">
                    <div className="text-xs font-bold text-zinc-950 tabular-nums">
                      {formatCurrency(lItem.amount, true)}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {lItem.reconciled ? 'Cleared' : 'Open'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
