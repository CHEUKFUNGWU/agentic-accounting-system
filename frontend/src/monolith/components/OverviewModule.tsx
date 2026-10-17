import React, { useState, useMemo } from 'react';
import {
  JournalEntry,
  ReconciliationSummary,
  SANKEY_DATASETS,
  PNL_SANKEY_DATASETS,
  computeFinancialStatements,
  buildLivePnlSankeyDataset,
  formatCurrency,
} from '../utils/accountingLogic';
import { createOverviewExportPayload } from '../utils/exportUtils';
import { SankeyChart, SankeyChartMode } from './SankeyChart';
import { ExportActionsBar } from './ExportActionsBar';
import { Check, ArrowUpRight } from 'lucide-react';

export interface AgentTask {
  id: string;
  code: string;
  title: string;
  impactAmount: number;
  confidence: number;
  category: 'Revenue Recognition' | 'Bank Reconciliation' | 'Tax Nexus' | 'Accrual Drift';
  description: string;
  resolved: boolean;
  targetTab: 'journal' | 'reconciliation' | 'tax';
}

interface OverviewModuleProps {
  journalEntries: JournalEntry[];
  reconSummary: ReconciliationSummary;
  totalNetTaxLiability: number;
  agentTasks: AgentTask[];
  onResolveAgentTask: (taskId: string) => void;
  onNavigateTab: (tab: 'overview' | 'journal' | 'ledger' | 'trial-balance' | 'statements' | 'reconciliation' | 'tax') => void;
}

