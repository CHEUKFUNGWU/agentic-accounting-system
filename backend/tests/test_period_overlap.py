"""BL-04 cross-label date locks and report movements, without fiscal close."""
from copy import deepcopy
from decimal import Decimal

import pytest
from sqlalchemy import update

from app import api_documents, mcp_server
from app.core import ledger, posting
from app.core.db import FiscalPeriodModel
from conftest import agent_as
from test_atomic_posting import isolated_posting, approve, stored_lines
from test_journal_concurrency import guarded_repo
from test_period_cutoff import dated, lock


@pytest.mark.asyncio
@pytest.mark.parametrize('accounting_date,period,locked', [
    ('2026-09-15', '2026-Q3', '2026-09'),
    ('2026-09-15', '2026-09', '2026-Q3'),
    ('2026-07-01', '2026-Q3', '2026-07'),
    ('2026-09-30', '2026-Q3', '2026-09'),
])
async def test_cross_label_locks_refuse_post_and_direct_writer(isolated_posting, accounting_date, period, locked):
    repository = isolated_posting
    entry = await dated(repository, accounting_date, period)
    await ledger.ensure_period('AU-OPC-01', period)
    await lock(repository, locked)
    before = deepcopy(entry)
    with pytest.raises(posting.PostingError, match=f'PERIOD_LOCKED:.*{locked}'):
        await approve(entry)
    with pytest.raises(ledger.LedgerError, match=f'PERIOD_LOCKED:.*{locked}'):
        await ledger.write_lines_for_entry(entry)
    assert entry == before == await repository.get_journal(entry['journal_id'])
    assert not await stored_lines(repository)


@pytest.mark.asyncio
@pytest.mark.parametrize('accounting_date,period', [
    ('2026-10-01', '2026-Q4'), ('2026-10-31', '2026-Q4'),
    ('2026-12-01', '2026-Q4'), ('2026-12-31', '2026-12'),
])
async def test_only_locks_containing_actual_date_block_posting(isolated_posting, accounting_date, period):
    await lock(isolated_posting, '2026-11')
    entry = await dated(isolated_posting, accounting_date, period)
    await approve(entry)
    rows = await stored_lines(isolated_posting)
    assert len(rows) == 2
    assert {row.period_code for row in rows} == {period}
    assert (await ledger.derive_balances('AU-OPC-01', accounting_date[:7]))['6100'].op_debit == 100


@pytest.mark.asyncio
@pytest.mark.parametrize('period,locked', [('2026-Q3', '2026-09'), ('2026-09', '2026-Q3')])
async def test_undated_period_checks_conservatively_reject_overlap(isolated_posting, period, locked):
    await lock(isolated_posting, locked)
    with pytest.raises(ledger.LedgerError, match='PERIOD_LOCKED'):
        await ledger.assert_writable('AU-OPC-01', period)
    assert (await ledger.assert_writable('AU-OPC-01', '2026-Q4'))['is_writable']


@pytest.mark.asyncio
async def test_lock_lookup_joins_caller_session_without_commit_or_nested_session(isolated_posting, monkeypatch):
    manager = isolated_posting.manager
    await ledger.ensure_period('AU-OPC-01', '2026-Q3')
    await ledger.ensure_period('AU-OPC-01', '2026-09')
    async with manager.session_factory() as session:
        await session.execute(update(FiscalPeriodModel).where(
            FiscalPeriodModel.period_id == 'AU-OPC-01:2026-09'
        ).values(status='LOCKED'))
        # An independent lookup cannot observe this uncommitted lock.
        def no_nested_session():
            pytest.fail('assert_writable opened an independent session')
        with monkeypatch.context() as patch:
            patch.setattr(manager, 'session_factory', no_nested_session)
            with pytest.raises(ledger.LedgerError, match='PERIOD_LOCKED:.*2026-09'):
                await ledger.assert_writable('AU-OPC-01', '2026-Q3', '2026-09-15', session=session)
            assert session.in_transaction()
        await session.rollback()
    assert (await ledger.assert_writable('AU-OPC-01', '2026-Q3', '2026-09-15'))['is_writable']


