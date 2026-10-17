"""Authentication boundaries exercised through actual HTTP dependencies and DB rows."""
import time
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

from app.main import app
from app.core.auth import (ApiCredentialModel, AuthSessionModel, AuthThrottleModel, PrincipalModel,
    PrincipalSecretModel, digest, issue_key, resolve_api_key)
from app.core.db import MonolithWorkspaceModel, db_manager
from conftest import login_as, agent_as


@pytest_asyncio.fixture
async def raw_client():
    async with db_manager.session_factory() as db:
        await db.execute(delete(AuthThrottleModel))
        await db.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://testserver") as client:
        yield client
    async with db_manager.session_factory() as db:
        await db.execute(delete(AuthThrottleModel))
        await db.commit()


@pytest.mark.asyncio
async def test_private_routes_have_no_anonymous_entry(raw_client):
    for method, path in [('GET', '/api/v1/monolith/workspace'), ('GET', '/api/v1/ledger/journals'),
                         ('GET', '/api/v1/admin/overview'), ('GET', '/api/v1/auth/me'),
                         ('POST', '/api/v1/desktop/backup'), ('POST', '/api/v1/vouchers'),
                         ('GET', '/api/v1/documents?entity_code=AU-OPC-01')]:
        response = await raw_client.request(method, path, json={} if method == 'POST' else None)
        assert response.status_code == 401, (path, response.text)


@pytest.mark.asyncio
async def test_password_session_cookie_csrf_and_revocation(raw_client):
    result = await raw_client.post('/api/v1/auth/login', json={'username': 'test-finance-human', 'password': 'test-fixture-password-only'})
    assert result.status_code == 200, result.text
    cookie = result.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'secure' in cookie and 'samesite=strict' in cookie
    session_token = result.cookies['aas_session']
    csrf = result.json()['csrfToken']
    async with db_manager.session_factory() as db:
        session = await db.get(AuthSessionModel, digest(session_token))
        assert session and session.session_id != session_token
        secret = await db.get(PrincipalSecretModel, session.principal_id)
        assert secret.password_hash.startswith('$argon2id$')
        assert 'test-fixture-password-only' not in secret.password_hash
    assert (await raw_client.get('/api/v1/monolith/workspace')).status_code == 200
    assert (await raw_client.post('/api/v1/auth/logout')).status_code == 403
    assert (await raw_client.post('/api/v1/auth/logout', headers={'X-CSRF-Token': csrf, 'Origin': 'https://untrusted.example'})).status_code == 403
    # Reloading /me must not break other tabs' CSRF material.
    assert (await raw_client.get('/api/v1/auth/me')).json()['csrfToken'] == csrf
    assert (await raw_client.post('/api/v1/auth/logout', headers={'X-CSRF-Token': csrf})).status_code == 200
    raw_client.cookies.set('aas_session', session_token)
    assert (await raw_client.get('/api/v1/auth/me')).status_code == 401


@pytest.mark.asyncio
async def test_uniform_failures_and_persistent_throttling(raw_client):
    bad = {'username': 'test-finance-human', 'password': 'incorrect-password'}
    first = await raw_client.post('/api/v1/auth/login', json=bad)
    unknown = await raw_client.post('/api/v1/auth/login', json={**bad, 'username': 'unknown-account'})
    assert first.status_code == unknown.status_code == 401
    assert first.json() == unknown.json()
    for _ in range(4):
        await raw_client.post('/api/v1/auth/login', json=bad)
    blocked = await raw_client.post('/api/v1/auth/login', json=bad)
    assert blocked.status_code == 429
    assert int(blocked.headers['retry-after']) > 0


@pytest.mark.asyncio
async def test_api_keys_hashed_expired_and_immediately_revoked(raw_client):
    key = await issue_key('ar-clerk-01')
    async with db_manager.session_factory() as db:
        row = await db.get(ApiCredentialModel, key['credentialId'])
        assert row.token_hash == digest(key['token']) and row.token_hash != key['token']
    assert (await resolve_api_key(key['token'])).position.position_id == 'AR_CLERK'
    assert await resolve_api_key('tok-ar-01') is None
    async with db_manager.session_factory() as db:
        await db.execute(update(ApiCredentialModel).where(ApiCredentialModel.credential_id == key['credentialId']).values(expires_at=int(time.time()) - 1))
        await db.commit()
    assert await resolve_api_key(key['token']) is None
    rotated = await issue_key('ar-clerk-01')
    async with db_manager.session_factory() as db:
        await db.execute(update(ApiCredentialModel).where(ApiCredentialModel.credential_id == rotated['credentialId']).values(revoked_at=int(time.time())))
        await db.commit()
    assert await resolve_api_key(rotated['token']) is None


