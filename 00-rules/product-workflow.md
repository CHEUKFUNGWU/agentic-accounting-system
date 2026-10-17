# Product workflow

```text
Raw inputs → Product knowledge and planning → Requirement pool → Individual requirement definition
→ Prototype and PRD → Version commitment → Development and acceptance
→ Live release verification → Retrospective
```

1. Register input in the source register before using it. Preserve original materials and distinguish them from translations or summaries.
2. Build product knowledge and cross-requirement plans from cited inputs. Mark conclusions `Observed`, `Inferred`, `To confirm`, or `Not covered`.
3. Register candidate requirements in the pool. Identify their source IDs, module, owner, priority rationale, dependencies, and tentative target version. Unknown fields stay explicit.
4. Create a work package when a requirement needs definition. Keep each requirement independently definable, reviewable, developable, and testable.
5. Develop its PRD, acceptance criteria, and prototype references as needed. List exclusions and unresolved decisions. A prototype is evidence for discussion, not proof of production behavior.
6. Present clear stage conclusions to the owner for confirmation before recording them as formal decisions or advancing status. Drafts may be prepared within authorized scope and must remain labeled as drafts.
7. After approval, record version commitments in the version's `scope.md`. A tentative target version in the pool alone is not a commitment.
8. Implement and validate against the approved criteria. Store acceptance and review evidence in `07-reviews/` and link it from the work package.
9. Record live deployment and verification evidence before moving to `released`.
10. Record follow-up and retrospective conclusions, confirm closure, and archive superseded material while preserving links.

## Collaboration boundaries

Before adding, changing, or deleting files, explain the problem assessment and affected scope and obtain confirmation. An explicit task request or standing authorization satisfies this requirement within its stated scope; do not repeatedly request the same permission. Ask again when scope materially changes or a required product decision remains unresolved.

AI-generated documents must retain source references, matters to confirm, and uncovered scope. AI must not independently approve drafts or advance formal statuses without owner confirmation. Never store keys, tokens, or passwords in code, documents, or Git history.
