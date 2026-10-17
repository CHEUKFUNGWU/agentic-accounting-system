"""Contract and accounting invariants for the adopted UI's persistent workspace."""
import asyncio
import base64
import copy
import hashlib
import json
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete
from conftest import login_as

from app.core.db import MonolithWorkspaceModel, db_manager
from app.core.monolith import WorkspaceError, apply_command, initial_state, trial_balance


@pytest_asyncio.fixture(autouse=True)
async def fresh_monolith():
    async with db_manager.session_factory() as session:
        await session.execute(delete(MonolithWorkspaceModel))
        await session.commit()


async def workspace(client):
    response = await client.get('/api/v1/monolith/workspace')
    assert response.status_code == 200, response.text
    return response.json()


async def command(client, action, payload=None, status=200, revision=None, command_id=None):
    if revision is None:
        revision = (await workspace(client))['revision']
    response = await client.post('/api/v1/monolith/commands', json={
        'action': action, 'payload': payload or {}, 'revision': revision, 'commandId': command_id or str(uuid4()),
    })
    assert response.status_code == status, response.text
    return response.json()


@pytest.mark.asyncio
async def test_workspace_seed_is_once_only_and_trial_balance_matches(client):
    first = await workspace(client)
    second = await workspace(client)
    assert first == second
    assert len(first['accounts']) == 19
    assert first['dataOrigin'] == 'Supplied demonstration dataset'
    response = await client.get('/api/v1/monolith/trial-balance')
    assert response.status_code == 200
    assert response.json()['balanced'] is True


