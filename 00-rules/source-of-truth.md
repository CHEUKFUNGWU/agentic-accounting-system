# Source of truth

Each information type has one maintained home. Other documents link to it instead of copying it.

| Information | Maintained home |
| --- | --- |
| Directory responsibilities and naming | `00-rules/naming-and-structure.md` |
| Product workflow | `00-rules/product-workflow.md` |
| Status definitions and gates | `00-rules/status-and-gates.md` |
| Information ownership | This file |
| Source identity, provenance, and processing state | `01-inputs/source-register.md` |
| Original input | The material linked from its source-register entry |
| Stable product knowledge | `02-product/`; existing `PRODUCT.md` remains in place until an agreed migration |
| Cross-requirement plans and decisions | `03-planning/` |
| Requirement identity and current lifecycle status | `04-requirement-pool/requirement-pool.md` |
| Requirement definition, PRD, and change history | `05-requirements/req-XXXX-short-name/` |
| Version commitment | `06-versions/v<major>.<minor>/scope.md` |
| Review, acceptance, release verification, and retrospective evidence | `07-reviews/` |
| Shared binary and visual assets | `90-assets/` |
| Application implementation and technical setup | Existing source directories and technical documentation |

## Reference rules

- Cite source IDs and link to the supporting material when making product judgments.
- Label conclusions `Observed`, `Inferred`, `To confirm`, or `Not covered`. `Observed` requires inspectable evidence; inference is not approval.
- Maintain current requirement status only in the requirement pool. Dated review records may record decisions and events but must not maintain another current-status field.
- Keep source-processing state separate from requirement lifecycle status.
- Markdown is the maintained content source. Word, PDF, and slide exports are dated deliverables derived from confirmed content; link them back to that content.
- Record conflicts and unresolved questions for the owner. Do not silently reconcile contradictory sources.
- Archive superseded material with provenance and replacement links. Do not let an archived copy become a competing active source.
