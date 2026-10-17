import React, { useState, useMemo } from 'react';
import {
  ReceivableInvoice,
  InvoiceStatus,
  computeReceivablesSummary,
  formatCurrency,
} from '../utils/accountingLogic';
import { createReceivablesExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Check, Plus } from 'lucide-react';

interface AccountsReceivableModuleProps {
  invoices: ReceivableInvoice[];
  onCollectInvoice: (invoiceId: string) => void;
  onCreateInvoice: (params: {
    customer: string;
    dueDate: string;
    revenueAccountCode: string;
    amount: number;
  }) => Promise<unknown>;
}

export const AccountsReceivableModule: React.FC<AccountsReceivableModuleProps> = ({
  invoices,
  onCollectInvoice,
  onCreateInvoice,
}) => {
  const [statusFilter, setStatusFilter] = useState<'All' | InvoiceStatus>('All');
  const [customerInput, setCustomerInput] = useState('');
  const [dueDateInput, setDueDateInput] = useState('2026-11-15');
  const [revenueAccountInput, setRevenueAccountInput] = useState('4010');
  const [amountInput, setAmountInput] = useState('');

  const summary = useMemo(() => computeReceivablesSummary(invoices), [invoices]);

  const filteredInvoices = useMemo(() => {
    if (statusFilter === 'All') return invoices;
    return invoices.filter((inv) => inv.status === statusFilter);
  }, [invoices, statusFilter]);

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(amountInput);
    if (!customerInput.trim() || !numericAmount || numericAmount <= 0) return;

    try { await onCreateInvoice({
      customer: customerInput.trim(),
      dueDate: dueDateInput || '2026-11-15',
      revenueAccountCode: revenueAccountInput,
      amount: numericAmount,
    }); } catch { return; }
    setCustomerInput('');
    setAmountInput('');
  };

  return (
    <div className="space-y-8">
      {/* Minimal KPI Strip */}
      <section
        aria-label="Accounts Receivable Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total AR</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.totalOutstanding)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Current</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.currentAmount)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Past Due</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.pastDueAmount)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Collected</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.collectedAmount)}
          </div>
        </div>
      </section>

      {/* Main AR Schedule & Inline Invoice Form */}
      <section aria-label="Receivables Schedule" className="bg-white border border-zinc-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-bold text-zinc-950">Receivables</h2>
            <div className="flex items-center border border-zinc-200 p-0.5 bg-zinc-50 text-xs">
              {(['All', 'Open', 'Overdue', 'Paid'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === status
                      ? 'bg-zinc-950 text-white font-semibold'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <ExportActionsBar
            onGenerateExport={() => createReceivablesExportPayload(filteredInvoices)}
          />
        </div>

        {/* Inline New Invoice Row */}
        <form
          onSubmit={handleSubmitNew}
          aria-label="New Invoice"
          className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-zinc-50 p-3 border border-zinc-200"
        >
          <input
            type="text"
            aria-label="Customer"
            placeholder="Customer"
            value={customerInput}
            onChange={(e) => setCustomerInput(e.target.value)}
            className="sm:col-span-4 px-3 py-1.5 text-xs bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <select
            aria-label="Revenue Account"
            value={revenueAccountInput}
            onChange={(e) => setRevenueAccountInput(e.target.value)}
            className="sm:col-span-3 px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          >
            <option value="4010">4010 · Enterprise SaaS</option>
            <option value="4020">4020 · Usage & Compute</option>
            <option value="4030">4030 · Advisory Services</option>
          </select>
          <input
            type="date"
            aria-label="Due Date"
            value={dueDateInput}
            onChange={(e) => setDueDateInput(e.target.value)}
            className="sm:col-span-2 px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <input
            type="number" step="0.01"
            aria-label="Invoice Amount"
            placeholder="Amount ($)"
            min="0"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="sm:col-span-2 px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <button
            type="submit"
            className="sm:col-span-1 px-3 py-1.5 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Issue</span>
          </button>
        </form>

        {/* Invoices Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] text-zinc-400">
                <th className="py-3 pr-4 font-normal w-28">INVOICE</th>
                <th className="py-3 px-4 font-normal">CUSTOMER</th>
                <th className="py-3 px-4 font-normal w-28">ISSUE DATE</th>
                <th className="py-3 px-4 font-normal w-28">DUE DATE</th>
                <th className="py-3 px-4 font-normal w-24">AGING</th>
                <th className="py-3 px-4 font-normal w-20">GL</th>
                <th className="py-3 px-4 font-normal text-right w-32">AMOUNT</th>
                <th className="py-3 px-4 font-normal text-right w-32 bg-zinc-50">BALANCE</th>
                <th className="py-3 px-4 font-normal w-24">STATUS</th>
                <th className="py-3 pl-4 font-normal text-right w-24">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredInvoices.map((inv) => {
                const balance = Math.max(0, inv.amount - inv.paidAmount);
                return (
                  <tr key={inv.id} className="hover:bg-zinc-50/80">
                    <td className="py-3 pr-4 font-bold text-zinc-950 whitespace-nowrap">
                      {inv.id}
                    </td>
                    <td className="py-3 px-4 font-sans font-medium text-zinc-900">
                      {inv.customer}
                    </td>
                    <td className="py-3 px-4 text-zinc-500 tabular-nums whitespace-nowrap">
                      {inv.issueDate}
                    </td>
                    <td className="py-3 px-4 text-zinc-500 tabular-nums whitespace-nowrap">
                      {inv.dueDate}
                    </td>
                    <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                      {inv.agingBucket}
                    </td>
                    <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">
                      {inv.revenueAccountCode}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-zinc-600 whitespace-nowrap">
                      {formatCurrency(inv.amount)}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold tabular-nums text-zinc-950 bg-zinc-50/60 whitespace-nowrap">
                      {balance > 0 ? formatCurrency(balance) : '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={
                          inv.status === 'Overdue'
                            ? 'text-red-600 font-semibold'
                            : inv.status === 'Paid'
                            ? 'text-zinc-400'
                            : 'text-zinc-900'
                        }
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-right whitespace-nowrap">
                      {inv.status === 'Paid' ? (
                        <span className="inline-flex items-center gap-1 text-zinc-400 justify-end">
                          <Check className="w-3.5 h-3.5 text-zinc-950" />
                          <span>Paid</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCollectInvoice(inv.id)}
                          aria-label={`Collect ${inv.id}`}
                          className="px-2.5 py-1 text-xs font-mono bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          Collect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
