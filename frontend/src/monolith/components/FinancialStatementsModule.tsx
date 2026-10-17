import React, { useState, useMemo } from 'react';
import {
  JournalEntry,
  SANKEY_DATASETS,
  computeFinancialStatements,
  buildLivePnlSankeyDataset,
  computeSankeyLayout,
  formatCurrency,
} from '../utils/accountingLogic';
import { createFinancialStatementsExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';

interface FinancialStatementsModuleProps {
  entries: JournalEntry[];
}

type StatementTab = 'pl' | 'bs' | 'cf';
type StatementDisplayMode = 'both' | 'sankey' | 'table';

export const FinancialStatementsModule: React.FC<FinancialStatementsModuleProps> = ({
  entries,
}) => {
  const [activeStatement, setActiveStatement] = useState<StatementTab>('pl');
  const [displayMode, setDisplayMode] = useState<StatementDisplayMode>('both');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  const fs = useMemo(() => computeFinancialStatements(entries), [entries]);
  const pnlSankeyDataset = useMemo(() => buildLivePnlSankeyDataset(fs), [fs]);
  const cfSankeyDataset = SANKEY_DATASETS['Q4-2026'];

  const width = 1160;
  const height = 420;
  const activeSankeyDataset =
    activeStatement === 'cf' ? cfSankeyDataset : pnlSankeyDataset;
  const sankeyLayout = useMemo(
    () => computeSankeyLayout(activeSankeyDataset, width, height, 18, 26, 16),
    [activeSankeyDataset]
  );

  const activeNode = useMemo(
    () => sankeyLayout.nodes.find((n) => n.id === hoveredNodeId),
    [sankeyLayout.nodes, hoveredNodeId]
  );
  const activeLink = useMemo(
    () => sankeyLayout.links.find((l) => l.id === hoveredLinkId),
    [sankeyLayout.links, hoveredLinkId]
  );

  const tabs: { id: StatementTab; label: string }[] = [
    { id: 'pl', label: 'Income Statement (P&L)' },
    { id: 'bs', label: 'Balance Sheet' },
    { id: 'cf', label: 'Cash Flow Statement' },
  ];

  return (
    <div className="space-y-8">
      {/* Minimal Summary Strip */}
      <section
        aria-label="Financial Statement Highlights"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total Revenue</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(fs.totalRevenue)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Net Income</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(fs.netIncome)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total Assets</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(fs.totalAssets)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Ending Cash</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(fs.cashFlow.endingCash)}
          </div>
        </div>
      </section>

      {/* Tabbed Statement Container */}
      <section
        aria-label="Financial Statement Report"
        className="bg-white border border-zinc-200 p-6"
      >
        {/* Header & Statement Switcher Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-200">
          <div className="flex items-center gap-1 p-0.5 bg-zinc-100 border border-zinc-200 self-start">
            {tabs.map((tab) => {
              const active = activeStatement === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveStatement(tab.id);
                    setHoveredNodeId(null);
                    setHoveredLinkId(null);
                  }}
                  className={`px-3.5 py-1.5 text-xs font-mono transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {(activeStatement === 'pl' || activeStatement === 'cf') && (
              <div className="flex items-center gap-1 p-0.5 bg-zinc-100 border border-zinc-200">
                {(
                  [
                    { id: 'both', label: 'Sankey + Table' },
                    {
                      id: 'sankey',
                      label: activeStatement === 'pl' ? 'P&L Sankey' : 'Cash Flow Sankey',
                    },
                    { id: 'table', label: 'Table Only' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDisplayMode(m.id)}
                    className={`px-2.5 py-1 text-xs font-mono transition-colors whitespace-nowrap cursor-pointer ${
                      displayMode === m.id
                        ? 'bg-zinc-950 text-white'
                        : 'text-zinc-500 hover:text-zinc-950'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            <ExportActionsBar
              onGenerateExport={() =>
                createFinancialStatementsExportPayload(entries, activeStatement)
              }
            />
          </div>
        </div>

        {/* Shared Sankey Renderer for P&L and Cash Flow Tabs */}
        {(activeStatement === 'pl' || activeStatement === 'cf') &&
          (displayMode === 'both' || displayMode === 'sankey') && (
            <div className="mt-6 border-b border-zinc-200 pb-6">
              <div className="flex items-baseline justify-between mb-3">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-sm font-bold text-zinc-950">
                    {activeStatement === 'pl' ? 'P&L Sankey' : 'Cash Flow Sankey'}
                  </h3>
                  <span className="text-xs font-mono text-zinc-400 tabular-nums">
                    {activeLink
                      ? `${activeLink.label} · ${formatCurrency(activeLink.value)}`
                      : activeNode
                      ? `${activeNode.label} · ${formatCurrency(activeNode.value)} (${activeNode.percentageOfTotal}%)`
                      : activeStatement === 'pl'
                      ? `Net Margin ${fs.netMarginPct}%`
                      : `Net Free Cash ${formatCurrency(fs.cashFlow.netCashFromOperating)}`}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-zinc-400">
                  {activeStatement === 'pl'
                    ? 'Revenue → EBITDA & OpEx → Net Income'
                    : 'Cash Inflow → Operating Surplus & Outflows → Net Free Cash'}
                </span>
              </div>

              <div className="relative w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="w-full min-w-[740px] h-auto select-none"
                  role="img"
                  aria-label={
                    activeStatement === 'pl'
                      ? `P&L Sankey diagram showing ${formatCurrency(fs.totalRevenue)} total revenue and ${formatCurrency(fs.netIncome)} net income`
                      : `Cash Flow Sankey diagram showing ${formatCurrency(sankeyLayout.totalFlow)} gross cash inflow`
                  }
                  data-testid="statement-sankey-svg"
                >
                  <defs>
                    <pattern
                      id="pnl-hatch"
                      width="6"
                      height="6"
                      patternTransform="rotate(45 0 0)"
                      patternUnits="userSpaceOnUse"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="6"
                        stroke="#18181b"
                        strokeWidth="1.5"
                        strokeOpacity="0.22"
                      />
                    </pattern>
                  </defs>

                  {/* Flow Links */}
                  <g>
                    {sankeyLayout.links.map((link) => {
                      const highlighted =
                        hoveredLinkId === link.id ||
                        (hoveredNodeId &&
                          (link.source === hoveredNodeId ||
                            link.target === hoveredNodeId));
                      const dimmed =
                        (hoveredLinkId || hoveredNodeId) && !highlighted;
                      const isProfitFlow =
                        link.target === 'ebitda_pool' ||
                        link.target === 'net_treasury';

                      return (
                        <path
                          key={link.id}
                          d={link.path}
                          fill="none"
                          stroke={
                            highlighted
                              ? '#09090b'
                              : isProfitFlow
                              ? '#18181b'
                              : '#71717a'
                          }
                          strokeWidth={link.thickness}
                          strokeOpacity={
                            dimmed
                              ? 0.06
                              : highlighted
                              ? 0.38
                              : isProfitFlow
                              ? 0.24
                              : 0.14
                          }
                          onMouseEnter={() => setHoveredLinkId(link.id)}
                          onMouseLeave={() => setHoveredLinkId(null)}
                          className="cursor-pointer"
                          style={{ transition: 'stroke-opacity 150ms ease' }}
                        />
                      );
                    })}
                  </g>

                  {/* Nodes & Labels */}
                  <g>
                    {sankeyLayout.nodes.map((node) => {
                      const isHovered = hoveredNodeId === node.id;
                      const isRightCol = node.column === 3;
                      const labelX = isRightCol
                        ? node.x - 10
                        : node.x + node.width + 10;
                      const textAnchor = isRightCol ? 'end' : 'start';

                      return (
                        <g
                          key={node.id}
                          onMouseEnter={() => setHoveredNodeId(node.id)}
                          onMouseLeave={() => setHoveredNodeId(null)}
                          className="cursor-pointer"
                        >
                          {isHovered && (
                            <rect
                              x={node.x - 3}
                              y={node.y - 3}
                              width={node.width + 6}
                              height={node.height + 6}
                              fill="none"
                              stroke="#09090b"
                              strokeWidth="1.5"
                            />
                          )}
                          <rect
                            x={node.x}
                            y={node.y}
                            width={node.width}
                            height={node.height}
                            fill={node.shade}
                          />
                          {node.category === 'retained' && (
                            <rect
                              x={node.x + 2}
                              y={node.y + 2}
                              width={node.width - 4}
                              height={Math.max(4, node.height - 4)}
                              fill="url(#pnl-hatch)"
                            />
                          )}
                          <rect
                            x={isRightCol ? labelX - 166 : labelX - 4}
                            y={node.y + node.height / 2 - 17}
                            width={170}
                            height={32}
                            fill="#ffffff"
                            fillOpacity="0.9"
                          />
                          <text
                            x={labelX}
                            y={node.y + node.height / 2 - 3}
                            textAnchor={textAnchor}
                            className="fill-zinc-950 font-medium text-[12px]"
                            style={{ fontFamily: 'var(--font-sans)' }}
                          >
                            {node.label}
                          </text>
                          <text
                            x={labelX}
                            y={node.y + node.height / 2 + 11}
                            textAnchor={textAnchor}
                            className="fill-zinc-500 text-[11px]"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {formatCurrency(node.value)} · {node.percentageOfTotal}%
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            </div>
          )}

        {/* 1. Income Statement (P&L) — Tabular Schedule */}
        {activeStatement === 'pl' &&
          (displayMode === 'both' || displayMode === 'table') && (
            <div className="mt-6 space-y-8 text-xs font-mono">
              <div>
                <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                  <span>REVENUE</span>
                  <span>AMOUNT</span>
                </div>
                <div className="divide-y divide-zinc-100">
                  {fs.revenues.map((r) => (
                    <div key={r.code} className="py-3 flex justify-between">
                      <span className="font-sans text-zinc-900">
                        <span className="font-mono text-zinc-400 mr-3">{r.code}</span>
                        {r.name}
                      </span>
                      <span className="tabular-nums text-zinc-950">
                        {formatCurrency(r.amount)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-3 border-t border-zinc-200 flex justify-between font-bold text-zinc-950">
                  <span>Total Revenue</span>
                  <span className="tabular-nums">{formatCurrency(fs.totalRevenue)}</span>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                  <span>OPERATING EXPENSES</span>
                  <span>AMOUNT</span>
                </div>
                <div className="divide-y divide-zinc-100">
                  {fs.operatingExpenses.map((e) => (
                    <div key={e.code} className="py-3 flex justify-between">
                      <span className="font-sans text-zinc-900">
                        <span className="font-mono text-zinc-400 mr-3">{e.code}</span>
                        {e.name}
                      </span>
                      <span className="tabular-nums text-zinc-950">
                        {formatCurrency(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-3 border-t border-zinc-200 flex justify-between font-bold text-zinc-950">
                  <span>Total Operating Expenses</span>
                  <span className="tabular-nums">
                    {formatCurrency(fs.totalOperatingExpenses)}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-200 space-y-3">
                <div className="flex justify-between font-semibold text-zinc-950">
                  <span>Operating Income (EBITDA)</span>
                  <span className="tabular-nums">{formatCurrency(fs.operatingIncome)}</span>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span className="font-sans">
                    <span className="font-mono text-zinc-400 mr-3">6800</span>
                    Corporate Tax Provision Expense
                  </span>
                  <span className="tabular-nums">-{formatCurrency(fs.taxExpense)}</span>
                </div>
                <div className="pt-3.5 border-t-2 border-zinc-950 flex justify-between text-sm font-bold text-zinc-950">
                  <span>Net Income ({fs.netMarginPct}% Margin)</span>
                  <span className="tabular-nums">{formatCurrency(fs.netIncome)}</span>
                </div>
              </div>
            </div>
          )}

        {/* 2. Balance Sheet (BS) */}
        {activeStatement === 'bs' && (
          <div className="mt-6 space-y-8 text-xs font-mono">
            <div>
              <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                <span>ASSETS</span>
                <span>BALANCE</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {fs.assets.map((a) => (
                  <div key={a.code} className="py-3 flex justify-between">
                    <span className="font-sans text-zinc-900">
                      <span className="font-mono text-zinc-400 mr-3">{a.code}</span>
                      {a.name}
                    </span>
                    <span className="tabular-nums text-zinc-950">
                      {formatCurrency(a.amount)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t-2 border-zinc-950 flex justify-between text-sm font-bold text-zinc-950">
                <span>Total Assets</span>
                <span className="tabular-nums">{formatCurrency(fs.totalAssets)}</span>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                <span>LIABILITIES</span>
                <span>BALANCE</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {fs.liabilities.map((l) => (
                  <div key={l.code} className="py-3 flex justify-between">
                    <span className="font-sans text-zinc-900">
                      <span className="font-mono text-zinc-400 mr-3">{l.code}</span>
                      {l.name}
                    </span>
                    <span className="tabular-nums text-zinc-950">
                      {formatCurrency(l.amount)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-zinc-200 flex justify-between font-bold text-zinc-950">
                <span>Total Liabilities</span>
                <span className="tabular-nums">
                  {formatCurrency(fs.totalLiabilities)}
                </span>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                <span>EQUITY</span>
                <span>BALANCE</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {fs.equity.map((e) => (
                  <div key={e.code} className="py-3 flex justify-between">
                    <span className="font-sans text-zinc-900">
                      <span className="font-mono text-zinc-400 mr-3">{e.code}</span>
                      {e.name}
                    </span>
                    <span className="tabular-nums text-zinc-950">
                      {formatCurrency(e.amount)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-zinc-200 flex justify-between font-bold text-zinc-950">
                <span>Total Equity</span>
                <span className="tabular-nums">{formatCurrency(fs.totalEquity)}</span>
              </div>
            </div>

            <div className="pt-3.5 border-t-2 border-zinc-950 flex justify-between text-sm font-bold text-zinc-950">
              <span>Total Liabilities & Equity</span>
              <span className="tabular-nums">
                {formatCurrency(fs.totalLiabilitiesAndEquity)}
              </span>
            </div>
          </div>
        )}

        {/* 3. Cash Flow Statement (CFS) — Tabular Schedule */}
        {activeStatement === 'cf' &&
          (displayMode === 'both' || displayMode === 'table') && (
            <div className="mt-6 space-y-8 text-xs font-mono">
              <div>
                <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                  <span>OPERATING ACTIVITIES (INDIRECT METHOD)</span>
                  <span>CASH FLOW</span>
                </div>
                <div className="divide-y divide-zinc-100">
                  <div className="py-3 flex justify-between">
                    <span className="font-sans font-medium text-zinc-950">
                      <span className="font-mono text-zinc-400 mr-3">3900</span>
                      Net Income
                    </span>
                    <span className="tabular-nums font-semibold text-zinc-950">
                      {formatCurrency(fs.cashFlow.netIncome, true)}
                    </span>
                  </div>
                  {fs.cashFlow.workingCapitalAdjustments.map((item) => (
                    <div key={item.code} className="py-3 flex justify-between">
                      <span className="font-sans text-zinc-800">
                        <span className="font-mono text-zinc-400 mr-3">{item.code}</span>
                        {item.name}
                      </span>
                      <span className="tabular-nums text-zinc-950">
                        {item.amount === 0 ? '$0' : formatCurrency(item.amount, true)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-3 border-t border-zinc-200 flex justify-between font-bold text-zinc-950">
                  <span>Net Cash Provided by Operating Activities</span>
                  <span className="tabular-nums">
                    {formatCurrency(fs.cashFlow.netCashFromOperating, true)}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-zinc-400 pb-2 border-b border-zinc-100 flex justify-between">
                  <span>INVESTING & FINANCING ACTIVITIES</span>
                  <span>CASH FLOW</span>
                </div>
                <div className="divide-y divide-zinc-100">
                  {fs.cashFlow.investingItems.map((item) => (
                    <div key={item.code} className="py-3 flex justify-between">
                      <span className="font-sans text-zinc-800">
                        <span className="font-mono text-zinc-400 mr-3">{item.code}</span>
                        {item.name}
                      </span>
                      <span className="tabular-nums text-zinc-950">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                  {fs.cashFlow.financingItems.map((item) => (
                    <div key={item.code} className="py-3 flex justify-between">
                      <span className="font-sans text-zinc-800">
                        <span className="font-mono text-zinc-400 mr-3">{item.code}</span>
                        {item.name}
                      </span>
                      <span className="tabular-nums text-zinc-950">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-200 space-y-3">
                <div className="flex justify-between font-semibold text-zinc-950">
                  <span>Net Change in Cash & Equivalents</span>
                  <span className="tabular-nums">
                    {formatCurrency(fs.cashFlow.netChangeInCash, true)}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span>Beginning Cash & Equivalents (1010 + 1020)</span>
                  <span className="tabular-nums">
                    {formatCurrency(fs.cashFlow.beginningCash)}
                  </span>
                </div>
                <div className="pt-3.5 border-t-2 border-zinc-950 flex justify-between text-sm font-bold text-zinc-950">
                  <span>Ending Cash & Equivalents (1010 + 1020)</span>
                  <span className="tabular-nums">
                    {formatCurrency(fs.cashFlow.endingCash)}
                  </span>
                </div>
              </div>
            </div>
          )}
      </section>
    </div>
  );
};
