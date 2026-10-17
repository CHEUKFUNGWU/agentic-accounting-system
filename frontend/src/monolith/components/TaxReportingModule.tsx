import React, { useState, useMemo } from 'react';
import {
  TaxJurisdictionSchedule,
  computeTaxScheduleLiability,
  formatCurrency,
} from '../utils/accountingLogic';
import { createTaxReportingExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Check } from 'lucide-react';

interface TaxReportingModuleProps {
  schedules: TaxJurisdictionSchedule[];
  onUpdateSchedule: (
    id: string,
    updates: Partial<Pick<TaxJurisdictionSchedule, 'taxableBase' | 'creditsAndDeductions' | 'status'>>
  ) => void;
  onPostTaxProvisionJournal: (amount: number, jurisdiction: string, formCode: string) => void;
}

export const TaxReportingModule: React.FC<TaxReportingModuleProps> = ({
  schedules,
  onUpdateSchedule,
  onPostTaxProvisionJournal,
}) => {
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(
    schedules[0]?.id || 'TAX-FED-1120'
  );

  const consolidated = useMemo(() => {
    let totalBase = 0;
    let totalGross = 0;
    let totalCredits = 0;
    let totalNet = 0;

    for (const s of schedules) {
      const c = computeTaxScheduleLiability(s);
      totalBase += s.taxableBase;
      totalGross += c.grossLiability;
      totalCredits += s.creditsAndDeductions;
      totalNet += c.netPayable;
    }

    const weightedEffectiveRate =
      totalBase > 0 ? Math.round((totalNet / totalBase) * 10000) / 100 : 0;

    return {
      totalBase,
      totalGross,
      totalCredits,
      totalNet,
      weightedEffectiveRate,
    };
  }, [schedules]);

  const activeSchedule =
    schedules.find((s) => s.id === selectedScheduleId) || schedules[0];
  const activeComputed = computeTaxScheduleLiability(activeSchedule);

  const handleTriggerProvisionPost = (s: TaxJurisdictionSchedule) => {
    const computed = computeTaxScheduleLiability(s);
    onPostTaxProvisionJournal(computed.netPayable, s.jurisdiction, s.formCode);
    onUpdateSchedule(s.id, { status: 'Filed' });
  };

  return (
    <div className="space-y-8">
      {/* Minimal Tax KPI Strip */}
      <section
        aria-label="Tax Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Gross Liability</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(consolidated.totalGross)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Tax Credits</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            -{formatCurrency(consolidated.totalCredits)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Net Payable</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(consolidated.totalNet)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Effective Rate</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {consolidated.weightedEffectiveRate}%
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 7 Columns: Clean Tabular Schedule List */}
        <section
          aria-label="Tax Schedules"
          className="lg:col-span-7 bg-white border border-zinc-200 p-6"
        >
          <div className="pb-4 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-base font-bold text-zinc-950">Tax Schedules</h2>
            <ExportActionsBar
              onGenerateExport={() => createTaxReportingExportPayload(schedules)}
            />
          </div>

          <div className="divide-y divide-zinc-100">
            {schedules.map((sched) => {
              const comp = computeTaxScheduleLiability(sched);
              const isSelected = sched.id === activeSchedule.id;

              return (
                <div
                  key={sched.id}
                  onClick={() => setSelectedScheduleId(sched.id)}
                  className={`py-4 px-3 -mx-3 flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-zinc-100' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                      <span className="font-bold text-zinc-950">{sched.formCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>Due {sched.dueDate}</span>
                      <span aria-hidden="true">·</span>
                      <span>{sched.statutoryRate}%</span>
                    </div>
                    <div className="text-xs font-semibold text-zinc-950 mt-0.5 truncate">
                      {sched.jurisdiction}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div className="text-right font-mono">
                      <div className="text-xs font-bold text-zinc-950 tabular-nums">
                        {formatCurrency(comp.netPayable)}
                      </div>
                      <div className="text-[10px] text-zinc-400 tabular-nums">
                        Eff. {comp.effectiveRate}%
                      </div>
                    </div>

                    {sched.status === 'Filed' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400 w-20 justify-end">
                        <Check className="w-3.5 h-3.5 text-zinc-950" />
                        <span>Filed</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleTriggerProvisionPost(sched)}
                        className="px-3 py-1 text-xs font-mono bg-zinc-950 text-white hover:bg-zinc-800 cursor-pointer w-20 text-center"
                      >
                        File
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right 5 Columns: Minimal Workpaper Calculator */}
        <section
          aria-label="Provision Calculator"
          className="lg:col-span-5 bg-white border border-zinc-200 p-6"
        >
          <div className="pb-4 border-b border-zinc-100 flex items-baseline justify-between">
            <h3 className="text-base font-bold text-zinc-950">
              {activeSchedule.formCode}
            </h3>
            <span className="text-xs font-mono text-zinc-400">
              {activeSchedule.jurisdiction}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <label htmlFor="tax-base-input" className="text-zinc-400">
                  TAXABLE BASE
                </label>
                <span className="text-zinc-950 font-semibold tabular-nums">
                  {formatCurrency(activeSchedule.taxableBase)}
                </span>
              </div>
              <input
                id="tax-base-input"
                type="number"
                step="5000"
                min="0"
                value={activeSchedule.taxableBase}
                onChange={(e) =>
                  onUpdateSchedule(activeSchedule.id, {
                    taxableBase: Math.max(0, parseInt(e.target.value, 10) || 0),
                  })
                }
                className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-zinc-50 border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <label htmlFor="tax-credits-input" className="text-zinc-400">
                  CREDITS
                </label>
                <span className="text-zinc-950 font-semibold tabular-nums">
                  {formatCurrency(activeSchedule.creditsAndDeductions)}
                </span>
              </div>
              <input
                id="tax-credits-input"
                type="number"
                step="1000"
                min="0"
                value={activeSchedule.creditsAndDeductions}
                onChange={(e) =>
                  onUpdateSchedule(activeSchedule.id, {
                    creditsAndDeductions: Math.max(0, parseInt(e.target.value, 10) || 0),
                  })
                }
                className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-zinc-50 border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </div>

            <div className="pt-3 border-t border-zinc-100 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-zinc-500">
                <span>Gross ({activeSchedule.statutoryRate}%)</span>
                <span className="tabular-nums">{formatCurrency(activeComputed.grossLiability)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Credits</span>
                <span className="tabular-nums">-{formatCurrency(activeSchedule.creditsAndDeductions)}</span>
              </div>
              <div className="pt-2 border-t border-zinc-200 flex justify-between font-bold text-zinc-950">
                <span>Net Payable</span>
                <span className="tabular-nums">{formatCurrency(activeComputed.netPayable)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleTriggerProvisionPost(activeSchedule)}
              disabled={activeSchedule.status === 'Filed'}
              className="w-full py-2 px-4 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 transition-colors cursor-pointer"
            >
              {activeSchedule.status === 'Filed'
                ? 'Filed'
                : `File & Post ${formatCurrency(activeComputed.netPayable)}`}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