export const OverviewModule: React.FC<OverviewModuleProps> = ({
  journalEntries,
  reconSummary,
  totalNetTaxLiability,
  agentTasks,
  onResolveAgentTask,
  onNavigateTab,
}) => {
  const [chartMode, setChartMode] = useState<SankeyChartMode>('cashflow');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('Q4-2026');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const livePnlDataset = useMemo(
    () => buildLivePnlSankeyDataset(computeFinancialStatements(journalEntries)),
    [journalEntries]
  );

  const dataset = useMemo(() => {
    if (chartMode === 'cashflow') {
      return SANKEY_DATASETS[selectedPeriod] || SANKEY_DATASETS['Q4-2026'];
    }
    if (selectedPeriod === 'Q4-2026') {
      return livePnlDataset;
    }
    return PNL_SANKEY_DATASETS[selectedPeriod] || livePnlDataset;
  }, [chartMode, selectedPeriod, livePnlDataset]);

  const grossInflow = dataset.nodes.find((n) => n.id === 'gross_inflow')?.value ?? 1315000;
  const opexPool = dataset.nodes.find((n) => n.id === 'opex_pool')?.value ?? 665000;
  const netTreasury = dataset.nodes.find((n) => n.id === 'net_treasury')?.value ?? 487200;
  const operatingMarginPct = ((grossInflow - opexPool) / Math.max(grossInflow, 1)) * 100;

  const filteredEntries = journalEntries.filter((entry) => {
    if (!selectedNodeId) return true;
    const text = `${entry.memo} ${entry.lines.map((l) => l.accountName).join(' ')}`.toLowerCase();
    if (selectedNodeId === 'rev_saas') return text.includes('saas') || text.includes('subscription');
    if (selectedNodeId === 'rev_usage') return text.includes('usage') || text.includes('overage');
    if (selectedNodeId === 'cost_cloud') return text.includes('cloud') || text.includes('gpu') || text.includes('aws');
    if (selectedNodeId === 'cost_rnd') return text.includes('payroll') || text.includes('r&d');
    if (selectedNodeId === 'tax_reserve') return text.includes('tax');
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Minimalist KPI Grid */}
      <section
        aria-label="Key Financial Indicators"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">
            {chartMode === 'cashflow' ? 'Gross Inflow' : 'Total Revenue'}
          </div>
          <div className="mt-2 text-3xl font-bold font-mono tabular-nums tracking-tight text-zinc-950">
            {formatCurrency(grossInflow)}
          </div>
          <div className="mt-2 text-xs font-mono text-zinc-500 tabular-nums">
            +18.5% QoQ
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">
            {chartMode === 'cashflow' ? 'Net Free Cash' : 'Net Income'}
          </div>
          <div className="mt-2 text-3xl font-bold font-mono tabular-nums tracking-tight text-zinc-950">
            {formatCurrency(netTreasury)}
          </div>
          <div className="mt-2 text-xs font-mono text-zinc-500 tabular-nums">
            {operatingMarginPct.toFixed(1)}% Margin
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Cash Balance</div>
          <div className="mt-2 text-3xl font-bold font-mono tabular-nums tracking-tight text-zinc-950">
            {formatCurrency(reconSummary.ledgerEndingBalance)}
          </div>
          <div className="mt-2 text-xs font-mono text-zinc-500 tabular-nums">
            {reconSummary.reconciliationRate}% Reconciled
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Tax Reserve</div>
          <div className="mt-2 text-3xl font-bold font-mono tabular-nums tracking-tight text-zinc-950">
            {formatCurrency(totalNetTaxLiability)}
          </div>
          <div className="mt-2 text-xs font-mono text-zinc-500 tabular-nums">
            4 Jurisdictions
          </div>
        </div>
      </section>

      {/* Dual-Mode Sankey Diagram (Cash Flow Sankey | P&L Sankey) */}
      <SankeyChart
        dataset={dataset}
        chartMode={chartMode}
        onSelectChartMode={setChartMode}
        selectedPeriod={selectedPeriod}
        onSelectPeriod={setSelectedPeriod}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        headerActions={
          <ExportActionsBar
            onGenerateExport={() =>
              createOverviewExportPayload(
                dataset,
                chartMode,
                reconSummary,
                totalNetTaxLiability,
                journalEntries
              )
            }
          />
        }
      />

      {/* Lower Two-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Agent Queue — Compact Single-Row Items */}
        <section
          aria-label="Agent Proposals"
          className="lg:col-span-5 bg-white border border-zinc-200 p-6"
        >
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-950">Agent Queue</h3>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              {agentTasks.filter((t) => !t.resolved).length} Open
            </span>
          </div>

          <div className="divide-y divide-zinc-100">
            {agentTasks.map((task) => (
              <div
                key={task.id}
                className="py-3.5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                    <span>{task.code}</span>
                    <span aria-hidden="true">·</span>
                    <span>{task.category}</span>
                  </div>
                  <div className="text-xs font-medium text-zinc-950 truncate mt-0.5">
                    {task.title}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono font-semibold text-zinc-950 tabular-nums">
                    {formatCurrency(task.impactAmount)}
                  </span>

                  {task.resolved ? (
                    <span className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400">
                      <Check className="w-3.5 h-3.5 text-zinc-950" />
                      Done
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onResolveAgentTask(task.id)}
                      className="px-2.5 py-1 text-xs font-mono bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Approve
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={`Inspect ${task.title}`}
                    onClick={() => onNavigateTab(task.targetTab)}
                    className="p-1 text-zinc-400 hover:text-zinc-950 transition-colors cursor-pointer"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Recent Ledger Table — Pure Data */}
        <section
          aria-label="General Ledger"
          className="lg:col-span-7 bg-white border border-zinc-200 p-6"
        >
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-950">Recent Ledger</h3>
            <button
              type="button"
              onClick={() => onNavigateTab('journal')}
              className="text-xs font-mono text-zinc-500 hover:text-zinc-950 transition-colors cursor-pointer"
            >
              All Entries →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 text-[11px] font-mono text-zinc-400">
                  <th className="py-2.5 pr-3 font-normal">ID</th>
                  <th className="py-2.5 px-2.5 font-normal">DATE</th>
                  <th className="py-2.5 px-2.5 font-normal">MEMO</th>
                  <th className="py-2.5 pl-3 font-normal text-right whitespace-nowrap">AMOUNT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {filteredEntries.slice(0, 6).map((entry) => {
                  const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
                  return (
                    <tr key={entry.id} className="hover:bg-zinc-50/80">
                      <td className="py-3 pr-3 font-mono font-medium text-zinc-950 whitespace-nowrap">
                        {entry.id}
                      </td>
                      <td className="py-3 px-2.5 font-mono text-zinc-400 whitespace-nowrap">
                        {entry.date}
                      </td>
                      <td className="py-3 px-2.5 text-zinc-800 truncate max-w-[160px] xl:max-w-[220px]">
                        {entry.memo}
                      </td>
                      <td className="py-3 pl-3 text-right font-mono font-semibold text-zinc-950 tabular-nums whitespace-nowrap">
                        {formatCurrency(totalDebit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
