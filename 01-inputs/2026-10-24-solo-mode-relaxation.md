# One-person-company definition relaxation (solo mode)

- Source ID: SRC-0028
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: BL-31 prerequisite and ADR-0001 D4 one-person-company mode — who qualifies for self-approval

## Original message

Context: the assistant explained the pending BL-31 question (which legal entity types qualify for the one-person-company self-approval mode) and recommended a fail-closed, jurisdiction-list approach.

> 一人公司的定義可以放寬一點，要不然沒有人想用

## Owner decision

- Observed: the owner decided to widen the one-person-company definition, prioritizing adoption. This overrides the assistant's fail-closed recommendation in [SRC-0027](2026-10-24-bl14-bl31-bl36-decisions.md); the conflict is recorded, not reconciled.
- Observed: this continues ADR-0001 D4's stated intent for the mode ("以方便使用與推廣為優先") and the product positioning that one-person companies are the paying users ([SRC-0022](2026-10-24-personal-agent-positioning.md)).

## Assistant recommendation: solo mode by user count (pending owner confirmation)

The owner gave the direction ("放寬一點"); the concrete mechanism below is the assistant's proposal:

- The qualifying axis changes from **legal entity type** to **human principals**: any entity may enable solo mode while it has exactly one active human principal (boss records and self-approves, flagged, per the existing D4 policy).
- A second active human principal (e.g. hiring a bookkeeper) automatically ends solo mode; entries return to maker-checker. Historical self-approvals remain flagged.
- What never relaxes, in solo mode or not: balance, period locks, hash chain, audit trail, duplicate detection, and O2-g (agents never approve). The year-end audit pack (self-approval list, agent activity, chain verification) stays the transparency answer to external stakeholders.
- Jurisdiction packs (REQ-0014 onward) may still add stricter requirements for specific entity types where law demands it (the Mainland one-person-company audit question remains To confirm in ADR-0001 D4); they cannot further relax solo mode.

## To confirm

- The mechanism above (user-count axis, auto-disable on second principal).
- Whether to keep calling it 一人公司模式 or rename to 單人作業模式 (solo mode) in UI copy.
