import React, { useMemo } from 'react';
import {
  CloseChecklistItem,
  AmortizationScheduleItem,
  computePeriodCloseSummary,
  formatCurrency,
} from '../utils/accountingLogic';
import { createPeriodCloseExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Check, Lock, Unlock } from 'lucide-react';

interface PeriodCloseModuleProps {
  checklist: CloseChecklistItem[];
  schedules: AmortizationScheduleItem[];
  isPeriodLocked: boolean;
  onToggleChecklistTask: (id: string) => void;
  onPostAmortizationSchedule: (id: string) => void;
  onTogglePeriodLock: () => void;
  canTogglePeriodLock?: boolean;
}

export const PeriodCloseModule: React.FC<PeriodCloseModuleProps> = ({
  checklist,
  schedules,
  isPeriodLocked,
  onToggleChecklistTask,
  onPostAmortizationSchedule,
  onTogglePeriodLock,
  canTogglePeriodLock = true,
}) => {
  const summary = useMemo(
    () => computePeriodCloseSummary(checklist, schedules, isPeriodLocked),
    [checklist, schedules, isPeriodLocked]
  );

  return (
    <div className="space-y-8">
      {/* Minimal KPI Strip */}
      <section
        aria-label="Period Close Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Close Progress</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {summary.completedTasks}/{summary.totalTasks} ({summary.completionPct}%)
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Period 2026-10</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950 flex items-center gap-2">
            <span>{isPeriodLocked ? 'Locked' : 'Open'}</span>
            {isPeriodLocked ? (
              <Lock className="w-4 h-4 text-zinc-950" />
            ) : (
              <Unlock className="w-4 h-4 text-zinc-400" />
            )}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Deferred Revenue</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.unamortizedDeferredRevenue)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Prepaid Balance</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.unamortizedPrepaidExpense)}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 7 Columns: Amortization & Deferral Schedules */}
        <section
          aria-label="Deferral and Amortization Schedules"
          className="lg:col-span-7 bg-white border border-zinc-200 p-6 space-y-4"
        >
          <div className="pb-4 border-b border-zinc-100 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-zinc-950">Amortization Schedules</h2>
            <ExportActionsBar
              onGenerateExport={() =>
                createPeriodCloseExportPayload(checklist, schedules, isPeriodLocked)
              }
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-200 text-[11px] text-zinc-400">
                  <th className="py-3 pr-3 font-normal">SCHEDULE</th>
                  <th className="py-3 px-3 font-normal">TYPE</th>
                  <th className="py-3 px-3 font-normal">GL PAIR</th>
                  <th className="py-3 px-3 font-normal text-right">REMAINING</th>
                  <th className="py-3 px-3 font-normal text-right bg-zinc-50">MONTHLY</th>
                  <th className="py-3 pl-3 font-normal text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {schedules.map((sch) => {
                  const remaining = Math.max(
                    0,
                    sch.totalContractAmount - sch.recognizedToDate
                  );
                  return (
                    <tr key={sch.id} className="hover:bg-zinc-50/80">
                      <td className="py-3 pr-3">
                        <div className="font-bold text-zinc-950">{sch.id}</div>
                        <div className="font-sans text-[11px] text-zinc-600">
                          {sch.counterparty}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-zinc-500 whitespace-nowrap">
                        {sch.type}
                      </td>
                      <td className="py-3 px-3 text-zinc-500 whitespace-nowrap">
                        {sch.balanceSheetAccount} → {sch.pnlAccount}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-zinc-600 whitespace-nowrap">
                        {formatCurrency(remaining)}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold tabular-nums text-zinc-950 bg-zinc-50/60 whitespace-nowrap">
                        {formatCurrency(sch.monthlyRecognition)}
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {sch.status === 'Posted Q4' ? (
                          <span className="inline-flex items-center gap-1 text-zinc-400 justify-end">
                            <Check className="w-3.5 h-3.5 text-zinc-950" />
                            <span>Posted</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isPeriodLocked}
                            onClick={() => onPostAmortizationSchedule(sch.id)}
                            aria-label={`Recognize ${sch.id}`}
                            className="px-2.5 py-1 text-xs font-mono bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 transition-colors cursor-pointer"
                          >
                            Recognize
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right 5 Columns: Period Close Checklist & Lock Control */}
        <section
          aria-label="Period Close Checklist"
          className="lg:col-span-5 bg-white border border-zinc-200 p-6 space-y-4"
        >
          <div className="pb-4 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-zinc-950">Close Checklist</h3>
            <button
              type="button"
              onClick={onTogglePeriodLock}
              disabled={!canTogglePeriodLock}
              title={!canTogglePeriodLock ? "MFA enrollment is required before period signing or reopening." : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                isPeriodLocked
                  ? 'bg-white text-zinc-950 border-zinc-950 hover:bg-zinc-100'
                  : 'bg-zinc-950 text-white border-zinc-950 hover:bg-zinc-800'
              }`}
            >
              {isPeriodLocked ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Unlock Period</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Period</span>
                </>
              )}
            </button>
          </div>

          <div className="divide-y divide-zinc-100">
            {checklist.map((item) => (
              <div
                key={item.id}
                onClick={() => onToggleChecklistTask(item.id)}
                className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-zinc-50 px-2 -mx-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => onToggleChecklistTask(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={item.task}
                    className="w-3.5 h-3.5 accent-zinc-950 cursor-pointer shrink-0"
                  />
                  <div className="min-w-0">
                    <div
                      className={`text-xs font-medium truncate ${
                        item.completed ? 'line-through text-zinc-400' : 'text-zinc-950'
                      }`}
                    >
                      {item.task}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-400">
                      {item.code} · {item.category} · {item.owner}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-zinc-400 shrink-0">
                  {item.completed ? 'Done' : 'Open'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
