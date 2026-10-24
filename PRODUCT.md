# Agentic Accounting System

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Paying customers are small businesses and one-person companies (OPC); accountants and bookkeepers are not expected to pay ([SRC-0022](01-inputs/2026-10-24-personal-agent-positioning.md)). The owner's personal agent submits documents and proposals through MCP. The owner, or an invited accountant, reviews and approves; in the one-person company profile the owner is the approver ([ADR-0001](03-planning/adr-0001-agent-first-mcp-architecture.md)). Accountants join at statutory points such as audit and tax lodgment, as invited collaborators.

The user earlier confirmed accountants reviewing transactions and completing month-end close as the primary audience for the redesign. That workflow remains the first prototype workflow. The prototype must support switching between Traditional Chinese and English.

## Product Purpose

Help SMEs, one-person companies and sole proprietors turn source documents into reviewed journal entries, supporting schedules and standalone financial statements. The accountant must understand what needs judgment and inspect the evidence before approving an entry.

## Operating Context

The repository supports entity and period selection, documents, vouchers, a ledger, trial balance, statements and period controls. Agent proposals and human review have separate responsibilities. The user selected review and month-end close as the first prototype workflow.

## Capabilities and Constraints

Existing React 18, TypeScript and Vite frontend, with installed Lucide icons and Radix UI components. Preserve the user's ongoing application and backend changes. The owner subsequently selected the supplied Monolith Ledger interface for direct adoption as the default UI. Its interface is now connected to a persistent Monolith workspace seeded from the supplied examples, with the earlier regional accounting workspace preserved at `/connected.html`. Monolith data and the legacy company entities remain separate; see `SRC-0003` and `docs/monolith-backend.md`. The earlier independent review prototype remains at `/prototype.html`. See `SRC-0002` in the source register and `docs/monolith-ui.md` for data boundaries.

The owner approved applying the reviewed sidebar/canvas reskin, dual themes, 10px panel / 6px control corners, and optional task pane to the actual frontend in [SRC-0014](01-inputs/2026-10-20-ui-adoption-request.md). The implementation retains the existing 15 modules, authenticated API and server preferences. The task pane uses live workspace tasks and direct module navigation; no preview fixture or fetch adapter is included in the default entry. See [current UI appearance](docs/ui-appearance.md). Local isolated verification is recorded; production deployment remains unverified.

## Evidence on Hand

README.md, frontend/src/app and frontend/src/components describe the present product. Spark AI Studio Pty Ltd is an existing example entity. The repo contains no user-provided brand assets or approved production financial dataset for this redesign.

## Product Principles

- Bring review exceptions and next actions to the foreground.
- Keep source documents, proposed entries and review history connected.
- Show explicit human approval and blocked close conditions.
- Keep amounts, currency, period and entity visible where decisions depend on them.
