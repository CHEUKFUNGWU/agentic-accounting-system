import React, { useState, useMemo, useRef } from 'react';
import {
  CHART_OF_ACCOUNTS,
  JournalEntry,
  JournalLine,
  JournalAttachment,
  validateJournalEntry,
  formatCurrency,
  formatFileSize,
} from '../utils/accountingLogic';
import {
  createJournalEntriesExportPayload,
  triggerBrowserDownload,
  buildPdfBytes,
} from '../utils/exportUtils';
import { ExportActionsBar } from './ExportActionsBar';
import {
  Plus,
  Trash2,
  Check,
  AlertTriangle,
  Search,
  Paperclip,
  X,
  FileText,
} from 'lucide-react';

interface JournalEntryModuleProps {
  entries: JournalEntry[];
  onAddEntry: (entry: JournalEntry) => Promise<JournalEntry>;
  onReviewEntry: (id: string) => void;
  globalSearchQuery?: string;
}

interface DraftLine {
  id: string;
  accountCode: string;
  description: string;
  debit: string;
  credit: string;
}

const AGENTIC_PRESETS = [
  {
    id: 'asc606-saas',
    label: 'ASC 606 Split ($240k)',
    memo: 'Citadel Quantitative — Annual SaaS contract split',
    reference: 'INV-9012',
    defaultAttachment: {
      name: 'Citadel_Enterprise_MSA_9012.pdf',
      sizeBytes: 312400,
      mimeType: 'application/pdf',
    },
    lines: [
      { id: 'p1', accountCode: '1010', description: 'Wire settlement', debit: '240000', credit: '0' },
      { id: 'p2', accountCode: '4010', description: 'Q4 recognized', debit: '0', credit: '60000' },
      { id: 'p3', accountCode: '2400', description: 'Deferred ARR', debit: '0', credit: '180000' },
    ],
  },
  {
    id: 'gpu-compute',
    label: 'GPU Accrual ($82.5k)',
    memo: 'CoreWeave H100 inference compute & prepaid drawdown',
    reference: 'CW-1026',
    defaultAttachment: {
      name: 'CoreWeave_H100_Usage_CW1026.pdf',
      sizeBytes: 194500,
      mimeType: 'application/pdf',
    },
    lines: [
      { id: 'p1', accountCode: '5010', description: 'H100 node usage', debit: '82500', credit: '0' },
      { id: 'p2', accountCode: '1400', description: 'Prepaid credit', debit: '0', credit: '32500' },
      { id: 'p3', accountCode: '2010', description: 'Net payable', debit: '0', credit: '50000' },
    ],
  },
  {
    id: 'audit-retainer',
    label: 'Audit Accrual ($28k)',
    memo: 'Deloitte Q4 statutory audit & SOC 2 accrual',
    reference: 'AUD-Q4',
    defaultAttachment: {
      name: 'Deloitte_Q4_Audit_Engagement.pdf',
      sizeBytes: 156800,
      mimeType: 'application/pdf',
    },
    lines: [
      { id: 'p1', accountCode: '6250', description: 'Audit fee', debit: '28000', credit: '0' },
      { id: 'p2', accountCode: '2010', description: 'Trade payable', debit: '0', credit: '28000' },
    ],
  },
];

