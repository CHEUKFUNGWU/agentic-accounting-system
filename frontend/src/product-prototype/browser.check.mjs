// Standalone QA against an isolated, locally launched Chrome CDP endpoint.
// Does not connect to the user's browser profile or any accounting API.
import { writeFile, mkdir } from 'node:fs/promises'
import { once } from 'node:events'
const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9235'
const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:5173/product-prototype.html'
const captures = process.env.CAPTURE_DIR || '/tmp/aas-product-capture'
await mkdir(captures, { recursive: true })
const target = (await (await fetch(`${endpoint}/json/list`)).json()).find(p => p.type === 'page')
if (!target) throw new Error('Launch an isolated QA Chrome page before running this script.')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await once(ws, 'open')
let id = 0
const callbacks = new Map()
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data))
  const pending = callbacks.get(message.id)
  if (!pending) return
  clearTimeout(pending.timer); callbacks.delete(message.id)
  if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result)
})
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const next = ++id
    const timer = setTimeout(() => { callbacks.delete(next); reject(new Error(`Timed out: ${method}`)) }, 20000)
    callbacks.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params }))
  })
}
async function run(fn, ...args) {
  const expression = `(${fn.toString()})(...${JSON.stringify(args)})`
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
async function settle() { await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function click(selector) {
  await run(selector => { const buttons = document.querySelectorAll(selector); if (buttons.length !== 1) throw Error(`Expected one ${selector}, found ${buttons.length}`); const b = buttons[0]; if (b.disabled) throw Error(`Disabled control ${selector}`); b.click() }, selector)
  await settle()
}
async function text(value) {
  await run(value => { const buttons = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === value); if (buttons.length !== 1) throw Error(`Expected one button ${value}, found ${buttons.length}`); if (buttons[0].disabled) throw Error(`Disabled ${value}`); buttons[0].click() }, value)
  await settle()
}
async function fill(selector, value) {
  await run((selector, value) => { const e = document.querySelector(selector); const prototype = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(e, value); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) }, selector, value)
  await settle()
}
async function shot(name) {
  await settle()
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(`${captures}/${name}.png`, Buffer.from(result.data, 'base64'))
}
const checks = []
async function check(name, fn) { if (!(await run(fn))) throw new Error(name); checks.push(name) }
async function go(page) { await click(`button[data-page="${page}"]`) }
try {
  await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url: base })
  for (let n = 0; n < 100; n++) { if (await run(() => !!document.querySelector('.tasks-table'))) break; await new Promise(r => setTimeout(r, 50)) }
  await run(async () => { await document.fonts.ready })
  await text('浅色')
  await check('Seven product navigation entries, not the old prototype', () => document.querySelectorAll('button[data-page]').length === 7)
  await check('Light theme is applied', () => document.documentElement.dataset.theme === 'light' && getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() === '#f8f9f7')
  await shot('desktop-light')
  await text('深色')
  await check('Dark theme is applied', () => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() === '#171819')
  await shot('desktop-dark')
  await text('工作站采购')
  await check('Three-column evidence / entry / control review exists', () => !!document.querySelector('.evidence-pane') && !!document.querySelector('.journal-pane') && !!document.querySelector('.controls-pane'))
  await check('Approval requires acknowledgement', () => document.querySelector('.review-actions .primary-button').disabled)
  await shot('review-dark')
  await click('.checkbox-label input')
  await text('模拟核准并过账')
  await check('Approval creates traceable journal link', () => document.querySelector('.review-actions').textContent.includes('本会话已模拟过账'))
  await text('浅色')
  await check('Theme switching preserves review result', () => document.querySelector('.status-posted')?.textContent === '已模拟过账')
  await text('查看分录')
  await check('Journal traces approved source', () => document.querySelector('.entry-detail').textContent.includes('JE-1028'))
  await text('原始单据')
  await check('Source trace returns to correct document', () => document.querySelector('.breadcrumb').textContent.includes('DOC-1028'))
  await go('documents')
  await run(() => [...document.querySelectorAll('.row-title')].find(x => x.textContent === '协作云').click()); await settle()
  await click('.checkbox-label input')
  await check('Return regression starts from acknowledged proposal', () => document.querySelector('.checkbox-label input').checked)
  await text('退回补件')
  await check('Return requires a nonempty reason', () => document.querySelector('.return-editor .primary-button').disabled)
  await fill('#return-reason', '请补充订阅期间说明')
  await text('确认退回')
  await check('Return retains reason', () => document.querySelector('.return-note').textContent.includes('请补充订阅期间说明'))
  await text('模拟补齐并重新提交')
  await check('Resubmission invalidates prior acknowledgement', () => !document.querySelector('.checkbox-label input').checked && document.querySelector('.review-actions .primary-button').disabled)
  await click('.checkbox-label input'); await text('模拟核准并过账')
  await go('documents')
  await run(() => [...document.querySelectorAll('.row-title')].find(x => x.textContent === '青禾印务').click()); await settle()
  await check('Missing evidence blocks approval', () => ![...document.querySelectorAll('button')].some(b => b.textContent === '模拟核准并过账'))
  await text('模拟补齐并重新提交'); await click('.checkbox-label input'); await text('模拟核准并过账')
  await go('books'); await text('财务报表')
  await check('Report recomputes after approvals', () => document.querySelector('.report-total').textContent.includes('9,920.00'))
  await run(() => document.querySelectorAll('.report-value')[1].click()); await settle()
  await check('Report amount drills into account ledger', () => document.querySelector('select').value === '6602' && document.querySelector('tbody').textContent.includes('青禾印务'))
  await go('close')
  await check('Unresolved checks block signoff', () => document.querySelector('.close-banner .primary-button').disabled)
  await go('bank'); await shot('bank-light')
  const entryCount = await run(() => document.querySelectorAll('.bank-transaction').length)
  if (entryCount !== 2) throw Error('Bank fixture count')
  await text('匹配已有记录')
  await click('.bank-transaction:nth-of-type(2)'); await text('匹配已有记录')
  await check('All bank transactions marked matched', () => document.querySelectorAll('.bank-transaction small').length === 4 && document.querySelector('.bank-book .primary-button').disabled)
  await go('agents'); await text('模拟停用 Agent')
  await check('Agent pause state updates', () => document.querySelector('.agent-identity .status').textContent === '已模拟停用')
  await text('执行记录'); await text('检查后关闭异常')
  await check('Failed run closure does not imply posting', () => document.querySelector('.run-heading .status').textContent === '异常已关闭')
  await go('close'); await text('预览签核')
  await check('Signoff needs explicit snapshot acknowledgement', () => document.querySelector('.signoff-preview > .primary-button').disabled)
  await click('.checkbox-label input'); await text('模拟签核并锁定')
  await check('Period lock reflected in context', () => document.querySelector('.lock-state').textContent === '已锁定' && document.querySelector('.close-banner .primary-button').disabled)
  await go('agents'); await text('审计记录')
  await check('Session audit includes all actions', () => document.querySelectorAll('.audit-list > div').length >= 10)
  await go('settings'); await click('.theme-option:nth-child(2)')
  await check('Settings theme control stays synchronized', () => document.documentElement.dataset.theme === 'dark' && document.querySelector('.theme-selector button[aria-pressed="true"]').textContent === '深色')
  await shot('settings-dark')
  await cdp('Page.reload')
  for (let n = 0; n < 100; n++) { if (await run(() => !!document.querySelector('.tasks-table'))) break; await new Promise(r => setTimeout(r, 50)) }
  await check('Theme persists but simulated transactions reset', () => document.documentElement.dataset.theme === 'dark' && document.querySelector('.home-context').textContent.includes('6 项'))
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await settle()
  await check('Mobile page fits viewport', () => document.documentElement.scrollWidth === 390)
  await shot('mobile-dark')
  await click('.header-theme'); await shot('mobile-light')
  await click('.mobile-menu')
  await check('Mobile navigation protects background focus', () => document.querySelector('.product-workspace').inert && document.activeElement.classList.contains('nav-close'))
  await run(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle()
  await check('Escape dismisses navigation', () => !document.querySelector('.product-workspace').inert)
  await click('.mobile-menu'); await go('documents')
  await run(() => [...document.querySelectorAll('.row-title')].find(x => x.textContent === '云栈科技').click()); await settle()
  await check('Mobile review fits viewport', () => document.documentElement.scrollWidth === 390)
  await shot('mobile-review-light')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await go('home'); await text('浅色')
  const result = { passed: checks.length, checks, captures, note: 'Isolated local Chrome CDP fallback after Ego screenshot requests timed out.' }
  await writeFile(`${captures}/checks.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { ws.close() }
