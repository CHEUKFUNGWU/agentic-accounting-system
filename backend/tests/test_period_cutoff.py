"""BL-04 date/period integrity, isolated SQLite and authenticated transport."""
from copy import deepcopy
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import update

from app import api_documents, api_vouchers, mcp_roles, mcp_server
from app.core import ledger, posting
from app.core.db import FiscalPeriodModel, JournalLineModel
from app.core.positions import POSITIONS
from app.mcp_roles import PositionSession
from conftest import agent_as, login_as
from test_atomic_posting import isolated_posting, voucher, approve, stored_lines
from test_journal_concurrency import guarded_repo


async def dated(repository, accounting_date, period):
    entry = await voucher(repository)
    entry.update(accounting_date=accounting_date, period=period)
    await repository.save_journal(entry)
    return await repository.get_journal(entry['journal_id'])


async def lock(repository, period):
    await ledger.ensure_period('AU-OPC-01', period)
    async with repository.manager.session_factory() as session:
        await session.execute(update(FiscalPeriodModel).where(
            FiscalPeriodModel.period_id == f'AU-OPC-01:{period}'
        ).values(status='LOCKED'))
        await session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize('accounting_date,period,error', [
    ('2026-02-30', '2026-02', 'INVALID_ACCOUNTING_DATE'),
    ('2026-2-01', '2026-02', 'INVALID_ACCOUNTING_DATE'),
    ('20260201', '2026-02', 'INVALID_ACCOUNTING_DATE'),
    ('2026-W01-1', '2026-01', 'INVALID_ACCOUNTING_DATE'),
    ('2026-10-15T00:00:00', '2026-10', 'INVALID_ACCOUNTING_DATE'),
    ('', '2026-10', 'INVALID_ACCOUNTING_DATE'),
    ('0000-01-01', '0000-01', 'INVALID_ACCOUNTING_DATE'),
    ('2026-09-15', '2026-11', 'PERIOD_DATE_MISMATCH'),
    ('2026-10-01', '2026-Q3', 'PERIOD_DATE_MISMATCH'),
    ('2026-10-15', '2026-13', 'INVALID_PERIOD'),
    ('2026-10-15', '2026-00', 'INVALID_PERIOD'),
    ('2026-10-15', '0000-Q4', 'INVALID_PERIOD'),
    ('2026-10-15', '2026-Q5', 'INVALID_PERIOD'),
    ('2026-10-15', '2026', 'INVALID_PERIOD'),
    ('2026-10-15', '', 'INVALID_PERIOD'),
    ('2026-10-15', '2026-10\n', 'INVALID_PERIOD'),
])
async def test_invalid_post_is_atomic(isolated_posting, accounting_date, period, error):
    repository = isolated_posting
    await lock(repository, '2026-09')
    before_balance = await ledger.derive_balances('AU-OPC-01', '2026-10')
    entry = await dated(repository, accounting_date, period)
    before = deepcopy(entry)
    with pytest.raises(posting.PostingError, match=error):
        await approve(entry)
    assert entry == before == await repository.get_journal(entry['journal_id'])
    assert not await stored_lines(repository)
    assert await ledger.derive_balances('AU-OPC-01', '2026-10') == before_balance
    async with repository.manager.session_factory() as session:
        assert await session.get(FiscalPeriodModel, 'AU-OPC-01:2026-11') is None
    following = await voucher(repository)
    assert (await approve(following))['block_index'] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('accounting_date,period', [
    ('2024-02-29', '2024-02'), ('2026-01-01', '2026-Q1'),
    ('2026-03-31', '2026-Q1'), ('2026-04-01', '2026-Q2'),
    ('2026-12-31', '2026-Q4'), ('2027-01-01', '2027-01'),
    ('0001-01-01', '0001-01'), ('2026-10-15', None),
])
async def test_inclusive_bounds_and_missing_period_compatibility(isolated_posting, accounting_date, period):
    entry = await dated(isolated_posting, accounting_date, period)
    await approve(entry)
    expected = period or accounting_date[:7]
    rows = await stored_lines(isolated_posting)
    assert {r.period_code for r in rows} == {expected}
    assert (await ledger.derive_balances('AU-OPC-01', expected))['6100'].op_debit == 100


