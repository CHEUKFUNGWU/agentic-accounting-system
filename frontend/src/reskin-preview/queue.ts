import type { AgentTask } from '../monolith/components/OverviewModule'
import { getTranslations, type AppLanguage } from '../monolith/utils/preferences.ts'

const categories: Record<AgentTask['category'], string> = {
  'Revenue Recognition': '收入确认', 'Bank Reconciliation': '银行核对',
  'Tax Nexus': '税务判断', 'Accrual Drift': '应计差异',
}
export const taskCategory = (task: AgentTask) => categories[task.category]
export const taskDestination = (task: AgentTask) => ({ journal: '会计分录', reconciliation: '银行对账', tax: '税务申报' })[task.targetTab]
export function filterQueue(tasks: AgentTask[], query: string, filter: 'pending' | 'all') {
  const term = query.normalize('NFKC').trim().toLowerCase()
  return tasks.filter(task => (filter === 'all' || !task.resolved) && `${task.title} ${task.code} ${task.id} ${task.category} ${taskCategory(task)}`.normalize('NFKC').toLowerCase().includes(term))
}

// Preview-only bridge. Activate the real App's existing nav button; do not recreate routing.
// Tasks only contain a destination module, so this does NOT claim a record-level deep link.
export function navigateExistingTask(task: AgentTask, doc: Document = document): boolean {
  const language = doc.documentElement.lang
  const validLanguage: AppLanguage = ['en', 'zh', 'es', 'ja'].includes(language) ? language as AppLanguage : 'en'
  const label = getTranslations(validLanguage).nav[task.targetTab]
  const buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>('nav[aria-label="Primary Accounting Modules"] button, [aria-label="Mobile Module Switcher"] button'))
  const target = buttons.find(button => button.textContent?.trim() === label && button.getClientRects().length > 0)
  if (!target) return false
  target.click()
  return true
}
