import { useCallback, useEffect, useState } from 'react'
import { PanelRight } from 'lucide-react'
import type { AgentTask } from '../monolith/components/OverviewModule'
import { TaskPane } from './TaskPane'
import { navigateExistingTask } from './queue'
import { createRoot } from 'react-dom/client'
import App from '../monolith/App'
import { createPreviewFetch, createPreviewStore } from './adapter'
import { createFixture, previewPrincipal } from './fixtures'
import '../monolith/index.css'
import './skin.css'

const store = createPreviewStore(createFixture(location.search))
window.fetch = createPreviewFetch(store)
document.documentElement.dataset.preview = 'reskin'

const taskWorkspace = store.snapshot()
const dockQuery = '(min-width: 1600px)'
function PreviewControls() {
  const [skin, setSkin] = useState<'reader' | 'original'>('reader')
  const [docked, setDocked] = useState(() => window.matchMedia(dockQuery).matches)
  const [queueOpen, setQueueOpen] = useState(() => window.matchMedia(dockQuery).matches)
  const visible = skin === 'reader' && queueOpen
  const pendingCount = taskWorkspace.agentTasks.filter(task => !task.resolved).length
  const closeQueue = useCallback(() => { setQueueOpen(false); requestAnimationFrame(() => document.getElementById('reskin-queue-toggle')?.focus()) }, [])
  useEffect(() => {
    const media = window.matchMedia(dockQuery)
    const change = () => { setDocked(media.matches); if (!media.matches) setQueueOpen(false) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => { document.documentElement.dataset.queue = visible ? 'open' : 'closed' }, [visible])
  function select(next: 'reader' | 'original') { document.documentElement.dataset.skin = next; setSkin(next) }
  async function navigate(task: AgentTask): Promise<boolean> {
    if (!docked) closeQueue()
    return new Promise(resolve => requestAnimationFrame(() => resolve(navigateExistingTask(task))))
  }
  return <><div className="reskin-preview-strip" role="region" aria-label="独立换肤预览控制">
    <span className="reskin-preview-label">现有前端 · 独立换肤预览</span>
    <div className="reskin-comparison" aria-label="对比原样与换肤"><button aria-pressed={skin === 'original'} onClick={() => select('original')}>原样</button><button aria-pressed={skin === 'reader'} onClick={() => select('reader')}>换肤</button></div>
    <button id="reskin-queue-toggle" className="reskin-queue-toggle" disabled={skin === 'original'} aria-controls="reskin-task-pane" aria-expanded={visible} onClick={() => setQueueOpen(!queueOpen)}><PanelRight size={14} />待办 <span>{pendingCount}</span></button>
    <span className="reskin-preview-limits">只读示例 · 仅外观设置生效 · Light / Dark 在 Settings 中切换</span>
  </div><TaskPane tasks={taskWorkspace.agentTasks} currency={taskWorkspace.currency} open={visible} modal={!docked} onClose={closeQueue} onNavigate={navigate} /></>
}
createRoot(document.getElementById('preview-controls')!).render(<PreviewControls />)
createRoot(document.getElementById('root')!).render(<App principal={previewPrincipal} showTaskPane={false} onSignOut={async () => { window.alert('独立预览没有登录正式账户，无需退出。刷新页面可重置本次外观设置。') }} />)
