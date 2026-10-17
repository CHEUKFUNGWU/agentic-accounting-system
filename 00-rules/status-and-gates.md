# Requirement statuses and stage gates

Maintain current status only in [requirement-pool.md](../04-requirement-pool/requirement-pool.md).

```text
candidate → collecting → analyzing → defined → reviewing → approved → developing → validating → released → closed
```

| Status | Meaning and gate for entry |
| --- | --- |
| `candidate` | A potential need is registered with at least one source ID. No scope commitment is implied. |
| `collecting` | The input gaps and collection questions are recorded. |
| `analyzing` | Available inputs support investigation of the problem, users, boundaries, and dependencies. Unknowns remain explicit. |
| `defined` | The work package defines the problem, scope, exclusions, acceptance criteria, sources, and open questions. It can be reviewed independently. |
| `reviewing` | The owner and reviewers have a concrete definition and supporting evidence to assess. |
| `approved` | The owner has explicitly approved the definition. Record who approved it, when, and which document revision was approved. |
| `developing` | Implementation has started against the approved definition. Applicable version scope links to the requirement. |
| `validating` | Implementation is ready for acceptance against the approved criteria, with test or review evidence available. |
| `released` | The change has actually been deployed and verified in its intended live environment. Link deployment identity, date, environment, verification results, and verifier. A prototype or passing local test is insufficient. |
| `closed` | Release follow-up and retrospective conclusions are recorded, or an explicit cancellation decision and reason are recorded. |

## Transition rules

- Obtain owner confirmation before recording a formal state transition. Existing explicit authorization can satisfy confirmation for its stated scope.
- Link the dated decision or evidence in the pool entry's status cell. Do not maintain a second current status in work packages or reviews.
- After approval, a material change to scope, behavior, acceptance criteria, or dependencies must be recorded in the work package's change history and returned to `reviewing`. Obtain fresh approval before continuing affected work.
- Failed validation returns to `developing` when the approved definition still applies; a changed definition returns to `reviewing`.
- A canceled or duplicate requirement may move to `closed` from any state after owner confirmation. Record the reason and any replacement requirement. This does not imply release.
- Do not infer approval, release, or closure from elapsed time, a merged pull request, or an AI-generated draft.

## Optional simplified workflow

The default is the full flow above. If the owner explicitly adopts a simpler workflow, use:

```text
candidate → analyzing → defined → approved → released → closed
```

The approval, material-change review, and live release-evidence gates still apply. Record the workflow decision in `03-planning/` before using the simplified flow; do not mix flows implicitly.