@pytest.mark.asyncio
async def test_helpers_refuse_before_replacing_lines_or_saving_migration(isolated_posting, monkeypatch):
    entry = await voucher(isolated_posting)
    await approve(entry)
    before = [(r.line_id, r.accounting_date) for r in await stored_lines(isolated_posting)]
    entry.update(accounting_date='2026-09-15', period='2026-11')
    with pytest.raises(ledger.LedgerError, match='PERIOD_DATE_MISMATCH'):
        await ledger.write_lines_for_entry(entry)
    monkeypatch.setattr('app.core.repository.repo', isolated_posting)
    history = await isolated_posting.get_journals()
    with pytest.raises(ledger.LedgerError, match='PERIOD_DATE_MISMATCH'):
        await ledger._write_migration_voucher('AU-OPC-01', 'AUD', '2026-11', '2026-09-15',
                                              'OPENING', 'test', [('6100', Decimal(100))])
    assert await isolated_posting.get_journals() == history
    await lock(isolated_posting, '2026-10')
    entry.update(accounting_date='2026-10-15', period='2026-10')
    with pytest.raises(ledger.LedgerError, match='PERIOD_LOCKED'):
        await ledger.write_lines_for_entry(entry)
    assert [(r.line_id, r.accounting_date) for r in await stored_lines(isolated_posting)] == before


@pytest.mark.asyncio
@pytest.mark.parametrize('corruption', [{'accounting_date': 'not-a-date'},
                                      {'accounting_date': '2026-09-15', 'period_code': '2026-11'}])
async def test_legacy_reporting_fails_closed_without_repair(isolated_posting, corruption):
    entry = await voucher(isolated_posting)
    await approve(entry)
    async with isolated_posting.manager.session_factory() as session:
        await session.execute(update(JournalLineModel).values(**corruption))
        await session.commit()
    for period in ('2026-10', '2026-11', '2027-01'):
        with pytest.raises(ledger.LedgerError):
            await ledger.derive_balances('AU-OPC-01', period)
    rows = await stored_lines(isolated_posting)
    assert all(r.accounting_date == corruption['accounting_date'] for r in rows)


class NovemberDate(date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 17)


