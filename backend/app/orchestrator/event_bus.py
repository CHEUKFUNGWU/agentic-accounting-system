"""
Hybrid Event-Driven Agent Orchestrator (Transactional Outbox + Stateless MCP Client / Webhook Dispatcher).

Supports bidirectional agentic workflows:
  1. Inbound (Pull): External AI Agents call `POST /mcp` directly over Stateless Streamable HTTP.
  2. Outbound (Push): Domain state transitions (e.g., `invoice.received`, `bank_feed.imported`,
     `proposal.pending_checker`, `proposal.awaiting_cpa`, `period.soft_closed`, `journal.posted`)
     write atomically to `outbox_events` and are dispatched by this orchestrator to awaken
     the subscribed Maker, Checker, or Auditor Agent.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, List
from uuid import UUID, uuid4

import httpx

logger = logging.getLogger("agentic_accounting.orchestrator")


@dataclass
class DomainOutboxEvent:
    event_id: UUID = field(default_factory=uuid4)
    event_type: str = ""
    entity_code: str = ""
    aggregate_id: str = ""
    payload: Dict[str, Any] = field(default_factory=dict)
    status: str = "PENDING"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class AgentSubscriptionRule:
    subscription_id: UUID
    agent_name: str
    agent_role: str
    event_type: str
    callback_transport: str  # "WEBHOOK_POST" | "MCP_CLIENT_HTTP" | "INTERNAL_HANDLER"
    target_endpoint_url: str
    recommended_mcp_tool_or_prompt: str


class HybridEventOrchestrator:
    """
    Transactional Outbox Event Bus that coordinates the Autonomous Agent Accounting Team
    without coupling the core accounting engine to stateful agent sessions.
    """

    def __init__(self) -> None:
        self._outbox_queue: asyncio.Queue[DomainOutboxEvent] = asyncio.Queue()
        self._recent_events: List[DomainOutboxEvent] = []
        self._sse_subscribers: List[asyncio.Queue[DomainOutboxEvent]] = []
        self._subscriptions: List[AgentSubscriptionRule] = self._default_agent_team_subscriptions()
        self._worker_task: asyncio.Task[None] | None = None

    @staticmethod
    def _default_agent_team_subscriptions() -> List[AgentSubscriptionRule]:
        return [
            AgentSubscriptionRule(
                subscription_id=UUID("11111111-1111-1111-1111-111111111101"),
                agent_name="ap-3way-matcher-agent",
                agent_role="MAKER_AP",
                event_type="invoice.received",
                callback_transport="WEBHOOK_POST",
                target_endpoint_url="http://localhost:8101/agents/ap-maker/wakeup",
                recommended_mcp_tool_or_prompt="propose_three_way_match_bill",
            ),
            AgentSubscriptionRule(
                subscription_id=UUID("11111111-1111-1111-1111-111111111102"),
                agent_name="bank-reconciliation-agent",
                agent_role="MAKER_BANK_REC",
                event_type="bank_feed.imported",
                callback_transport="WEBHOOK_POST",
                target_endpoint_url="http://localhost:8102/agents/bank-rec/wakeup",
                recommended_mcp_tool_or_prompt="propose_bank_reconciliation",
            ),
            AgentSubscriptionRule(
                subscription_id=UUID("11111111-1111-1111-1111-111111111103"),
                agent_name="close-and-consolidation-agent",
                agent_role="MAKER_CLOSE_CONSOL",
                event_type="period.soft_closed",
                callback_transport="WEBHOOK_POST",
                target_endpoint_url="http://localhost:8103/agents/close-consol/wakeup",
                recommended_mcp_tool_or_prompt="global-month-end-close-sop",
            ),
            AgentSubscriptionRule(
                subscription_id=UUID("11111111-1111-1111-1111-111111111104"),
                agent_name="controller-reviewer-agent",
                agent_role="CHECKER_CONTROLLER",
                event_type="proposal.pending_checker",
                callback_transport="WEBHOOK_POST",
                target_endpoint_url="http://localhost:8104/agents/controller-checker/wakeup",
                recommended_mcp_tool_or_prompt="review_and_approve_proposal",
            ),
            AgentSubscriptionRule(
                subscription_id=UUID("11111111-1111-1111-1111-111111111105"),
                agent_name="continuous-internal-auditor-agent",
                agent_role="AUDITOR_INTERNAL",
                event_type="journal.posted",
                callback_transport="WEBHOOK_POST",
                target_endpoint_url="http://localhost:8105/agents/internal-auditor/wakeup",
                recommended_mcp_tool_or_prompt="statutory-tax-audit-sop",
            ),
        ]

    async def start(self) -> None:
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._consume_outbox_loop())
            logger.info("Hybrid Event-Driven Agent Orchestrator started.")

    async def stop(self) -> None:
        if self._worker_task is not None:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

    async def publish_outbox_event(
        self,
        event_type: str,
        entity_code: str,
        aggregate_id: str,
        payload: Dict[str, Any],
    ) -> DomainOutboxEvent:
        event = DomainOutboxEvent(
            event_type=event_type,
            entity_code=entity_code,
            aggregate_id=aggregate_id,
            payload=payload,
        )
        self._recent_events.insert(0, event)
        del self._recent_events[100:]
        await self._outbox_queue.put(event)
        for subscriber_q in list(self._sse_subscribers):
            await subscriber_q.put(event)
        return event

    def get_recent_events(self) -> List[DomainOutboxEvent]:
        return list(self._recent_events)

    def get_subscriptions(self) -> List[AgentSubscriptionRule]:
        return list(self._subscriptions)

    def subscribe_sse(self) -> asyncio.Queue[DomainOutboxEvent]:
        q: asyncio.Queue[DomainOutboxEvent] = asyncio.Queue()
        self._sse_subscribers.append(q)
        return q

    def unsubscribe_sse(self, q: asyncio.Queue[DomainOutboxEvent]) -> None:
        if q in self._sse_subscribers:
            self._sse_subscribers.remove(q)

    async def _consume_outbox_loop(self) -> None:
        async with httpx.AsyncClient(timeout=5.0) as http_client:
            while True:
                event = await self._outbox_queue.get()
                matching_rules = [s for s in self._subscriptions if s.event_type == event.event_type]
                for rule in matching_rules:
                    dispatch_envelope = {
                        "event_id": str(event.event_id),
                        "event_type": event.event_type,
                        "entity_code": event.entity_code,
                        "aggregate_id": event.aggregate_id,
                        "target_agent": rule.agent_name,
                        "target_role": rule.agent_role,
                        "mcp_stateless_endpoint": "http://localhost:8000/mcp",
                        "recommended_mcp_action": rule.recommended_mcp_tool_or_prompt,
                        "payload": event.payload,
                    }
                    try:
                        await http_client.post(rule.target_endpoint_url, json=dispatch_envelope)
                        event.status = "DISPATCHED"
                    except httpx.HTTPError:
                        # External agent listener is optional in local dev; event remains logged for polling/SSE
                        event.status = "QUEUED_FOR_STATELESS_POLL"
                self._outbox_queue.task_done()


orchestrator = HybridEventOrchestrator()
