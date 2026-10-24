# Independent product UX prototype verification

Date: 2026-10-20. Scope: [product prototype](../docs/ui-prototype/product-prototype.md), source [SRC-0009](../01-inputs/2026-10-20-product-prototype-clarification.md). No owner adoption decision or requirement transition is recorded.

## Observed

- `npm run build:web`: TypeScript and Vite build passed. Existing connected application retains its non-blocking >500 kB chunk warning.
- `node --test src/product-prototype/model.test.mjs`: 7 passed. Fixtures/balance, complete evidence and acknowledgement guards, returned-item blockers and resubmission, report recomputation, idempotent bank matching, period locking, invalid-value checks.
- `npm run test:monolith`: 17 existing tests passed.
- `node src/prototype/model.check.mjs`: existing 404 allocation scenarios and legacy guards passed. This is regression evidence only, not a dependency of the new prototype.
- Browser: 29 assertions passed. Full list is in [machine-readable results](../90-assets/product-prototype/checks.json). Covers seven navigation entries, both themes and persistence, state preservation across theme changes, three-column review, acknowledgement, return reason, fresh acknowledgement after replacement, source trace, dynamic reports, bank matching, Agent controls, computed close prerequisites, snapshot acknowledgement, lock status, audit and mobile focus/width checks.
- Ego browser opened the artifact and supplied DOM snapshots, but screenshot requests timed out, including raw CDP capture. Used an isolated local headless Chrome profile as fallback for screenshots and browser assertions, without attaching a personal browser profile or exposing the site externally. Capture dimensions: desktop 1440 × 1000, mobile 390 × 844.
- Mechanical design detector ran once: incumbent Inter-font warning only. Preserved the product's sans-serif accounting typography as requested.
- Independent review confirmed the seven-module architecture, dual-theme coverage and isolation. It found an acknowledgement surviving return/resubmission when checked before returning. Cleared it in both handlers and added the exact regression sequence. Final browser run passed 29 checks; fresh read-only verdict scored that specific finding resolved, ship for that finding only.
- Production entry files, Monolith application/components, authentication, backend and database are untouched. Vite registers a separate optional prototype entry. Earlier uncommitted reader prototype files are preserved, not reused or overwritten.

## Visual evidence

[Desktop Light](../90-assets/product-prototype/desktop-light.png), [Desktop Dark](../90-assets/product-prototype/desktop-dark.png), [Review Dark](../90-assets/product-prototype/review-dark.png), [Bank Light](../90-assets/product-prototype/bank-light.png), [Settings Dark](../90-assets/product-prototype/settings-dark.png), [Mobile Light](../90-assets/product-prototype/mobile-light.png), [Mobile Dark](../90-assets/product-prototype/mobile-dark.png), [Mobile review Light](../90-assets/product-prototype/mobile-review-light.png).

All screenshots are local captures of the synthetic application, not generated imagery. Reference attachment provenance remains in SRC-0009.

## To confirm / not covered

This tests a representative interactive subset, not the complete blueprint or a production system. Mobile review is scroll-heavy and stacks sections rather than implementing context-preserving review tabs. Full accessibility, all secondary routes, cross-company/period handling, statutory/tax rules, processed original documents, live MCP controls, real posting/payment, bank connectivity, MFA and production sign-off are not validated.
