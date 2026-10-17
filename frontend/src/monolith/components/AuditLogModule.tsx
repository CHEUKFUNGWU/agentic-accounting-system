import React, { useState, useMemo } from 'react';
import {
  AuditLogEntry,
  AuditCategory,
  AuditActorType,
  filterAuditLogs,
  formatCurrency,
} from '../utils/accountingLogic';
import { createAuditLogExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import {
  Search,
  ExternalLink,
  X,
  User,
  Bot,
  Cpu,
  Hash,
  Clock,
  ArrowRight,
} from 'lucide-react';

interface AuditLogModuleProps {
  logs: AuditLogEntry[];
  onNavigateToRecord: (category: AuditCategory, targetId: string) => void;
  globalSearchQuery?: string;
}

const AUDIT_CATEGORIES: ('All' | AuditCategory)[] = [
  'All',
  'Journal Entry',
  'Bank Reconciliation',
  'Accounts Receivable',
  'Accounts Payable',
  'Fixed Assets',
  'Period Close',
];

export const AuditLogModule: React.FC<AuditLogModuleProps> = ({
  logs,
  onNavigateToRecord,
  globalSearchQuery = '',
}) => {
  const [searchQuery, setSearchQuery] = useState(globalSearchQuery);
  const [selectedCategory, setSelectedCategory] = useState<'All' | AuditCategory>('All');
  const [selectedActorType, setSelectedActorType] = useState<'All' | AuditActorType>('All');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  React.useEffect(() => {
    if (globalSearchQuery) {
      setSearchQuery(globalSearchQuery);
    }
  }, [globalSearchQuery]);

  const filteredLogs = useMemo(() => {
    return filterAuditLogs(logs, {
      category: selectedCategory,
      actorType: selectedActorType,
      searchQuery,
    });
  }, [logs, selectedCategory, selectedActorType, searchQuery]);

  const metrics = useMemo(() => {
    const total = logs.length;
    const journalCount = logs.filter((l) => l.category === 'Journal Entry').length;
    const reconCount = logs.filter((l) => l.category === 'Bank Reconciliation').length;
    const totalImpact = logs.reduce((sum, l) => sum + Math.abs(l.impactAmount || 0), 0);
    return { total, journalCount, reconCount, totalImpact };
  }, [logs]);

  const getActorIcon = (type: AuditActorType) => {
    switch (type) {
      case 'User':
        return <User className="w-3.5 h-3.5 text-zinc-700" />;
      case 'Agent':
        return <Bot className="w-3.5 h-3.5 text-zinc-700" />;
      case 'System':
        return <Cpu className="w-3.5 h-3.5 text-zinc-700" />;
    }
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' || selectedCategory !== 'All' || selectedActorType !== 'All';

  return (
    <div className="space-y-8">
      {/* Minimal KPI Strip */}
      <section
        aria-label="Audit Log Overview"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total Events</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {metrics.total}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Journal Events</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {metrics.journalCount}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Reconciliations</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {metrics.reconCount}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Cumulative Volume</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(metrics.totalImpact)}
          </div>
        </div>
      </section>

      {/* Main Audit Table & Filter Header */}
      <section aria-label="Audit Log Table" className="bg-white border border-zinc-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-bold text-zinc-950">Audit Log</h1>
            <span className="text-xs font-mono text-zinc-400">SHA-256</span>
          </div>
          <ExportActionsBar
            onGenerateExport={() => createAuditLogExportPayload(filteredLogs)}
          />
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              role="searchbox"
              placeholder="Filter ID, actor, record..."
              aria-label="Filter audit logs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-950"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                aria-label="Clear audit search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center border border-zinc-200 p-0.5 bg-zinc-50 text-xs">
              {AUDIT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    selectedCategory === cat
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  {cat === 'All' ? 'All Modules' : cat}
                </button>
              ))}
            </div>

            <div className="flex items-center border border-zinc-200 p-0.5 bg-zinc-50 text-xs">
              {(['All', 'User', 'Agent', 'System'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelectedActorType(type)}
                  className={`px-2 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    selectedActorType === type
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  {type === 'All' ? 'All Actors' : type}
                </button>
              ))}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                  setSelectedActorType('All');
                }}
                className="text-xs text-zinc-500 hover:text-zinc-950 underline px-2 py-1 cursor-pointer whitespace-nowrap"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] text-zinc-400">
                <th className="py-3 pr-3 font-normal whitespace-nowrap">TIMESTAMP (UTC)</th>
                <th className="py-3 px-2.5 font-normal whitespace-nowrap">AUDIT ID</th>
                <th className="py-3 px-2.5 font-normal whitespace-nowrap">ACTOR</th>
                <th className="py-3 px-2.5 font-normal whitespace-nowrap">ACTION</th>
                <th className="py-3 px-2.5 font-normal whitespace-nowrap">TARGET</th>
                <th className="py-3 px-2.5 font-normal">SUMMARY</th>
                <th className="py-3 px-2.5 font-normal text-right whitespace-nowrap bg-zinc-50">
                  IMPACT
                </th>
                <th className="py-3 pl-2.5 font-normal text-right whitespace-nowrap">INSPECT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-400 font-sans">
                    No matching records
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-zinc-50/80 transition-colors cursor-pointer"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-500 tabular-nums text-[11px]">
                      {log.timestamp}
                    </td>
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      <span className="font-bold text-zinc-950 block">{log.id}</span>
                      <span className="text-[10px] text-zinc-400 block truncate max-w-[84px]">
                        {log.hash}
                      </span>
                    </td>
                    <td className="py-3 px-2.5 whitespace-nowrap font-sans">
                      <div className="flex items-center gap-1.5">
                        {getActorIcon(log.actorType)}
                        <span className="font-medium text-zinc-900 truncate max-w-[140px]">
                          {log.actorId}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 pl-5 block">
                        {log.actorType}
                      </span>
                    </td>
                    <td className="py-3 px-2.5 whitespace-nowrap font-sans">
                      <span className="font-medium text-zinc-900 block">{log.action}</span>
                      <span className="text-[10px] font-mono text-zinc-400 block">
                        {log.category}
                      </span>
                    </td>
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToRecord(log.category, log.targetId);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-xs border border-zinc-200 bg-zinc-50 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors cursor-pointer"
                      >
                        <span>{log.targetId}</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                    <td className="py-3 px-2.5 font-sans max-w-[240px]">
                      <div className="font-medium text-zinc-900 truncate">{log.summary}</div>
                      {log.details && (
                        <div className="text-[11px] text-zinc-400 truncate">
                          {log.details}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2.5 text-right whitespace-nowrap tabular-nums font-semibold text-zinc-950 bg-zinc-50/60">
                      {log.impactAmount !== undefined
                        ? formatCurrency(log.impactAmount, true)
                        : '—'}
                    </td>
                    <td className="py-3 pl-2.5 text-right whitespace-nowrap font-sans">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        className="px-2 py-1 text-[11px] font-medium border border-zinc-200 hover:border-zinc-950 text-zinc-700 hover:text-zinc-950 transition-colors cursor-pointer"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Inspector */}
      {selectedLog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-white border border-zinc-950 max-w-xl w-full p-6 shadow-xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-4 border-b border-zinc-200">
              <div>
                <div className="text-xs font-mono text-zinc-400">{selectedLog.id}</div>
                <h3
                  id="audit-modal-title"
                  className="text-base font-bold text-zinc-950 mt-0.5 font-display"
                >
                  {selectedLog.action} · {selectedLog.targetId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-zinc-400 hover:text-zinc-950 p-1 cursor-pointer"
                aria-label="Close audit details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 border border-zinc-200 bg-zinc-50/50">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block">
                  Timestamp
                </span>
                <span className="font-mono text-zinc-900 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-zinc-400" />
                  {selectedLog.timestamp}
                </span>
              </div>

              <div className="p-3 border border-zinc-200 bg-zinc-50/50">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block">
                  Actor
                </span>
                <span className="font-medium text-zinc-900 mt-0.5 flex items-center gap-1.5">
                  {getActorIcon(selectedLog.actorType)}
                  {selectedLog.actorId} ({selectedLog.actorType})
                </span>
              </div>

              <div className="p-3 border border-zinc-200 bg-zinc-50/50">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block">
                  Target
                </span>
                <span className="font-mono text-zinc-900 mt-0.5 block">
                  {selectedLog.targetId}
                  {selectedLog.targetReference ? ` · ${selectedLog.targetReference}` : ''}
                </span>
              </div>

              <div className="p-3 border border-zinc-200 bg-zinc-50/50">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block">
                  Impact
                </span>
                <span className="font-mono text-zinc-900 mt-0.5 block tabular-nums">
                  {selectedLog.impactAmount !== undefined
                    ? formatCurrency(selectedLog.impactAmount, true)
                    : '—'}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[10px] font-mono text-zinc-400 uppercase block">
                  Summary
                </span>
                <p className="text-zinc-900 mt-1 font-medium">{selectedLog.summary}</p>
              </div>

              {selectedLog.details && (
                <div>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase block">
                    Details
                  </span>
                  <p className="text-zinc-600 mt-1 font-mono text-[11px] bg-zinc-50 p-2 border border-zinc-200">
                    {selectedLog.details}
                  </p>
                </div>
              )}

              <div>
                <span className="text-[10px] font-mono text-zinc-400 uppercase flex items-center gap-1">
                  <Hash className="w-3 h-3 text-zinc-400" />
                  SHA-256
                </span>
                <div className="font-mono text-[11px] text-zinc-700 bg-zinc-100 p-2 border border-zinc-200 mt-1 select-all break-all">
                  {selectedLog.hash}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-zinc-200">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-3 py-1.5 text-xs font-medium border border-zinc-200 hover:border-zinc-950 text-zinc-700 hover:text-zinc-950 cursor-pointer"
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  const cat = selectedLog.category;
                  const id = selectedLog.targetId;
                  setSelectedLog(null);
                  onNavigateToRecord(cat, id);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <span>Open {selectedLog.targetId}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
