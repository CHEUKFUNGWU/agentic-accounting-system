import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, ChevronRight, FileText, Inbox, Scale, Search, ShieldCheck, X } from 'lucide-react';
import type { AgentTask } from './OverviewModule';
import { getTranslations, type AppLanguage } from '../utils/preferences';
import { filterTasks, pendingTaskCount, queueCategory, queueCopy, queuePeriod } from '../utils/taskQueue';

type Props = {
  tasks: AgentTask[]; currency: string; period: string; entityName: string;
  language: AppLanguage; open: boolean; modal: boolean;
  onClose: () => void; onNavigate: (task: AgentTask) => void;
};
export function TaskQueuePane({ tasks, currency, period, entityName, language, open, modal, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const text = queueCopy(language);
  const visible = filterTasks(tasks, query, filter, language);
  const selectedTask = tasks.find(task => task.id === selected);
  const notice = selectedTask ? text.opened.replace('{module}', getTranslations(language).nav[selectedTask.targetTab]) : '';
  const amount = (value: number) => {
    try { return new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : language, { style:'currency', currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format(value); }
    catch { return `${currency} ${value.toFixed(2)}`; }
  };
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const app = document.getElementById('root')!;
    const previousInert = app.inert;
    const previousOverflow = document.body.style.overflow;
    if (modal) { app.inert = true; document.body.style.overflow = 'hidden'; closeButton.current?.focus(); }
    const containFocus = (event: FocusEvent) => {
      if (modal && !panel.current?.contains(event.target as Node)) closeButton.current?.focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (modal || panel.current?.contains(event.target as Node))) { event.preventDefault(); onClose(); }
      if (!modal || event.key !== 'Tab') return;
      const controls = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')).filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key);
    document.addEventListener('focusin', containFocus);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('focusin', containFocus);
      if (modal) { app.inert = previousInert; document.body.style.overflow = previousOverflow; before?.focus(); }
    };
  }, [open, modal, onClose]);
  return createPortal(<>
    {open && modal && <button className="task-queue-backdrop" tabIndex={-1} aria-label={text.backdrop} onClick={onClose} />}
    <aside ref={panel} id="monolith-task-pane" className="task-queue-pane" hidden={!open} role={modal ? 'dialog' : 'complementary'} aria-modal={modal ? true : undefined} aria-labelledby="monolith-task-heading">
      <header className="task-queue-header"><div><h2 id="monolith-task-heading">{text.title} <span>{pendingTaskCount(tasks)}</span></h2><p>{text.subtitle}</p></div><button ref={closeButton} className="task-queue-icon" aria-label={text.close} onClick={onClose}><X size={16} /></button></header>
      <div className="task-queue-context"><span>{queuePeriod(period, language)}</span><span>{currency} · {text.source}</span></div>
      <p className="task-queue-entity">{entityName}</p>
      <div className="task-queue-search"><Search size={15} /><input aria-label={text.search} placeholder={text.placeholder} value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="task-queue-icon" aria-label={text.clear} onClick={() => setQuery('')}><X size={13} /></button>}</div>
      <div className="task-queue-filters" aria-label={text.filters}><button aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>{text.pending} <span>{pendingTaskCount(tasks)}</span></button><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{text.all} <span>{tasks.length}</span></button></div>
      <div className="task-queue-list" aria-label={text.list}>{visible.map(task => {
        const Icon = task.targetTab === 'journal' ? FileText : task.targetTab === 'reconciliation' ? ArrowLeftRight : Scale;
        return <button key={task.id} className={`task-queue-item ${selected === task.id ? 'selected' : ''}`} aria-pressed={selected === task.id} onClick={() => { setSelected(task.id); onNavigate(task); }}>
          <span className="task-queue-item-top"><Icon size={17} /><span>{queueCategory(task, language)}</span><ChevronRight size={14} /></span>
          <strong>{task.title}</strong><span className="task-queue-code">{task.code} · {task.id}</span>
          <span className="task-queue-item-bottom"><span>{task.resolved ? text.done : text.review}</span><span>{amount(task.impactAmount)}</span></span>
        </button>;
      })}{visible.length === 0 && <div className="task-queue-empty"><Inbox size={25} /><p>{query ? text.noMatches : text.empty}</p><button onClick={() => { setQuery(''); setFilter('all'); }}>{text.showAll}</button></div>}</div>
      {notice && <p className="task-queue-notice" role="status">{notice}</p>}
      <footer className="task-queue-footer"><ShieldCheck size={18} /><p>{text.footer}<span>{text.footnote}</span></p></footer>
    </aside>
  </>, document.body);
}
