import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPreviewFetch, createPreviewStore } from './adapter.ts'
const fixture = JSON.parse(await readFile(new URL('./seed.json', import.meta.url), 'utf8'))
fixture.revision = 0
const command = (action, payload, revision = 0, commandId = 'test-1') => ({ action, payload, revision, commandId })

test('workspace reads are clones and never call a network implementation', async () => {
  const store = createPreviewStore(fixture)
  const fetch = createPreviewFetch(store)
  const response = await fetch('/api/v1/monolith/workspace')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.journalEntries.length, 5)
  result.journalEntries.splice(0)
  assert.equal(store.snapshot().journalEntries.length, 5)
  assert.equal(fixture.journalEntries.length, 5)
})
test('absolute production-like URLs return local fixtures without forwarding', async () => {
  const fetch = createPreviewFetch(createPreviewStore(fixture))
  const response = await fetch('https://live.invalid/custom/api/v1/monolith/workspace')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).workspaceId, fixture.workspaceId)
  assert.equal((await fetch('https://live.invalid/api/anything', { method: 'POST' })).status, 403)
})
test('all business commands are denied and leave seed unchanged', async () => {
  const store = createPreviewStore(fixture)
  for (const action of ['journal.create', 'journal.review', 'invoice.collect', 'bill.pay', 'bank.reconcile', 'period.lock', 'period.unlock', 'budget.save', 'forecast.save', 'agent.resolve', 'unknown']) {
    const result = store.command(command(action, {}))
    assert.equal(result.status, 403)
    assert.match((await result.json()).detail, /Read-only reskin preview/)
  }
  assert.deepEqual(store.snapshot(), fixture)
})
test('appearance preferences update only in isolated memory', async () => {
  const store = createPreviewStore(fixture)
  const response = store.command(command('preferences.update', { theme: 'dark', language: 'zh' }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).revision, 1)
  assert.equal(store.snapshot().preferences.theme, 'dark')
  assert.equal(store.snapshot().preferences.language, 'zh')
  assert.deepEqual(store.snapshot().journalEntries, fixture.journalEntries)
  assert.equal(fixture.preferences.theme, 'light')
})
test('revision conflicts and repeated command IDs are handled', async () => {
  const store = createPreviewStore(fixture)
  const update = command('preferences.update', { theme: 'dark' })
  assert.equal(store.command(update).status, 200)
  assert.equal(store.command(update).status, 200)
  assert.equal(store.snapshot().revision, 1)
  assert.equal(store.command(command('preferences.update', { theme: 'light' }, 0, 'new-id')).status, 409)
  assert.equal(store.command(command('preferences.update', { theme: 'light' }, 1, 'test-1')).status, 409)
})
test('unsupported preferences, payloads and request methods fail closed', async () => {
  const store = createPreviewStore(fixture)
  assert.equal(store.command(command('preferences.update', { theme: 'auto' })).status, 400)
  assert.equal(store.command(command('preferences.update', { businessWrite: true })).status, 400)
  assert.equal(store.command(command('preferences.update', [])).status, 400)
  assert.equal(store.command(null).status, 400)
  const fetch = createPreviewFetch(store)
  assert.equal((await fetch('/api/v1/monolith/workspace', { method: 'DELETE' })).status, 403)
  assert.equal((await fetch('/api/v1/monolith/commands', { method: 'POST', body: 'bad JSON' })).status, 400)
})
test('Request instances and init overrides stay inside the adapter', async () => {
  const store = createPreviewStore(fixture)
  const fetch = createPreviewFetch(store)
  const request = new Request('https://live.invalid/api/v1/monolith/commands', { method: 'POST', body: JSON.stringify(command('preferences.update', { theme: 'dark' })) })
  assert.equal((await fetch(request)).status, 200)
  assert.equal(store.snapshot().preferences.theme, 'dark')
  assert.equal((await fetch(new Request('https://live.invalid/api/v1/monolith/workspace'), { method: 'DELETE' })).status, 403)
})