@pytest.mark.asyncio
@pytest.mark.parametrize('transport', ['rest', 'mcp'])
async def test_current_reversal_preserves_locked_history_and_refuses_locked_target(guarded_repo, client, monkeypatch, transport):
    repository = guarded_repo
    await ledger.upsert_account('AU-OPC-01', {'account_code': '2110', 'account_type': 'LIABILITY',
                                             'account_name': 'Payables', 'is_control_account': False})
    entry = await dated(repository, '2026-09-15', '2026-09')
    entry['lines'][1]['account_code'] = '2110'
    await repository.save_journal(entry)
    await approve(entry)
    historical_lines = [(r.line_id, r.accounting_date, r.period_code) for r in await stored_lines(repository)]
    await lock(repository, '2026-09')
    monkeypatch.setattr(api_vouchers, 'date', NovemberDate)
    monkeypatch.setattr(mcp_roles, 'date', NovemberDate)
    role = PositionSession(principal_key='controller-checker-01',
                           principal_id=str(mcp_server.PRINCIPALS['controller-checker-01'].principal_id),
                           position=POSITIONS['FINANCE_MANAGER'], credential_id='test', token='test')

    async def build(original_id):
        if transport == 'rest':
            return await client.post(f'/api/v1/vouchers/{original_id}/reverse', json={'reason': 'correct'})
        return await mcp_roles._reverse_voucher(role, original_id, 'correct')

    if transport == 'rest':
        await agent_as(client, 'ap-clerk-01')
        response = await build(entry['journal_id'])
        assert response.status_code == 200, response.text
    else:
        await build(entry['journal_id'])
    draft = next(j for j in await repository.get_journals() if j.get('reversal_of_journal_id') == entry['journal_id'])
    assert draft['accounting_date'] == '2026-11-17' and draft['period'] == '2026-11'
    draft['status'] = 'PENDING_CHECKER'
    await repository.save_journal(draft)
    await login_as(client, 'test-cpa-human')
    response = await client.post(f"/api/v1/vouchers/{draft['journal_id']}/approve", json={})
    assert response.status_code == 200, response.text
    assert (await repository.get_journal(entry['journal_id']))['accounting_date'] == '2026-09-15'
    assert [(r.line_id, r.accounting_date, r.period_code) for r in await stored_lines(repository)
            if r.journal_id == entry['journal_id']] == historical_lines
    assert (await ledger.derive_balances('AU-OPC-01', '2026-09'))['6100'].op_debit == 100
    assert (await ledger.derive_balances('AU-OPC-01', '2026-10'))['6100'].opening == 100
    november = (await ledger.derive_balances('AU-OPC-01', '2026-11'))['6100']
    assert november.opening == 100 and november.op_credit == 100 and november.closing == 0
    other = await dated(repository, '2026-10-15', '2026-10')
    other['lines'][1]['account_code'] = '2110'
    await repository.save_journal(other)
    await approve(other)
    await lock(repository, '2026-11')
    await login_as(client, 'test-finance-human')
    if transport == 'rest':
        await agent_as(client, 'ap-clerk-01')
    count = len(await repository.get_journals())
    if transport == 'rest':
        response = await build(other['journal_id'])
        assert response.status_code == 400 and 'PERIOD_LOCKED' in response.text
    else:
        with pytest.raises(mcp_roles.ToolError, match='PERIOD_LOCKED'):
            await build(other['journal_id'])
    assert len(await repository.get_journals()) == count


@pytest.mark.asyncio
async def test_authenticated_ingress_and_direct_aje(guarded_repo, client):
    before = await guarded_repo.get_journals()
    for accounting_date, period in [('2026-02-30', '2026-02'), ('2026-09-15', '2026-11'),
                                    ('2026-10-15', '2026-13'), ('2026-10-15', '2026')]:
        response = await client.post('/api/v1/vouchers', json={
            'accounting_date': accounting_date, 'period': period,
            'lines': [{'account_code': '6100', 'debit': '100'}, {'account_code': '1110', 'credit': '100'}],
        })
        assert response.status_code == 400, response.text
    result = await mcp_server.propose_adjusting_entry('AU-OPC-01', '6100', '1110', '100', 'test',
                                                     period_code='2026-11', accounting_date='2026-09-15')
    assert result['status'] == 'ERROR' and 'PERIOD_DATE_MISMATCH' in result['reason']
    assert await guarded_repo.get_journals() == before
    with pytest.raises(ledger.LedgerError, match='INVALID_ACCOUNTING_DATE'):
        mcp_roles.period_of('2026-02-30')


@pytest.mark.asyncio
async def test_document_ingress_refuses_bad_date_and_accepts_valid_date(guarded_repo, client, monkeypatch, tmp_path):
    monkeypatch.setattr(api_documents, 'repo', guarded_repo)
    monkeypatch.setattr(api_documents.sources, 'repo', guarded_repo)
    monkeypatch.setattr(api_documents.vz, 'attachment_root', lambda: tmp_path / 'attachments')
    evidence = api_documents.vz.save_attachment('AU-OPC-01', 'cutoff.pdf', b'cutoff evidence', '', 'maker')
    await guarded_repo.save_document({'document_id': 'cutoff-doc', 'entity_code': 'AU-OPC-01',
                                     'sha256': evidence['sha256'], 'stored_name': evidence['stored_name'],
                                     'doc_date': '2026-02-30', 'amount': '100', 'currency': 'AUD'})
    payload = {'debit_account_code': '6100', 'credit_account_code': '1110'}
    response = await client.post('/api/v1/documents/cutoff-doc/to-voucher', json=payload)
    assert response.status_code == 400 and 'INVALID_ACCOUNTING_DATE' in response.text
    assert (await guarded_repo.get_document('cutoff-doc'))['status'] == 'NEW'
    assert not await guarded_repo.get_journals()
    document = await guarded_repo.get_document('cutoff-doc')
    document['doc_date'] = '2026-10-31'
    await guarded_repo.save_document(document)
    response = await client.post('/api/v1/documents/cutoff-doc/to-voucher', json=payload)
    assert response.status_code == 200, response.text
    journal = (await guarded_repo.get_journals())[0]
    assert journal['accounting_date'] == '2026-10-31' and journal['period'] == '2026-10'


