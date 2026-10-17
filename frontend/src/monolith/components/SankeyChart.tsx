import React, { useState, useMemo } from 'react';
import {
  PeriodSankeyDataset,
  computeSankeyLayout,
  formatCurrency,
  ComputedSankeyNode,
  ComputedSankeyLink,
} from '../utils/accountingLogic';

export type SankeyChartMode = 'cashflow' | 'pnl';

interface SankeyChartProps {
  dataset: PeriodSankeyDataset;
  chartMode: SankeyChartMode;
  onSelectChartMode: (mode: SankeyChartMode) => void;
  selectedPeriod: string;
  onSelectPeriod: (period: string) => void;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  headerActions?: React.ReactNode;
}

export const SankeyChart: React.FC<SankeyChartProps> = ({
  dataset,
  chartMode,
  onSelectChartMode,
  selectedPeriod,
  onSelectPeriod,
  selectedNodeId,
  onSelectNode,
  headerActions,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  const width = 1160;
  const height = 440;

  const { nodes, links, totalFlow } = useMemo(
    () => computeSankeyLayout(dataset, width, height, 18, 28, 16),
    [dataset]
  );

  const activeNodeId = hoveredNodeId || selectedNodeId;

  const activeNode: ComputedSankeyNode | undefined = useMemo(
    () => nodes.find((n) => n.id === activeNodeId),
    [nodes, activeNodeId]
  );

  const activeLink: ComputedSankeyLink | undefined = useMemo(
    () => links.find((l) => l.id === hoveredLinkId),
    [links, hoveredLinkId]
  );

  const isLinkHighlighted = (link: ComputedSankeyLink) => {
    if (hoveredLinkId) return link.id === hoveredLinkId;
    if (activeNodeId) {
      return link.source === activeNodeId || link.target === activeNodeId;
    }
    return false;
  };

  const isLinkDimmed = (link: ComputedSankeyLink) => {
    if (!hoveredLinkId && !activeNodeId) return false;
    return !isLinkHighlighted(link);
  };

  return (
    <section
      aria-label={chartMode === 'cashflow' ? 'Cash Flow Sankey' : 'P&L Sankey'}
      className="bg-white border border-zinc-200 p-6"
    >
      {/* Minimal Header with Chart Mode Switcher (Cash Flow | P&L) + Period Switcher + Export Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-zinc-100">
        <div className="flex flex-wrap items-center gap-4">
          {/* Tab Switcher: Cash Flow Sankey vs P&L Sankey */}
          <div
            role="tablist"
            aria-label="Sankey Chart Type"
            className="flex items-center gap-1 p-0.5 bg-zinc-100 border border-zinc-200"
          >
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === 'cashflow'}
              onClick={() => onSelectChartMode('cashflow')}
              className={`px-3 py-1 text-xs font-mono transition-colors whitespace-nowrap cursor-pointer ${
                chartMode === 'cashflow'
                  ? 'bg-zinc-950 text-white font-semibold'
                  : 'text-zinc-500 hover:text-zinc-950'
              }`}
            >
              Cash Flow Sankey
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === 'pnl'}
              onClick={() => onSelectChartMode('pnl')}
              className={`px-3 py-1 text-xs font-mono transition-colors whitespace-nowrap cursor-pointer ${
                chartMode === 'pnl'
                  ? 'bg-zinc-950 text-white font-semibold'
                  : 'text-zinc-500 hover:text-zinc-950'
              }`}
            >
              P&amp;L Sankey
            </button>
          </div>

          <span className="text-xs font-mono text-zinc-400 tabular-nums">
            {activeLink
              ? `${activeLink.label} · ${formatCurrency(activeLink.value)}`
              : activeNode
              ? `${activeNode.label} · ${formatCurrency(activeNode.value)} (${activeNode.percentageOfTotal}%)`
              : `${formatCurrency(totalFlow)} ${chartMode === 'cashflow' ? 'Gross Inflow' : 'Total Revenue'}`}
          </span>

          {selectedNodeId && (
            <button
              type="button"
              onClick={() => onSelectNode(null)}
              className="text-xs font-mono text-zinc-950 underline cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <div className="flex items-center gap-1 p-0.5 bg-zinc-100 border border-zinc-200">
            {(['Q3-2026', 'Q4-2026', 'FY-2026'] as const).map((periodKey) => {
              const active = selectedPeriod === periodKey;
              return (
                <button
                  key={periodKey}
                  type="button"
                  onClick={() => onSelectPeriod(periodKey)}
                  className={`px-2.5 py-1 text-xs font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-zinc-950 text-white'
                      : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  {periodKey.replace('-', ' ')}
                </button>
              );
            })}
          </div>
          {headerActions}
        </div>
      </div>

      {/* SVG Sankey Canvas */}
      <div className="relative w-full overflow-x-auto pt-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[740px] h-auto select-none"
          role="img"
          aria-label={`${chartMode === 'cashflow' ? 'Cash Flow' : 'P&L'} Sankey diagram showing ${formatCurrency(totalFlow)}`}
          data-testid="sankey-svg"
        >
          <defs>
            <pattern
              id="monolith-hatch"
              width="6"
              height="6"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="#18181b" strokeWidth="1.5" strokeOpacity="0.22" />
            </pattern>
          </defs>

          {/* Flow Links */}
          <g>
            {links.map((link) => {
              const highlighted = isLinkHighlighted(link);
              const dimmed = isLinkDimmed(link);
              const isRetainedFlow =
                link.target === 'ebitda_pool' || link.target === 'net_treasury';

              const strokeColor = highlighted
                ? '#09090b'
                : isRetainedFlow
                ? '#27272a'
                : '#71717a';

              const strokeOpacity = dimmed
                ? 0.06
                : highlighted
                ? 0.38
                : isRetainedFlow
                ? 0.22
                : 0.14;

              return (
                <g
                  key={link.id}
                  onMouseEnter={() => setHoveredLinkId(link.id)}
                  onMouseLeave={() => setHoveredLinkId(null)}
                  className="cursor-pointer"
                >
                  <path
                    d={link.path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={link.thickness}
                    strokeOpacity={strokeOpacity}
                    style={{ transition: 'stroke-opacity 150ms ease' }}
                  />
                </g>
              );
            })}
          </g>

          {/* Nodes & Labels */}
          <g>
            {nodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isHovered = hoveredNodeId === node.id;
              const isRightCol = node.column === 3;
              const labelX = isRightCol ? node.x - 10 : node.x + node.width + 10;
              const textAnchor = isRightCol ? 'end' : 'start';

              return (
                <g
                  key={node.id}
                  onClick={() => onSelectNode(isSelected ? null : node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label} ${formatCurrency(node.value)}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectNode(isSelected ? null : node.id);
                    }
                  }}
                >
                  {(isSelected || isHovered) && (
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
                      fill="url(#monolith-hatch)"
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
                    style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatCurrency(node.value)} · {node.percentageOfTotal}%
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
};
