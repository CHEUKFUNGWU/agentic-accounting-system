# Roadmap code baseline

- Source ID: SRC-0006
- Inspected: 2026-10-18, Australia/Sydney
- Base commit: `67208f7d505eeefcf6a32417408959ea97236e97`
- Method: targeted source and documentation inspection, plus existing accounting tests
- Working tree was clean before planning work. No `.codegraph/` directory was present.
- This is implementation evidence, not an approved product baseline or a complete audit.

## Observed

| Finding | Inspectable evidence | Planning implication |
| --- | --- | --- |
| The default Monolith UI uses a separate persisted workspace; legacy MCP tools operate on older entities. | [Backend contract](../docs/monolith-backend.md), [Monolith commands](../backend/app/core/monolith.py), [MCP surfaces](../backend/app/mcp_roles.py) | Unify the authoritative accounting write path before allowing external agents to operate the default UI's books. |
| The Monolith aggregate commits journal, subledger, command receipt and audit changes with a revision check. | `execute_command` in [monolith.py](../backend/app/core/monolith.py) | Retain concurrency and idempotency guarantees during migration. |
| Monolith validates with Decimal but stores monetary values as JSON numbers. The UI also calculates ledger/report values with JavaScript numbers. | `money`, `append_entry`, `pair` in [monolith.py](../backend/app/core/monolith.py); [accountingLogic.ts](../frontend/src/monolith/utils/accountingLogic.ts) | Define one money/rounding contract and server-derived reports. This observation alone does not prove a financial misstatement. |
| Manual/agent journal review requires another authorized human in the default workspace. Other operational commands retain separate posting behavior. | [Authentication implementation](../docs/auth-implementation.md), `apply_command` in [monolith.py](../backend/app/core/monolith.py) | Unify policies across all write paths; add explicit policy authorization for low-risk automation. |
| Invoice issuance, bill recognition and later settlements exist; the current collection/payment commands settle the outstanding amount. | `invoice.create`, `invoice.collect`, `bill.create`, `bill.approve`, `bill.pay` in [monolith.py](../backend/app/core/monolith.py) | Add partial settlements, credit notes, allocation and clearly separated recognition/payment approval. |
| Reconciliation uses exact signed one-to-one matching. Monolith close rejects every unmatched bank or book item. | `reconcile`, `period.lock` in [monolith.py](../backend/app/core/monolith.py) | Model valid timing differences and reconciliation evidence; complete matching is not always the correct close condition. |
| The UI has a fixed opening-bank-balance argument and some fixed period labels. | [App.tsx](../frontend/src/monolith/App.tsx), [PeriodCloseModule.tsx](../frontend/src/monolith/components/PeriodCloseModule.tsx) | Derive company, period and balance context from authoritative data. |
| Monolith agent queue processing branches on example task IDs and fixed payloads. | `agent.resolve` in [monolith.py](../backend/app/core/monolith.py) | A real MCP proposal/run queue must replace the sample task mechanism. |
| The inspected orchestrator queues events in process with `asyncio.Queue`; recent events are kept in a list. | [event_bus.py](../backend/app/orchestrator/event_bus.py) | The inspected dispatcher is not a durable transactional outbox. Add persistence, retries and restart recovery. |
| Authentication supports persistent humans/agents, hashed credentials, CSRF checks and revocation. MFA signing, entity-bound credentials and full governance UI remain incomplete. | [Authentication implementation](../docs/auth-implementation.md), [auth.py](../backend/app/core/auth.py) | Preserve existing controls; complete company scoping and high-risk authentication before production use. |
| Statutory schedules contain illustrative estimates, including percentages of prepayment balances. | `tax_meta_map` in [reporting.py](../backend/app/core/reporting.py) | Replace them with traceable transaction tax records and versioned local rules. Balanced statements do not verify tax correctness. |
| Current Monolith language options include English and Simplified Chinese, but no Traditional Chinese. Many module labels are English literals. | [preferences.ts](../frontend/src/monolith/utils/preferences.ts), [OverviewModule.tsx](../frontend/src/monolith/components/OverviewModule.tsx) | Complete Simplified Chinese for Mainland launch and Traditional Chinese for Hong Kong. Translation must cover operations, errors and exports. |
| Monolith's monochrome UI, tables, search and module navigation are the adopted design. | [UI adoption](../docs/monolith-ui.md), [App.tsx](../frontend/src/monolith/App.tsx), [index.css](../frontend/src/monolith/index.css) | Improve task flow within the existing design rather than replacing its identity. |
| Current automated checks passed with a documented frontend runtime workaround. | [Verification record](../07-reviews/2026-10-18-roadmap-baseline-verification.md) | Preserve this baseline and add scenario-driven tests as capabilities change. |

## Inferred

The main readiness gap is consistency across the accounting stores, authorization paths, local rules and user workflows. The code already supports useful accounting operations, but it does not yet establish a single production-ready system for the market sequence in SRC-0005.

## To confirm

Actual customer data volumes, production infrastructure, accountant-approved examples, local filing obligations and usage behavior have not been established by this inspection.

## Not covered

This was not a full code review, penetration test, browser accessibility audit, load test, legal review or statutory accounting opinion. No current browser usability study or production deployment was performed.
