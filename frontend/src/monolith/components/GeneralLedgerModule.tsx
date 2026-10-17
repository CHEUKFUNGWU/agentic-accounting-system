import React, { useState, useMemo, useEffect } from 'react';
import {
  JournalEntry,
  AccountCategory,
  computeGeneralLedgerByAccount,
  formatCurrency,
} from '../utils/accountingLogic';
import { createGeneralLedgerExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';

interface GeneralLedgerModuleProps {
  entries: JournalEntry[];
  focusedAccountCode?: string | null;
  globalSearchQuery?: string;
}

export const GeneralLedgerModule: React.FC<GeneralLedgerModuleProps> = ({
  entries,
  focusedAccountCode,
  globalSearchQuery = '',
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | AccountCategory>('ALL');
  const [selectedAccountCode, setSelectedAccountCode] = useState<string>(
    focusedAccountCode || 'ALL'
  );

  useEffect(() => {
    if (focusedAccountCode) {
      setCategoryFilter('ALL');
      setSelectedAccountCode(focusedAccountCode);
    }
  }, [focusedAccountCode]);

  const allAccountLedgers = useMemo(
    () => computeGeneralLedgerByAccount(entries),
    [entries]
  );

  const filteredLedgers = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    return allAccountLedgers.filter((gl) => {
      if (categoryFilter !== 'ALL' && gl.account.category !== categoryFilter) {
        return false;
      }
      if (selectedAccountCode !== 'ALL' && gl.account.code !== selectedAccountCode) {
        return false;
      }
      if (q && selectedAccountCode === 'ALL') {
        const matchesAccount =
          gl.account.code.toLowerCase().includes(q) ||
          gl.account.name.toLowerCase().includes(q) ||
          gl.account.category.toLowerCase().includes(q) ||
          gl.postings.some(
            (p) =>
              p.entryId.toLowerCase().includes(q) || p.memo.toLowerCase().includes(q)
          );
        if (!matchesAccount) return false;
      }
      return true;
    });
  }, [allAccountLedgers, categoryFilter, selectedAccountCode, globalSearchQuery]);

  const totalDebits = useMemo(
    () => allAccountLedgers.reduce((sum, g) => sum + g.periodDebits, 0),
    [allAccountLedgers]
  );
  const totalCredits = useMemo(
    () => allAccountLedgers.reduce((sum, g) => sum + g.periodCredits, 0),
    [allAccountLedgers]
  );

  return (
    <div className="space-y-8">
      {/* Minimal Summary Strip */}
      <section
        aria-label="General Ledger Summary"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Active Accounts</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {allAccountLedgers.length}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Period Debits</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(totalDebits)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Period Credits</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(totalCredits)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Posted Journals</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {entries.length}
          </div>
        </div>
      </section>

      {/* Filter Toolbar & Account Ledgers */}
      <section aria-label="Account Ledgers" className="bg-white border border-zinc-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-100">
          <h2 className="text-base font-bold text-zinc-950 whitespace-nowrap">General Ledger</h2>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by GL Account"
              value={selectedAccountCode}
              onChange={(e) => setSelectedAccountCode(e.target.value)}
              className="px-2.5 py-1 text-xs font-mono bg-zinc-50 border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
            >
              <option value="ALL">All Accounts ({allAccountLedgers.length})</option>
              {allAccountLedgers.map((g) => (
                <option key={g.account.code} value={g.account.code}>
                  {g.account.code} · {g.account.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200">
              {(['ALL', 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] as const).map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(cat);
                      setSelectedAccountCode('ALL');
                    }}
                    className={`px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                      categoryFilter === cat
                        ? 'bg-zinc-950 text-white'
                        : 'text-zinc-500 hover:text-zinc-950'
                    }`}
                  >
                    {cat === 'ALL' ? 'All' : cat}
                  </button>
                )
              )}
            </div>

            <ExportActionsBar
              onGenerateExport={() =>
                createGeneralLedgerExportPayload(entries, categoryFilter, selectedAccountCode)
              }
            />
          </div>
        </div>

        <div className="divide-y divide-zinc-200 mt-2">
          {filteredLedgers.map((gl) => (
            <div key={gl.account.code} className="py-5 first:pt-3 last:pb-1">
              {/* Account Header */}
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 pb-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-mono font-bold text-zinc-950">
                    {gl.account.code}
                  </span>
                  <h3 className="text-sm font-bold text-zinc-950">
                    {gl.account.name}
                  </h3>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {gl.account.category}
                  </span>
                </div>

                <div className="flex items-baseline gap-4 text-xs font-mono tabular-nums">
                  <span className="text-zinc-400">
                    Open {formatCurrency(gl.openingBalance)}
                  </span>
                  <span className="font-bold text-zinc-950">
                    Close {formatCurrency(gl.endingBalance)}
                  </span>
                </div>
              </div>

              {/* Postings Table */}
              {gl.postings.length > 0 ? (
                <div className="border border-zinc-200 overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-400">
                        <th className="py-1.5 px-3 font-normal w-28">DATE</th>
                        <th className="py-1.5 px-3 font-normal w-36">ENTRY</th>
                        <th className="py-1.5 px-3 font-normal">MEMO</th>
                        <th className="py-1.5 px-3 font-normal text-right w-28">DEBIT</th>
                        <th className="py-1.5 px-3 font-normal text-right w-28">CREDIT</th>
                        <th className="py-1.5 px-3 font-normal text-right w-32">BALANCE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {gl.postings.map((p) => (
                        <tr key={p.id} className="hover:bg-zinc-50/80">
                          <td className="py-2 px-3 text-zinc-400">{p.date}</td>
                          <td className="py-2 px-3 font-medium text-zinc-950">{p.entryId}</td>
                          <td className="py-2 px-3 font-sans text-zinc-700 truncate max-w-[280px]">
                            {p.memo}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-zinc-950">
                            {p.debit > 0 ? formatCurrency(p.debit) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-zinc-950">
                            {p.credit > 0 ? formatCurrency(p.credit) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold tabular-nums text-zinc-950">
                            {formatCurrency(p.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[11px] font-mono text-zinc-400">
                  No period activity
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
