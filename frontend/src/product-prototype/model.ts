// Independent synthetic fixtures. Integer fen; no production API or legacy prototype imports.
export type DocumentStatus = 'review' | 'missing' | 'returned' | 'posted'
export type Document = {
  id: string; vendor: string; title: string; date: string; amount: number;
  account: string; accountName: string; source: string; status: DocumentStatus;
  reason: string; note: string
}
export type Line = { code: string; name: string; debit: number; credit: number }
export type Entry = { id: string; date: string; summary: string; documentId?: string; lines: Line[] }
export type Event = { id: number; action: string; subject: string; time: string }
export type DemoState = { documents: Document[]; entries: Entry[]; matched: string[]; agentPaused: boolean; agentFailure: boolean; locked: boolean; events: Event[] }
export const initialState = (): DemoState => ({
  documents: [
    { id: 'DOC-1028', vendor: '云栈科技', title: '工作站采购', date: '2026-10-18', amount: 1280000, account: '1601', accountName: '固定资产', source: '采购发票_1028.pdf', status: 'review', reason: '设备预计使用超过一年，请确认是否确认为固定资产。', note: '' },
    { id: 'DOC-1027', vendor: '协作云', title: '10 月软件订阅', date: '2026-10-17', amount: 68000, account: '6602', accountName: '管理费用', source: '订阅账单_1027.pdf', status: 'review', reason: '费用属于本月，请核对订阅期间与会计科目。', note: '' },
    { id: 'DOC-1026', vendor: '青禾印务', title: '项目印刷服务', date: '2026-10-16', amount: 320000, account: '6602', accountName: '管理费用', source: '待补充原始单据', status: 'missing', reason: '仅收到付款说明，缺少原始单据，不能核准。', note: '' },
  ],
  entries: [
    { id: 'JE-1001', date: '2026-10-01', summary: '期初投入资金', lines: [{ code: '1002', name: '银行存款', debit: 10000000, credit: 0 }, { code: '4001', name: '实收资本', debit: 0, credit: 10000000 }] },
    { id: 'JE-1002', date: '2026-10-12', summary: '山序品牌 · 设计服务收入', lines: [{ code: '1002', name: '银行存款', debit: 1860000, credit: 0 }, { code: '6001', name: '主营业务收入', debit: 0, credit: 1860000 }] },
    { id: 'JE-1003', date: '2026-10-15', summary: '十月工作室租金', lines: [{ code: '6602', name: '管理费用', debit: 480000, credit: 0 }, { code: '1002', name: '银行存款', debit: 0, credit: 480000 }] },
  ],
  matched: [], agentPaused: false, agentFailure: true, locked: false, events: [],
})
export const bankTransactions = [
  { id: 'BK-031', date: '2026-10-12', name: '山序品牌', description: '设计服务尾款', amount: 1860000, entryId: 'JE-1002', reference: '收款回单 031' },
  { id: 'BK-032', date: '2026-10-15', name: '方寸空间', description: '10 月租金', amount: -480000, entryId: 'JE-1003', reference: '付款回单 032' },
]
export const documentLines = (doc: Document): Line[] => [
  { code: doc.account, name: doc.accountName, debit: doc.amount, credit: 0 },
  { code: '2202', name: '应付账款', debit: 0, credit: doc.amount },
]
export const isBalanced = (lines: Line[]) => lines.length >= 2 && lines.every(l => Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit) && l.debit >= 0 && l.credit >= 0) && lines.reduce((sum, l) => sum + l.debit - l.credit, 0) === 0
export const unresolvedDocuments = (s: DemoState) => s.documents.filter(d => d.status !== 'posted')
export const closeBlockers = (s: DemoState) => unresolvedDocuments(s).length + bankTransactions.filter(b => !s.matched.includes(b.id)).length + (s.agentFailure ? 1 : 0)
export function trialBalance(s: DemoState) {
  const rows = new Map<string, { code: string; name: string; debit: number; credit: number }>()
  for (const e of s.entries) for (const l of e.lines) { const row = rows.get(l.code) ?? { code: l.code, name: l.name, debit: 0, credit: 0 }; row.debit += l.debit; row.credit += l.credit; rows.set(l.code, row) }
  return Array.from(rows.values()).sort((a, b) => a.code.localeCompare(b.code)).map(r => ({ ...r, balance: r.debit - r.credit }))
}
export function approve(s: DemoState, id: string, acknowledged: boolean): DemoState {
  const doc = s.documents.find(d => d.id === id)
  if (s.locked || !acknowledged || doc?.status !== 'review' || !isBalanced(documentLines(doc))) return s
  return { ...s, documents: s.documents.map(d => d.id === id ? { ...d, status: 'posted' } : d), entries: [...s.entries, { id: `JE-${id.slice(4)}`, date: doc.date, summary: `${doc.vendor} · ${doc.title}`, documentId: doc.id, lines: documentLines(doc) }] }
}
export function returnDocument(s: DemoState, id: string, note: string): DemoState {
  if (s.locked || !note.trim()) return s
  return { ...s, documents: s.documents.map(d => d.id === id && d.status === 'review' ? { ...d, status: 'returned', note: note.trim() } : d) }
}
export function supplement(s: DemoState, id: string): DemoState {
  if (s.locked) return s
  return { ...s, documents: s.documents.map(d => d.id === id && ['missing', 'returned'].includes(d.status) ? { ...d, status: 'review', source: `示例补件_${id}.pdf`, reason: '示例补件已收到，原件未经真实性查验，请人工覆核。', note: '' } : d) }
}
export function matchBank(s: DemoState, id: string): DemoState {
  if (s.locked || !bankTransactions.some(b => b.id === id) || s.matched.includes(id)) return s
  return { ...s, matched: [...s.matched, id] }
}
export function lockPeriod(s: DemoState, acknowledged: boolean): DemoState {
  return acknowledged && !s.locked && closeBlockers(s) === 0 ? { ...s, locked: true } : s
}
export function profit(s: DemoState) {
  const rows = trialBalance(s)
  const income = -(rows.find(r => r.code === '6001')?.balance ?? 0)
  const expenses = rows.find(r => r.code === '6602')?.balance ?? 0
  return { income, expenses, net: income - expenses }
}
