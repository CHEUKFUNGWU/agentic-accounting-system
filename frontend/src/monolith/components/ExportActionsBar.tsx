import React, { useState } from 'react';
import { Download, FileDown, Check } from 'lucide-react';
import { triggerBrowserDownload } from '../utils/exportUtils';

interface ExportActionsBarProps {
  onGenerateExport: () => {
    filenameBase: string;
    csv: string;
    pdf: Uint8Array;
  };
}

export const ExportActionsBar: React.FC<ExportActionsBarProps> = ({
  onGenerateExport,
}) => {
  const [recentAction, setRecentAction] = useState<'csv' | 'pdf' | null>(null);

  const handleExportCsv = () => {
    const payload = onGenerateExport();
    triggerBrowserDownload(
      `${payload.filenameBase}.csv`,
      payload.csv,
      'text/csv;charset=utf-8;'
    );
    setRecentAction('csv');
    setTimeout(() => setRecentAction(null), 1800);
  };

  const handleDownloadPdf = () => {
    const payload = onGenerateExport();
    triggerBrowserDownload(
      `${payload.filenameBase}.pdf`,
      payload.pdf,
      'application/pdf'
    );
    setRecentAction('pdf');
    setTimeout(() => setRecentAction(null), 1800);
  };

  return (
    <div
      role="group"
      aria-label="Offline Export Actions"
      className="flex items-center gap-1.5"
    >
      <button
        type="button"
        onClick={handleExportCsv}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors cursor-pointer whitespace-nowrap"
      >
        {recentAction === 'csv' ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        <span>Export CSV</span>
      </button>

      <button
        type="button"
        onClick={handleDownloadPdf}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
      >
        {recentAction === 'pdf' ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <FileDown className="w-3.5 h-3.5" />
        )}
        <span>Download PDF</span>
      </button>
    </div>
  );
};
