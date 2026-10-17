"""Persistent authentication shared by HTTP and the position-scoped MCP gateway.

No default credentials are installed. Provision identities with app.auth_cli.
Accounting permissions remain code-owned in positions.py.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
import time
from dataclasses import dataclass, replace
from decimal import Decimal
from uuid import UUID, uuid4

from argon2 import PasswordHasher
from fastapi import HTTPException, Request, Response
from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, select, update
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, db_manager
from app.core.positions import POSITIONS, Position

COOKIE = "aas_session"
SESSION_SECONDS = 8 * 60 * 60
hasher = PasswordHasher()
# One process-local dummy hash makes unknown-account password checks comparable.
_dummy_hash = hasher.hash(secrets.token_urlsafe(32))


class PrincipalModel(Base):
    __tablename__ = "principals"
    principal_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    principal_key: Mapped[str] = mapped_column(String(80), unique=True)
    display_name: Mapped[str] = mapped_column(String(160))
    position_id: Mapped[str] = mapped_column(String(40))
    is_human: Mapped[bool] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE")
    max_auto_approve_func_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    min_confidence_threshold: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.9"))
    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()))


class PrincipalSecretModel(Base):
    __tablename__ = "principal_secrets"
    principal_id: Mapped[str] = mapped_column(ForeignKey("principals.principal_id"), primary_key=True)
    password_hash: Mapped[str] = mapped_column(Text)


class ApiCredentialModel(Base):
    __tablename__ = "api_credentials"
    credential_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    principal_id: Mapped[str] = mapped_column(ForeignKey("principals.principal_id"), index=True)
    token_prefix: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    issued_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer)
    last_used_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revoked_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AuthSessionModel(Base):
    __tablename__ = "auth_sessions"
    # Opaque session tokens and CSRF tokens are stored only as hashes.
    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    principal_id: Mapped[str] = mapped_column(ForeignKey("principals.principal_id"), index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer)
    revoked_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AuthEventModel(Base):
    __tablename__ = "auth_events"
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    occurred_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)
    event: Mapped[str] = mapped_column(String(40))
    principal_key: Mapped[str] = mapped_column(String(80))
    credential_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str] = mapped_column(String(500), default="")


class AuthThrottleModel(Base):
    __tablename__ = "auth_throttles"
    bucket: Mapped[str] = mapped_column(String(64), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    window_start: Mapped[int] = mapped_column(Integer)
    locked_until: Mapped[int] = mapped_column(Integer, default=0)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def allowed_origins() -> list[str]:
    return [v.strip() for v in os.environ.get("AAS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if v.strip() and v.strip() != "*"]


def check_origin(request: Request):
    origin = request.headers.get("origin")
    if origin and origin not in allowed_origins() and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "ORIGIN_NOT_ALLOWED")


@dataclass(frozen=True)
class AuthPrincipal:
    principal_key: str
    principal_id: str
    display_name: str
    position: Position
    is_human: bool
    credential_id: str
    method: str

    def public(self):
        return {"principalKey": self.principal_key, "displayName": self.display_name,
                "positionId": self.position.position_id, "positionTitle": self.position.title_en,
                "isHuman": self.is_human, "canPrepare": self.position.can_prepare,
                "canReview": self.position.can_review, "isAdmin": self.position.position_id == "ADMIN",
                "canReadWorkspace": self.position.read_all_accounts,
                "commands": sorted(monolith_actions(self))}


def principal_from(row, credential_id, method):
    if not row or row.status != "ACTIVE" or row.position_id not in POSITIONS:
        return None
    pos = replace(POSITIONS[row.position_id], is_human=row.is_human)
    result = AuthPrincipal(row.principal_key, row.principal_id, row.display_name, pos, row.is_human, credential_id, method)
    # Compatibility adapter for the legacy deterministic ledger. The DB is the
    # authority for the current request; these maps contain no credentials.
    from app.mcp_server import PRINCIPALS
    from app.core.positions import PRINCIPAL_ALIASES
    from app.core.sod_guard import AgentIdentity, AgentRole
    roles = {"CASHIER": AgentRole.MAKER_BANK_REC, "AR_CLERK": AgentRole.MAKER_AR_REVREC,
             "AP_CLERK": AgentRole.MAKER_AP, "FA_CLERK": AgentRole.MAKER_INV_FA,
             "TAX_CLERK": AgentRole.MAKER_BOOKKEEPER, "GL_ACCOUNTANT": AgentRole.CHECKER_CONTROLLER,
             "FINANCE_MANAGER": AgentRole.CHECKER_CONTROLLER, "CPA_ADVISOR": AgentRole.HUMAN_CPA,
             "FOUNDER_DIRECTOR": AgentRole.HUMAN_CPA}
    PRINCIPAL_ALIASES[row.principal_key] = row.position_id
    from app.core.positions import PRINCIPAL_POSITIONS
    PRINCIPAL_POSITIONS[row.principal_key] = pos
    PRINCIPALS[row.principal_key] = AgentIdentity(principal_id=UUID(row.principal_id), agent_name=row.display_name,
        role=roles.get(row.position_id, AgentRole.AUDITOR_INTERNAL),
        max_auto_approve_func_amount=row.max_auto_approve_func_amount, min_confidence_threshold=row.min_confidence_threshold)
    return result


async def resolve_api_key(token: str):
    if not token.startswith("aas1.") or len(token) > 200:
        return None
    now = int(time.time())
    async with db_manager.session_factory() as db:
        credential = await db.scalar(select(ApiCredentialModel).where(ApiCredentialModel.token_hash == digest(token)))
        if not credential or credential.revoked_at is not None or credential.expires_at <= now:
            return None
        row = await db.get(PrincipalModel, credential.principal_id)
        if not row or row.is_human:
            return None
        principal = principal_from(row, credential.credential_id, "bearer")
        if principal:
            credential.last_used_at = now
            await db.commit()
        return principal


async def get_current_principal(request: Request) -> AuthPrincipal:
    if getattr(request.state, "principal", None):
        return request.state.principal
    raw = request.headers.get("authorization", "")
    principal = None
    if raw:
        if raw.lower().startswith("bearer "):
            principal = await resolve_api_key(raw[7:].strip())
    else:
        token = request.cookies.get(COOKIE, "")
        if token and len(token) <= 200:
            async with db_manager.session_factory() as db:
                session = await db.get(AuthSessionModel, digest(token))
                if session and session.revoked_at is None and session.expires_at > int(time.time()):
                    principal = principal_from(await db.get(PrincipalModel, session.principal_id), session.session_id, "session")
                    if principal and not principal.is_human:
                        principal = None
                    if principal and request.method not in {"GET", "HEAD", "OPTIONS"}:
                        check_origin(request)
                        if not secrets.compare_digest(session.csrf_hash, digest(request.headers.get("x-csrf-token", ""))):
                            raise HTTPException(403, "CSRF_TOKEN_REQUIRED")
    if not principal:
        raise HTTPException(401, "UNAUTHENTICATED", headers={"WWW-Authenticate": "Bearer"})
    request.state.principal = principal
    return principal


# The Monolith API returns a whole ledger aggregate. Scoped clerks must use
# their MCP surfaces until projections exist; do not leak the aggregate to them.
def monolith_actions(principal):
    from app.core.positions import monolith_commands
    return monolith_commands(principal.position)

async def enforce_api_access(request: Request, response: Response):
    path = request.url.path
    if not path.startswith("/api/v1/") or path in {"/api/v1/auth/login"}:
        return
    response.headers["Cache-Control"] = "no-store"
    principal = await get_current_principal(request)
    pos = principal.position
    if path.startswith(("/api/v1/auth/", "/api/v1/admin/")):
        if path.startswith("/api/v1/admin/") and pos.position_id != "ADMIN":
            raise HTTPException(403, "ADMIN_REQUIRED")
        return
    if path.startswith("/api/v1/monolith/"):
        if not pos.read_all_accounts:
            raise HTTPException(403, "WORKSPACE_SCOPE_REQUIRED: Use your position-scoped MCP surface.")
        return  # Commands authorize the action inside the revision transaction.
    if path.startswith(("/api/v1/audit/", "/api/v1/desktop/", "/api/v1/mcp/")):
        if pos.position_id not in {"ADMIN", "CPA_ADVISOR", "FOUNDER_DIRECTOR", "FINANCE_MANAGER", "GL_ACCOUNTANT", "AUDITOR_READONLY"}:
            raise HTTPException(403, "GOVERNANCE_ROLE_REQUIRED")
        if request.method == "POST" and pos.position_id != "ADMIN":
            raise HTTPException(403, "ADMIN_REQUIRED")
        return
    if pos.position_id == "ADMIN":
        raise HTTPException(403, "ACCOUNTING_ACCESS_DENIED")
    if request.method in {"GET", "HEAD"}:
        if not pos.read_all_accounts:
            raise HTTPException(403, "ACCOUNT_SCOPE_REQUIRED: Use your position-scoped MCP surface.")
        return
    if path.endswith(("/lock", "/close")):
        raise HTTPException(403, "MFA_REQUIRED: Signing and closing require the upcoming MFA enrollment flow.")
    if path.endswith(("/review", "/approve", "/reject")):
        if not pos.can_review:
            raise HTTPException(403, "REVIEW_PERMISSION_REQUIRED")
        return
    if pos.position_id == "AP_CLERK" and not (
        path == "/api/v1/webhooks/personal-expense-split" or path == "/api/v1/reporting/aje"
        or path.startswith(("/api/v1/documents", "/api/v1/vouchers"))
    ):
        raise HTTPException(403, "COMMAND_NOT_AUTHORIZED")
    if not pos.can_prepare:
        raise HTTPException(403, "PREPARE_PERMISSION_REQUIRED")
    # The remaining aggregate legacy mutations require broad account scope;
    # per-account preparation stays on the existing guarded MCP tools.
    if "*" not in pos.account_scope and pos.position_id != "AP_CLERK":
        raise HTTPException(403, "ACCOUNT_SCOPE_REQUIRED")


async def seed_principals():
    from app.mcp_server import PRINCIPALS
    from app.core.positions import position_for_principal
    async with db_manager.session_factory() as db:
        for key, old in PRINCIPALS.items():
            position = position_for_principal(key)
            if position and not await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == key)):
                db.add(PrincipalModel(principal_id=str(old.principal_id), principal_key=key,
                    display_name=old.agent_name, position_id=position.position_id,
                    is_human=position.is_human, status="ACTIVE",
                    max_auto_approve_func_amount=old.max_auto_approve_func_amount,
                    min_confidence_threshold=old.min_confidence_threshold))
        await db.commit()
        for row in (await db.scalars(select(PrincipalModel))).all():
            principal_from(row, "", "metadata")


async def provision_principal(key, name, position_id, *, password=None):
    if position_id not in POSITIONS or not key or len(key) > 80 or not name or len(name) > 160:
        raise ValueError("Use a valid principal key and position.")
    if password is not None and not 12 <= len(password) <= 256:
        raise ValueError("Passwords must contain 12–256 characters.")
    if password is None and position_id in {"ADMIN", "FOUNDER_DIRECTOR", "CPA_ADVISOR"}:
        raise ValueError("This position requires a human login.")
    password_hash = await asyncio.to_thread(hasher.hash, password) if password is not None else None
    async with db_manager.session_factory() as db:
        row = await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == key))
        if row:
            # Provisioning cannot silently change a seed's position or kind.
            if row.position_id != position_id or row.is_human != (password is not None):
                raise ValueError("Existing identity has a different position or kind. Use a new key.")
            if await db.get(PrincipalSecretModel, row.principal_id):
                raise ValueError("Identity already has a password; use reset-password.")
        else:
            row = PrincipalModel(principal_id=str(uuid4()), principal_key=key, display_name=name,
                position_id=position_id, is_human=password is not None, status="ACTIVE")
            db.add(row)
            await db.flush()
        if password_hash:
            db.add(PrincipalSecretModel(principal_id=row.principal_id, password_hash=password_hash))
        db.add(AuthEventModel(event="PRINCIPAL_PROVISIONED", principal_key=key, detail="Local operator provisioning"))
        await db.commit()
        return row.principal_id


async def issue_key(key, days=90):
    if not 1 <= days <= 90:
        raise ValueError("Credential lifetime must be 1–90 days.")
    token = "aas1." + secrets.token_urlsafe(40)
    async with db_manager.session_factory() as db:
        principal = await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == key))
        if not principal or principal.is_human or principal.status != "ACTIVE":
            raise ValueError("An active agent principal is required.")
        credential_id = str(uuid4())
        db.add(ApiCredentialModel(credential_id=credential_id, principal_id=principal.principal_id,
            token_hash=digest(token), token_prefix=token[:13], issued_at=int(time.time()),
            expires_at=int(time.time()) + days * 86400))
        db.add(AuthEventModel(event="TOKEN_ISSUED", principal_key=key, credential_id=credential_id))
        await db.commit()
    return {"credentialId": credential_id, "token": token}
