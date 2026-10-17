import React, { useMemo } from 'react';
import {
  JournalEntry,
  computeTrialBalance,
  formatCurrency,
} from '../utils/accountingLogic';
import { createTrialBalanceExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Check } from 'lucide-react';

interface TrialBalanceModuleProps {
  entries: JournalEntry[];
}

export const TrialBalanceModule: React.FC<TrialBalanceModuleProps> = ({ entries }) => {
  const report = useMemo(() => computeTrialBalance(entries), [entries]);

  return (
    <div className="space-y-8">
      {/* Minimal Summary Strip */}
      <section
        aria-label="Trial Balance Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total Debits</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(report.totalDebitBalance)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total Credits</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(report.totalCreditBalance)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Period Activity</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(report.totalPeriodDebits)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Status</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950 flex items-center gap-2">
            <span>{report.isBalanced ? 'Balanced' : 'Out of Balance'}</span>
            {report.isBalanced && <Check className="w-5 h-5 text-zinc-950" />}
          </div>
        </div>
      </section>

      {/* Trial Balance Table */}
      <section aria-label="Trial Balance Schedule" className="bg-white border border-zinc-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-bold text-zinc-950">Trial Balance</h2>
            <span className="text-xs font-mono text-zinc-400">Q4 2026</span>
          </div>
          <ExportActionsBar
            onGenerateExport={() => createTrialBalanceExportPayload(entries)}
          />
        </div>

        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] text-zinc-400">
                <th className="py-3 pr-4 font-normal w-20">CODE</th>
                <th className="py-3 px-4 font-normal">ACCOUNT</th>
                <th className="py-3 px-4 font-normal w-28">TYPE</th>
                <th className="py-3 px-4 font-normal text-right w-32">OPENING</th>
                <th className="py-3 px-4 font-normal text-right w-32">PERIOD DR</th>
                <th className="py-3 px-4 font-normal text-right w-32">PERIOD CR</th>
                <th className="py-3 px-4 font-normal text-right w-36 bg-zinc-50">ENDING DEBIT</th>
                <th className="py-3 pl-4 font-normal text-right w-36 bg-zinc-50">ENDING CREDIT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {report.rows.map((row) => (
                <tr key={row.code} className="hover:bg-zinc-50/80">
                  <td className="py-3 pr-4 font-bold text-zinc-950">{row.code}</td>
                  <td className="py-3 px-4 font-sans font-medium text-zinc-900">
                    {row.name}
                  </td>
                  <td className="py-3 px-4 text-zinc-400">{row.category}</td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-500">
                    {formatCurrency(row.openingBalance)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-600">
                    {row.periodDebits > 0 ? formatCurrency(row.periodDebits) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-600">
                    {row.periodCredits > 0 ? formatCurrency(row.periodCredits) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums text-zinc-950 bg-zinc-50/60">
                    {row.debitBalance > 0 ? formatCurrency(row.debitBalance) : '—'}
                  </td>
                  <td className="py-3 pl-4 text-right font-semibold tabular-nums text-zinc-950 bg-zinc-50/60">
                    {row.creditBalance > 0 ? formatCurrency(row.creditBalance) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-950 bg-zinc-50 font-bold text-zinc-950">
                <td colSpan={4} className="py-3.5 pr-4">
                  TOTAL
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums">
                  {formatCurrency(report.totalPeriodDebits)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums">
                  {formatCurrency(report.totalPeriodCredits)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums">
                  {formatCurrency(report.totalDebitBalance)}
                </td>
                <td className="py-3.5 pl-4 text-right tabular-nums">
                  {formatCurrency(report.totalCreditBalance)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};
