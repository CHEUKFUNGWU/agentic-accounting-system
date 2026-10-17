import React, { useState, useMemo } from 'react';
import {
  FixedAssetItem,
  computeFixedAssetMetrics,
  formatCurrency,
} from '../utils/accountingLogic';
import { createFixedAssetsExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Plus, Play } from 'lucide-react';

interface FixedAssetsModuleProps {
  assets: FixedAssetItem[];
  period: string;
  onRunMonthlyDepreciation: () => void;
  onRegisterAsset: (params: {
    name: string;
    category: FixedAssetItem['category'];
    usefulLifeMonths: number;
    costBasis: number;
    salvageValue: number;
  }) => Promise<unknown>;
}

export const FixedAssetsModule: React.FC<FixedAssetsModuleProps> = ({
  assets,
  period,
  onRunMonthlyDepreciation,
  onRegisterAsset,
}) => {
  const [nameInput, setNameInput] = useState('');
  const [categoryInput, setCategoryInput] =
    useState<FixedAssetItem['category']>('Compute Cluster');
  const [lifeInput, setLifeInput] = useState('36');
  const [costInput, setCostInput] = useState('');
  const [salvageInput, setSalvageInput] = useState('0');

  const summary = useMemo(() => computeFixedAssetMetrics(assets), [assets]);
  const due = useMemo(() => computeFixedAssetMetrics(assets.filter(asset => asset.lastDepreciatedPeriod < period)).totalMonthlyDepreciation, [assets, period]);

  const handleSubmitAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cost = Number(costInput);
    const life = Math.max(12, Math.round(Number(lifeInput) || 36));
    const salvage = Math.max(0, Number(salvageInput) || 0);
    if (!nameInput.trim() || !cost || cost <= 0) return;

    try { await onRegisterAsset({
      name: nameInput.trim(),
      category: categoryInput,
      usefulLifeMonths: life,
      costBasis: cost,
      salvageValue: Math.min(salvage, cost),
    }); } catch { return; }
    setNameInput('');
    setCostInput('');
    setSalvageInput('0');
  };

  return (
    <div className="space-y-8">
      {/* Minimal KPI Strip */}
      <section
        aria-label="Fixed Assets Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Cost Basis</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.totalCostBasis)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Accum. Depr.</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            -{formatCurrency(summary.totalAccumulatedDepreciation)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Net Book Value</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.totalNetBookValue)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Monthly Depr.</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.totalMonthlyDepreciation)}
          </div>
        </div>
      </section>

      {/* Asset Register & Depreciation Schedule */}
      <section aria-label="Fixed Asset Register" className="bg-white border border-zinc-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-bold text-zinc-950">Fixed Assets</h2>
            <span className="text-xs font-mono text-zinc-400">Straight-Line</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRunMonthlyDepreciation}
              disabled={due <= 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 transition-colors cursor-pointer"
            >
              <Play className="w-3 h-3" />
              <span>Post Monthly Depr. ({formatCurrency(due)})</span>
            </button>
            <ExportActionsBar
              onGenerateExport={() => createFixedAssetsExportPayload(assets)}
            />
          </div>
        </div>

        {/* Inline Register New Asset Form */}
        <form
          onSubmit={handleSubmitAsset}
          aria-label="Register Fixed Asset"
          className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-zinc-50 p-3 border border-zinc-200"
        >
          <input
            type="text"
            aria-label="Asset Name"
            placeholder="Asset Name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="sm:col-span-4 px-3 py-1.5 text-xs bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <select
            aria-label="Asset Category"
            value={categoryInput}
            onChange={(e) =>
              setCategoryInput(e.target.value as FixedAssetItem['category'])
            }
            className="sm:col-span-3 px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          >
            <option value="Compute Cluster">Compute Cluster</option>
            <option value="Networking">Networking</option>
            <option value="Leasehold">Leasehold</option>
            <option value="Workstations">Workstations</option>
          </select>
          <select
            aria-label="Useful Life Months"
            value={lifeInput}
            onChange={(e) => setLifeInput(e.target.value)}
            className="sm:col-span-2 px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          >
            <option value="24">24 Mo</option>
            <option value="36">36 Mo</option>
            <option value="48">48 Mo</option>
            <option value="60">60 Mo</option>
          </select>
          <input
            type="number" step="0.01"
            aria-label="Cost Basis"
            placeholder="Cost ($)"
            min="0"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value)}
            className="sm:col-span-2 px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <button
            type="submit"
            className="sm:col-span-1 px-3 py-1.5 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </form>

        {/* Assets Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] text-zinc-400">
                <th className="py-3 pr-4 font-normal w-20">ID</th>
                <th className="py-3 px-4 font-normal">ASSET</th>
                <th className="py-3 px-4 font-normal w-32">CATEGORY</th>
                <th className="py-3 px-4 font-normal w-28">IN SERVICE</th>
                <th className="py-3 px-4 font-normal text-right w-20">LIFE</th>
                <th className="py-3 px-4 font-normal text-right w-28">COST</th>
                <th className="py-3 px-4 font-normal text-right w-28">SALVAGE</th>
                <th className="py-3 px-4 font-normal text-right w-28">MONTHLY</th>
                <th className="py-3 px-4 font-normal text-right w-32">ACCUM DEPR</th>
                <th className="py-3 pl-4 font-normal text-right w-32 bg-zinc-50">NBV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {summary.rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/80">
                  <td className="py-3 pr-4 font-bold text-zinc-950 whitespace-nowrap">
                    {row.id}
                  </td>
                  <td className="py-3 px-4 font-sans font-medium text-zinc-900">
                    {row.name}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                    {row.category}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 tabular-nums whitespace-nowrap">
                    {row.inServiceDate}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-500 whitespace-nowrap">
                    {row.usefulLifeMonths}m
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-600 whitespace-nowrap">
                    {formatCurrency(row.costBasis)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-400 whitespace-nowrap">
                    {row.salvageValue > 0 ? formatCurrency(row.salvageValue) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-900 whitespace-nowrap">
                    {formatCurrency(row.monthlyDepreciation)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-600 whitespace-nowrap">
                    {formatCurrency(row.accumulatedDepreciation)}
                  </td>
                  <td className="py-3 pl-4 text-right font-semibold tabular-nums text-zinc-950 bg-zinc-50/60 whitespace-nowrap">
                    {formatCurrency(row.netBookValue)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-950 font-bold text-zinc-950 bg-zinc-50/60">
                <td colSpan={5} className="py-3 pr-4">
                  TOTAL
                </td>
                <td className="py-3 px-4 text-right tabular-nums">
                  {formatCurrency(summary.totalCostBasis)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums text-zinc-400">—</td>
                <td className="py-3 px-4 text-right tabular-nums">
                  {formatCurrency(summary.totalMonthlyDepreciation)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums">
                  {formatCurrency(summary.totalAccumulatedDepreciation)}
                </td>
                <td className="py-3 pl-4 text-right tabular-nums">
                  {formatCurrency(summary.totalNetBookValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};
