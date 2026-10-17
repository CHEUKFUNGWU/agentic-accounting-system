# Naming and structure

Numeric prefixes make directory name order follow the product workflow.

| Directory | Store here | Keep elsewhere |
| --- | --- | --- |
| `00-rules/` | Workspace rules and reusable templates | Product facts and requirement decisions |
| `01-inputs/` | Original discussions, documents, screenshots, external inputs, and source register | Approved requirement definitions |
| `02-product/` | Stable terminology, background, and confirmed platform baseline | Proposals and temporary analysis |
| `03-planning/` | Problem space, module map, cross-requirement decisions | Individual requirement specifications |
| `04-requirement-pool/` | Candidate register and current requirement status | PRDs, prototypes, and acceptance evidence |
| `05-requirements/` | One work package per requirement, including analysis, PRD, and prototype references | Cross-requirement plans and duplicated status |
| `06-versions/` | Version goals, committed scope, and milestones | Requirement definitions and raw input |
| `07-reviews/` | Reviews, acceptance, release verification, and retrospectives | Current requirement status |
| `90-assets/` | Shared presentations, screenshots, and other reusable assets | Canonical Markdown facts and secrets |
| `99-archive/` | Closed or superseded material with traceable references | Active facts and plans |

## Naming conventions

- New Markdown filenames use lowercase English kebab-case, such as `problem-space.md` and `decision-log.md`. Keep conventional entry filenames `README.md` and `AGENTS.md`.
- Date-based materials use `YYYY-MM-DD-topic`, such as `2026-10-17-workspace-setup.md`.
- Requirement IDs use `REQ-XXXX`; directories use `req-XXXX-short-name`, such as `req-0001-route-management`.
- Source IDs use `SRC-XXXX`. Allocate the next unused four-digit number in the source register.
- Version directories use `v<major>.<minor>`, such as `v1.0`.
- IDs are permanent. Do not reuse an ID after closure or archival.
- Prefer relative Markdown links within the repository. Update links when moving files.

## Existing application files

The numbered directories sit alongside `backend/`, `frontend/`, `database/`, and `docs/`. They do not replace the source tree or its technical documentation.

Existing files retain their names and locations until an explicit migration is agreed. In particular, `PRODUCT.md` remains the existing product-context file; reference it rather than creating a competing copy. Its statements require source review before being treated as confirmed baseline facts.