@pytest.mark.asyncio
async def test_expense_and_quarterly_aje_compatibility(guarded_repo, monkeypatch):
    for code in ('1420', '2190'):
        await ledger.upsert_account('AU-OPC-01', {'account_code': code, 'account_name': code,
                                                'account_type': 'ASSET', 'is_control_account': False})
    monkeypatch.setattr(mcp_server, 'date', NovemberDate)
    monkeypatch.setattr(mcp_server, 'PERSONAL_SPLITS_LOG', {})
    result = await mcp_server.propose_expense_with_personal_split(
        'bookkeeper-maker-01', 'AU-OPC-01', 'test', '100', '0.1', '0.8', 'test://evidence')
    assert result['status'] == 'PROPOSED_AWAITING_REVIEW', result
    assert result['journal']['accounting_date'] == '2026-11-17'
    assert result['journal']['period'] == '2026-11'
    await lock(guarded_repo, '2026-11')
    count = len(await guarded_repo.get_journals())
    result = await mcp_server.propose_expense_with_personal_split(
        'bookkeeper-maker-01', 'AU-OPC-01', 'test', '100', '0.1', '0.8', 'test://evidence')
    assert result['status'] == 'ERROR' and 'PERIOD_LOCKED' in result['reason']
    assert len(await guarded_repo.get_journals()) == count
    # Both accounts belong to AP, so the existing AJE ownership check applies.
    result = await mcp_server.propose_adjusting_entry(
        'AU-OPC-01', '6100', '1420', '100', 'test', period_code='2026-Q1')
    assert result['status'] != 'ERROR', result
    aje = next(j for j in await guarded_repo.get_journals() if j['source_module'] == 'AJE')
    assert aje['accounting_date'] == '2026-03-28' and aje['period'] == '2026-Q1'


@pytest.mark.asyncio
async def test_target_locked_after_draft_refuses_approval(isolated_posting):
    entry = await voucher(isolated_posting)
    await lock(isolated_posting, '2026-10')
    before = deepcopy(entry)
    with pytest.raises(posting.PostingError, match='PERIOD_LOCKED'):
        await approve(entry)
    assert entry == before == await isolated_posting.get_journal(entry['journal_id'])
    assert not await stored_lines(isolated_posting)


@pytest.mark.asyncio
@pytest.mark.parametrize('accounting_date,period,error', [
    ('2026-09-15', '2026-11', 'PERIOD_DATE_MISMATCH'),
    ('2026-02-30', '2026-02', 'INVALID_ACCOUNTING_DATE'),
    ('2026-10-15', '2026', 'INVALID_PERIOD'),
])
async def test_authenticated_approval_cannot_bypass_cutoff(guarded_repo, client, accounting_date, period, error):
    await lock(guarded_repo, '2026-09')
    entry = await dated(guarded_repo, accounting_date, period)
    before = deepcopy(entry)
    await login_as(client, 'test-cpa-human')
    response = await client.post(f"/api/v1/vouchers/{entry['journal_id']}/approve", json={})
    assert response.status_code == 400 and error in response.text
    assert await guarded_repo.get_journal(entry['journal_id']) == before
    assert not await stored_lines(guarded_repo)
