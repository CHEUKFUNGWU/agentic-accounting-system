import rawSeed from './seed.json?raw'
import type { Workspace } from '../monolith/api'
import type { Principal } from '../monolith/auth'

export function createFixture(search = ''): Workspace {
  const seed = JSON.parse(rawSeed) as Workspace
  const params = new URLSearchParams(search)
  seed.revision = 0
  seed.workspaceId = 'read-only-reskin-preview'
  seed.dataOrigin = 'READ-ONLY SKIN PREVIEW · supplied synthetic examples · no backend'
  seed.accounts.push(
    { code: '1590', name: 'Accumulated depreciation', category: 'Asset', normalBalance: 'credit', openingBalance: 0 },
    { code: '6900', name: 'Depreciation expense', category: 'Expense', normalBalance: 'debit', openingBalance: 0 },
  )
  seed.preferences.theme = params.get('theme') === 'light' ? 'light' : 'dark'
  const lang = params.get('lang')
  if (lang === 'en' || lang === 'zh' || lang === 'es' || lang === 'ja') seed.preferences.language = lang
  return seed
}

// Expose the real editors for visual inspection. The adapter independently denies every business write.
export const previewPrincipal: Principal = {
  principalKey: 'reskin-preview-only', displayName: 'Visual preview · no live account',
  positionId: 'preview', positionTitle: 'Read-only examples. Settings work locally.',
  isHuman: true, canPrepare: true, canReview: true, isAdmin: false, canReadWorkspace: true,
  commands: [
    'preferences.update', 'journal.create', 'journal.review', 'invoice.create', 'invoice.collect',
    'bill.create', 'bill.approve', 'bill.pay', 'bank.reconcile', 'bank.batch', 'bank.exception',
    'tax.update', 'tax.provision', 'asset.register', 'asset.depreciate', 'close.checklist',
    'close.amortize', 'agent.resolve', 'budget.save', 'forecast.save',
  ],
}
