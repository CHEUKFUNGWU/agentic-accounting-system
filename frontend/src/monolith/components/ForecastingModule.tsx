import React, { useState, useMemo } from 'react';
import {
  JournalEntry,
  ForecastScenarioId,
  ForecastDrivers,
  FORECAST_SCENARIO_PRESETS,
  computeRollingForecast,
  formatCurrency,
} from '../utils/accountingLogic';
import { createForecastingExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import {
  Grid3X3,
  BarChart3,
  RotateCcw,
  KeyRound,
  SlidersHorizontal,
} from 'lucide-react';

interface ForecastingModuleProps {
  entries: JournalEntry[];
}

type ColLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

type EditableRowKey = 'saas' | 'otherRev' | 'cloudCogs' | 'rndAndGtmOpex';

interface SelectedForecastCell {
  col: ColLetter;
  row: number;
  columnName: string;
  dataType: string;
  formula: string;
}

export const ForecastingModule: React.FC<ForecastingModuleProps> = ({ entries }) => {
  const [drivers, setDrivers] = useState<ForecastDrivers>(
    FORECAST_SCENARIO_PRESETS.base
  );
  const [viewMode, setViewMode] = useState<'sheet' | 'chart'>('sheet');
  // Cell-level overrides keyed by `${rowKey}-${quarterIdx}` (for quarterIdx 1..4 = Q1..Q4 2027E)
  const [cellOverrides, setCellOverrides] = useState<Record<string, number>>({});

  const baseForecast = useMemo(
    () => computeRollingForecast(entries, drivers),
    [entries, drivers]
  );

  // Merge user cell overrides with formula-computed quarters so editing any cell in Q1..Q4 2027E
  // recalculates Total Revenue, Gross Profit, EBITDA, Tax Provision, Net Income, and Ending Cash!
  const forecast = useMemo(() => {
    if (Object.keys(cellOverrides).length === 0) return baseForecast;

    const taxRate = drivers.effectiveTaxRatePct / 100;
    let runningCash = baseForecast.quarters[0].endingCash;

    const updatedQuarters = baseForecast.quarters.map((q, idx) => {
      if (idx === 0) return q;

      const saasRevenue =
        cellOverrides[`saas-${idx}`] !== undefined
          ? cellOverrides[`saas-${idx}`]
          : q.saasRevenue;
      const usageAndServicesRevenue =
        cellOverrides[`otherRev-${idx}`] !== undefined
          ? cellOverrides[`otherRev-${idx}`]
          : q.usageAndServicesRevenue;
      const totalRevenue = saasRevenue + usageAndServicesRevenue;

      const cloudCogs =
        cellOverrides[`cloudCogs-${idx}`] !== undefined
          ? cellOverrides[`cloudCogs-${idx}`]
          : q.cloudCogs;
      const grossProfit = totalRevenue - cloudCogs;
      const grossMarginPct =
        Math.round((grossProfit / Math.max(1, totalRevenue)) * 1000) / 10;

      const rndAndGtmOpex =
        cellOverrides[`rndAndGtmOpex-${idx}`] !== undefined
          ? cellOverrides[`rndAndGtmOpex-${idx}`]
          : q.rndAndGtmOpex;
      const totalOperatingExpenses = cloudCogs + rndAndGtmOpex;

      const ebitda = totalRevenue - totalOperatingExpenses;
      const ebitdaMarginPct =
        Math.round((ebitda / Math.max(1, totalRevenue)) * 1000) / 10;

      const taxProvision = ebitda > 0 ? Math.round(ebitda * taxRate) : 0;
      const netIncome = ebitda - taxProvision;

      runningCash += Math.round(netIncome * 1.04);

      return {
        ...q,
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
      };
    });

    const proj = updatedQuarters.slice(1);
    return {
      ...baseForecast,
      quarters: updatedQuarters,
      fy2027TotalRevenue: proj.reduce((s, q) => s + q.totalRevenue, 0),
      fy2027TotalEbitda: proj.reduce((s, q) => s + q.ebitda, 0),
      fy2027TotalNetIncome: proj.reduce((s, q) => s + q.netIncome, 0),
      fy2027EndingCash: proj[proj.length - 1].endingCash,
      arrExitQ4_2027: proj[proj.length - 1].totalRevenue * 4,
    };
  }, [baseForecast, cellOverrides, drivers.effectiveTaxRatePct]);

  const [selectedCell, setSelectedCell] = useState<SelectedForecastCell>({
    col: 'D',
    row: 1,
    columnName: 'q1_2027e',
    dataType: 'int8 (editable)',
    formula: '=ROUND(C1*(1+$DRV_REV_GROWTH), 0)',
  });

  const handleSelectScenario = (scenarioId: ForecastScenarioId) => {
    setDrivers(FORECAST_SCENARIO_PRESETS[scenarioId]);
    setCellOverrides({});
  };

  const handleDriverChange = (
    field: keyof Pick<
      ForecastDrivers,
      | 'quarterlyRevGrowthPct'
      | 'cloudCogsRatioPct'
      | 'quarterlyOpexGrowthPct'
      | 'effectiveTaxRatePct'
    >,
    value: string
  ) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return;
    setDrivers((prev) => ({
      ...prev,
      [field]: Math.max(0, Math.min(60, parsed)),
    }));
  };

  const handleCellOverrideChange = (
    rowKey: EditableRowKey,
    quarterIdx: number,
    rawValue: string
  ) => {
    const val = Math.max(0, Math.round(parseFloat(rawValue) || 0));
    setCellOverrides((prev) => ({
      ...prev,
      [`${rowKey}-${quarterIdx}`]: val,
    }));
  };

  const handleResetOverrides = () => {
    setCellOverrides({});
    setDrivers(FORECAST_SCENARIO_PRESETS.base);
  };

  const maxChartRevenue = useMemo(() => {
    return Math.max(...forecast.quarters.map((q) => q.totalRevenue), 1500000);
  }, [forecast.quarters]);

  const colLettersForQuarters: ('C' | 'D' | 'E' | 'F' | 'G')[] = ['C', 'D', 'E', 'F', 'G'];
  const colNamesForQuarters = [
    'q4_2026_act',
    'q1_2027e',
    'q2_2027e',
    'q3_2027e',
    'q4_2027e',
  ];

  const fy2027Totals = useMemo(() => {
    const proj = forecast.quarters.slice(1);
    return {
      saas: proj.reduce((s, q) => s + q.saasRevenue, 0),
      otherRev: proj.reduce((s, q) => s + q.usageAndServicesRevenue, 0),
      totalRev: forecast.fy2027TotalRevenue,
      cogs: proj.reduce((s, q) => s + q.cloudCogs, 0),
      grossProfit: proj.reduce((s, q) => s + q.grossProfit, 0),
      opex: proj.reduce((s, q) => s + q.rndAndGtmOpex, 0),
      ebitda: forecast.fy2027TotalEbitda,
      tax: proj.reduce((s, q) => s + q.taxProvision, 0),
      netIncome: forecast.fy2027TotalNetIncome,
      endingCash: forecast.fy2027EndingCash,
    };
  }, [forecast]);

  const overrideCount = Object.keys(cellOverrides).length;

  return (
    <div className="space-y-8">
      {/* Top Forecast KPI Strip */}
      <section
        aria-label="Rolling Forecast Summary"
        className="grid grid-cols-2 lg:grid-cols-4 border border-zinc-200 bg-white divide-y lg:divide-y-0 lg:divide-x divide-zinc-200"
      >
        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">FY 2027E PROJECTED REVENUE</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(forecast.fy2027TotalRevenue)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            +{drivers.quarterlyRevGrowthPct}% QoQ Compounding
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">FY 2027E OPERATING EBITDA</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(forecast.fy2027TotalEbitda)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            Margin:{' '}
            {Math.round(
              (forecast.fy2027TotalEbitda / Math.max(1, forecast.fy2027TotalRevenue)) *
                1000
            ) / 10}
            %
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">EXIT Q4 2027E RUN-RATE ARR</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(forecast.arrExitQ4_2027)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            4x Q4 2027E Revenue
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">PROJECTED Q4 2027E CASH</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(forecast.fy2027EndingCash)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            FY27 Net Income: {formatCurrency(forecast.fy2027TotalNetIncome)}
          </div>
        </div>
      </section>

      {/* Supabase + Excel Editable Forecast Grid Workbench */}
      <section
        aria-label="Rolling 4-Quarter Forecast Model"
        className="bg-white border border-zinc-200 p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-center gap-3 whitespace-nowrap">
            <h2 className="text-base font-bold text-zinc-950">
              Rolling 4-Quarter Forecast (Q1–Q4 2027E)
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-200 text-zinc-700">
              public.rolling_forecast_2027 · 10 rows
            </span>
            {overrideCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 text-white">
                {overrideCount} cell {overrideCount === 1 ? 'override' : 'overrides'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle: Grid Editor vs Chart + Table */}
            <div
              role="group"
              aria-label="Forecast View Mode"
              className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200"
            >
              <button
                type="button"
                onClick={() => setViewMode('sheet')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'sheet'
                    ? 'bg-zinc-950 text-white font-semibold'
                    : 'text-zinc-500 hover:text-zinc-950'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>Grid Editor</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('chart')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'chart'
                    ? 'bg-zinc-950 text-white font-semibold'
                    : 'text-zinc-500 hover:text-zinc-950'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Chart View</span>
              </button>
            </div>

            {/* Scenario Tabs */}
            <div
              role="group"
              aria-label="Forecast Scenarios"
              className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200"
            >
              {(
                [
                  { id: 'base', label: 'Base Case' },
                  { id: 'bull', label: 'Bull Expansion' },
                  { id: 'conservative', label: 'Conservative' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelectScenario(s.id)}
                  className={`px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                    drivers.scenarioId === s.id
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <ExportActionsBar
              onGenerateExport={() => createForecastingExportPayload(forecast)}
            />
          </div>
        </div>

        {/* Compact Inline Driver Bar (always accessible above grid or chart) */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 p-3 bg-zinc-100 border border-b-0 border-zinc-300 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 font-bold text-zinc-950">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Model Drivers:</span>
            </span>

            <label className="inline-flex items-center gap-1.5 text-zinc-600">
              <span>QoQ Rev %</span>
              <input
                type="number"
                step="0.5"
                min="0"
                max="50"
                aria-label="QoQ Revenue Growth (%)"
                value={drivers.quarterlyRevGrowthPct}
                onChange={(e) =>
                  handleDriverChange('quarterlyRevGrowthPct', e.target.value)
                }
                className="w-16 px-1.5 py-0.5 text-right font-bold bg-white border border-zinc-300 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </label>

            <label className="inline-flex items-center gap-1.5 text-zinc-600">
              <span>Cloud COGS %</span>
              <input
                type="number"
                step="0.5"
                min="5"
                max="40"
                aria-label="Cloud COGS (% of Revenue)"
                value={drivers.cloudCogsRatioPct}
                onChange={(e) => handleDriverChange('cloudCogsRatioPct', e.target.value)}
                className="w-16 px-1.5 py-0.5 text-right font-bold bg-white border border-zinc-300 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </label>

            <label className="inline-flex items-center gap-1.5 text-zinc-600">
              <span>QoQ OpEx %</span>
              <input
                type="number"
                step="0.5"
                min="0"
                max="30"
                aria-label="QoQ OpEx Growth (%)"
                value={drivers.quarterlyOpexGrowthPct}
                onChange={(e) =>
                  handleDriverChange('quarterlyOpexGrowthPct', e.target.value)
                }
                className="w-16 px-1.5 py-0.5 text-right font-bold bg-white border border-zinc-300 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </label>

            <label className="inline-flex items-center gap-1.5 text-zinc-600">
              <span>Tax Rate %</span>
              <input
                type="number"
                step="0.5"
                min="10"
                max="35"
                aria-label="Effective Tax Rate (%)"
                value={drivers.effectiveTaxRatePct}
                onChange={(e) =>
                  handleDriverChange('effectiveTaxRatePct', e.target.value)
                }
                className="w-16 px-1.5 py-0.5 text-right font-bold bg-white border border-zinc-300 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </label>
          </div>

          {overrideCount > 0 && (
            <button
              type="button"
              onClick={handleResetOverrides}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-zinc-300 text-zinc-800 hover:border-zinc-950 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Cell Overrides</span>
            </button>
          )}
        </div>

        {viewMode === 'sheet' ? (
          <div>
            {/* Formula / Cell Inspector Bar */}
            <div
              aria-label="Forecast Spreadsheet Formula Bar"
              className="flex items-center border border-b-0 border-zinc-300 bg-zinc-50 text-xs font-mono"
            >
              <div className="w-16 py-1.5 px-2 text-center font-bold text-zinc-950 border-r border-zinc-300 bg-white select-none">
                {selectedCell.col}
                {selectedCell.row}
              </div>
              <div className="px-2.5 py-1.5 text-[11px] text-zinc-500 border-r border-zinc-200 bg-zinc-100 select-none flex items-center gap-1.5">
                <span className="font-semibold text-zinc-800">
                  {selectedCell.columnName}
                </span>
                <span className="px-1 py-0.2 bg-zinc-200 text-zinc-600 text-[10px]">
                  {selectedCell.dataType}
                </span>
              </div>
              <div className="px-2.5 py-1.5 text-zinc-400 italic font-serif border-r border-zinc-200 select-none">
                fx
              </div>
              <div className="flex-1 flex items-center px-3 py-1 bg-white">
                <span className="text-zinc-800 truncate">{selectedCell.formula}</span>
              </div>
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-400 border-l border-zinc-200 bg-zinc-50">
                <span>Click any Q1–Q4 2027E cell to edit value in-place</span>
              </div>
            </div>

            {/* Supabase + Excel Database Grid Table */}
            <div className="border border-zinc-300 overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs select-none">
                <thead>
                  {/* Excel Column Letters A..H */}
                  <tr className="bg-zinc-100 border-b border-zinc-300 text-[10px] text-zinc-500 text-center">
                    <th className="w-10 py-1 border-r border-zinc-300 bg-zinc-200/70 font-normal">
                      #
                    </th>
                    {(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const).map(
                      (colLetter) => (
                        <th
                          key={colLetter}
                          className={`py-1 border-r last:border-r-0 border-zinc-300 font-semibold ${
                            selectedCell.col === colLetter
                              ? 'bg-zinc-950 text-white'
                              : 'bg-zinc-100 text-zinc-600'
                          }`}
                        >
                          {colLetter}
                        </th>
                      )
                    )}
                  </tr>

                  {/* Supabase Schema Column Headers with Type Badges */}
                  <tr className="bg-zinc-50 border-b border-zinc-300 text-[11px] text-zinc-700">
                    <td className="py-2 text-center border-r border-zinc-300 bg-zinc-100 text-zinc-400">
                      0
                    </td>
                    <th className="py-2 px-2.5 w-24 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span className="inline-flex items-center gap-1">
                          <KeyRound className="w-3 h-3 text-zinc-400" />
                          code
                        </span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          pk
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 border-r border-zinc-200 font-semibold min-w-[200px]">
                      <div className="flex items-center justify-between gap-1">
                        <span>line_item</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          text
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-32 border-r border-zinc-200 font-semibold bg-zinc-100/70">
                      <div className="flex items-center justify-between gap-1">
                        <span>q4_2026_act</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          gl
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-32 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>q1_2027e</span>
                        <span className="text-[10px] font-normal text-zinc-500">
                          int8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-32 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>q2_2027e</span>
                        <span className="text-[10px] font-normal text-zinc-500">
                          int8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-32 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>q3_2027e</span>
                        <span className="text-[10px] font-normal text-zinc-500">
                          int8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-32 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>q4_2027e</span>
                        <span className="text-[10px] font-normal text-zinc-500">
                          int8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-36 font-semibold bg-zinc-100/70">
                      <div className="flex items-center justify-between gap-1">
                        <span>fy2027_sum</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          fx
                        </span>
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-200">
                  {/* Row 1: 4010 Enterprise SaaS Subscriptions (Editable Q1..Q4 cells) */}
                  <tr className="hover:bg-zinc-50/60">
                    <td className="py-1.5 text-center border-r border-zinc-300 bg-zinc-100 text-[11px] text-zinc-400">
                      1
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-bold text-zinc-950">
                      4010
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-sans text-zinc-900">
                      Enterprise SaaS Subscriptions
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      const isActive = selectedCell.row === 1 && selectedCell.col === col;
                      const isOverridden = cellOverrides[`saas-${idx}`] !== undefined;

                      if (q.isActual) {
                        return (
                          <td
                            key={q.period}
                            onClick={() =>
                              setSelectedCell({
                                col,
                                row: 1,
                                columnName: colName,
                                dataType: 'gl_actual',
                                formula: '=GL_ACTUAL("4010", "Q4_2026")',
                              })
                            }
                            className={`py-1.5 px-2.5 border-r border-zinc-200 text-right tabular-nums bg-zinc-50/60 cursor-cell ${
                              isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''
                            }`}
                          >
                            {formatCurrency(q.saasRevenue)}
                          </td>
                        );
                      }

                      const prevCol = colLettersForQuarters[idx - 1];
                      return (
                        <td
                          key={q.period}
                          className={`p-0 border-r border-zinc-200 ${
                            isOverridden ? 'bg-zinc-100/80' : ''
                          } ${isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''}`}
                        >
                          <input
                            type="number"
                            step="5000"
                            min="0"
                            aria-label={`4010 SaaS for ${q.period}`}
                            value={q.saasRevenue}
                            onFocus={() =>
                              setSelectedCell({
                                col,
                                row: 1,
                                columnName: colName,
                                dataType: isOverridden ? 'int8 (edited)' : 'int8 (formula)',
                                formula: isOverridden
                                  ? String(q.saasRevenue)
                                  : `=ROUND(${prevCol}1*(1+${drivers.quarterlyRevGrowthPct}%), 0)`,
                              })
                            }
                            onChange={(e) =>
                              handleCellOverrideChange('saas', idx, e.target.value)
                            }
                            className="w-full py-1.5 px-2.5 text-right font-mono font-semibold text-zinc-950 bg-transparent focus:outline-none tabular-nums"
                          />
                        </td>
                      );
                    })}
                    <td
                      onClick={() =>
                        setSelectedCell({
                          col: 'H',
                          row: 1,
                          columnName: 'fy2027_sum',
                          dataType: 'formula',
                          formula: '=SUM(D1:G1)',
                        })
                      }
                      className="py-1.5 px-2.5 text-right font-semibold tabular-nums bg-zinc-50/70 cursor-cell"
                    >
                      {formatCurrency(fy2027Totals.saas)}
                    </td>
                  </tr>

                  {/* Row 2: 4020/4030 Usage & Advisory Services (Editable Q1..Q4 cells) */}
                  <tr className="hover:bg-zinc-50/60">
                    <td className="py-1.5 text-center border-r border-zinc-300 bg-zinc-100 text-[11px] text-zinc-400">
                      2
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-bold text-zinc-950">
                      4020/30
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-sans text-zinc-900">
                      Usage & Advisory Services
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      const isActive = selectedCell.row === 2 && selectedCell.col === col;
                      const isOverridden = cellOverrides[`otherRev-${idx}`] !== undefined;

                      if (q.isActual) {
                        return (
                          <td
                            key={q.period}
                            onClick={() =>
                              setSelectedCell({
                                col,
                                row: 2,
                                columnName: colName,
                                dataType: 'gl_actual',
                                formula: '=GL_ACTUAL("4020:4030", "Q4_2026")',
                              })
                            }
                            className={`py-1.5 px-2.5 border-r border-zinc-200 text-right tabular-nums bg-zinc-50/60 cursor-cell ${
                              isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''
                            }`}
                          >
                            {formatCurrency(q.usageAndServicesRevenue)}
                          </td>
                        );
                      }

                      const prevCol = colLettersForQuarters[idx - 1];
                      return (
                        <td
                          key={q.period}
                          className={`p-0 border-r border-zinc-200 ${
                            isOverridden ? 'bg-zinc-100/80' : ''
                          } ${isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''}`}
                        >
                          <input
                            type="number"
                            step="5000"
                            min="0"
                            aria-label={`4020 Usage for ${q.period}`}
                            value={q.usageAndServicesRevenue}
                            onFocus={() =>
                              setSelectedCell({
                                col,
                                row: 2,
                                columnName: colName,
                                dataType: isOverridden ? 'int8 (edited)' : 'int8 (formula)',
                                formula: isOverridden
                                  ? String(q.usageAndServicesRevenue)
                                  : `=ROUND(${prevCol}2*(1+${drivers.quarterlyRevGrowthPct}%), 0)`,
                              })
                            }
                            onChange={(e) =>
                              handleCellOverrideChange('otherRev', idx, e.target.value)
                            }
                            className="w-full py-1.5 px-2.5 text-right font-mono font-semibold text-zinc-950 bg-transparent focus:outline-none tabular-nums"
                          />
                        </td>
                      );
                    })}
                    <td
                      onClick={() =>
                        setSelectedCell({
                          col: 'H',
                          row: 2,
                          columnName: 'fy2027_sum',
                          dataType: 'formula',
                          formula: '=SUM(D2:G2)',
                        })
                      }
                      className="py-1.5 px-2.5 text-right font-semibold tabular-nums bg-zinc-50/70 cursor-cell"
                    >
                      {formatCurrency(fy2027Totals.otherRev)}
                    </td>
                  </tr>

                  {/* Row 3: Total Revenue (Formula Row) */}
                  <tr className="bg-zinc-100/90 font-bold text-zinc-950 border-t border-b border-zinc-300">
                    <td className="py-2 text-center border-r border-zinc-300 bg-zinc-200/70 text-[11px] font-normal text-zinc-500">
                      3
                    </td>
                    <td className="py-2 px-2.5 border-r border-zinc-200">TOT-REV</td>
                    <td className="py-2 px-2.5 border-r border-zinc-200 font-sans">
                      Total Revenue
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      return (
                        <td
                          key={q.period}
                          onClick={() =>
                            setSelectedCell({
                              col,
                              row: 3,
                              columnName: colName,
                              dataType: 'formula',
                              formula: `=SUM(${col}1:${col}2)`,
                            })
                          }
                          className={`py-2 px-2.5 border-r border-zinc-200 text-right tabular-nums cursor-cell ${
                            selectedCell.row === 3 && selectedCell.col === col
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          {formatCurrency(q.totalRevenue)}
                        </td>
                      );
                    })}
                    <td
                      onClick={() =>
                        setSelectedCell({
                          col: 'H',
                          row: 3,
                          columnName: 'fy2027_sum',
                          dataType: 'formula',
                          formula: '=SUM(D3:G3)',
                        })
                      }
                      className="py-2 px-2.5 text-right tabular-nums bg-zinc-200/60 cursor-cell"
                    >
                      {formatCurrency(fy2027Totals.totalRev)}
                    </td>
                  </tr>

                  {/* Row 4: 5010 Cloud & GPU COGS (Editable Q1..Q4 cells) */}
                  <tr className="hover:bg-zinc-50/60">
                    <td className="py-1.5 text-center border-r border-zinc-300 bg-zinc-100 text-[11px] text-zinc-400">
                      4
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-bold text-zinc-950">
                      5010
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-sans text-zinc-700">
                      Cloud & GPU Inference COGS
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      const isActive = selectedCell.row === 4 && selectedCell.col === col;
                      const isOverridden = cellOverrides[`cloudCogs-${idx}`] !== undefined;

                      if (q.isActual) {
                        return (
                          <td
                            key={q.period}
                            onClick={() =>
                              setSelectedCell({
                                col,
                                row: 4,
                                columnName: colName,
                                dataType: 'gl_actual',
                                formula: '=GL_ACTUAL("5010", "Q4_2026")',
                              })
                            }
                            className={`py-1.5 px-2.5 border-r border-zinc-200 text-right tabular-nums text-zinc-600 bg-zinc-50/60 cursor-cell ${
                              isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''
                            }`}
                          >
                            {formatCurrency(q.cloudCogs)}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={q.period}
                          className={`p-0 border-r border-zinc-200 ${
                            isOverridden ? 'bg-zinc-100/80' : ''
                          } ${isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''}`}
                        >
                          <input
                            type="number"
                            step="2500"
                            min="0"
                            aria-label={`5010 Cloud COGS for ${q.period}`}
                            value={q.cloudCogs}
                            onFocus={() =>
                              setSelectedCell({
                                col,
                                row: 4,
                                columnName: colName,
                                dataType: isOverridden ? 'int8 (edited)' : 'int8 (formula)',
                                formula: isOverridden
                                  ? String(q.cloudCogs)
                                  : `=ROUND(${col}3*(${drivers.cloudCogsRatioPct}%), 0)`,
                              })
                            }
                            onChange={(e) =>
                              handleCellOverrideChange('cloudCogs', idx, e.target.value)
                            }
                            className="w-full py-1.5 px-2.5 text-right font-mono text-zinc-700 bg-transparent focus:outline-none tabular-nums"
                          />
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-zinc-600 bg-zinc-50/70">
                      {formatCurrency(fy2027Totals.cogs)}
                    </td>
                  </tr>

                  {/* Row 5: Gross Profit */}
                  <tr className="bg-zinc-50 font-semibold text-zinc-950">
                    <td className="py-2 text-center border-r border-zinc-300 bg-zinc-100 text-[11px] font-normal text-zinc-400">
                      5
                    </td>
                    <td className="py-2 px-2.5 border-r border-zinc-200">GROSS</td>
                    <td className="py-2 px-2.5 border-r border-zinc-200 font-sans">
                      Gross Profit
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      return (
                        <td
                          key={q.period}
                          onClick={() =>
                            setSelectedCell({
                              col,
                              row: 5,
                              columnName: colName,
                              dataType: 'formula',
                              formula: `=${col}3-${col}4`,
                            })
                          }
                          className={`py-2 px-2.5 border-r border-zinc-200 text-right tabular-nums cursor-cell ${
                            selectedCell.row === 5 && selectedCell.col === col
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          {formatCurrency(q.grossProfit)}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2.5 text-right tabular-nums bg-zinc-100">
                      {formatCurrency(fy2027Totals.grossProfit)}
                    </td>
                  </tr>

                  {/* Row 6: 6010-6250 R&D, GTM & Corporate OpEx (Editable Q1..Q4 cells) */}
                  <tr className="hover:bg-zinc-50/60">
                    <td className="py-1.5 text-center border-r border-zinc-300 bg-zinc-100 text-[11px] text-zinc-400">
                      6
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-bold text-zinc-950">
                      6010–50
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-sans text-zinc-700">
                      R&D, GTM & Corporate OpEx
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      const isActive = selectedCell.row === 6 && selectedCell.col === col;
                      const isOverridden =
                        cellOverrides[`rndAndGtmOpex-${idx}`] !== undefined;

                      if (q.isActual) {
                        return (
                          <td
                            key={q.period}
                            onClick={() =>
                              setSelectedCell({
                                col,
                                row: 6,
                                columnName: colName,
                                dataType: 'gl_actual',
                                formula: '=GL_ACTUAL("6010:6250", "Q4_2026")',
                              })
                            }
                            className={`py-1.5 px-2.5 border-r border-zinc-200 text-right tabular-nums text-zinc-600 bg-zinc-50/60 cursor-cell ${
                              isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''
                            }`}
                          >
                            {formatCurrency(q.rndAndGtmOpex)}
                          </td>
                        );
                      }

                      const prevCol = colLettersForQuarters[idx - 1];
                      return (
                        <td
                          key={q.period}
                          className={`p-0 border-r border-zinc-200 ${
                            isOverridden ? 'bg-zinc-100/80' : ''
                          } ${isActive ? 'ring-2 ring-inset ring-zinc-950 bg-white' : ''}`}
                        >
                          <input
                            type="number"
                            step="5000"
                            min="0"
                            aria-label={`R&D OpEx for ${q.period}`}
                            value={q.rndAndGtmOpex}
                            onFocus={() =>
                              setSelectedCell({
                                col,
                                row: 6,
                                columnName: colName,
                                dataType: isOverridden ? 'int8 (edited)' : 'int8 (formula)',
                                formula: isOverridden
                                  ? String(q.rndAndGtmOpex)
                                  : `=ROUND(${prevCol}6*(1+${drivers.quarterlyOpexGrowthPct}%), 0)`,
                              })
                            }
                            onChange={(e) =>
                              handleCellOverrideChange('rndAndGtmOpex', idx, e.target.value)
                            }
                            className="w-full py-1.5 px-2.5 text-right font-mono text-zinc-700 bg-transparent focus:outline-none tabular-nums"
                          />
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-zinc-600 bg-zinc-50/70">
                      {formatCurrency(fy2027Totals.opex)}
                    </td>
                  </tr>

                  {/* Row 7: Operating Income / EBITDA */}
                  <tr className="bg-zinc-100/90 font-bold text-zinc-950 border-t border-b border-zinc-300">
                    <td className="py-2 text-center border-r border-zinc-300 bg-zinc-200/70 text-[11px] font-normal text-zinc-500">
                      7
                    </td>
                    <td className="py-2 px-2.5 border-r border-zinc-200">EBITDA</td>
                    <td className="py-2 px-2.5 border-r border-zinc-200 font-sans">
                      Operating Income (EBITDA)
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      return (
                        <td
                          key={q.period}
                          onClick={() =>
                            setSelectedCell({
                              col,
                              row: 7,
                              columnName: colName,
                              dataType: 'formula',
                              formula: `=${col}5-${col}6`,
                            })
                          }
                          className={`py-2 px-2.5 border-r border-zinc-200 text-right tabular-nums cursor-cell ${
                            selectedCell.row === 7 && selectedCell.col === col
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          {formatCurrency(q.ebitda)}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2.5 text-right tabular-nums bg-zinc-200/60">
                      {formatCurrency(fy2027Totals.ebitda)}
                    </td>
                  </tr>

                  {/* Row 8: Corporate Tax Provision (6800) */}
                  <tr className="hover:bg-zinc-50/60">
                    <td className="py-1.5 text-center border-r border-zinc-300 bg-zinc-100 text-[11px] text-zinc-400">
                      8
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-bold text-zinc-950">
                      6800
                    </td>
                    <td className="py-1.5 px-2.5 border-r border-zinc-200 font-sans text-zinc-700">
                      Corporate Tax Provision
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      return (
                        <td
                          key={q.period}
                          onClick={() =>
                            setSelectedCell({
                              col,
                              row: 8,
                              columnName: colName,
                              dataType: 'formula',
                              formula: q.isActual
                                ? '=GL_ACTUAL("6800", "Q4_2026")'
                                : `=ROUND(${col}7*(${drivers.effectiveTaxRatePct}%), 0)`,
                            })
                          }
                          className={`py-1.5 px-2.5 border-r border-zinc-200 text-right tabular-nums text-zinc-600 cursor-cell ${
                            selectedCell.row === 8 && selectedCell.col === col
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          {formatCurrency(q.taxProvision)}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-zinc-600 bg-zinc-50/70">
                      {formatCurrency(fy2027Totals.tax)}
                    </td>
                  </tr>

                  {/* Row 9: Net Income */}
                  <tr className="bg-zinc-950 text-white font-bold">
                    <td className="py-2.5 text-center border-r border-zinc-700 bg-zinc-900 text-[11px] font-normal text-zinc-400">
                      9
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800">NET-INC</td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800 font-sans">
                      NET INCOME
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      return (
                        <td
                          key={q.period}
                          onClick={() =>
                            setSelectedCell({
                              col,
                              row: 9,
                              columnName: colName,
                              dataType: 'formula',
                              formula: `=${col}7-${col}8`,
                            })
                          }
                          className="py-2.5 px-2.5 border-r border-zinc-800 text-right tabular-nums cursor-cell"
                        >
                          {formatCurrency(q.netIncome)}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-2.5 text-right tabular-nums bg-zinc-900">
                      {formatCurrency(fy2027Totals.netIncome)}
                    </td>
                  </tr>

                  {/* Row 10: Projected Ending Cash Balance */}
                  <tr className="bg-zinc-100 font-bold text-zinc-950 border-t border-zinc-300">
                    <td className="py-2.5 text-center border-r border-zinc-300 bg-zinc-200/70 text-[11px] font-normal text-zinc-500">
                      10
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-200">1010/20</td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-200 font-sans">
                      PROJECTED ENDING CASH BALANCE
                    </td>
                    {forecast.quarters.map((q, idx) => {
                      const col = colLettersForQuarters[idx];
                      const colName = colNamesForQuarters[idx];
                      const prevCol = idx > 0 ? colLettersForQuarters[idx - 1] : 'C';
                      return (
                        <td
                          key={q.period}
                          onClick={() =>
                            setSelectedCell({
                              col,
                              row: 10,
                              columnName: colName,
                              dataType: 'formula',
                              formula: q.isActual
                                ? '=GL_CASH_ENDING("Q4_2026")'
                                : `=${prevCol}10+ROUND(${col}9*1.04, 0)`,
                            })
                          }
                          className="py-2.5 px-2.5 border-r border-zinc-200 text-right tabular-nums cursor-cell"
                        >
                          {formatCurrency(q.endingCash)}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-2.5 text-right tabular-nums bg-zinc-200/60">
                      {formatCurrency(fy2027Totals.endingCash)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Chart View */
          <div className="pt-5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-3">
              <span>QUARTERLY TRAJECTORY (REVENUE · OPEX · NET INCOME)</span>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-zinc-900">
                  <span className="w-2.5 h-2.5 bg-zinc-950 inline-block" />
                  Total Revenue
                </span>
                <span className="inline-flex items-center gap-1.5 text-zinc-600">
                  <span className="w-2.5 h-2.5 bg-zinc-400 inline-block" />
                  Operating Expenses
                </span>
                <span className="inline-flex items-center gap-1.5 text-zinc-800">
                  <span className="w-2.5 h-2.5 border border-zinc-950 bg-zinc-200 inline-block" />
                  Net Income
                </span>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-4 border border-zinc-200 p-5 bg-zinc-50/40">
              {forecast.quarters.map((q) => {
                const revHeightPct = Math.round(
                  (q.totalRevenue / maxChartRevenue) * 100
                );
                const opexHeightPct = Math.round(
                  (q.totalOperatingExpenses / maxChartRevenue) * 100
                );
                const netHeightPct = Math.max(
                  4,
                  Math.round((Math.max(0, q.netIncome) / maxChartRevenue) * 100)
                );

                return (
                  <div
                    key={q.period}
                    className="flex flex-col justify-between bg-white border border-zinc-200 p-4"
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-zinc-950">{q.period}</span>
                      <span
                        className={`px-1.5 py-0.5 text-[10px] ${
                          q.isActual
                            ? 'bg-zinc-950 text-white'
                            : 'bg-zinc-100 text-zinc-600'
                        }`}
                      >
                        {q.isActual ? 'ACTUAL' : 'PROJ'}
                      </span>
                    </div>

                    <div className="h-36 flex items-end justify-center gap-3 my-4 pt-4 border-b border-zinc-200">
                      <div className="flex flex-col items-center gap-1 flex-1 h-full justify-end">
                        <div
                          className="w-full bg-zinc-950 transition-all"
                          style={{ height: `${revHeightPct}%` }}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-1 h-full justify-end">
                        <div
                          className="w-full bg-zinc-400 transition-all"
                          style={{ height: `${opexHeightPct}%` }}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-1 h-full justify-end">
                        <div
                          className="w-full bg-zinc-200 border border-zinc-950 transition-all"
                          style={{ height: `${netHeightPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1 font-mono text-[11px]">
                      <div className="flex justify-between text-zinc-950 font-bold tabular-nums">
                        <span>Rev</span>
                        <span>{formatCurrency(q.totalRevenue)}</span>
                      </div>
                      <div className="flex justify-between text-zinc-500 tabular-nums">
                        <span>OpEx</span>
                        <span>{formatCurrency(q.totalOperatingExpenses)}</span>
                      </div>
                      <div className="flex justify-between text-zinc-900 font-semibold tabular-nums pt-1 border-t border-zinc-100">
                        <span>Net</span>
                        <span>{formatCurrency(q.netIncome)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
