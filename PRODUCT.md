# Agentic Accounting System

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The user confirmed accountants reviewing transactions and completing month-end close as the primary audience for the redesign. The prototype must support switching between Traditional Chinese and English.

## Product Purpose

Help SMEs, one-person companies and sole proprietors turn source documents into reviewed journal entries, supporting schedules and standalone financial statements. The accountant must understand what needs judgment and inspect the evidence before approving an entry.

## Operating Context

The repository supports entity and period selection, documents, vouchers, a ledger, trial balance, statements and period controls. Agent proposals and human review have separate responsibilities. The user selected review and month-end close as the first prototype workflow.

## Capabilities and Constraints

Existing React 18, TypeScript and Vite frontend, with installed Lucide icons and Radix UI components. Preserve the user's ongoing application and backend changes. Deliver the redesign through an independent interactive prototype entry. Prototype actions and financial figures must be clearly identified as demonstrations, not live postings or compliance decisions.

## Evidence on Hand

README.md, frontend/src/app and frontend/src/components describe the present product. Spark AI Studio Pty Ltd is an existing example entity. The repo contains no user-provided brand assets or approved production financial dataset for this redesign.

## Product Principles

- Bring review exceptions and next actions to the foreground.
- Keep source documents, proposed entries and review history connected.
- Show explicit human approval and blocked close conditions.
- Keep amounts, currency, period and entity visible where decisions depend on them.
