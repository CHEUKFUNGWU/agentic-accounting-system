import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  JournalEntry,
  BankFeedItem,
  searchGlobalAccountingRecords,
  formatCurrency,
} from '../utils/accountingLogic';
import {
  AppPreferences,
  getTranslations,
} from '../utils/preferences';
import {
  Search,
  X,
  BookOpen,
  Layers,
  ArrowLeftRight,
  ArrowUpRight,
} from 'lucide-react';

interface GlobalSearchBarProps {
  query: string;
  onQueryChange: (newQuery: string) => void;
  entries: JournalEntry[];
  bankItems: BankFeedItem[];
  onSelectJournalEntry: (entryId: string) => void;
  onSelectAccount: (accountCode: string) => void;
  onSelectBankTransaction: (bankId: string) => void;
  preferences: AppPreferences;
}

type SearchCategoryTab = 'ALL' | 'JOURNALS' | 'ACCOUNTS' | 'BANK';

const QUICK_SEARCH_PRESETS = [
  { label: '1010 · Cash', query: '1010' },
  { label: 'Stripe', query: 'Stripe' },
  { label: 'AWS', query: 'AWS' },
  { label: 'JE-2026-0942', query: 'JE-2026-0942' },
  { label: 'Delaware Tax', query: 'Delaware' },
];

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  query,
  onQueryChange,
  entries,
  bankItems,
  onSelectJournalEntry,
  onSelectAccount,
  onSelectBankTransaction,
  preferences,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [categoryTab, setCategoryTab] = useState<SearchCategoryTab>('ALL');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = getTranslations(preferences.language);

  const results = useMemo(
    () => searchGlobalAccountingRecords(query, entries, bankItems),
    [query, entries, bankItems]
  );

  // Global "/" shortcut to focus search bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasQuery = query.trim().length > 0;

  const showJournals =
    (categoryTab === 'ALL' || categoryTab === 'JOURNALS') &&
    results.journalEntries.length > 0;
  const showAccounts =
    (categoryTab === 'ALL' || categoryTab === 'ACCOUNTS') &&
    results.accounts.length > 0;
  const showBank =
    (categoryTab === 'ALL' || categoryTab === 'BANK') &&
    results.bankTransactions.length > 0;

  return (
    <div ref={containerRef} className="relative mb-6 z-20">
      <div className="bg-white border border-zinc-200 flex items-center px-3.5 py-2.5 gap-3 focus-within:border-zinc-950 transition-colors">
        <Search className="w-4 h-4 text-zinc-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          aria-label="Global search for journal entries, accounts, or bank transactions"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setIsOpen(true);
          }}
          placeholder={t.search.placeholder}
          className="w-full text-xs text-zinc-950 placeholder:text-zinc-400 bg-transparent focus:outline-none"
        />

        {hasQuery ? (
          <div className="flex items-center gap-2 shrink-0">
            <span
              data-testid="global-search-count"
              className="px-2 py-0.5 text-[11px] tabular-nums bg-zinc-100 text-zinc-700 border border-zinc-200 whitespace-nowrap"
            >
              {results.totalCount}{' '}
              {results.totalCount === 1
                ? t.search.matchesSingle
                : t.search.matchesPlural}
            </span>
            <button
              type="button"
              aria-label="Clear global search"
              onClick={() => {
                onQueryChange('');
                setCategoryTab('ALL');
                inputRef.current?.focus();
              }}
              className="p-1 text-zinc-400 hover:text-zinc-950 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-medium text-zinc-400 border border-zinc-200 bg-zinc-50 px-1.5 py-0.5">
              /
            </span>
          </div>
        )}
      </div>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          role="region"
          aria-label="Global Search Results"
          className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-950 shadow-lg max-h-[460px] overflow-y-auto"
        >
          {!hasQuery ? (
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-zinc-400 mr-1">
                  {t.search.quickLookup}
                </span>
                {QUICK_SEARCH_PRESETS.map((preset) => (
                  <button
                    key={preset.query}
                    type="button"
                    onClick={() => {
                      onQueryChange(preset.query);
                      setIsOpen(true);
                    }}
                    className="px-2 py-1 text-[11px] font-medium bg-zinc-50 border border-zinc-200 text-zinc-700 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[11px] font-medium text-zinc-400 hover:text-zinc-950 cursor-pointer"
              >
                ESC
              </button>
            </div>
          ) : (
            <div>
              {/* Category Filter Tabs */}
              <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { id: 'ALL', label: `${t.search.all} (${results.totalCount})` },
                      {
                        id: 'JOURNALS',
                        label: `${t.search.journals} (${results.journalEntries.length})`,
                      },
                      {
                        id: 'ACCOUNTS',
                        label: `${t.search.accounts} (${results.accounts.length})`,
                      },
                      {
                        id: 'BANK',
                        label: `${t.search.bank} (${results.bankTransactions.length})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCategoryTab(tab.id)}
                      className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                        categoryTab === tab.id
                          ? 'bg-zinc-950 text-white font-semibold'
                          : 'text-zinc-500 hover:text-zinc-950 bg-white border border-zinc-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-[11px] font-medium text-zinc-400 hover:text-zinc-950 cursor-pointer"
                >
                  {t.search.close}
                </button>
              </div>

              {results.totalCount === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs text-zinc-500">
                    {t.search.noMatches} &ldquo;{query}&rdquo;.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-200">
                  {/* Accounts Section */}
                  {showAccounts && (
                    <div className="p-3">
                      <div className="px-2 pb-2 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        <Layers className="w-3 h-3" />
                        <span>
                          {t.search.accounts} ({results.accounts.length})
                        </span>
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {results.accounts.map((acct) => (
                          <button
                            key={acct.code}
                            type="button"
                            onClick={() => {
                              onSelectAccount(acct.code);
                              setIsOpen(false);
                            }}
                            className="w-full px-2 py-2.5 flex items-center justify-between gap-4 text-left hover:bg-zinc-50 transition-colors cursor-pointer group"
                          >
                            <div className="min-w-0 flex items-baseline gap-2.5">
                              <span className="text-xs tabular-nums font-bold text-zinc-950 shrink-0">
                                {acct.code}
                              </span>
                              <span className="text-xs font-medium text-zinc-900 truncate">
                                {acct.name}
                              </span>
                              <span className="text-[10px] font-medium text-zinc-400 border border-zinc-200 px-1.5 py-0.5 shrink-0">
                                {acct.category}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs">
                              <span className="text-[11px] text-zinc-400 tabular-nums">
                                {acct.transactionCount} postings
                              </span>
                              <span className="font-bold text-zinc-950 tabular-nums">
                                {formatCurrency(acct.closingBalance)}
                              </span>
                              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-950 inline-flex items-center gap-0.5">
                                {t.nav.ledger}
                                <ArrowUpRight className="w-3 h-3" />
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Journal Entries Section */}
                  {showJournals && (
                    <div className="p-3">
                      <div className="px-2 pb-2 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        <BookOpen className="w-3 h-3" />
                        <span>
                          {t.search.journals} ({results.journalEntries.length})
                        </span>
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {results.journalEntries.map((je) => (
                          <button
                            key={je.id}
                            type="button"
                            onClick={() => {
                              onSelectJournalEntry(je.id);
                              setIsOpen(false);
                            }}
                            className="w-full px-2 py-2.5 flex items-center justify-between gap-4 text-left hover:bg-zinc-50 transition-colors cursor-pointer group"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-xs tabular-nums">
                                <span className="font-bold text-zinc-950">{je.id}</span>
                                <span className="text-zinc-400">{je.date}</span>
                                <span className="text-[10px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5">
                                  {je.reference}
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  [{je.matchedAccountCodes.join(', ')}]
                                </span>
                              </div>
                              <div className="text-xs text-zinc-700 truncate mt-0.5">
                                {je.memo}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs">
                              <span className="font-bold text-zinc-950 tabular-nums">
                                {formatCurrency(je.totalAmount)}
                              </span>
                              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-950 inline-flex items-center gap-0.5">
                                {t.nav.journal}
                                <ArrowUpRight className="w-3 h-3" />
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Bank Transactions Section */}
                  {showBank && (
                    <div className="p-3">
                      <div className="px-2 pb-2 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        <ArrowLeftRight className="w-3 h-3" />
                        <span>
                          {t.search.bank} ({results.bankTransactions.length})
                        </span>
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {results.bankTransactions.map((bf) => (
                          <button
                            key={bf.id}
                            type="button"
                            onClick={() => {
                              onSelectBankTransaction(bf.id);
                              setIsOpen(false);
                            }}
                            className="w-full px-2 py-2.5 flex items-center justify-between gap-4 text-left hover:bg-zinc-50 transition-colors cursor-pointer group"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-xs tabular-nums">
                                <span className="font-bold text-zinc-950">{bf.id}</span>
                                <span className="text-zinc-400">{bf.date}</span>
                                <span className="text-[10px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5">
                                  {bf.bankReference}
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  {bf.status}
                                </span>
                              </div>
                              <div className="text-xs text-zinc-700 truncate mt-0.5">
                                {bf.counterparty} — {bf.description}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs">
                              <span className="font-bold text-zinc-950 tabular-nums">
                                {formatCurrency(bf.amount, true)}
                              </span>
                              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-950 inline-flex items-center gap-0.5">
                                {t.nav.reconciliation}
                                <ArrowUpRight className="w-3 h-3" />
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
