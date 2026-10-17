"""Human sessions and read-only governance, backed by persistent credentials."""
import asyncio
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update, case

from app.core.auth import (AuthEventModel, AuthSessionModel, AuthThrottleModel, ApiCredentialModel,
    PrincipalModel, PrincipalSecretModel, AuthPrincipal, COOKIE, SESSION_SECONDS, check_origin,
    digest, get_current_principal, hasher, _dummy_hash)
from app.core.db import db_manager
from argon2.exceptions import VerificationError, InvalidHashError

router = APIRouter(prefix="/api/v1", tags=["authentication"])


class LoginRequest(BaseModel):
    model_config = {"extra": "forbid"}
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response):
    check_origin(request)
    now = int(time.time())
    # Trust the connection peer, never an untrusted X-Forwarded-For header.
    peer = request.client.host if request.client else "unknown"
    buckets = [digest("ip:" + peer), digest("user:" + body.username)]
    async with db_manager.session_factory() as db:
        # Upsert + conditional UPDATE works across processes and concurrent
        # first attempts. Reserve a bounded budget before expensive Argon2 work.
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        from sqlalchemy.dialects.postgresql import insert as postgres_insert
        insert = sqlite_insert if db_manager.is_sqlite else postgres_insert
        for bucket in buckets:
            await db.execute(insert(AuthThrottleModel).values(bucket=bucket, failures=0,
                window_start=now, locked_until=0).on_conflict_do_nothing(index_elements=["bucket"]))
            stale = AuthThrottleModel.window_start <= now - 900
            result = await db.execute(update(AuthThrottleModel).where(
                AuthThrottleModel.bucket == bucket, AuthThrottleModel.locked_until <= now,
                (AuthThrottleModel.failures < 20) | stale
            ).values(failures=case((stale, 1), else_=AuthThrottleModel.failures + 1),
                window_start=case((stale, now), else_=AuthThrottleModel.window_start)))
            if result.rowcount != 1:
                raise HTTPException(429, "Too many login attempts. Please try again later.", headers={"Retry-After": "900"})
        await db.commit()
        row = await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == body.username))
        secret = await db.get(PrincipalSecretModel, row.principal_id) if row else None
        try:
            valid = await asyncio.to_thread(hasher.verify, secret.password_hash if secret else _dummy_hash, body.password)
        except (VerificationError, InvalidHashError):
            valid = False
        if not valid or not row or row.status != "ACTIVE" or not row.is_human or not secret:
            for bucket in buckets:
                throttle = await db.get(AuthThrottleModel, bucket, populate_existing=True)
                if throttle.failures >= 5:
                    throttle.locked_until = now + min(900, 30 * 2 ** min(throttle.failures - 5, 5))
            db.add(AuthEventModel(event="LOGIN_FAIL", principal_key=body.username))
            await db.commit()
            raise HTTPException(401, "Invalid username or password.")
        await db.execute(update(AuthThrottleModel).where(AuthThrottleModel.bucket == buckets[0]).values(failures=case((AuthThrottleModel.failures > 0, AuthThrottleModel.failures - 1), else_=0)))
        # Reset only this account's bucket: an attacker cannot reset a shared
        # IP budget by interleaving successful logins to a different account.
        await db.execute(update(AuthThrottleModel).where(AuthThrottleModel.bucket == buckets[1]).values(failures=0, locked_until=0))
        if hasher.check_needs_rehash(secret.password_hash):
            secret.password_hash = await asyncio.to_thread(hasher.hash, body.password)
        old = request.cookies.get(COOKIE)
        if old:
            await db.execute(update(AuthSessionModel).where(AuthSessionModel.session_id == digest(old)).values(revoked_at=now))
        token = secrets.token_urlsafe(40)
        csrf = digest("csrf:" + token)
        session = AuthSessionModel(session_id=digest(token), principal_id=row.principal_id,
            csrf_hash=digest(csrf), created_at=now, expires_at=now + SESSION_SECONDS)
        db.add(session)
        db.add(AuthEventModel(event="LOGIN_OK", principal_key=row.principal_key, credential_id=session.session_id))
        await db.commit()
    import os
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite="strict",
        secure=os.environ.get("AAS_COOKIE_SECURE", "true").lower() != "false", path="/api/v1")
    response.headers["Cache-Control"] = "no-store"
    from app.core.auth import principal_from
    return {"principal": principal_from(row, session.session_id, "session").public(), "csrfToken": csrf}


@router.get("/auth/me")
async def me(request: Request, response: Response, principal: AuthPrincipal = Depends(get_current_principal)):
    response.headers["Cache-Control"] = "no-store"
    csrf = digest("csrf:" + request.cookies.get(COOKIE, ""))
    return {"principal": principal.public(), "csrfToken": csrf if principal.method == "session" else None}


@router.post("/auth/logout")
async def logout(response: Response, principal: AuthPrincipal = Depends(get_current_principal)):
    async with db_manager.session_factory() as db:
        if principal.method == "session":
            await db.execute(update(AuthSessionModel).where(AuthSessionModel.session_id == principal.credential_id).values(revoked_at=int(time.time())))
        db.add(AuthEventModel(event="LOGOUT", principal_key=principal.principal_key, credential_id=principal.credential_id))
        await db.commit()
    response.delete_cookie(COOKIE, path="/api/v1")
    response.headers["Cache-Control"] = "no-store"
    return {"status": "SIGNED_OUT"}


def admin(principal: AuthPrincipal = Depends(get_current_principal)):
    if principal.position.position_id != "ADMIN":
        raise HTTPException(403, "ADMIN_REQUIRED")
    return principal


@router.get("/admin/overview")
async def overview(response: Response, principal: AuthPrincipal = Depends(admin)):
    response.headers["Cache-Control"] = "no-store"
    async with db_manager.session_factory() as db:
        rows = (await db.scalars(select(PrincipalModel).order_by(PrincipalModel.principal_key))).all()
        events = (await db.scalars(select(AuthEventModel).order_by(AuthEventModel.occurred_at.desc()).limit(100))).all()
        credentials = (await db.scalars(select(ApiCredentialModel))).all()
        sessions = (await db.scalars(select(AuthSessionModel).where(AuthSessionModel.revoked_at.is_(None), AuthSessionModel.expires_at > int(time.time())))).all()
        return {"principals": [{"principalKey": r.principal_key, "displayName": r.display_name, "positionId": r.position_id, "isHuman": r.is_human, "status": r.status} for r in rows],
            "events": [{"eventId": e.event_id, "timestamp": e.occurred_at, "event": e.event, "principalKey": e.principal_key, "detail": e.detail} for e in events],
            "credentials": [{"credentialId": c.credential_id, "principalId": c.principal_id, "prefix": c.token_prefix, "expiresAt": c.expires_at, "revokedAt": c.revoked_at, "lastUsedAt": c.last_used_at} for c in credentials],
            "sessions": [{"sessionId": s.session_id, "principalId": s.principal_id, "expiresAt": s.expires_at} for s in sessions]}