@pytest.mark.asyncio
async def test_admin_separation_and_read_only_governance(raw_client):
    await login_as(raw_client, 'test-admin-human')
    result = await raw_client.get('/api/v1/admin/overview')
    assert result.status_code == 200
    assert 'password_hash' not in result.text and 'token_hash' not in result.text
    assert (await raw_client.get('/api/v1/monolith/workspace')).status_code == 403
    assert (await raw_client.get('/api/v1/reporting/AU-OPC-01/2026-10')).status_code == 403
    await login_as(raw_client, 'test-finance-human')
    assert (await raw_client.get('/api/v1/admin/overview')).status_code == 403


@pytest.mark.asyncio
async def test_caller_cannot_claim_another_identity(raw_client):
    await agent_as(raw_client, 'ap-clerk-01')
    forged = await raw_client.post('/api/v1/vouchers', json={'created_by_principal_key': 'cpa-griffin'})
    assert forged.status_code == 422
    forged_review = await raw_client.post('/api/v1/journals/not-real/review', json={'reviewer_principal_key': 'cpa-griffin'})
    assert forged_review.status_code == 403
    assert (await raw_client.get('/api/v1/monolith/workspace')).status_code == 403
    assert (await raw_client.put('/api/v1/entities/AU-OPC-01/chart-of-accounts/1110', json={})).status_code == 403


@pytest.mark.asyncio
async def test_session_suspension_and_expiry_are_checked_per_request(raw_client):
    await login_as(raw_client, 'test-finance-human')
    async with db_manager.session_factory() as db:
        await db.execute(update(AuthSessionModel).where(AuthSessionModel.session_id == digest(raw_client.cookies.get('aas_session'))).values(expires_at=int(time.time()) - 1))
        await db.commit()
    assert (await raw_client.get('/api/v1/auth/me')).status_code == 401
    await login_as(raw_client, 'test-finance-human')
    async with db_manager.session_factory() as db:
        await db.execute(update(PrincipalModel).where(PrincipalModel.principal_key == 'test-finance-human').values(status='SUSPENDED'))
        await db.commit()
    try:
        assert (await raw_client.get('/api/v1/auth/me')).status_code == 401
    finally:
        async with db_manager.session_factory() as db:
            await db.execute(update(PrincipalModel).where(PrincipalModel.principal_key == 'test-finance-human').values(status='ACTIVE'))
            await db.commit()


@pytest.mark.asyncio
async def test_readonly_and_mfa_boundaries_cannot_be_bypassed(raw_client):
    await agent_as(raw_client, 'auditor-readonly-01')
    state = (await raw_client.get('/api/v1/monolith/workspace')).json()
    for action in ['invoice.create', 'journal.create', 'budget.save', 'period.lock', 'period.unlock']:
        response = await raw_client.post('/api/v1/monolith/commands', json={'action': action, 'payload': {}, 'revision': state['revision'], 'commandId': str(uuid4())})
        assert response.status_code == 403, response.text
    await login_as(raw_client, 'test-cpa-human')
    for path in ['/api/v1/reporting/AU-OPC-01/2026-10/lock', '/api/v1/entities/AU-OPC-01/periods/2026-10/close']:
        assert (await raw_client.post(path, json={})).status_code == 403


@pytest.mark.asyncio
async def test_mcp_uses_same_db_credentials_and_position_boundary(raw_client):
    # Unauthorized/mismatched requests are rejected before MCP protocol startup.
    for token, expected in [('tok-ar-01', 401), ((await issue_key('ar-clerk-01'))['token'], 403)]:
        response = await raw_client.post('/mcp/cashier/', headers={'Authorization': 'Bearer ' + token}, json={})
        assert response.status_code == expected, response.text
    from app.mcp_roles import resolve_token
    key = await issue_key('cashier-01')
    resolved = await resolve_token(key['token'])
    assert resolved.principal_key == 'cashier-01' and resolved.credential_id == key['credentialId']
    assert resolved.token == ''  # Never carry the raw secret into tool context/audit.


@pytest.mark.asyncio
async def test_concurrent_first_login_attempts_do_not_bypass_throttle_or_crash(raw_client):
    import asyncio
    responses = await asyncio.gather(*[
        raw_client.post('/api/v1/auth/login', json={'username': 'unknown-concurrent-user', 'password': 'not-a-real-password'})
        for _ in range(6)
    ])
    assert all(response.status_code in {401, 429} for response in responses)
    assert (await raw_client.post('/api/v1/auth/login', json={'username': 'unknown-concurrent-user', 'password': 'not-a-real-password'})).status_code == 429
