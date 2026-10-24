# Reader prototype verification

Date: 2026-10-20. Draft concept only. Source [SRC-0008](../01-inputs/2026-10-20-reader-prototype-request.md). Artifact: [reader prototype](../docs/ui-prototype/reader-prototype.md).

## Observed

- `cd frontend && npm run build:web` passed TypeScript and Vite production build. Existing connected entry retains a non-blocking chunk-size warning.
- `npm run test:monolith`: 17 tests passed.
- `node src/prototype/model.check.mjs`: 404 allocation scenarios, balanced cents, approval guards, close prerequisites and safe storage recovery passed. These are shared-model regression checks, not comprehensive tests of the new UI.
- Ego browser interaction checks: 19 passed. Allocation acknowledgement; allocation recalculation; pending count; source-linked journal; cross-page search shortcut; vendor filtering; duplicate approval blocking; return reason requirement; ready-item acknowledgement; bank close blocker; enabled close after checks; locking; history; ordinary-return close blocker; desktop sticky actions visible; mobile workspace inert during navigation; Escape dismissal; mobile no horizontal overflow; mobile action width.
- Initial browser test incorrectly expected searching `Studio` to return one proposal. The search correctly also matched Dell's `Studio computer equipment` description. Repeated with the unambiguous query `studio north`; passed. No application change was needed.
- Mechanical design detector ran once. Only warning was incumbent Inter font. Retained for app controls; serif narrative and heading supply the reference's reading character.
- Independent review found four material issues: clipped sticky actions, ready-item acknowledgement bypass, missing search accessible label, and cross-page search focus timing. All fixed locally. A fresh verdict pass scored all four resolved and recommended ship for those findings only. This is not a full accessibility or accounting audit.

## Captures

- [Desktop](../90-assets/reader-prototype/desktop.png)
- [Mobile](../90-assets/reader-prototype/mobile.png)
- [Mobile review actions](../90-assets/reader-prototype/mobile-actions.png)

These are local browser captures of the synthetic prototype, not generated product imagery. Desktop and mobile layouts inspected; mobile emulation requested at 390 × 844.

## To confirm / not covered

No owner approval or requirement transition recorded. Fixed Australian example data, memory-only state and simulated evidence/bank checks remain deliberate limitations. Returning an ordinary proposal has no resubmission path in this draft. Production financial accuracy, statutory jurisdiction rules, real processing and full accessibility remain outside this verification.
