// Authenticated UI regression against a DISPOSABLE backend and isolated Chrome profile.
// Credentials are read from an operator-created temp file, never embedded or printed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
const base = process.env.UI_QA_URL || 'http://127.0.0.1:5180/';
const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9240';
const directory = process.env.CAPTURE_DIR;
if (!process.env.QA_CREDENTIALS || !directory) throw Error('Set QA_CREDENTIALS and CAPTURE_DIR for an isolated test environment.');
if (new URL(base).hostname !== '127.0.0.1' || new URL(base).port !== '5180') throw Error('This write-capable regression is restricted to the documented disposable localhost:5180 harness.');
const credentials = JSON.parse(await readFile(process.env.QA_CREDENTIALS, 'utf8'));
await mkdir(directory, { recursive:true });
const target = (await (await fetch(`${endpoint}/json/list`)).json()).find(item => item.type === 'page');
if (!target) throw Error('Launch a dedicated QA Chrome page first.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await once(socket, 'open');
let sequence = 0;
const waiting = new Map();
const requests = [];
const errors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data));
  if (message.method === 'Network.requestWillBeSent') {
    const request = message.params.request;
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/v1/')) {
      let action;
      if (path.endsWith('/monolith/commands')) { try { action = JSON.parse(request.postData || '{}').action; } catch { /* No raw payload logging. */ } }
      requests.push({ method:request.method, path, ...(action ? { action } : {}) });
    }
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  const item = waiting.get(message.id);
  if (!item) return;
  clearTimeout(item.timer); waiting.delete(message.id);
  if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`CDP timed out: ${method}`)); }, 20000);
    waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function run(fn, ...args) {
  const value = await cdp('Runtime.evaluate', { expression:`(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise:true, returnByValue:true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result.value;
}
async function settle() { await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) ; }
async function wait(fn) {
  for (let i = 0; i < 150; i++) { if (await run(fn)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw Error(`Condition timed out: ${fn}`);
}
async function click(selector) {
  await run(selector => { const items = document.querySelectorAll(selector); if (items.length !== 1) throw Error(`Expected one ${selector}, got ${items.length}`); if (items[0].disabled) throw Error(`Disabled: ${selector}`); items[0].click(); }, selector); await settle();
}
async function text(label) {
  await run(label => { const items = [...document.querySelectorAll('button')].filter(item => item.textContent.trim() === label && item.getClientRects().length > 0); if (items.length !== 1) throw Error(`Expected one visible button: ${label}, got ${items.length}`); items[0].click(); }, label); await settle();
}
async function fill(selector, value) {
  await run((selector, value) => { const input = document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles:true })); }, selector, value); await settle();
}
async function nav(index) { await click(`nav[aria-label="Primary Accounting Modules"] button:nth-child(${index + 1})`); }
async function screenshot(name) { await settle(); const image = await cdp('Page.captureScreenshot', { format:'png', captureBeyondViewport:false }); await writeFile(`${directory}/${name}.png`, Buffer.from(image.data, 'base64')); }
const checks = [];
async function check(name, fn) { if (!(await run(fn))) throw Error(name); checks.push(name); }
async function login(role) {
  await wait(() => !!document.getElementById('username'));
  await fill('#username', credentials[role].username); await fill('#password', credentials[role].password);
  await click('form button[type="submit"], form button:not([type])');
}
try {
  await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled:true });
  await cdp('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }, { name:'prefers-color-scheme', value:'light' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width:1680, height:1000, deviceScaleFactor:1, mobile:false });
  await cdp('Page.navigate', { url:base }); await wait(() => !!document.getElementById('username'));
  await check('Actual AuthGate login is retained with production skin', () => document.documentElement.dataset.ui === 'reader' && document.querySelector('h1').textContent.includes('Sign in') && getComputedStyle(document.getElementById('username')).borderRadius === '6px');
  await check('No preview strip or fetch adapter is present', () => !document.querySelector('.reskin-preview-strip') && !document.documentElement.dataset.preview && Function.prototype.toString.call(window.fetch).includes('[native code]'));
  if (requests.some(request => request.path.endsWith('/monolith/workspace'))) throw Error('Protected workspace was loaded before authentication');
  checks.push('Workspace is not read before authentication');
  await screenshot('login-light');
  await login('finance'); await wait(() => document.querySelectorAll('nav[aria-label="Primary Accounting Modules"] button').length === 15);
  await check('Authenticated workspace retains all 15 original modules', () => document.querySelectorAll('nav[aria-label="Primary Accounting Modules"] button').length === 15 && !!document.querySelector('svg[data-testid="sankey-svg"]'));
  await check('Live task pane defaults docked on wide screens', () => !document.getElementById('monolith-task-pane').hidden && document.querySelectorAll('.task-queue-item').length === 3 && getComputedStyle(document.querySelector('main')).paddingRight === '300px');
  await check('Workspace metadata is used without preview labels', () => document.querySelector('.workspace-context').textContent.includes('USD') && !document.querySelector('main').textContent.includes('READ-ONLY SKIN PREVIEW') && document.querySelector('.task-queue-entity').textContent === 'Monolith Ledger');
  await check('Light main panel and field radii match approved design', () => getComputedStyle(document.querySelector('section[aria-label="Cash Flow Sankey"]')).borderRadius === '10px' && getComputedStyle(document.querySelector('input[role="searchbox"]').parentElement).borderRadius === '6px');
  await screenshot('workspace-light');
  const names = await run(() => [...document.querySelectorAll('nav[aria-label="Primary Accounting Modules"] button')].map(button => button.textContent.trim()));
  for (let i = 0; i < names.length; i++) { await nav(i); await check(`${names[i]} module opens through existing navigation`, () => !document.querySelector('[role="alert"]') && !!document.querySelector('main section, main table, main [aria-label]')); }
  await text('Dark'); await wait(() => document.documentElement.classList.contains('dark'));
  await check('Dark preference is saved by the real API', async () => (await (await fetch('/api/v1/monolith/workspace')).json()).preferences.theme === 'dark');
  await nav(0); await screenshot('workspace-dark');
  await cdp('Page.reload'); await wait(() => document.querySelectorAll('nav[aria-label="Primary Accounting Modules"] button').length === 15 && document.documentElement.classList.contains('dark'));
  checks.push('Authenticated session and server theme survive reload');
  const commandsBeforeSelection = requests.filter(request => request.path.endsWith('/monolith/commands')).length;
  await fill('input[aria-label="Search tasks"]', 'citadel');
  await check('Live queue search filters the actual workspace tasks', () => document.querySelectorAll('.task-queue-item').length === 1);
  await click('.task-queue-item'); await wait(() => document.querySelector('main').textContent.includes('New Journal Entry'));
  if (requests.filter(request => request.path.endsWith('/monolith/commands')).length !== commandsBeforeSelection) throw Error('Task navigation executed a business command');
  checks.push('Task click uses direct App navigation without executing commands');
  await check('Task navigation clears stale global search', () => document.querySelector('input[role="searchbox"]').value === '');
  await screenshot('journal-dark');
  await click('button[aria-label="Clear task search"]'); await nav(0);
  await run(() => [...document.querySelectorAll('section[aria-label="Agent Proposals"] button')].find(button => button.textContent.trim() === 'Approve').click());
  await wait(() => document.querySelectorAll('.task-queue-item').length === 2);
  await check('Existing authorized task resolution updates the live queue', async () => (await (await fetch('/api/v1/monolith/workspace')).json()).agentTasks.filter(task => !task.resolved).length === 2 && document.querySelector('[data-testid="task-pane-toggle"]').textContent.includes('2'));
  await click('.task-queue-filters button:last-child');
  await check('All filter includes resolved server records without changing them', () => document.querySelectorAll('.task-queue-item').length === 3 && document.querySelector('.task-queue-item').textContent.includes('Handled'));
  await nav(14); await run(() => [...document.querySelectorAll('section[aria-label="Settings"] button')].find(button => button.textContent.includes('简体中文')).click()); await wait(() => document.documentElement.lang === 'zh');
  await check('Queue language follows existing server preference', () => document.getElementById('monolith-task-heading').textContent.includes('待你处理') && document.querySelector('.task-queue-search input').getAttribute('aria-label') === '搜索右侧待办');
  await nav(12); await check('Existing MFA period-signing gate remains intact', () => document.querySelector('main').textContent.includes('unavailable until MFA'));
  await cdp('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true }); await settle();
  await check('Narrow viewport closes docking and preserves mobile navigation', () => document.getElementById('monolith-task-pane').hidden && document.querySelectorAll('[aria-label="Mobile Module Switcher"] button').length === 15);
  await click('[data-testid="task-pane-toggle"]');
  await check('Mobile drawer is portaled outside inert App and receives focus', () => document.getElementById('root').inert && !document.getElementById('root').contains(document.getElementById('monolith-task-pane')) && document.activeElement.getAttribute('aria-label') === '收起待办栏');
  await screenshot('task-drawer-mobile-dark');
  await run(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex'); }); await settle();
  await check('Modal guard redirects escaped focus', () => document.activeElement.getAttribute('aria-label') === '收起待办栏');
  await run(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', shiftKey:true, bubbles:true, cancelable:true }))); await settle();
  await check('Drawer focus wraps within the dialog', () => document.activeElement === document.querySelector('.task-queue-item:last-child'));
  await run(() => window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))); await settle();
  await check('Escape restores App interaction and trigger focus', () => !document.getElementById('root').inert && document.getElementById('monolith-task-pane').hidden && document.activeElement.dataset.testid === 'task-pane-toggle');
  await click('[data-testid="task-pane-toggle"]'); await click('.task-queue-item:nth-child(2)');
  await wait(() => document.getElementById('monolith-task-pane').hidden && document.querySelector('[aria-label="Mobile Module Switcher"] button.bg-zinc-950').textContent.trim() === '银行对账');
  await check('Mobile task navigation closes drawer without processing task', () => !document.getElementById('root').inert);
  await click('[aria-label="Mobile Module Switcher"] button:last-child'); await text('浅色'); await wait(() => !document.documentElement.classList.contains('dark')); await screenshot('settings-mobile-light');
  await cdp('Emulation.setDeviceMetricsOverride', { width:1680, height:1000, deviceScaleFactor:1, mobile:false }); await settle();
  await text('Sign out'); await wait(() => !!document.getElementById('username'));
  await check('Real sign-out removes workspace and task portal', () => !document.getElementById('monolith-task-pane') && !document.getElementById('root').inert);
  const adminStart = requests.length;
  await login('admin'); await wait(() => document.querySelector('h1')?.textContent === 'Access & governance');
  await check('Administrator remains in governance without accounting UI', () => !document.querySelector('nav[aria-label="Primary Accounting Modules"]') && !document.getElementById('monolith-task-pane'));
  if (requests.slice(adminStart).some(request => request.path.endsWith('/monolith/workspace'))) throw Error('Admin UI fetched accounting workspace');
  checks.push('Administrator branch never loads accounting workspace');
  await check('Server still denies administrator workspace access', async () => (await fetch('/api/v1/monolith/workspace')).status === 403);
  await screenshot('governance-light'); await text('Sign out'); await wait(() => !!document.getElementById('username'));
  await login('clerk'); await wait(() => document.querySelector('h1')?.textContent === 'Position-scoped access');
  await check('Position-scoped role is not granted full workspace by UI adoption', () => !document.querySelector('nav[aria-label="Primary Accounting Modules"]') && !document.getElementById('monolith-task-pane'));
  await text('Sign out'); await wait(() => !!document.getElementById('username'));
  await login('finance'); await wait(() => !!document.querySelector('nav[aria-label="Primary Accounting Modules"]')); await nav(14);
  await run(async () => { const auth = await (await fetch('/api/v1/auth/me')).json(); const result = await fetch('/api/v1/auth/logout', { method:'POST', headers:{ 'X-CSRF-Token':auth.csrfToken } }); if (!result.ok) throw Error('Unable to revoke disposable QA session'); });
  await text('深色'); await wait(() => !!document.getElementById('username'));
  await check('Real 401 still expires the session and removes task UI', () => document.querySelector('[role="alert"]').textContent.includes('expired') && !document.getElementById('monolith-task-pane') && !document.getElementById('root').inert);
  await check('Signed-out appearance follows OS without protected workspace reads', () => !document.documentElement.classList.contains('dark') && document.documentElement.lang === 'en');
  if (errors.length) throw Error(`Unhandled browser exceptions: ${errors.join(', ')}`);
  checks.push('No unhandled browser exceptions');
  if (!requests.some(request => request.action === 'preferences.update') || !requests.some(request => request.action === 'agent.resolve')) throw Error('Expected actual authenticated command traffic was absent');
  checks.push('Actual authenticated preference/task API commands were exercised');
  const result = { passed:checks.length, checks, requests, unhandledErrors:errors, note:'Actual AuthGate/App, real API and CSRF with disposable SQLite and QA-only accounts. No preview adapter or personal database.' };
  await writeFile(`${directory}/checks.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed:checks.length, checks, unhandledErrors:errors }, null, 2));
} finally { socket.close(); }
