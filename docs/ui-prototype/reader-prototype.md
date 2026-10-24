# Reader-inspired accounting workspace

Draft independent concept, based on [SRC-0008](../../01-inputs/2026-10-20-reader-prototype-request.md), [PRODUCT.md](../../PRODUCT.md), the existing [prototype model](../../frontend/src/prototype/model.ts), and the [draft UX blueprint](../../03-planning/ux-workflow-blueprint.md). This does not replace the default application, approve requirements, or commit scope.

## Preview

Run `cd frontend && npm run dev:web -- --host 127.0.0.1`, then open <http://127.0.0.1:5173/reader-prototype.html>.

## Design and interactions

- Operate mode. Charcoal main surface, slightly lighter sidebar, muted sage selection and actions, coral duplicate warning. Teal exists only outside the application frame, following the supplied reference.
- Evidence-led review document, with quiet navigation and a compact right-side review queue. No dashboard metrics or invented performance claims.
- Traditional Chinese and English toggle. Fixed Australian synthetic entity, October 2026, AUD. It is not an approved Mainland China launch dataset.
- Four synthetic proposals. Review allocation/classification, inspect an expandable synthetic document excerpt, approve or return with a required reason.
- Duplicate approval is blocked. Returning the duplicate excludes it for the simulated close. Returning an ordinary item still blocks close; reload resets the workflow for another attempt.
- Approved proposals appear in journals and all review decisions appear in the activity log. The automation switch only illustrates a policy setting and cannot bypass human review.
- Simulated bank confirmation and blocking checks precede period locking. No backend requests, file processing, real posting, bank reconciliation, statutory reports, or persistent changes.
- State is memory-only, isolated from the existing prototype and live application. Reload resets it. Company and period are explicitly fixed.
- Mobile layout moves the queue above the review document. Sidebar navigation uses an overlay.

## To confirm

Default UI adoption, jurisdiction/language priorities, return-and-resubmission behavior, real source document viewer, production agent policies and accounting approval rules remain owner decisions.

## Files

`frontend/reader-prototype.html`, `frontend/src/reader-prototype/main.tsx`, `frontend/src/reader-prototype/reader.css`. Vite registers the new entry alongside the existing ones.
