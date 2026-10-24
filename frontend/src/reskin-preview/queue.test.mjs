import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { filterQueue, navigateExistingTask, taskCategory, taskDestination } from './queue.ts'
const { agentTasks } = JSON.parse(await readFile(new URL('./seed.json', import.meta.url), 'utf8'))

test('queue uses existing Agent Task records and never mutates them', () => {
  const before = JSON.stringify(agentTasks)
  assert.equal(filterQueue(agentTasks, '', 'pending').length, 3)
  assert.equal(filterQueue(agentTasks, '', 'all').length, 3)
  assert.equal(JSON.stringify(agentTasks), before)
  assert.equal(taskCategory(agentTasks[0]), '收入确认')
  assert.equal(taskDestination(agentTasks[0]), '会计分录')
})
test('pending and all distinguish resolved fixtures without inventing records', () => {
  const tasks = agentTasks.map((task, i) => ({ ...task, resolved: i === 0 }))
  assert.equal(filterQueue(tasks, '', 'pending').length, 2)
  assert.equal(filterQueue(tasks, '', 'all').length, 3)
})
test('search handles IDs, codes, titles, category labels, case and fullwidth input', () => {
  assert.equal(filterQueue(agentTasks, 'citadel', 'all')[0].id, 'AGT-101')
  assert.equal(filterQueue(agentTasks, ' REC-02 ', 'all')[0].id, 'AGT-102')
  assert.equal(filterQueue(agentTasks, '税务判断', 'all')[0].id, 'AGT-103')
  assert.equal(filterQueue(agentTasks, 'ＡＧＴ-１０１', 'all')[0].id, 'AGT-101')
  assert.equal(filterQueue(agentTasks, 'not-a-task', 'all').length, 0)
})
test('navigation activates the visible existing translated module button', () => {
  let clicked = 0
  const doc = {
    documentElement: { lang: 'zh' },
    querySelectorAll: () => [
      { textContent: '会计分录', getClientRects: () => [], click: () => assert.fail('Hidden desktop button must not be used') },
      { textContent: '会计分录', getClientRects: () => [1], click: () => { clicked++ } },
    ],
  }
  assert.equal(navigateExistingTask(agentTasks[0], doc), true)
  assert.equal(clicked, 1)
})
test('missing module links fail safely without changing any task state', () => {
  const before = JSON.stringify(agentTasks)
  const doc = { documentElement: { lang: 'en' }, querySelectorAll: () => [] }
  assert.equal(navigateExistingTask(agentTasks[0], doc), false)
  assert.equal(JSON.stringify(agentTasks), before)
})
