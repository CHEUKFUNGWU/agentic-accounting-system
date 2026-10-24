# Adopted frontend appearance

Implementation authorization: [SRC-0014](../01-inputs/2026-10-20-ui-adoption-request.md). This applies the reviewed skin to the actual authenticated frontend, not another prototype.

## Open

Use the existing frontend at <http://127.0.0.1:5173/> or `/app.html`. Sign in with an existing authorized human account. This change does not create production accounts or bypass login. Existing backend configuration and company files are unchanged.

## Appearance

- Charcoal canvas and slightly lighter inset sidepane in Dark; off-white canvas and quiet gray sidepane in Light.
- Sage navigation selection. Panels use 10px corners, controls 6px and small bordered labels 4px. Native checkbox/radio shapes, table cells/internal grid dividers and chart geometry are retained.
- Settings remains the authoritative appearance/language control, saving via authenticated `preferences.update`. Reload reads those server preferences again.
- Login, session checking, administrator and position-scoped screens follow OS appearance without reading protected workspace preferences. Logout/session expiry restores that unauthenticated policy. No theme or accounting state is copied into a new browser store.

The canonical product skin is `frontend/src/monolith/skin.css`. The earlier independent preview remains a separate historical/comparison artifact, not a runtime dependency of the product.

## Right task pane

The workspace context row has a Tasks button and live pending count. At viewport widths ≥1600px it starts docked at 300px wide. Smaller screens use a dismissible drawer, closed initially. Shrinking a docked viewport closes it instead of squeezing tables. The drawer portals outside the inert application root, contains focus, closes via Escape/backdrop and restores focus and scrolling.

Data comes directly from the currently loaded workspace: task list, entity name, period, currency and language. Filters and counts reflect the latest server state after commands. Selection navigates directly through the App and clears stale global search/account focus. It does not submit, approve, resolve or post anything. Current task records contain module destinations, not individual record links. Changing workspace/period resets the pane context.

Existing accounting actions still use the original command queue, revision checks, authorization, human-review and MFA restrictions. In particular, period signing/reopening remains unavailable until existing MFA work is implemented. Admin and position-scoped users do not acquire accounting access through the new UI.

## Validation

```bash
cd frontend
npm run build:web
npm run test:monolith
```

Authenticated browser regression: `frontend/src/monolith/browser.check.mjs`. It is write-capable and deliberately restricted to the documented disposable harness at localhost:5180. Do not point it at a personal browser profile or company file.

The verified harness used a separate backend on 8064, a new temporary SQLite directory, `DATABASE_URL` unset before imports, QA-only finance/admin/clerk accounts, and a separate Chrome profile on CDP port 9240. Local HTTP cookies were configured only for that temporary backend. Its lifespan workers were disabled; authentication tables were initialized and QA principals provisioned explicitly. No normal backend or user data directory was modified.

To reproduce, provision fresh disposable accounts using the existing backend operator facilities, and pass a mode-600 temporary JSON credential file containing `finance`, `admin`, and `clerk`, each with `username` and `password`. Never place that file in the repository. The browser script reads it via `QA_CREDENTIALS`, writes only non-secret evidence under `CAPTURE_DIR`, and accepts `CDP_URL`. Reset the disposable workspace/sessions between full runs. Remove the temporary credential file afterward.

[Verification and screenshots](../07-reviews/2026-10-20-ui-adoption-review.md). This establishes local implementation validation, not a production deployment or complete accessibility/accounting audit.
