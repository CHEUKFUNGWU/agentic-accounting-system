import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks, pendingTaskCount, queueCategory, queueCopy, queuePeriod } from './taskQueue.ts';
const tasks = [
  { id:'t1', code:'REV-01', title:'Contract review', description:'Annual service agreement', category:'Revenue Recognition', impactAmount:240000, confidence:99, resolved:false, targetTab:'journal' },
  { id:'t2', code:'REC-02', title:'Bank match', description:'Wire receipt', category:'Bank Reconciliation', impactAmount:4200, confidence:98, resolved:true, targetTab:'reconciliation' },
];
test('counts and filters reflect current server task state without mutating it', () => {
  const before = JSON.stringify(tasks);
  assert.equal(pendingTaskCount(tasks), 1);
  assert.equal(filterTasks(tasks, '', 'pending', 'en').length, 1);
  assert.equal(filterTasks(tasks, '', 'all', 'en').length, 2);
  assert.equal(JSON.stringify(tasks), before);
  const updated = tasks.map(t => ({ ...t, resolved:true }));
  assert.equal(pendingTaskCount(updated), 0);
  assert.equal(filterTasks(updated, '', 'pending', 'en').length, 0);
});
test('search supports references, descriptions, localized categories and fullwidth text', () => {
  assert.equal(filterTasks(tasks, 'annual', 'all', 'en')[0].id, 't1');
  assert.equal(filterTasks(tasks, '收入确认', 'pending', 'zh')[0].id, 't1');
  assert.equal(filterTasks(tasks, 'ＲＥＣ-０２', 'all', 'zh')[0].id, 't2');
  assert.equal(filterTasks(tasks, 'not present', 'all', 'en').length, 0);
});
test('all existing preference languages have complete task copy and category names', () => {
  const keys = Object.keys(queueCopy('en')).sort();
  for (const language of ['en','zh','es','ja']) {
    assert.deepEqual(Object.keys(queueCopy(language)).sort(), keys);
    assert.ok(Object.values(queueCopy(language)).every(v => typeof v === 'string' && v.length > 0));
    assert.ok(queueCategory(tasks[0], language));
  }
});
test('period context comes from workspace rather than a fixed example month', () => {
  assert.match(queuePeriod('2027-02', 'en'), /February.*2027/);
  assert.match(queuePeriod('2028-11', 'zh'), /2028.*11/);
  assert.equal(queuePeriod('unconfigured', 'en'), 'unconfigured');
  assert.equal(queuePeriod('2026-13', 'en'), '2026-13');
});
