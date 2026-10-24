# BL-14 / BL-31 / BL-36 prerequisite decisions

- Source ID: SRC-0027
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: the three owner decisions ADR-0002 §3.1 flagged as prerequisites for absorbing audit findings during the Go migration

## Original message

> 1.management report period提供自定義，financial report提供monthly, quarterly, semi-annually, annually？你覺得如何
> 2. 我不太了解這個
> 3. 最好根據法域的best practices

## Owner answers

1. **BL-14 (reporting-period semantics)** — Observed: management reports get custom periods; financial reports are limited to monthly, quarterly, semi-annually, annually. The owner asked for the assistant's opinion before finalizing.
2. **BL-31 (one-person-company entity types)** — Observed: the owner did not yet understand the question. No decision; the assistant re-explains below.
3. **BL-36 (voucher-number format)** — Observed: the format should follow jurisdictional best practices.

## Assistant recommendations (not yet owner decisions)

### BL-14 — agree, with two conditions

- Management custom periods are read-only projections over posted entries; they never bypass period locks.
- Financial-report periods anchor to the fiscal-period state (`fiscal_periods`, open/soft-closed/locked), not free date math: a standard-period report is the aggregation of the underlying fiscal periods, and "annually" means the entity's fiscal year (CN commonly calendar year, AU July–June, HK April–March for tax), not the calendar year.

### BL-31 — plain-language statement of the question

One-person-company mode lets the boss self-approve their own entries with a flag (policy set 2026-10-21, [ADR-0001 D4](../03-planning/adr-0001-agent-first-mcp-architecture.md)). The open question is simply: **which legal entity types qualify for that mode** — e.g. Mainland 個體工商戶 / 一人有限責任公司, HK sole proprietorship / single-member limited company, AU sole trader / single-member Pty Ltd, US single-member LLC. Recommended answer: fail-closed by default (no OPC mode), and each jurisdiction pack (REQ-0014 onward) explicitly lists the qualifying types; the Mainland one-person-company audit question stays flagged as To confirm in ADR-0001 D4.

### BL-36 — what "jurisdictional best practices" means concretely

- Uniqueness and gap reporting are system-level guarantees regardless of jurisdiction (the core of the finding).
- The visible number format ships as a per-jurisdiction default in each jurisdiction pack (e.g. Mainland 記-XXX monthly-continuous styles vs JV-2026-0001 style elsewhere); until the packs exist, a neutral prefix-year-sequence default applies.

## To confirm

- BL-14: the two conditions above (owner asked for opinion; answer pending).
- BL-31: the qualifying entity types, or acceptance of the fail-closed-plus-pack-list recommendation.
