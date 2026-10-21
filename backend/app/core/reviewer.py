"""Shared reviewer identity and position policy for legacy REST and scoped MCP.

Checklist requirements and amount-based escalation remain transport-specific.
Identity caches are compatibility adapters, not sources of review authority.
"""
from dataclasses import dataclass, replace
from uuid import UUID

from sqlalchemy import select

from app.core.auth import PrincipalModel
from app.core.db import db_manager
from app.core.positions import POSITIONS, Position, may_review, required_reviewer
from app.core.sod_guard import AgentIdentity, AgentRole


class ReviewAuthorizationError(ValueError):
    pass


@dataclass(frozen=True)
class ReviewerAuthority:
    identity: AgentIdentity
    position: Position
    preparer: Position


def validate_verdict(verdict: str, allowed=("APPROVE", "REJECT", "ESCALATE")) -> str:
    normalized = (verdict or "").upper()
    if normalized not in allowed:
        raise ValueError("INVALID_VERDICT: verdict must be " + " / ".join(allowed))
    return normalized


async def authorize_review(principal_key: str, journal: dict, *, principal_id: str | None = None) -> ReviewerAuthority:
    """Resolve current durable authority, including both halves of maker identity.

    An auth-bound ID must match its key. A stale PositionSession's position is
    deliberately ignored: a current demotion must apply to the next review.
    """
    async with db_manager.session_factory() as db:
        actor = await db.scalar(select(PrincipalModel).where(PrincipalModel.principal_key == principal_key))
        maker = await db.scalar(select(PrincipalModel).where(
            PrincipalModel.principal_key == journal.get("created_by_principal_key")))
        if not actor or actor.status != "ACTIVE" or actor.position_id not in POSITIONS:
            raise ReviewAuthorizationError("UNKNOWN_REVIEWER_PRINCIPAL: active reviewer identity required")
        if principal_id is not None and str(actor.principal_id) != str(principal_id):
            raise ReviewAuthorizationError("REVIEWER_IDENTITY_MISMATCH: principal key and ID disagree")
        if (not maker or maker.status != "ACTIVE" or maker.position_id not in POSITIONS
                or not journal.get("created_by_principal_id")
                or str(maker.principal_id) != str(journal["created_by_principal_id"])):
            raise ReviewAuthorizationError("UNKNOWN_PREPARER_POSITION: missing, inactive or mismatched creator identity")
        if actor.principal_id == maker.principal_id:
            raise ReviewAuthorizationError("SOD_MAKER_CHECKER_VIOLATION: maker cannot review their own voucher")
        position = replace(POSITIONS[actor.position_id], is_human=actor.is_human)
        preparer = replace(POSITIONS[maker.position_id], is_human=maker.is_human)
        if not preparer.can_prepare:
            raise ReviewAuthorizationError("SOD_POSITION_VIOLATION: creator position cannot prepare vouchers")
        if not may_review(position, preparer):
            raise ReviewAuthorizationError(
                f"SOD_POSITION_VIOLATION: {position.position_id} cannot review {preparer.position_id}; "
                f"requires {required_reviewer(preparer).position_id}")
        # Owner decision (ADR-0001 O2-g): outside an auto-post policy, a person
        # decides. An agent may pre-review and advise but never change review state.
        if not actor.is_human:
            raise ReviewAuthorizationError(
                "HUMAN_REVIEWER_REQUIRED: agents may pre-review and advise; approval, rejection "
                "and escalation require a human reviewer")
        identity = AgentIdentity(
            principal_id=UUID(actor.principal_id), agent_name=actor.display_name,
            role=AgentRole.HUMAN_CPA if position.position_id == "CPA_ADVISOR" else AgentRole.CHECKER_CONTROLLER,
            max_auto_approve_func_amount=actor.max_auto_approve_func_amount,
            min_confidence_threshold=actor.min_confidence_threshold,
        )
        return ReviewerAuthority(identity, position, preparer)
