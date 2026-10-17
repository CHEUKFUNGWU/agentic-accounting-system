import React, { useState, useMemo } from 'react';
import {
  PayableBill,
  BillStatus,
  computePayablesSummary,
  formatCurrency,
} from '../utils/accountingLogic';
import { createPayablesExportPayload } from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import { Check, Plus } from 'lucide-react';

interface AccountsPayableModuleProps {
  bills: PayableBill[];
  onApproveBill: (billId: string) => void;
  onPayBill: (billId: string) => void;
  onCreateBill: (params: {
    vendor: string;
    reference: string;
    dueDate: string;
    expenseAccountCode: string;
    amount: number;
  }) => Promise<unknown>;
}

const EXPENSE_ACCOUNTS: { code: string; name: string }[] = [
  { code: '5010', name: 'Cloud & GPU Inference Hosting' },
  { code: '6010', name: 'R&D Engineering Payroll' },
  { code: '6120', name: 'Enterprise GTM & Growth Operations' },
  { code: '6250', name: 'General, Legal & Audit Advisory' },
];

export const AccountsPayableModule: React.FC<AccountsPayableModuleProps> = ({
  bills,
  onApproveBill,
  onPayBill,
  onCreateBill,
}) => {
  const [statusFilter, setStatusFilter] = useState<'All' | BillStatus>('All');
  const [vendorInput, setVendorInput] = useState('');
  const [refInput, setRefInput] = useState('');
  const [dueDateInput, setDueDateInput] = useState('2026-11-15');
  const [expenseCodeInput, setExpenseCodeInput] = useState('5010');
  const [amountInput, setAmountInput] = useState('');

  const summary = useMemo(() => computePayablesSummary(bills), [bills]);

  const filteredBills = useMemo(() => {
    if (statusFilter === 'All') return bills;
    return bills.filter((b) => b.status === statusFilter);
  }, [bills, statusFilter]);

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(amountInput);
    if (!vendorInput.trim() || !numericAmount || numericAmount <= 0) return;

    try { await onCreateBill({
      vendor: vendorInput.trim(),
      reference: refInput.trim() || `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      dueDate: dueDateInput || '2026-11-15',
      expenseAccountCode: expenseCodeInput,
      amount: numericAmount,
    }); } catch { return; }
    setVendorInput('');
    setRefInput('');
    setAmountInput('');
  };

  return (
    <div className="space-y-8">
      {/* Minimal KPI Strip */}
      <section
        aria-label="Accounts Payable Metrics"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-zinc-200 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200"
      >
        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Total Open AP</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.totalOpenAp)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Approved</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.approvedAmount)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Pending</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.pendingAmount)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-mono text-zinc-400">Paid</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-zinc-950">
            {formatCurrency(summary.paidAmount)}
          </div>
        </div>
      </section>

      {/* Main AP Schedule & Inline Bill Form */}
      <section aria-label="Payables Schedule" className="bg-white border border-zinc-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-zinc-100">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-bold text-zinc-950">Payables</h2>
            <div className="flex items-center border border-zinc-200 p-0.5 bg-zinc-50 text-xs">
              {(['All', 'Approved', 'Pending', 'Paid'] as const).map((status) => (
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
            onGenerateExport={() => createPayablesExportPayload(filteredBills)}
          />
        </div>

        {/* Inline New Vendor Bill Row */}
        <form
          onSubmit={handleSubmitNew}
          aria-label="New Bill"
          className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-zinc-50 p-3 border border-zinc-200"
        >
          <input
            type="text"
            aria-label="Vendor"
            placeholder="Vendor"
            value={vendorInput}
            onChange={(e) => setVendorInput(e.target.value)}
            className="sm:col-span-3 px-3 py-1.5 text-xs bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <input
            type="text"
            aria-label="Bill Reference"
            placeholder="Reference"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            className="sm:col-span-2 px-3 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <select
            aria-label="Expense Account"
            value={expenseCodeInput}
            onChange={(e) => setExpenseCodeInput(e.target.value)}
            className="sm:col-span-3 px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          >
            {EXPENSE_ACCOUNTS.map((acc) => (
              <option key={acc.code} value={acc.code}>
                {acc.code} · {acc.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Bill Due Date"
            value={dueDateInput}
            onChange={(e) => setDueDateInput(e.target.value)}
            className="sm:col-span-2 px-2.5 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
          />
          <div className="sm:col-span-2 flex gap-2">
            <input
              type="number" step="0.01"
              aria-label="Bill Amount"
              placeholder="Amount ($)"
              min="0"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>
        </form>

        {/* Bills Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] text-zinc-400">
                <th className="py-3 pr-4 font-normal w-24">BILL</th>
                <th className="py-3 px-4 font-normal">VENDOR</th>
                <th className="py-3 px-4 font-normal w-32">REF</th>
                <th className="py-3 px-4 font-normal w-28">BILL DATE</th>
                <th className="py-3 px-4 font-normal w-28">DUE DATE</th>
                <th className="py-3 px-4 font-normal">GL ACCOUNT</th>
                <th className="py-3 px-4 font-normal text-right w-32 bg-zinc-50">AMOUNT</th>
                <th className="py-3 px-4 font-normal w-24">STATUS</th>
                <th className="py-3 pl-4 font-normal text-right w-28">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredBills.map((bill) => (
                <tr key={bill.id} className="hover:bg-zinc-50/80">
                  <td className="py-3 pr-4 font-bold text-zinc-950 whitespace-nowrap">
                    {bill.id}
                  </td>
                  <td className="py-3 px-4 font-sans font-medium text-zinc-900">
                    {bill.vendor}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                    {bill.reference}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 tabular-nums whitespace-nowrap">
                    {bill.billDate}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 tabular-nums whitespace-nowrap">
                    {bill.dueDate}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                    <span className="font-bold text-zinc-900">{bill.expenseAccountCode}</span>
                    <span className="mx-1.5 text-zinc-300">·</span>
                    <span className="font-sans text-zinc-600">{bill.expenseAccountName}</span>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums text-zinc-950 bg-zinc-50/60 whitespace-nowrap">
                    {formatCurrency(bill.amount)}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={
                        bill.status === 'Pending'
                          ? 'text-amber-600 font-semibold'
                          : bill.status === 'Paid'
                          ? 'text-zinc-400'
                          : 'text-zinc-900'
                      }
                    >
                      {bill.status}
                    </span>
                  </td>
                  <td className="py-3 pl-4 text-right whitespace-nowrap">
                    {bill.status === 'Paid' ? (
                      <span className="inline-flex items-center gap-1 text-zinc-400 justify-end">
                        <Check className="w-3.5 h-3.5 text-zinc-950" />
                        <span>Paid</span>
                      </span>
                    ) : bill.status === 'Pending' ? (
                      <button
                        type="button"
                        onClick={() => onApproveBill(bill.id)}
                        aria-label={`Approve ${bill.id}`}
                        className="px-2.5 py-1 text-xs font-mono border border-zinc-200 hover:border-zinc-950 text-zinc-900 transition-colors cursor-pointer"
                      >
                        Approve
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPayBill(bill.id)}
                        aria-label={`Pay ${bill.id}`}
                        className="px-2.5 py-1 text-xs font-mono bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
