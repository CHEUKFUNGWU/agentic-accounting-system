# Reader prototype design notes

Scope: [independent reader prototype](reader-prototype.md), not the default application. Draft direction inferred from [SRC-0008](../../01-inputs/2026-10-20-reader-prototype-request.md). Mode: Operate.

## Visual language

- `#171819` main reading surface; `#222425` sidebar; `#1c1e1f` queue; `#303233` separators.
- `#e5e3de` body text; `#a2a6a4` secondary text; `#b2cebf` sage; `#e9a296` duplicate warning. Teal `#193b3c` frames the desktop only.
- App controls use the installed Inter Variable and system Chinese sans. Review narrative and vendor heading use Georgia with Songti TC for Chinese reading character. No additional font downloads or generated imagery.
- Compact navigation, spacious review document, tabular monetary values, restrained 4–7px control corners. Brand wordmark is provisional text, not an approved identity.
- Three panes on desktop: company/navigation, evidence-led decision, proposal queue. At 820px and below navigation becomes an overlay. At 620px and below queue becomes a horizontally scrollable strip above the review.

## Interaction conventions

Source excerpt uses native details disclosure. Acknowledgement is required before approval. Allocation edits clear acknowledgement. Suspected duplicates cannot approve. Return requires a reason. Desktop decisions remain visible via sticky actions; mobile uses ordinary document flow. Keyboard focus uses sage outlines; Cmd/Ctrl K opens and focuses review search; Escape closes navigation or return editing. Mobile navigation traps keyboard focus and makes the workspace inert. Reduced-motion removes entrance and switch movement.

## Boundaries

Source excerpt is synthetic HTML, not an original PDF renderer. No modal, chart or large KPI strip is necessary for this task. State is deliberately session-only. See the [verification record](../../07-reviews/2026-10-20-reader-prototype-review.md) for evidence and unresolved scope.