@pytest.mark.asyncio
async def test_invoice_collection_is_persistent_balanced_and_not_repeatable(client):
    created = await command(client, 'invoice.create', {'customer': 'Test customer', 'dueDate': '2026-11-15', 'revenueAccountCode': '4010', 'amount': 123.45})
    invoice = created['receivables'][0]
    journal = created['journalEntries'][0]
    assert journal['lines'][0]['accountCode'] == '1100'
    assert trial_balance(created)['balanced']
    paid = await command(client, 'invoice.collect', {'id': invoice['id']})
    assert paid['receivables'][0]['status'] == 'Paid'
    assert paid['ledgerCashItems'][0]['amount'] == 123.45
    assert (await workspace(client)) == paid
    before = copy.deepcopy(paid)
    await command(client, 'invoice.collect', {'id': invoice['id']}, status=409)
    assert await workspace(client) == before
    event = paid['auditLogs'][0].copy()
    digest = event.pop('hash')
    assert digest == hashlib.sha256(json.dumps(event, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert event['previousHash'] == paid['auditLogs'][1]['hash']


@pytest.mark.asyncio
async def test_bill_requires_approval_and_cannot_be_paid_twice(client):
    created = await command(client, 'bill.create', {'vendor': 'Test vendor', 'reference': 'BILL-TEST', 'dueDate': '2026-11-15', 'expenseAccountCode': '5010', 'amount': 50})
    bill = created['payables'][0]
    await command(client, 'bill.pay', {'id': bill['id']}, status=409)
    await command(client, 'bill.approve', {'id': bill['id']})
    paid = await command(client, 'bill.pay', {'id': bill['id']})
    assert paid['payables'][0]['status'] == 'Paid'
    assert paid['ledgerCashItems'][0]['amount'] == -50
    assert trial_balance(paid)['balanced']
    await command(client, 'bill.pay', {'id': bill['id']}, status=409)
    assert await workspace(client) == paid


def manual_entry(**overrides):
    return {'memo': 'Server validated journal', 'date': '2026-10-17', 'reference': 'TEST-JE', 'source': 'Manual Entry',
            'lines': [{'accountCode': '6010', 'debit': 100, 'credit': 0}, {'accountCode': '1010', 'debit': 0, 'credit': 100}], **overrides}


@pytest.mark.asyncio
@pytest.mark.parametrize('changes', [
    {'lines': [{'accountCode': '6010', 'debit': 100, 'credit': 0}, {'accountCode': '1010', 'credit': 99}]},
    {'lines': [{'accountCode': '9999', 'debit': 100}, {'accountCode': '1010', 'credit': 100}]},
    {'date': '2026-11-01'}, {'date': 'not-a-date'}, {'memo': ''},
    {'lines': [{'accountCode': '6010', 'debit': 'NaN'}, {'accountCode': '1010', 'credit': 100}]},
    {'lines': [{'accountCode': '6010', 'debit': -100}, {'accountCode': '1010', 'credit': -100}]},
])
async def test_invalid_journal_is_rejected_without_partial_changes(client, changes):
    before = await workspace(client)
    await command(client, 'journal.create', manual_entry(**changes), status=422)
    assert await workspace(client) == before


@pytest.mark.asyncio
async def test_agent_entries_require_review_and_cash_is_written_once(client):
    before = await workspace(client)
    draft = await command(client, 'journal.create', manual_entry(source='Agentic Auto-Draft', createdByPrincipalKey='cpa-griffin'))
    assert draft['journalEntries'][0]['status'] == 'Draft'
    assert len(draft['ledgerCashItems']) == len(before['ledgerCashItems'])
    assert trial_balance(draft) == trial_balance(before)
    assert draft['journalEntries'][0]['createdByPrincipalKey'] == 'test-finance-human'
    assert draft['auditLogs'][0]['actorId'] == 'test-finance-human'
    entry_id = draft['journalEntries'][0]['id']
    await command(client, 'journal.review', {'id': entry_id}, status=403)
    await login_as(client, 'test-cpa-human')
    posted = await command(client, 'journal.review', {'id': entry_id})
    assert posted['journalEntries'][0]['id'] == entry_id
    assert posted['ledgerCashItems'][0]['entryId'] == entry_id
    assert posted['ledgerCashItems'][0]['amount'] == -100
    await command(client, 'journal.review', {'id': entry_id}, status=409)


@pytest.mark.asyncio
async def test_idempotency_and_conflicts_do_not_duplicate_journals(client):
    command_id = str(uuid4())
    result = await command(client, 'journal.create', manual_entry(), revision=0, command_id=command_id)
    replay = await command(client, 'journal.create', manual_entry(), revision=0, command_id=command_id)
    assert replay == result
    await command(client, 'journal.create', manual_entry(memo='Changed'), revision=0, command_id=command_id, status=409)
    await command(client, 'journal.create', manual_entry(), revision=0, status=409)
    assert await workspace(client) == result


@pytest.mark.asyncio
async def test_simultaneous_writers_only_commit_once(client):
    await workspace(client)
    async def write():
        return await client.post('/api/v1/monolith/commands', json={'action': 'journal.create', 'payload': manual_entry(), 'revision': 0, 'commandId': str(uuid4())})
    responses = await asyncio.gather(write(), write())
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert (await workspace(client))['revision'] == 1


@pytest.mark.asyncio
async def test_bank_matching_validates_amounts_and_prevents_reuse(client):
    await command(client, 'bank.reconcile', {'bankId': 'BF-903', 'ledgerId': 'LC-03'}, status=422)
    matched = await command(client, 'bank.batch')
    assert sum(r['status'] == 'Matched' for r in matched['bankItems']) == 5
    await command(client, 'bank.reconcile', {'bankId': 'BF-903', 'ledgerId': 'LC-04'}, status=409)
    result = await command(client, 'bank.exception', {'id': 'BF-906'})
    assert all(r['status'] == 'Matched' for r in result['bankItems'])
    assert result['ledgerCashItems'][0]['amount'] == -4200
    assert trial_balance(result)['balanced']
    await command(client, 'bank.exception', {'id': 'BF-906'}, status=409)


@pytest.mark.asyncio
async def test_tax_uses_server_calculation_and_cannot_claim_external_filing(client):
    state = await workspace(client)
    schedule = state['taxSchedules'][0]
    payload = {'formCode': schedule['formCode'], 'jurisdiction': schedule['jurisdiction'], 'amount': 1}
    await command(client, 'tax.provision', payload, status=422)
    await command(client, 'tax.update', {'id': schedule['id'], 'updates': {'status': 'Filed'}}, status=422)
    updated = await command(client, 'tax.update', {'id': schedule['id'], 'updates': {'taxableBase': 1000, 'creditsAndDeductions': 0}})
    assert updated['taxSchedules'][0]['taxableBase'] == 1000
    result = await command(client, 'tax.provision', {**payload, 'amount': 210})
    assert result['taxSchedules'][0]['provisionJournalId'] == result['journalEntries'][0]['id']
    await command(client, 'tax.provision', {**payload, 'amount': 210}, status=409)


@pytest.mark.asyncio
async def test_asset_depreciation_and_amortization_only_post_once_per_period(client):
    await command(client, 'asset.register', {'name': 'Laptop', 'category': 'Workstations', 'usefulLifeMonths': 12, 'costBasis': 1200, 'salvageValue': 0})
    result = await command(client, 'asset.depreciate')
    assert result['fixedAssets'][0]['accumulatedDepreciation'] == 100
    assert result['journalEntries'][0]['lines'][0]['accountCode'] == '6900'
    assert result['journalEntries'][0]['lines'][1]['accountCode'] == '1590'
    assert trial_balance(result)['balanced']
    await command(client, 'asset.depreciate', status=409)
    schedule_id = result['amortizationSchedules'][0]['id']
    result = await command(client, 'close.amortize', {'id': schedule_id})
    assert result['amortizationSchedules'][0]['status'] == 'Posted Q4'
    await command(client, 'close.amortize', {'id': schedule_id}, status=409)


@pytest.mark.asyncio
async def test_close_enforces_real_gates_and_lock_blocks_mutations(client):
    await command(client, 'period.lock', status=403)
    result = await command(client, 'bank.batch')
    await command(client, 'bank.exception', {'id': 'BF-906'})
    result = await command(client, 'asset.depreciate')
    for schedule in result['amortizationSchedules']:
        await command(client, 'close.amortize', {'id': schedule['id']})
    result = await workspace(client)
    for item in result['closeChecklist']:
        if item['id'] != 'CLS-06' and not item['completed']:
            await command(client, 'close.checklist', {'id': item['id']})
    await command(client, 'period.lock', status=403)
    state = await workspace(client)
    apply_command(state, 'period.lock', {})
    assert state['isPeriodLocked']
    with pytest.raises(WorkspaceError, match='PERIOD_LOCKED'):
        apply_command(state, 'journal.create', manual_entry())
    apply_command(state, 'period.unlock', {})
    assert not state['isPeriodLocked']


@pytest.mark.asyncio
async def test_settings_budget_forecast_and_attachment_persist(client):
    await command(client, 'preferences.update', {'language': 'ja', 'theme': 'dark'})
    state = await workspace(client)
    allocations = state['budgetAllocations']
    allocations[0]['q4Budget'] = 123456
    await command(client, 'budget.save', {'allocations': allocations})
    drivers = state['forecastDrivers']
    drivers['quarterlyRevGrowthPct'] = 25
    await command(client, 'forecast.save', {'drivers': drivers, 'overrides': {'saas-1': 98765}})
    attachment = {'id': 'receipt', 'name': 'receipt.txt', 'mimeType': 'text/plain', 'dataUrl': 'data:text/plain;base64,'+base64.b64encode(b'Test evidence').decode()}
    result = await command(client, 'journal.create', manual_entry(attachments=[attachment]))
    assert result['journalEntries'][0]['attachments'][0]['sha256'] == hashlib.sha256(b'Test evidence').hexdigest()
    reloaded = await workspace(client)
    assert reloaded['preferences']['language'] == 'ja'
    assert reloaded['budgetAllocations'][0]['q4Budget'] == 123456
    assert reloaded['forecastOverrides'] == {'saas-1': 98765}
    assert reloaded == result


@pytest.mark.asyncio
async def test_budget_inserted_rows_are_plans_not_new_gl_accounts(client):
    state = await workspace(client)
    rows = state['budgetAllocations'] + [{'accountCode': '6399', 'accountName': 'New department', 'department': 'Engineering', 'category': 'Expense', 'q4Budget': 50000, 'customActual': 45000}]
    result = await command(client, 'budget.save', {'allocations': rows})
    assert result['budgetAllocations'][-1]['accountName'] == 'New department'
    assert not any(a['code'] == '6399' for a in result['accounts'])
    await command(client, 'journal.create', manual_entry(lines=[{'accountCode': '6399', 'debit': 100}, {'accountCode': '1010', 'credit': 100}]), status=422)


@pytest.mark.asyncio
async def test_agent_queue_resolution_produces_a_draft_not_an_unreviewed_posting(client):
    before = await workspace(client)
    result = await command(client, 'agent.resolve', {'id': 'AGT-101'})
    assert result['journalEntries'][0]['status'] == 'Draft'
    assert result['agentTasks'][0]['resolved']
    assert trial_balance(result) == trial_balance(before)
    await command(client, 'agent.resolve', {'id': 'AGT-101'}, status=409)


def test_period_close_refuses_unmatched_book_cash_even_when_feed_is_matched():
    state = initial_state()
    for item in state['closeChecklist']:
        item['completed'] = True
    for item in state['bankItems']:
        item['status'] = 'Matched'
    for item in state['fixedAssets']:
        item['lastDepreciatedPeriod'] = state['period']
    with pytest.raises(WorkspaceError, match='UNRECONCILED_LEDGER'):
        apply_command(state, 'period.lock', {})
