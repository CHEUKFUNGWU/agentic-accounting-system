# Optional right task pane verification

Date: 2026-10-20. Draft preview extension. Source [SRC-0011](../01-inputs/2026-10-20-reskin-right-task-pane-request.md), preserving [SRC-0010](../01-inputs/2026-10-20-existing-frontend-reskin-request.md) boundaries. Artifact: [existing frontend reskin](../docs/ui-prototype/existing-frontend-reskin.md).

## Observed

- Existing `monolith/App.tsx`, all module components, default application entries and backend remain unchanged. No previous prototype imports. Right pane is outside the App, uses its existing seed Agent Tasks and only activates its existing visible translated navigation buttons.
- TypeScript and standalone preview Vite build passed.
- 12 adapter/queue tests passed. Queue tests cover current fixtures, pending/all behavior, non-mutating search including case/fullwidth text, visible translated navigation and absent-link failure.
- All 17 existing Monolith tests passed.
- Browser suite passed 54 assertions, including its earlier 30 regressions. [Full report](../90-assets/reskin-task-pane/checks.json). Covers wide docking, real three-task counts, search/empty state, filters, all three destination modules, selection retention, dual themes, original comparison/App DOM identity, collapse/resize, laptop/mobile modal behavior, focus wrapping/escape and restoration, 320px preview-strip fit, unchanged business records and zero real accounting API requests.
- Browser harness was updated to target the actual named left sidebar rather than the first `aside`, since the new pane is another aside. This corrected an ambiguous QA selector, not application behavior.
- Ego inspected the actual UI/DOM. Captures and automated assertions use the existing isolated local Chrome fallback because Ego screenshot capture was unavailable in preceding preview verification. Reduced motion and focused-page emulation make capture/focus assertions deterministic. Captures: docked 1680 × 1000; laptop 1280 × 900; mobile 390 × 844.
- Independent review found a modal-focus escape through the still-active preview strip. Fixed by saving/restoring inert state for both background regions, adding an outside-focus guard, and handling Tab arriving outside. Added strip-focus and programmatic body-focus regressions. Fresh verdict marked this finding resolved, ship at its scope; inspected source, tests, report and recaptured images, without rerunning the final browser suite.
- Mechanical detector ran once for this extension. Only warning was existing Inter font, retained to preserve actual frontend typography.

## Captures

[Dark overview](../90-assets/reskin-task-pane/right-pane-overview-dark.png), [Light overview](../90-assets/reskin-task-pane/right-pane-overview-light.png), [Journal and selection](../90-assets/reskin-task-pane/right-pane-journal-dark.png), [Laptop drawer](../90-assets/reskin-task-pane/right-pane-laptop-light.png), [Mobile Light](../90-assets/reskin-task-pane/right-pane-mobile-light.png), [Mobile Dark](../90-assets/reskin-task-pane/right-pane-mobile-dark.png).

These are local captures of synthetic existing frontend data. The supplied reference remains preserved under SRC-0011.

## To confirm / not covered

Production adoption, writable tasks, authenticated permissions, and record-level deep links are outside this preview. Task rows only route to their existing modules; the UI explicitly states that records have not been processed. The initial seed has no resolved tasks, so pending/all both show three until a future fixture changes. No formal requirement transition recorded.