export const JournalEntryModule: React.FC<JournalEntryModuleProps> = ({
  entries,
  onAddEntry,
  onReviewEntry,
  globalSearchQuery = '',
}) => {
  const [date, setDate] = useState<string>('2026-10-16');
  const [reference, setReference] = useState<string>('JE-104');
  const [memo, setMemo] = useState<string>('');
  const [sourceType, setSourceType] = useState<'Manual Entry' | 'Agentic Auto-Draft'>('Manual Entry');
  const [lines, setLines] = useState<DraftLine[]>([
    { id: 'dl-1', accountCode: '6010', description: 'R&D allocation', debit: '45000', credit: '0' },
    { id: 'dl-2', accountCode: '1010', description: 'Operating cash', debit: '0', credit: '45000' },
  ]);
  const [attachments, setAttachments] = useState<JournalAttachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [attemptedSubmit, setAttemptedSubmit] = useState<boolean>(false);
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');

  const parsedLinesForValidation = useMemo(() => {
    return lines.map((l) => ({
      accountCode: l.accountCode,
      debit: parseFloat(l.debit) || 0,
      credit: parseFloat(l.credit) || 0,
    }));
  }, [lines]);

  const validation = useMemo(
    () => validateJournalEntry(memo, reference, parsedLinesForValidation),
    [memo, reference, parsedLinesForValidation]
  );

  const handleLoadPreset = (preset: (typeof AGENTIC_PRESETS)[number]) => {
    setMemo(preset.memo);
    setReference(preset.reference);
    setSourceType('Agentic Auto-Draft');
    setLines(preset.lines.map((l, idx) => ({ ...l, id: `dl-${Date.now()}-${idx}` })));
    setAttachments([
      {
        id: `att-preset-${Date.now()}`,
        name: preset.defaultAttachment.name,
        sizeBytes: preset.defaultAttachment.sizeBytes,
        mimeType: preset.defaultAttachment.mimeType,
        uploadedAt: date,
      },
    ]);
    setAttemptedSubmit(false);
    setSubmitSuccessMsg(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const uploadedItems: JournalAttachment[] = Array.from(fileList).map((file, idx) => ({
      id: `att-${Date.now()}-${idx}`,
      name: file.name,
      sizeBytes: file.size || 124800,
      mimeType: file.type || 'application/octet-stream',
      uploadedAt: date,
      dataUrl: URL.createObjectURL(file),
    }));

    setAttachments((prev) => [...prev, ...uploadedItems]);
    setSubmitSuccessMsg(null);
    e.target.value = '';
  };

  const handleRemoveAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleDownloadAttachment = (entry: JournalEntry, att: JournalAttachment) => {
    if (att.dataUrl) {
      const anchor = document.createElement('a');
      anchor.href = att.dataUrl;
      anchor.download = att.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return;
    }

    if (att.name.endsWith('.csv')) {
      const csvText = `ENTRY_ID,DATE,REFERENCE,MEMO,ACCOUNT,DEBIT,CREDIT\r\n${entry.lines
        .map(
          (l) =>
            `${entry.id},${entry.date},${entry.reference},"${entry.memo}",${l.accountCode},${l.debit},${l.credit}`
        )
        .join('\r\n')}\r\n`;
      triggerBrowserDownload(att.name, csvText, 'text/csv;charset=utf-8;');
      return;
    }

    const voucherPdf = buildPdfBytes({
      title: `Supporting Voucher — ${att.name}`,
      subtitle: `Attached to Journal Entry ${entry.id} (${entry.date}) | Ref: ${entry.reference}`,
      metrics: [
        { label: 'Journal ID', value: entry.id },
        { label: 'Reference', value: entry.reference },
        { label: 'Document', value: att.name },
      ],
      sections: [
        {
          sectionTitle: `Voucher Backing Schedule (${entry.memo})`,
          headers: ['CODE', 'ACCOUNT NAME', 'DESCRIPTION', 'DEBIT', 'CREDIT'],
          columnWidths: [8, 28, 26, 12, 12],
          alignRight: [false, false, false, true, true],
          rows: entry.lines.map((l) => [
            l.accountCode,
            l.accountName,
            l.description,
            l.debit > 0 ? formatCurrency(l.debit) : '-',
            l.credit > 0 ? formatCurrency(l.credit) : '-',
          ]),
        },
      ],
    });
    triggerBrowserDownload(att.name, voucherPdf, 'application/pdf');
  };

  const handleLineChange = (id: string, field: keyof DraftLine, value: string) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        if (field === 'debit' && parseFloat(value) > 0) {
          return { ...line, debit: value, credit: '0' };
        }
        if (field === 'credit' && parseFloat(value) > 0) {
          return { ...line, credit: value, debit: '0' };
        }
        return { ...line, [field]: value };
      })
    );
    setSubmitSuccessMsg(null);
  };

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `dl-${Date.now()}-${prev.length + 1}`,
        accountCode: '2010',
        description: '',
        debit: '0',
        credit: '0',
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleAutoBalance = () => {
    if (Math.abs(validation.imbalance) < 0.01) return;
    const diff = validation.imbalance;
    setLines((prev) => [
      ...prev,
      {
        id: `dl-auto-${Date.now()}`,
        accountCode: diff > 0 ? '1010' : '6250',
        description: 'Balancing line',
        debit: diff < 0 ? String(Math.abs(diff)) : '0',
        credit: diff > 0 ? String(Math.abs(diff)) : '0',
      },
    ]);
  };

  const handlePostEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);

    if (!validation.isValid) return;

    const finalLines: JournalLine[] = lines
      .filter((l) => (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0)
      .map((l, idx) => {
        const acct = CHART_OF_ACCOUNTS.find((a) => a.code === l.accountCode);
        return {
          id: `L-${Date.now()}-${idx}`,
          accountCode: l.accountCode,
          accountName: acct ? acct.name : 'GL Account',
          description: l.description.trim() || memo.trim(),
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
        };
      });

    const nextNumber = 943 + entries.length;
    const newEntry: JournalEntry = {
      id: `JE-2026-0${nextNumber}`,
      date,
      reference: reference.trim(),
      memo: memo.trim(),
      source: sourceType,
      status: 'Posted',
      confidence: sourceType === 'Agentic Auto-Draft' ? 99.6 : 100,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      lines: finalLines,
    };

    let saved: JournalEntry;
    try { saved = await onAddEntry(newEntry); } catch { return; }
    setSubmitSuccessMsg(
      attachments.length > 0
        ? `Recorded ${saved.status.toLowerCase()} ${saved.id} (${attachments.length} file${attachments.length > 1 ? 's' : ''} attached)`
        : `Recorded ${saved.status.toLowerCase()} ${saved.id}`
    );
    setMemo('');
    setReference(`JE-${105 + entries.length}`);
    setAttachments([]);
    setAttemptedSubmit(false);
  };

  const effectiveQuery = (searchQuery.trim() || globalSearchQuery.trim()).toLowerCase();

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (sourceFilter !== 'ALL' && entry.source !== sourceFilter) return false;
      if (!effectiveQuery) return true;
      return (
        entry.id.toLowerCase().includes(effectiveQuery) ||
        entry.memo.toLowerCase().includes(effectiveQuery) ||
        entry.reference.toLowerCase().includes(effectiveQuery) ||
        entry.lines.some(
          (l) =>
            l.accountCode.toLowerCase().includes(effectiveQuery) ||
            l.accountName.toLowerCase().includes(effectiveQuery) ||
            l.description.toLowerCase().includes(effectiveQuery)
        ) ||
        (entry.attachments &&
          entry.attachments.some((a) => a.name.toLowerCase().includes(effectiveQuery)))
      );
    });
  }, [entries, effectiveQuery, sourceFilter]);

  return (
    <div className="space-y-8">
      {/* Double-Entry Creation Workbench */}
      <section aria-label="New Journal Entry" className="bg-white border border-zinc-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-zinc-100">
          <h2 className="text-base font-bold text-zinc-950">New Journal Entry</h2>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {AGENTIC_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleLoadPreset(preset)}
                  className="px-2.5 py-1 text-xs font-mono border border-zinc-200 bg-zinc-50 text-zinc-800 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <ExportActionsBar
              onGenerateExport={() => createJournalEntriesExportPayload(filteredEntries)}
            />
          </div>
        </div>

        <form onSubmit={handlePostEntry} className="mt-5 space-y-5" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-3">
              <label htmlFor="je-date" className="block text-[11px] font-mono text-zinc-400 mb-1">
                DATE
              </label>
              <input
                id="je-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </div>

            <div className="md:col-span-3">
              <label htmlFor="je-reference" className="block text-[11px] font-mono text-zinc-400 mb-1">
                REF
              </label>
              <input
                id="je-reference"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="INV-9012"
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </div>

            <div className="md:col-span-6">
              <label htmlFor="je-memo" className="block text-[11px] font-mono text-zinc-400 mb-1">
                MEMO
              </label>
              <input
                id="je-memo"
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Entry description..."
                className="w-full px-3 py-1.5 text-xs bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
              />
            </div>
          </div>

          {/* Lines Grid */}
          <div className="border border-zinc-200 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px] font-mono text-zinc-400">
                  <th className="py-2 pl-4 pr-3 w-10 font-normal">#</th>
                  <th className="py-2 px-3 w-72 font-normal">ACCOUNT</th>
                  <th className="py-2 px-3 font-normal">NOTE</th>
                  <th className="py-2 px-3 w-36 text-right font-normal">DEBIT</th>
                  <th className="py-2 px-3 w-36 text-right font-normal">CREDIT</th>
                  <th className="py-2 pl-3 pr-4 w-10 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {lines.map((line, index) => (
                  <tr key={line.id}>
                    <td className="py-2 pl-4 pr-3 font-mono text-zinc-400">
                      0{index + 1}
                    </td>
                    <td className="py-2 px-3">
                      <select
                        aria-label={`Line ${index + 1} Account`}
                        value={line.accountCode}
                        onChange={(e) => handleLineChange(line.id, 'accountCode', e.target.value)}
                        className="w-full px-2 py-1 text-xs font-mono bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
                      >
                        {CHART_OF_ACCOUNTS.map((acct) => (
                          <option key={acct.code} value={acct.code}>
                            {acct.code} · {acct.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        aria-label={`Line ${index + 1} Note`}
                        value={line.description}
                        onChange={(e) => handleLineChange(line.id, 'description', e.target.value)}
                        className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="0"
                        step="100"
                        aria-label={`Line ${index + 1} Debit`}
                        value={line.debit}
                        onChange={(e) => handleLineChange(line.id, 'debit', e.target.value)}
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums text-right bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="0"
                        step="100"
                        aria-label={`Line ${index + 1} Credit`}
                        value={line.credit}
                        onChange={(e) => handleLineChange(line.id, 'credit', e.target.value)}
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums text-right bg-white border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950"
                      />
                    </td>
                    <td className="py-2 pl-3 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(line.id)}
                        disabled={lines.length <= 2}
                        aria-label={`Remove line ${index + 1}`}
                        className="p-1 text-zinc-300 hover:text-zinc-950 disabled:opacity-20 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 border-t border-zinc-200 font-mono text-xs">
                  <td colSpan={3} className="py-2.5 pl-4 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Line</span>
                      </button>

                      {/* Hidden File Input + Upload Attachment Trigger */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.csv,.png,.jpg,.jpeg,.xlsx,.txt"
                        aria-label="Upload voucher attachment"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 cursor-pointer"
                      >
                        <Paperclip className="w-3 h-3" />
                        <span>
                          Attach File{attachments.length > 0 ? ` (${attachments.length})` : ''}
                        </span>
                      </button>

                      {Math.abs(validation.imbalance) >= 0.01 && (
                        <button
                          type="button"
                          onClick={handleAutoBalance}
                          className="px-2.5 py-1 text-xs font-mono bg-zinc-200 text-zinc-900 hover:bg-zinc-300 cursor-pointer"
                        >
                          Balance ({formatCurrency(Math.abs(validation.imbalance))})
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-zinc-950 tabular-nums">
                    {formatCurrency(validation.totalDebit)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-zinc-950 tabular-nums">
                    {formatCurrency(validation.totalCredit)}
                  </td>
                  <td className="py-2.5 pl-3 pr-4" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Attached Files Staging Strip (shown when files are attached during creation) */}
          {attachments.length > 0 && (
            <div
              aria-label="Staged Attachments"
              className="flex flex-wrap items-center gap-2 pt-1"
            >
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-mono bg-zinc-50 border border-zinc-200 text-zinc-900"
                >
                  <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="truncate max-w-[220px]">{att.name}</span>
                  <span className="text-[11px] text-zinc-400 tabular-nums">
                    {formatFileSize(att.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove attachment ${att.name}`}
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="text-zinc-400 hover:text-zinc-950 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="text-xs font-mono">
              {attemptedSubmit && !validation.isValid ? (
                <div role="alert" className="flex items-center gap-1.5 text-zinc-950">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{validation.errors[0]}</span>
                </div>
              ) : submitSuccessMsg ? (
                <div role="status" className="flex items-center gap-1.5 text-zinc-950">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{submitSuccessMsg}</span>
                </div>
              ) : (
                <span className="text-zinc-400 tabular-nums">
                  {Math.abs(validation.imbalance) < 0.01
                    ? 'Balanced'
                    : `Diff: ${formatCurrency(validation.imbalance, true)}`}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="px-4 py-2 text-xs font-mono font-semibold bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Post Entry
            </button>
          </div>
        </form>
      </section>

      {/* Ledger Register */}
      <section aria-label="Ledger Register" className="bg-white border border-zinc-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-100">
          <h3 className="text-base font-bold text-zinc-950">
            General Ledger ({filteredEntries.length})
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Search entries"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter..."
                className="pl-8 pr-3 py-1 text-xs font-mono bg-zinc-50 border border-zinc-200 text-zinc-950 focus:outline-none focus:border-zinc-950 w-44"
              />
            </div>

            <div className="flex items-center gap-0.5 p-0.5 bg-zinc-100 border border-zinc-200">
              {(['ALL', 'Agentic Auto-Draft', 'Manual Entry', 'System Accrual'] as const).map(
                (src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSourceFilter(src)}
                    className={`px-2 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                      sourceFilter === src
                        ? 'bg-zinc-950 text-white'
                        : 'text-zinc-500 hover:text-zinc-950'
                    }`}
                  >
                    {src === 'ALL'
                      ? 'All'
                      : src === 'Agentic Auto-Draft'
                      ? 'Agent'
                      : src === 'Manual Entry'
                      ? 'Manual'
                      : 'Accrual'}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        <div className="divide-y divide-zinc-100">
          {filteredEntries.map((entry) => {
            const total = entry.lines.reduce((s, l) => s + l.debit, 0);
            return (
              <div key={entry.id} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div className="flex flex-wrap items-baseline gap-3 min-w-0">
                    <span className="text-xs font-mono font-bold text-zinc-950 shrink-0">
                      {entry.id}
                    </span>
                    <span className="text-xs font-mono text-zinc-400 shrink-0">
                      {entry.date}
                    </span>
                    {entry.status !== 'Posted' && <button type="button" className="border border-zinc-300 px-2 py-1 text-xs text-zinc-950" onClick={() => onReviewEntry(entry.id)}>Review &amp; post</button>}
                    <span className="text-xs font-medium text-zinc-900 truncate">
                      {entry.memo}
                    </span>

                    {/* Attached Voucher Chips */}
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {entry.attachments.map((att) => (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => handleDownloadAttachment(entry, att)}
                            title={`Download ${att.name} (${formatFileSize(att.sizeBytes)})`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[180px]">{att.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-mono font-bold text-zinc-950 tabular-nums shrink-0">
                    {formatCurrency(total)}
                  </span>
                </div>

                <div className="mt-2.5 pl-4 border-l border-zinc-200 space-y-1">
                  {entry.lines.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center justify-between text-[11px] font-mono text-zinc-500"
                    >
                      <span>
                        {line.accountCode} · {line.accountName}
                      </span>
                      <span className="tabular-nums text-zinc-800">
                        {line.debit > 0
                          ? `DR ${formatCurrency(line.debit)}`
                          : `CR ${formatCurrency(line.credit)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
