# Fold open audit findings into the Go migration

- Source ID: SRC-0026
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: disposition of unremediated audit findings during the backend Go migration (ADR-0002)

## Original message

> 我們還有些audit後的findings，是沒有處理的，到時候可以一併在重構中處理

## Inventory (Observed, 2026-10-24)

- [Business logic audit](../07-reviews/2026-10-21-business-logic-audit.md) (SRC-0016): 29 findings; 6 verified fixed (BL-01, BL-02, BL-03, BL-04, BL-25, BL-29); **23 open** (BL-05 to BL-28 excluding the fixed ones).
- [AIS textbook gap review](../07-reviews/2026-10-21-ais-textbook-gap-review.md) (SRC-0019): **BL-30 to BL-36 all open** ("Findings BL-30 to BL-36 have no remediation evidence yet"). GAP-01 to GAP-07 remain registered as candidates REQ-0024 to REQ-0030, untouched by this direction.
- Of the open findings, BL-15, BL-16 and BL-19 are defects in the Monolith frontend (`frontend/src/monolith/`), not backend code.

## Direction (owner, 2026-10-24)

- Observed: the owner directed that open findings be fixed as part of the Go rewrite rather than separately in the frozen Python implementation.
- Recorded in [ADR-0002](../03-planning/adr-0002-backend-golang-migration.md): D3 gains a known-defect exclusion rule for golden parity, and §3.1 maps every open backend finding to the phase that absorbs it.

## To confirm

- Owner decisions some findings already name: BL-14 reporting-period semantics, BL-31 one-person-company entity types (policy set 2026-10-21), BL-36 voucher-number format (rule set 2026-10-21).
- Scheduling of the frontend findings BL-15, BL-16, BL-19 is outside the backend migration; BL-15/16's durable fix is the frontend consuming backend reporting (available after ADR-0002 P5).
