# Existing frontend reskin verification

Date: 2026-10-20. Draft visual preview only. Source [SRC-0010](../01-inputs/2026-10-20-existing-frontend-reskin-request.md). Artifact [documentation](../docs/ui-prototype/existing-frontend-reskin.md).

## Observed

- Preview entry directly mounts existing `monolith/App.tsx` and components. No old prototype, new UX blueprint shell or reimplemented business page is imported.
- `git diff --exit-code -- frontend/src/monolith frontend/index.html frontend/app.html backend` passed. Existing dirty prototype artifacts and default Vite-config changes predate this reskin and were left untouched; this task uses a new separate Vite config.
- Copied `seed.json` is byte-identical to `backend/app/monolith_seed.json`. Extra depreciation accounts are added locally to match existing backend initialization, without executing backend code.
- TypeScript and the standalone Vite build passed. Default frontend build and 17 existing Monolith tests also passed. Default build retains the existing non-blocking connected-chunk size warning.
- Seven new adapter tests passed: clone isolation, local handling of absolute URLs, write denial, validated preference updates, revisions/idempotency, invalid requests and Request/init handling.
- Thirty browser assertions passed, including all 15 original modules, actual Overview Sankey, exact App DOM/root identity across Original/Reskin switching, original Settings theme/language handling, read-only business-write denial, unchanged fixture journals, MFA restriction, original mobile switcher and zero real accounting API requests. [Full report](../90-assets/reskin-preview/checks.json).
- Ego loaded and inspected the page; screenshot capture timed out. Screenshots and browser assertions used an isolated local Chrome fallback with a new QA-only profile. First captures caught color transitions; recaptured with reduced motion enabled before judging. Dimensions: desktop 1440 × 1000, mobile 390 × 844.
- Mechanical detector returned no findings on new entry and CSS.
- Fresh independent review returned ship for sharing the independent preview: direct existing-component reuse, fail-closed adapter and sidebar/canvas treatment confirmed. Reviewer reran seven adapter tests and TypeScript, inspected nine captures and reviewed the browser assertion report. This is not approval for production adoption.

## Captures

- [Overview Dark](../90-assets/reskin-preview/overview-dark.png), [Overview Light](../90-assets/reskin-preview/overview-light.png), [Original Dark](../90-assets/reskin-preview/overview-original-dark.png).
- [Journal Light](../90-assets/reskin-preview/journal-light.png), [Original Journal Light](../90-assets/reskin-preview/journal-original-light.png), [Journal Dark with Chinese navigation](../90-assets/reskin-preview/journal-dark-zh.png).
- [Settings Dark](../90-assets/reskin-preview/settings-dark.png), [Settings Light](../90-assets/reskin-preview/settings-light.png).
- [Mobile Dark](../90-assets/reskin-preview/mobile-dark.png), [Mobile Light](../90-assets/reskin-preview/mobile-light.png), [Mobile Settings Light](../90-assets/reskin-preview/mobile-settings-light.png).

These are local browser screenshots of the existing frontend using synthetic seed data, not generated imagery.

## To confirm / not covered

Production skin adoption, live-write behavior, comprehensive accounting/authentication/accessibility audits and changing existing module layouts are excluded. Existing compact labels, incomplete non-English module copy, downloadable synthetic exports and responsive tables are retained rather than redesigned. No formal status transition recorded.
