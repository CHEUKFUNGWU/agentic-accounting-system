export type Language = 'zh' | 'en'
export type Page = 'home' | 'review' | 'journals' | 'close' | 'reports' | 'agents'
export type ReviewStatus = 'pending' | 'approved' | 'returned'
export type Item = {
  id: string
  vendor: string
  initials: string
  description: [string, string]
  amount: number
  date: string
  kind: 'split' | 'duplicate' | 'ready' | 'asset'
  account: [string, string]
  code: string
  file: string
}
export const ITEMS: Item[] = [
  {id:'INV-1042',vendor:'Telstra',initials:'T',description:['網絡及行動通訊費用','Internet & mobile plan'],amount:13200,date:'2026-10-15',kind:'split',account:['通訊費用','Telecommunications'],code:'6200',file:'telstra_oct_2026.pdf'},
  {id:'INV-1041',vendor:'Studio North',initials:'SN',description:['品牌設計服務','Brand design services'],amount:660000,date:'2026-10-15',kind:'duplicate',account:['專業服務費用','Professional services'],code:'6300',file:'studio_north_086.pdf'},
  {id:'INV-1040',vendor:'Figma',initials:'F',description:['設計軟體訂閱','Design software subscription'],amount:52800,date:'2026-10-14',kind:'ready',account:['軟體訂閱','Software subscriptions'],code:'6100',file:'figma_oct_2026.pdf'},
  {id:'INV-1039',vendor:'Dell Australia',initials:'D',description:['工作室電腦設備','Studio computer equipment'],amount:242000,date:'2026-10-14',kind:'asset',account:['電腦設備','Computer equipment'],code:'1500',file:'dell_invoice_391.pdf'},
]
export type EntryLine = {code:string; label:[string,string]; debit:number; credit:number}
// Prototype amounts are integer cents. Tax allocation is illustrative, not a tax engine.
export function entryLines(item: Item, businessPercent = 80): EntryLine[] {
  const grossBusiness = item.kind === 'split' ? Math.round(item.amount * businessPercent / 100) : item.amount
  const tax = Math.round(grossBusiness / 11)
  const lines: EntryLine[] = [
    {code:item.code,label:item.account,debit:grossBusiness-tax,credit:0},
    {code:'1300',label:['進項 GST','GST receivable'],debit:tax,credit:0},
  ]
  if(item.kind === 'split' && grossBusiness < item.amount) lines.push({code:'2190',label:['董事往來','Director loan'],debit:item.amount-grossBusiness,credit:0})
  lines.push({code:'2100',label:['應付帳款','Accounts payable'],debit:0,credit:item.amount})
  return lines
}
export function mayApprove(item:Item, acknowledged:boolean) {
  return item.kind !== 'duplicate' && (item.kind === 'ready' || acknowledged)
}
export type Audit = {id:string; subject:string; action:'approved'|'returned'|'close'|'reconcile'; time:string; note?:string}
export type DemoState = {statuses:Partial<Record<string,ReviewStatus>>; allocations:Record<string,number>; audit:Audit[]; bankDone:boolean; locked:boolean}
export const initialState = (): DemoState => ({statuses:{},allocations:{'INV-1042':80},audit:[],bankDone:false,locked:false})
export function readDemoState():DemoState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('aas-review-prototype-v1') || 'null')
    if (!parsed || typeof parsed !== 'object') return initialState()
    const p = parsed as Partial<DemoState>
    if (!p.statuses || !p.allocations || !Array.isArray(p.audit) || typeof p.bankDone !== 'boolean' || typeof p.locked !== 'boolean') return initialState()
    const validStatuses = Object.entries(p.statuses).every(([id,status])=>ITEMS.some(i=>i.id===id)&&['pending','approved','returned'].includes(status as string))
    const validAllocations = Object.values(p.allocations).every(v=>Number.isFinite(v)&&v>=0&&v<=100)
    const validAudit = p.audit.every(a=>a && typeof a.subject==='string' && typeof a.time==='string' && ['approved','returned','close','reconcile'].includes(a.action))
    return validStatuses&&validAllocations&&validAudit ? p as DemoState : initialState()
  } catch { return initialState() }
}
export function pendingItems(state:DemoState) {return ITEMS.filter(i=>!state.statuses[i.id]||state.statuses[i.id]==='pending')}
export function canClose(state:DemoState) { return pendingItems(state).length===0 && state.bankDone && !state.locked }
