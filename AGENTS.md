# Agentic Accounting System: agent guide

An open-source accounting system that AI agents operate through MCP, with humans approving what automatic policies do not cover. Correctness matters more than speed: a wrong ledger is worse than a slow one.

This file is the entry point. Detailed rules live in `00-rules/`. Update the canonical rule first, then its references here.

## Rules

| Rule | Canonical location |
| --- | --- |
| How work is done: playbooks, review, evidence | [engineering-workflow.md](00-rules/engineering-workflow.md) |
| Product workflow and collaboration boundaries | [product-workflow.md](00-rules/product-workflow.md) |
| Requirement statuses and gates | [status-and-gates.md](00-rules/status-and-gates.md) |
| Information ownership and references | [source-of-truth.md](00-rules/source-of-truth.md) |
| Directory responsibilities and naming | [naming-and-structure.md](00-rules/naming-and-structure.md) |

## Workflow at a glance

Classify each request and follow its playbook in [engineering-workflow.md](00-rules/engineering-workflow.md#2-playbooks). Copy the steps into your task list. If you skip one, keep it in the list with the reason.

| Request | Playbook |
| --- | --- |
| How or why does this work? | Investigation: trace the code and its history; change nothing |
| Something is broken | Bug fix: reproduce, failing test, root cause, fix, verify the reproduction |
| New behaviour | Feature: ground, grill, spec, design, slice, build test-first, verify, review |
| Same behaviour, better structure | Refactor: pin behaviour, subtract, small steps, migrate then delete |
| A fact only an experiment settles | Prototype: smallest throwaway artifact |
| Decision, plan or review | Record: register the source, write in its maintained home, label conclusions |

Before reporting done:

1. Review on three axes: spec, standards and accounting controls.
2. Run the checks below and report their results.
3. Name anything you did not verify.

## Commands

| Purpose | Command |
| --- | --- |
| Backend tests | `cd backend && uv run --extra dev pytest -q` |
| Backend lint | `cd backend && uv run --extra dev ruff check <touched files>`; the codebase has existing lint debt, so add no new errors |
| Frontend build | `cd frontend && npm run build:web` |
| Frontend tests | `cd frontend && npm run test:monolith` |

## Where things live

| Need | Place |
| --- | --- |
| Original owner input and its source ID | `01-inputs/`, [source register](01-inputs/source-register.md) |
| Architecture decisions | `03-planning/adr-XXXX-*.md` |
| Accounting controls and counterexamples | [control matrix](03-planning/accounting-control-matrix.md) |
| Requirement status (only here) | [requirement pool](04-requirement-pool/requirement-pool.md) |
| Spec and tickets for one requirement | `05-requirements/req-XXXX-short-name/` |
| Audit findings, reviews, acceptance evidence | `07-reviews/` |
| Backend: FastAPI, SQLAlchemy, MCP servers | `backend/app/`, tests in `backend/tests/` |
| Frontend: React (Monolith UI) | `frontend/src/` |

## Hard boundaries

Stop and ask the owner instead of crossing these.

**Accounting** ([invariants](00-rules/engineering-workflow.md#3-accounting-invariants)):

- Never weaken a control to make a test pass.
- Agents never approve. Tests that approve use human principals.
- Posted entries are never edited. Correct them by reversal.
- Money is exact decimal. Debits equal credits.
- Agents get domain MCP tools only, never SQL or storage access.

**Collaboration** ([boundaries](00-rules/product-workflow.md#collaboration-boundaries)):

- Confirm scope before changing files outside the request.
- Trace every product claim to a source ID.
- Only the owner approves formal status transitions and decisions.
- Never store keys, tokens or passwords in code, documents or Git history.
- Never commit `docs/reference/` or `90-assets/ui-references/`. Both are third-party material.
- Do not push, merge into `main`, publish or change repository settings without the owner.

## CodeGraph

In repositories indexed by CodeGraph, where a `.codegraph/` directory exists at the repo root, use CodeGraph before grep/find or reading files to understand or locate code.

- MCP: `codegraph_explore` returns relevant symbols' verbatim source and call paths, including dynamic-dispatch hops. Name a file or symbol to read its current line-numbered source. If deferred, load it by name through tool search.
- Shell: `codegraph explore "<symbol names or question>"` provides the same output.

If there is no `.codegraph/` directory, skip CodeGraph. Indexing is the user's decision.
