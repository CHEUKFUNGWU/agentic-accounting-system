import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source = fs.readFileSync(new URL('./model.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ES2022 } }).outputText
const {ITEMS,entryLines,initialState,canClose,mayApprove,readDemoState}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
for (const item of ITEMS) for (let percent=0;percent<=100;percent++) {
  const lines=entryLines(item,percent)
  assert.equal(lines.reduce((n,l)=>n+l.debit,0),item.amount)
  assert.equal(lines.reduce((n,l)=>n+l.credit,0),item.amount)
  assert(lines.every(l=>Number.isInteger(l.debit)&&Number.isInteger(l.credit)&&l.debit>=0&&l.credit>=0))
}
assert.deepEqual(entryLines(ITEMS[0],80).map(l=>l.debit),[9600,960,2640,0])
assert.equal(mayApprove(ITEMS[0],false),false)
assert.equal(mayApprove(ITEMS[0],true),true)
assert.equal(mayApprove(ITEMS[1],true),false)
assert.equal(mayApprove(ITEMS[2],false),true)
const state=initialState()
assert.equal(canClose(state),false)
for(const item of ITEMS)state.statuses[item.id]=item.kind==='duplicate'?'returned':'approved'
assert.equal(canClose(state),false)
state.bankDone=true
assert.equal(canClose(state),true)
state.locked=true
assert.equal(canClose(state),false)
globalThis.localStorage={getItem:()=>'{invalid'}
assert.deepEqual(readDemoState(),initialState())
console.log('PASS: 404 allocation scenarios, balanced cents, approval guards, close prerequisites, safe storage recovery.')