@pytest.mark.asyncio
@pytest.mark.parametrize('period,expected_opening,expected_op,expected_aj,expected_count', [
    ('2026-09', 100, 200, 100, 3),
    ('2026-Q3', 0, 300, 100, 4),
    ('2026-10', 400, 100, 0, 1),
])
async def test_mixed_month_quarter_reports_use_dates_once(
    isolated_posting, period, expected_opening, expected_op, expected_aj, expected_count,
):
    entity = 'AU-OPC-01'
    # Mark the credit account as cash so the direct cash-flow report is tested too.
    await ledger.upsert_account(entity, {'account_code': '1110', 'account_name': 'Cash',
                                        'account_type': 'ASSET', 'fs_category': 'CASH',
                                        'is_control_account': False})
    for accounting_date, label, layer in [
        ('2026-08-31', '2026-Q3', 'OPERATIONAL'),
        ('2026-09-01', '2026-Q3', 'OPERATIONAL'),
        ('2026-09-15', '2026-09', 'OPERATIONAL'),
        ('2026-09-30', '2026-Q3', 'AJE_MONTH_END'),
        ('2026-10-01', '2026-Q4', 'OPERATIONAL'),
    ]:
        entry = await dated(isolated_posting, accounting_date, label)
        entry['entry_layer'] = layer
        await isolated_posting.save_journal(entry)
        await approve(entry)
    balance = (await ledger.derive_balances(entity, period))['6100']
    assert (balance.opening, balance.op_debit, balance.aj_debit, balance.closing) == (
        expected_opening, expected_op, expected_aj, expected_opening + expected_op + expected_aj,
    )
    rows = await ledger.get_lines(entity, account_code='6100', period_code=period)
    assert len(rows) == expected_count == len({r['line_id'] for r in rows})
    account = await ledger.account_ledger(entity, '6100', period)
    assert len(account['movements']) == expected_count
    assert Decimal(account['movements'][-1]['balance']) == balance.closing
    assert Decimal(account['total_debit']) == expected_op + expected_aj
    tb = next(r for r in await ledger.trial_balance_from_ledger(entity, period) if r.account_code == '6100')
    assert (tb.opening_balance, tb.period_op_debit, tb.adjustment_debit) == (
        balance.opening, balance.op_debit, balance.aj_debit,
    )
    check = await ledger.assert_trial_balance(entity, period)
    assert check['period_balanced'] and check['ledger_balanced']
    assert Decimal(check['period_debit']) == Decimal(check['period_credit']) == expected_op + expected_aj
    cash = await ledger.cash_flow_breakdown(entity, period)
    assert cash['ties']
    assert Decimal(cash['movement']) == Decimal(cash['derived_movement']) == -(expected_op + expected_aj)
    # Querying a different reporting label never rewrites persisted labels.
    assert {row.period_code for row in await stored_lines(isolated_posting)} == {'2026-Q3', '2026-09', '2026-Q4'}


@pytest.mark.asyncio
async def test_monthly_only_postings_are_quarter_movements_not_opening(isolated_posting):
    for accounting_date in ('2026-07-01', '2026-08-15', '2026-09-30'):
        await approve(await dated(isolated_posting, accounting_date, accounting_date[:7]))
    balance = (await ledger.derive_balances('AU-OPC-01', '2026-Q3'))['6100']
    assert balance.opening == 0 and balance.op_debit == balance.closing == 300
    assert len(await ledger.get_lines('AU-OPC-01', period_code='2026-Q3')) == 6


@pytest.mark.asyncio
@pytest.mark.parametrize('period,locked', [('2026-Q3', '2026-09'), ('2026-09', '2026-Q3')])
async def test_rest_and_aje_ingress_cannot_bypass_cross_label_lock(guarded_repo, client, period, locked):
    await ledger.upsert_account('AU-OPC-01', {'account_code': '1420', 'account_name': 'Prepaid',
                                           'account_type': 'ASSET', 'is_control_account': False})
    await lock(guarded_repo, locked)
    before = await guarded_repo.get_journals()
    await agent_as(client, 'ap-clerk-01')
    response = await client.post('/api/v1/vouchers', json={
        'accounting_date': '2026-09-15', 'period': period,
        'lines': [{'account_code': '6100', 'debit': '100'}, {'account_code': '1110', 'credit': '100'}],
    })
    assert response.status_code == 400 and 'PERIOD_LOCKED' in response.text
    result = await mcp_server.propose_adjusting_entry(
        'AU-OPC-01', '6100', '1420', '100', 'test', period_code=period, accounting_date='2026-09-15')
    assert result['status'] == 'ERROR' and 'PERIOD_LOCKED' in result['reason']
    assert await guarded_repo.get_journals() == before


@pytest.mark.asyncio
async def test_document_month_ingress_observes_quarter_lock(guarded_repo, client, monkeypatch, tmp_path):
    monkeypatch.setattr(api_documents, 'repo', guarded_repo)
    monkeypatch.setattr(api_documents.sources, 'repo', guarded_repo)
    monkeypatch.setattr(api_documents.vz, 'attachment_root', lambda: tmp_path / 'attachments')
    evidence = api_documents.vz.save_attachment('AU-OPC-01', 'overlap.pdf', b'overlap evidence', '', 'maker')
    await lock(guarded_repo, '2026-Q3')
    await guarded_repo.save_document({'document_id': 'overlap-doc', 'entity_code': 'AU-OPC-01',
                                     'sha256': evidence['sha256'], 'stored_name': evidence['stored_name'],
                                     'doc_date': '2026-09-15', 'amount': '100', 'currency': 'AUD'})
    response = await client.post('/api/v1/documents/overlap-doc/to-voucher', json={
        'debit_account_code': '6100', 'credit_account_code': '1110',
    })
    assert response.status_code == 400 and 'PERIOD_LOCKED' in response.text
    assert (await guarded_repo.get_document('overlap-doc'))['status'] == 'NEW'
    assert not await guarded_repo.get_journals()


@pytest.mark.asyncio
@pytest.mark.parametrize('period,label', [('2026-09', '2026-Q3'), ('2026-Q3', '2026-09')])
async def test_period_close_pending_check_uses_dates(isolated_posting, monkeypatch, period, label):
    monkeypatch.setattr('app.core.repository.repo', isolated_posting)
    await dated(isolated_posting, '2026-09-15', label)
    with pytest.raises(ledger.LedgerError, match='PERIOD_HAS_UNPOSTED_VOUCHERS'):
        await ledger.close_period('AU-OPC-01', period, 'checker')
    assert (await ledger.get_period('AU-OPC-01', period))['is_writable']
