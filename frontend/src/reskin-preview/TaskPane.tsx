import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, ChevronRight, FileText, Inbox, Scale, Search, ShieldCheck, X } from 'lucide-react'
import type { AgentTask } from '../monolith/components/OverviewModule'
import { filterQueue, taskCategory, taskDestination } from './queue'

type Props = {
  tasks: AgentTask[]; currency: string; open: boolean; modal: boolean;
  onClose: () => void; onNavigate: (task: AgentTask) => Promise<boolean>
}
export function TaskPane({ tasks, currency, open, modal, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const pendingCount = tasks.filter(task => !task.resolved).length
  const visible = filterQueue(tasks, query, filter)
  const amount = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const app = document.getElementById('root')!
    const strip = document.querySelector<HTMLElement>('.reskin-preview-strip')!
    const previousAppInert = app.inert
    const previousStripInert = strip.inert
    const previousOverflow = document.body.style.overflow
    if (modal) { app.inert = true; strip.inert = true; document.body.style.overflow = 'hidden'; closeButton.current?.focus() }
    const containFocus = (event: FocusEvent) => {
      if (modal && !panel.current?.contains(event.target as Node)) closeButton.current?.focus()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (modal || panel.current?.contains(event.target as Node))) { event.preventDefault(); onClose() }
      if (!modal || event.key !== 'Tab') return
      const controls = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')).filter(node => node.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key)
    document.addEventListener('focusin', containFocus)
    return () => {
      window.removeEventListener('keydown', key)
      document.removeEventListener('focusin', containFocus)
      if (modal) { app.inert = previousAppInert; strip.inert = previousStripInert; document.body.style.overflow = previousOverflow; before?.focus() }
    }
  }, [open, modal, onClose])
  async function choose(task: AgentTask) {
    setSelected(task.id)
    const opened = await onNavigate(task)
    setNotice(opened ? `已打开${taskDestination(task)}模块。此任务未提供单条记录链接，尚未执行任何处理。` : '未找到对应页面入口，请使用现有左侧导航。')
  }
  return <>
    {open && modal && <button className="reskin-task-backdrop" tabIndex={-1} aria-label="关闭待办抽屉" onClick={onClose} />}
    <aside ref={panel} id="reskin-task-pane" className="reskin-task-pane" hidden={!open} role={modal ? 'dialog' : 'complementary'} aria-modal={modal ? true : undefined} aria-labelledby="reskin-task-heading">
      <header className="reskin-task-header"><div><h2 id="reskin-task-heading">待你处理 <span>{pendingCount}</span></h2><p>把注意力留给需要判断的事。</p></div><button ref={closeButton} className="reskin-pane-icon" aria-label="收起待办栏" onClick={onClose}><X size={16} /></button></header>
      <div className="reskin-task-context"><span>2026 年 10 月</span><span>{currency} · 现有 Agent Queue</span></div>
      <div className="reskin-task-search"><Search size={15} /><input aria-label="搜索右侧待办" placeholder="搜索待办、编号…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="reskin-pane-icon" aria-label="清除待办搜索" onClick={() => setQuery('')}><X size={13} /></button>}</div>
      <div className="reskin-task-filters" aria-label="待办状态筛选"><button aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>待处理 <span>{pendingCount}</span></button><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部 <span>{tasks.length}</span></button></div>
      <div className="reskin-task-list" aria-label="任务列表">{visible.map(task => {
        const Icon = task.targetTab === 'journal' ? FileText : task.targetTab === 'reconciliation' ? ArrowLeftRight : Scale
        return <button key={task.id} className={`reskin-task-item ${selected === task.id ? 'selected' : ''}`} aria-pressed={selected === task.id} onClick={() => { void choose(task) }}>
          <span className="reskin-task-item-top"><Icon size={17} /><span>{taskCategory(task)}</span><ChevronRight size={14} /></span>
          <strong>{task.title}</strong>
          <span className="reskin-task-code">{task.code} · {task.id}</span>
          <span className="reskin-task-item-bottom"><span>{task.resolved ? '示例已处理' : '待人工判断'}</span><span>{amount(task.impactAmount)}</span></span>
        </button>
      })}{visible.length === 0 && <div className="reskin-task-empty"><Inbox size={25} /><p>{query ? '没有匹配的待办' : '没有待处理事项'}</p><button onClick={() => { setQuery(''); setFilter('all') }}>查看全部</button></div>}</div>
      {notice && <p className="reskin-task-notice" role="status">{notice}</p>}
      <footer className="reskin-task-footer"><ShieldCheck size={18} /><p>现有示例待办，只读展示。<span>点选仅打开对应业务模块，不会核准、过账或改变待办状态。</span></p></footer>
    </aside>
  </>
}
