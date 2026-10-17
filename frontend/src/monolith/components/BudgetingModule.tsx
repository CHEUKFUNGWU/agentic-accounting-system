import React, { useState, useMemo } from 'react';
import {
  JournalEntry,
  BudgetAllocationItem,
  INITIAL_BUDGET_ALLOCATIONS,
  computeBudgetVariance,
  formatCurrency,
} from '../utils/accountingLogic';
import { createBudgetingExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import {
  Grid3X3,
  ListFilter,
  Plus,
  Trash2,
  RotateCcw,
  KeyRound,
  Search,
} from 'lucide-react';

interface BudgetingModuleProps {
  entries: JournalEntry[];
}

type ColLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

interface SelectedCell {
  col: ColLetter;
  row: number;
  columnName: string;
  dataType: string;
  formulaOrValue: string;
  accountCode?: string;
  editableField?: 'accountName' | 'q4Budget' | 'customActual';
}

const DEPARTMENTS: BudgetAllocationItem['department'][] = [
  'Revenue',
  'Infrastructure',
  'Engineering',
  'GTM & Growth',
  'G&A & Legal',
  'Tax',
];

export const BudgetingModule: React.FC<BudgetingModuleProps> = ({ entries }) => {
  const [allocations, setAllocations] = useState<BudgetAllocationItem[]>(
    INITIAL_BUDGET_ALLOCATIONS
  );
  const [viewMode, setViewMode] = useState<'sheet' | 'standard'>('sheet');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'Revenue' | 'Expense'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activePreset, setActivePreset] = useState<'board' | 'lean' | 'stretch'>('board');
  const [selectedRowCodes, setSelectedRowCodes] = useState<string[]>([]);
  const [editCount, setEditCount] = useState<number>(0);

  const report = useMemo(
    () => computeBudgetVariance(entries, allocations),
    [entries, allocations]
  );

  const [selectedCell, setSelectedCell] = useState<SelectedCell>({
    col: 'E',
    row: 1,
    columnName: 'q4_budget',
    dataType: 'numeric',
    formulaOrValue: '800000',
    accountCode: '4010',
    editableField: 'q4Budget',
  });

  const filteredRows = useMemo(() => {
    return report.rows.filter((r) => {
      if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.accountCode.toLowerCase().includes(q) ||
        r.accountName.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
      );
    });
  }, [report.rows, categoryFilter, searchQuery]);

  const handleCellUpdate = <K extends keyof BudgetAllocationItem>(
    accountCode: string,
    field: K,
    value: BudgetAllocationItem[K]
  ) => {
    setAllocations((prev) =>
      prev.map((item) =>
        item.accountCode === accountCode ? { ...item, [field]: value } : item
      )
    );
    setEditCount((c) => c + 1);
  };

  const handleUpdateBudget = (accountCode: string, value: string) => {
    const parsed = Math.max(0, parseFloat(value) || 0);
    handleCellUpdate(accountCode, 'q4Budget', parsed);
    if (selectedCell.accountCode === accountCode && selectedCell.editableField === 'q4Budget') {
      setSelectedCell((prev) => ({ ...prev, formulaOrValue: String(parsed) }));
    }
  };

  const handleUpdateActualOverride = (accountCode: string, value: string) => {
    const parsed = Math.max(0, parseFloat(value) || 0);
    handleCellUpdate(accountCode, 'customActual', parsed);
    if (
      selectedCell.accountCode === accountCode &&
      selectedCell.editableField === 'customActual'
    ) {
      setSelectedCell((prev) => ({ ...prev, formulaOrValue: String(parsed) }));
    }
  };

  const handleInsertRow = () => {
    const nextCode = String(6300 + allocations.length * 10);
    const newRow: BudgetAllocationItem = {
      accountCode: nextCode,
      accountName: 'New Department Allocation',
      department: 'Engineering',
      category: 'Expense',
      q4Budget: 50000,
      customActual: 45000,
    };
    setAllocations((prev) => [...prev, newRow]);
    setEditCount((c) => c + 1);
    setSelectedCell({
      col: 'B',
      row: allocations.length + 1,
      columnName: 'account_name',
      dataType: 'text',
      formulaOrValue: newRow.accountName,
      accountCode: nextCode,
      editableField: 'accountName',
    });
  };

  const handleDeleteSelectedRows = () => {
    if (selectedRowCodes.length === 0) return;
    setAllocations((prev) =>
      prev.filter((item) => !selectedRowCodes.includes(item.accountCode))
    );
    setSelectedRowCodes([]);
    setEditCount((c) => c + 1);
  };

  const handleResetGrid = () => {
    setAllocations(INITIAL_BUDGET_ALLOCATIONS);
    setSelectedRowCodes([]);
    setEditCount(0);
    setActivePreset('board');
  };

  const toggleRowSelection = (code: string) => {
    setSelectedRowCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const toggleAllRows = () => {
    if (selectedRowCodes.length === filteredRows.length) {
      setSelectedRowCodes([]);
    } else {
      setSelectedRowCodes(filteredRows.map((r) => r.accountCode));
    }
  };

  const handleApplyPreset = (preset: 'board' | 'lean' | 'stretch') => {
    setActivePreset(preset);
    if (preset === 'board') {
      setAllocations(INITIAL_BUDGET_ALLOCATIONS);
    } else if (preset === 'lean') {
      setAllocations(
        INITIAL_BUDGET_ALLOCATIONS.map((item) => ({
          ...item,
          q4Budget:
            item.category === 'Expense'
              ? Math.round(item.q4Budget * 0.9)
              : item.q4Budget,
        }))
      );
    } else {
      setAllocations(
        INITIAL_BUDGET_ALLOCATIONS.map((item) => ({
          ...item,
          q4Budget:
            item.category === 'Revenue'
              ? Math.round(item.q4Budget * 1.15)
              : Math.round(item.q4Budget * 1.05),
        }))
      );
    }
  };

  return (
    <div className="space-y-8">
      {/* Top KPI Summary Strip */}
      <section
        aria-label="Budget Variance Summary"
        className="grid grid-cols-2 lg:grid-cols-4 border border-zinc-200 bg-white divide-y lg:divide-y-0 lg:divide-x divide-zinc-200"
      >
        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">REVENUE VS. BUDGET</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-zinc-950">
              {formatCurrency(report.totalActualRevenue)}
            </span>
            <span
              className={`text-xs font-mono font-bold tabular-nums ${
                report.revenueVariance >= 0 ? 'text-zinc-950' : 'text-zinc-500'
              }`}
            >
              {formatCurrency(report.revenueVariance, true)}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            Target: {formatCurrency(report.totalBudgetRevenue)}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">EXPENSES VS. BUDGET</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-zinc-950">
              {formatCurrency(report.totalActualExpense)}
            </span>
            <span
              className={`text-xs font-mono font-bold tabular-nums ${
                report.expenseVariance >= 0 ? 'text-zinc-950' : 'text-zinc-500'
              }`}
            >
              {formatCurrency(report.expenseVariance, true)}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            Cap: {formatCurrency(report.totalBudgetExpense)}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">BUDGETED NET INCOME</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(report.budgetNetIncome)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            Plan Margin:{' '}
            {Math.round(
              (report.budgetNetIncome / Math.max(1, report.totalBudgetRevenue)) * 1000
            ) / 10}
            %
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-mono text-zinc-400">ACTUAL NET INCOME (GL)</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-zinc-950">
              {formatCurrency(report.actualNetIncome)}
            </span>
            <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-zinc-950 text-white tabular-nums">
              {formatCurrency(report.netIncomeVariance, true)}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
            Actual Margin:{' '}
            {Math.round(
              (report.actualNetIncome / Math.max(1, report.totalActualRevenue)) * 1000
            ) / 10}
            %
          </div>
        </div>
      </section>

      {/* Supabase + Excel Editable Database Grid Workbench */}
      <section
        aria-label="Budget vs Actual Schedule"
        className="bg-white border border-zinc-200 p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-center gap-3 whitespace-nowrap">
            <h2 className="text-base font-bold text-zinc-950">
              Budget vs. Actual (Q4 2026)
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-200 text-zinc-700">
              public.budget_allocations · {filteredRows.length} rows
            </span>
            {editCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-mono bg-zinc-950 text-white">
                {editCount} {editCount === 1 ? 'edit' : 'edits'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle: Table Grid vs Standard View */}
            <div
              role="group"
              aria-label="Budget View Mode"
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
                onClick={() => setViewMode('standard')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'standard'
                    ? 'bg-zinc-950 text-white font-semibold'
                    : 'text-zinc-500 hover:text-zinc-950'
                }`}
              >
                <ListFilter className="w-3.5 h-3.5" />
                <span>Standard</span>
              </button>
            </div>

            {/* Budget Baseline Presets */}
            <div
              role="group"
              aria-label="Budget Plan Presets"
              className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200"
            >
              {(
                [
                  { id: 'board', label: 'Board Plan' },
                  { id: 'lean', label: 'Lean (-10% OpEx)' },
                  { id: 'stretch', label: 'Stretch (+15% Rev)' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPreset(p.id)}
                  className={`px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                    activePreset === p.id
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <ExportActionsBar
              onGenerateExport={() => createBudgetingExportPayload(report)}
            />
          </div>
        </div>

        {viewMode === 'sheet' ? (
          <div className="mt-5">
            {/* Supabase-Style Table Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-zinc-100 border border-b-0 border-zinc-300 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleInsertRow}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-950 text-white font-semibold hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Row</span>
                </button>

                {selectedRowCodes.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteSelectedRows}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-zinc-950 text-zinc-950 font-semibold hover:bg-zinc-950 hover:text-white transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete ({selectedRowCodes.length})</span>
                  </button>
                )}

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    aria-label="Filter budget grid"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter rows..."
                    className="pl-8 pr-2.5 py-1 text-xs font-mono bg-white border border-zinc-300 text-zinc-950 focus:outline-none focus:border-zinc-950 w-44"
                  />
                </div>

                <div className="flex items-center gap-0.5 bg-white border border-zinc-300 p-0.5">
                  {(['ALL', 'Revenue', 'Expense'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-2 py-0.5 text-[11px] font-mono cursor-pointer ${
                        categoryFilter === cat
                          ? 'bg-zinc-950 text-white font-semibold'
                          : 'text-zinc-500 hover:text-zinc-950'
                      }`}
                    >
                      {cat === 'ALL' ? 'All' : cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {editCount > 0 && (
                  <button
                    type="button"
                    onClick={handleResetGrid}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-zinc-300 text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Grid</span>
                  </button>
                )}
              </div>
            </div>

            {/* Hybrid Cell Inspector & Formula Bar */}
            <div
              aria-label="Spreadsheet Formula Bar"
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
                {selectedCell.accountCode && selectedCell.editableField ? (
                  <input
                    type={
                      selectedCell.editableField === 'accountName' ? 'text' : 'number'
                    }
                    aria-label="Formula bar cell editor"
                    value={
                      selectedCell.editableField === 'accountName'
                        ? allocations.find(
                            (a) => a.accountCode === selectedCell.accountCode
                          )?.accountName ?? ''
                        : selectedCell.editableField === 'q4Budget'
                        ? allocations.find(
                            (a) => a.accountCode === selectedCell.accountCode
                          )?.q4Budget ?? 0
                        : report.rows.find(
                            (r) => r.accountCode === selectedCell.accountCode
                          )?.actual ?? 0
                    }
                    onChange={(e) => {
                      if (!selectedCell.accountCode) return;
                      if (selectedCell.editableField === 'accountName') {
                        handleCellUpdate(
                          selectedCell.accountCode,
                          'accountName',
                          e.target.value
                        );
                      } else if (selectedCell.editableField === 'q4Budget') {
                        handleUpdateBudget(selectedCell.accountCode, e.target.value);
                      } else if (selectedCell.editableField === 'customActual') {
                        handleUpdateActualOverride(
                          selectedCell.accountCode,
                          e.target.value
                        );
                      }
                    }}
                    className="w-full text-xs font-mono text-zinc-950 focus:outline-none"
                  />
                ) : (
                  <span className="text-zinc-800 truncate">
                    {selectedCell.formulaOrValue}
                  </span>
                )}
              </div>
            </div>

            {/* Supabase + Excel Database Grid Table */}
            <div className="border border-zinc-300 overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs select-none">
                <thead>
                  {/* Excel Column Letters Bar */}
                  <tr className="bg-zinc-100 border-b border-zinc-300 text-[10px] text-zinc-500 text-center">
                    <th className="w-16 py-1 border-r border-zinc-300 bg-zinc-200/70 font-normal">
                      #
                    </th>
                    {(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const).map(
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
                    <th className="py-2 px-2 text-center border-r border-zinc-300 bg-zinc-100">
                      <input
                        type="checkbox"
                        aria-label="Select all budget rows"
                        checked={
                          filteredRows.length > 0 &&
                          selectedRowCodes.length === filteredRows.length
                        }
                        onChange={toggleAllRows}
                        className="accent-zinc-950 cursor-pointer"
                      />
                    </th>
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
                    <th className="py-2 px-2.5 border-r border-zinc-200 font-semibold min-w-[210px]">
                      <div className="flex items-center justify-between gap-1">
                        <span>account_name</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          text
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-36 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>department</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          enum
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-28 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>category</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          enum
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-36 border-r border-zinc-200 font-semibold bg-zinc-100/70">
                      <div className="flex items-center justify-between gap-1">
                        <span>q4_budget</span>
                        <span className="text-[10px] font-normal text-zinc-500">
                          int8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-36 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>q4_actual_gl</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          int8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-32 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>variance</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          fx
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-28 border-r border-zinc-200 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>util_pct</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          float8
                        </span>
                      </div>
                    </th>
                    <th className="py-2 px-2.5 w-28 font-semibold">
                      <div className="flex items-center justify-between gap-1">
                        <span>status</span>
                        <span className="text-[10px] font-normal text-zinc-400">
                          badge
                        </span>
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-200">
                  {filteredRows.map((r, idx) => {
                    const rowNum = idx + 1;
                    const isRowSelected = selectedRowCodes.includes(r.accountCode);
                    const isCell = (c: ColLetter) =>
                      selectedCell.row === rowNum && selectedCell.col === c;

                    return (
                      <tr
                        key={r.accountCode}
                        className={`${
                          isRowSelected ? 'bg-zinc-100/80' : 'hover:bg-zinc-50/60'
                        }`}
                      >
                        {/* Row Selector + Row Number */}
                        <td className="py-1.5 px-2 border-r border-zinc-300 bg-zinc-100 text-[11px] text-zinc-400">
                          <div className="flex items-center justify-between gap-1">
                            <input
                              type="checkbox"
                              aria-label={`Select row ${r.accountCode}`}
                              checked={isRowSelected}
                              onChange={() => toggleRowSelection(r.accountCode)}
                              className="accent-zinc-950 cursor-pointer"
                            />
                            <span>{rowNum}</span>
                          </div>
                        </td>

                        {/* Col A: code (pk) */}
                        <td
                          onClick={() =>
                            setSelectedCell({
                              col: 'A',
                              row: rowNum,
                              columnName: 'code',
                              dataType: 'pk text',
                              formulaOrValue: r.accountCode,
                              accountCode: r.accountCode,
                            })
                          }
                          className={`py-1.5 px-2.5 border-r border-zinc-200 font-bold text-zinc-950 cursor-cell ${
                            isCell('A')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          {r.accountCode}
                        </td>

                        {/* Col B: account_name (inline editable text cell) */}
                        <td
                          className={`p-0 border-r border-zinc-200 ${
                            isCell('B')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          <input
                            type="text"
                            aria-label={`Account name for ${r.accountCode}`}
                            value={r.accountName}
                            onFocus={() =>
                              setSelectedCell({
                                col: 'B',
                                row: rowNum,
                                columnName: 'account_name',
                                dataType: 'text',
                                formulaOrValue: r.accountName,
                                accountCode: r.accountCode,
                                editableField: 'accountName',
                              })
                            }
                            onChange={(e) =>
                              handleCellUpdate(
                                r.accountCode,
                                'accountName',
                                e.target.value
                              )
                            }
                            className="w-full py-1.5 px-2.5 font-sans text-xs text-zinc-900 bg-transparent focus:outline-none"
                          />
                        </td>

                        {/* Col C: department (inline enum select cell) */}
                        <td
                          className={`p-0 border-r border-zinc-200 ${
                            isCell('C')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          <select
                            aria-label={`Department for ${r.accountCode}`}
                            value={r.department}
                            onFocus={() =>
                              setSelectedCell({
                                col: 'C',
                                row: rowNum,
                                columnName: 'department',
                                dataType: 'enum',
                                formulaOrValue: r.department,
                                accountCode: r.accountCode,
                              })
                            }
                            onChange={(e) =>
                              handleCellUpdate(
                                r.accountCode,
                                'department',
                                e.target.value as BudgetAllocationItem['department']
                              )
                            }
                            className="w-full py-1.5 px-2 text-xs font-mono text-zinc-700 bg-transparent focus:outline-none cursor-pointer"
                          >
                            {DEPARTMENTS.map((dept) => (
                              <option key={dept} value={dept}>
                                {dept}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Col D: category (inline enum select cell) */}
                        <td
                          className={`p-0 border-r border-zinc-200 ${
                            isCell('D')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          <select
                            aria-label={`Category for ${r.accountCode}`}
                            value={r.category}
                            onFocus={() =>
                              setSelectedCell({
                                col: 'D',
                                row: rowNum,
                                columnName: 'category',
                                dataType: 'enum',
                                formulaOrValue: r.category,
                                accountCode: r.accountCode,
                              })
                            }
                            onChange={(e) =>
                              handleCellUpdate(
                                r.accountCode,
                                'category',
                                e.target.value as 'Revenue' | 'Expense'
                              )
                            }
                            className="w-full py-1.5 px-2 text-xs font-mono text-zinc-700 bg-transparent focus:outline-none cursor-pointer"
                          >
                            <option value="Revenue">Revenue</option>
                            <option value="Expense">Expense</option>
                          </select>
                        </td>

                        {/* Col E: q4_budget (inline editable int8 cell) */}
                        <td
                          className={`p-0 border-r border-zinc-200 bg-zinc-50/70 ${
                            isCell('E')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          <input
                            type="number"
                            step="5000"
                            min="0"
                            aria-label={`Budget for ${r.accountCode}`}
                            value={r.budget}
                            onFocus={() =>
                              setSelectedCell({
                                col: 'E',
                                row: rowNum,
                                columnName: 'q4_budget',
                                dataType: 'int8',
                                formulaOrValue: String(r.budget),
                                accountCode: r.accountCode,
                                editableField: 'q4Budget',
                              })
                            }
                            onChange={(e) =>
                              handleUpdateBudget(r.accountCode, e.target.value)
                            }
                            className="w-full py-1.5 px-2.5 text-right font-mono font-semibold text-zinc-950 bg-transparent focus:outline-none tabular-nums"
                          />
                        </td>

                        {/* Col F: q4_actual_gl (inline editable / GL-linked int8 cell) */}
                        <td
                          className={`p-0 border-r border-zinc-200 ${
                            isCell('F')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-white'
                              : ''
                          }`}
                        >
                          <input
                            type="number"
                            step="1000"
                            min="0"
                            aria-label={`Actual for ${r.accountCode}`}
                            value={r.actual}
                            onFocus={() =>
                              setSelectedCell({
                                col: 'F',
                                row: rowNum,
                                columnName: 'q4_actual_gl',
                                dataType: 'int8',
                                formulaOrValue: `=GL_ACTUAL("${r.accountCode}") -> ${r.actual}`,
                                accountCode: r.accountCode,
                                editableField: 'customActual',
                              })
                            }
                            onChange={(e) =>
                              handleUpdateActualOverride(r.accountCode, e.target.value)
                            }
                            className="w-full py-1.5 px-2.5 text-right font-mono text-zinc-900 bg-transparent focus:outline-none tabular-nums"
                          />
                        </td>

                        {/* Col G: variance (computed formula cell) */}
                        <td
                          onClick={() =>
                            setSelectedCell({
                              col: 'G',
                              row: rowNum,
                              columnName: 'variance',
                              dataType: 'formula',
                              formulaOrValue:
                                r.category === 'Revenue'
                                  ? `=F${rowNum}-E${rowNum}`
                                  : `=E${rowNum}-F${rowNum}`,
                            })
                          }
                          className={`py-1.5 px-2.5 border-r border-zinc-200 text-right font-semibold tabular-nums cursor-cell ${
                            r.favorableDollar >= 0 ? 'text-zinc-950' : 'text-zinc-500'
                          } ${
                            isCell('G')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-zinc-50'
                              : ''
                          }`}
                        >
                          {formatCurrency(r.favorableDollar, true)}
                        </td>

                        {/* Col H: util_pct (computed float8 cell) */}
                        <td
                          onClick={() =>
                            setSelectedCell({
                              col: 'H',
                              row: rowNum,
                              columnName: 'util_pct',
                              dataType: 'float8',
                              formulaOrValue: `=ROUND((F${rowNum}/E${rowNum})*100, 1)`,
                            })
                          }
                          className={`py-1.5 px-2.5 border-r border-zinc-200 text-right tabular-nums text-zinc-600 cursor-cell ${
                            isCell('H')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-zinc-50'
                              : ''
                          }`}
                        >
                          {r.utilizationPct.toFixed(1)}%
                        </td>

                        {/* Col I: status (computed enum badge) */}
                        <td
                          onClick={() =>
                            setSelectedCell({
                              col: 'I',
                              row: rowNum,
                              columnName: 'status',
                              dataType: 'enum',
                              formulaOrValue: r.status,
                            })
                          }
                          className={`py-1.5 px-2.5 text-center cursor-cell ${
                            isCell('I')
                              ? 'ring-2 ring-inset ring-zinc-950 bg-zinc-50'
                              : ''
                          }`}
                        >
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] ${
                              r.status === 'Favorable'
                                ? 'bg-zinc-950 text-white font-semibold'
                                : r.status === 'Over Budget' ||
                                  r.status === 'Below Target'
                                ? 'border border-zinc-950 text-zinc-950 font-semibold'
                                : 'bg-zinc-100 text-zinc-600'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Supabase Bottom "+ Insert Row" Trigger Row */}
                  <tr className="bg-zinc-50/70 hover:bg-zinc-100 transition-colors">
                    <td
                      colSpan={10}
                      className="p-0"
                    >
                      <button
                        type="button"
                        onClick={handleInsertRow}
                        className="w-full py-2 px-3 text-left text-xs font-mono text-zinc-500 hover:text-zinc-950 flex items-center gap-2 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>+ Insert new budget row into public.budget_allocations</span>
                      </button>
                    </td>
                  </tr>
                </tbody>

                {/* Consolidated Summary Footer */}
                <tfoot>
                  <tr className="bg-zinc-950 text-white font-mono text-xs border-t border-zinc-950">
                    <td className="py-2.5 px-2 text-center border-r border-zinc-800 text-zinc-400">
                      Σ
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800 font-bold">
                      NET-INC
                    </td>
                    <td
                      colSpan={3}
                      className="py-2.5 px-2.5 border-r border-zinc-800 font-sans font-bold"
                    >
                      NET INCOME (TOTAL REVENUE LESS TOTAL EXPENSES)
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800 text-right font-bold tabular-nums">
                      {formatCurrency(report.budgetNetIncome)}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800 text-right font-bold tabular-nums">
                      {formatCurrency(report.actualNetIncome)}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800 text-right font-bold tabular-nums">
                      {formatCurrency(report.netIncomeVariance, true)}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-zinc-800 text-right tabular-nums text-zinc-300">
                      {Math.round(
                        (report.actualNetIncome / Math.max(1, report.budgetNetIncome)) *
                          1000
                      ) / 10}
                      %
                    </td>
                    <td className="py-2.5 px-2.5 text-center text-[10px] font-bold">
                      {report.netIncomeVariance >= 0 ? 'FAVORABLE' : 'BELOW PLAN'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          /* Standard View */
          <div className="mt-5 space-y-4">
            <div className="flex justify-end">
              <div className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200">
                {(['ALL', 'Revenue', 'Expense'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer ${
                      categoryFilter === cat
                        ? 'bg-zinc-950 text-white font-semibold'
                        : 'text-zinc-500 hover:text-zinc-950'
                    }`}
                  >
                    {cat === 'ALL' ? 'All' : cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-zinc-200 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-mono text-zinc-400">
                    <th className="py-2.5 pl-4 pr-3 w-20 font-normal">CODE</th>
                    <th className="py-2.5 px-3 font-normal">ACCOUNT</th>
                    <th className="py-2.5 px-3 w-32 font-normal">DEPT</th>
                    <th className="py-2.5 px-3 w-36 text-right font-normal">Q4 BUDGET</th>
                    <th className="py-2.5 px-3 w-36 text-right font-normal">ACTUAL (GL)</th>
                    <th className="py-2.5 px-3 w-36 text-right font-normal">VARIANCE ($)</th>
                    <th className="py-2.5 px-3 w-44 font-normal">UTILIZATION</th>
                    <th className="py-2.5 pl-3 pr-4 w-28 text-right font-normal">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-xs">
                  {filteredRows.map((row) => {
                    const clampedBar = Math.min(100, Math.max(0, row.utilizationPct));
                    const isOverExpense =
                      row.category === 'Expense' && row.actual > row.budget;

                    return (
                      <tr key={row.accountCode} className="hover:bg-zinc-50/70">
                        <td className="py-3 pl-4 pr-3 font-mono font-bold text-zinc-950">
                          {row.accountCode}
                        </td>
                        <td className="py-3 px-3 font-medium text-zinc-900">
                          {row.accountName}
                        </td>
                        <td className="py-3 px-3 font-mono text-zinc-500">
                          {row.department}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <input
                            type="number"
                            step="5000"
                            min="0"
                            aria-label={`Budget for ${row.accountCode}`}
                            value={row.budget}
                            onChange={(e) =>
                              handleUpdateBudget(row.accountCode, e.target.value)
                            }
                            className="w-28 px-2 py-1 text-xs font-mono tabular-nums text-right bg-zinc-50 border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950 focus:bg-white"
                          />
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-zinc-950 tabular-nums">
                          {formatCurrency(row.actual)}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono font-semibold tabular-nums ${
                            row.favorableDollar >= 0 ? 'text-zinc-950' : 'text-zinc-500'
                          }`}
                        >
                          {formatCurrency(row.favorableDollar, true)}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex-1 h-1.5 bg-zinc-100 overflow-hidden">
                              <div
                                className={`h-full ${
                                  isOverExpense ? 'bg-zinc-500' : 'bg-zinc-950'
                                }`}
                                style={{ width: `${clampedBar}%` }}
                              />
                            </div>
                            <span className="w-12 text-right font-mono text-[11px] text-zinc-600 tabular-nums">
                              {row.utilizationPct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 pl-3 pr-4 text-right font-mono">
                          <span
                            className={`inline-block px-2 py-0.5 text-[11px] ${
                              row.status === 'Favorable'
                                ? 'bg-zinc-950 text-white font-semibold'
                                : row.status === 'Over Budget' ||
                                  row.status === 'Below Target'
                                ? 'border border-zinc-950 text-zinc-950 font-semibold'
                                : 'bg-zinc-100 text-zinc-600'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
