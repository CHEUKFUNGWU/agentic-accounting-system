# Existing frontend reskin preview

Draft visual preview only. Scope: [SRC-0010](../../01-inputs/2026-10-20-existing-frontend-reskin-request.md). Unlike the earlier prototypes, this directly renders the existing [`monolith/App.tsx`](../../frontend/src/monolith/App.tsx) and its existing components. No blueprint-derived replacement interface is used.

## Open

```bash
cd frontend
./node_modules/.bin/vite --config vite.reskin-preview.config.ts
```

Open <http://127.0.0.1:5174/reskin-preview.html?lang=zh>. English is available without `?lang=zh`. Default is Dark; `?theme=light` starts Light. Both remain selectable through the existing Settings page.

The separate preview server binds localhost port 5174, has no API proxy and does not expose the normal `VITE_*` environment variables. The default application and its Vite config are not changed by this preview.

## What stays the same

Observed: direct imports, not copies, preserve all 15 current modules: Overview, Journal Entry, General Ledger, Receivables, Payables, Fixed Assets, Trial Balance, Statements, Budgeting, Forecasting, Reconciliation, Tax, Period Close, Audit Log and Settings. Their DOM, layouts, navigation state, chart logic, tables, editors, exports and translations are the existing implementation. Existing translation limitations and compact typography are not redesigned here.

A separate small preview strip sits outside the application. Original / Reskin changes only the scoped CSS activation flag; it does not remount or replace the app. In-browser verification checked exact application DOM equality and root-node identity across comparison switches.

## What changes visually

- Reference-style inset sidepane, 15px outer corners, quiet surface and sage active selection.
- Dark canvas `#171819`, pane `#232426`, selection `#303c36`.
- Light canvas `#f8f9f7`, pane `#eeefec`, selection `#dbe5db`.
- Theme-coordinated existing panel surfaces, separators and chart ink, without changing widget layout or adding a new content design.
- [SRC-0012](../../01-inputs/2026-10-20-reskin-small-corners-request.md) adds main-canvas corners, subsequently increased under [SRC-0013](../../01-inputs/2026-10-20-reskin-larger-corners-request.md) to 10px panels, 6px controls/tab groups and 4px bordered badges. Existing explicit rounded shapes and native checkbox/radio inputs are preserved. Table cells, internal grid dividers and SVG geometry stay unchanged; no clipping is added to search/menu parents. Original comparison remains square. [Corner verification](../../07-reviews/2026-10-20-reskin-small-corners-review.md).
- The same Inter face is served from an installed local font file instead of relying on Google Fonts. Other font options retain the existing fallbacks; this preview does not fetch additional font families externally.

## Optional right task pane

Extension requested in [SRC-0011](../../01-inputs/2026-10-20-reskin-right-task-pane-request.md). The central App remains unchanged. `TaskPane.tsx` is a sibling outside the App, populated from its existing three synthetic Agent Tasks in USD, not from either previous prototype.

- Toolbar **待办** toggles the pane. It defaults to docked/open at widths ≥1600px, reserving 300px without overlaying the main canvas. Narrower screens default closed and use a dismissible drawer rather than squeezing the existing tables. Shrinking a docked viewport closes it.
- Search matches title, ID, code and category. Pending/all filters and selection survive collapse. This seed has three unresolved tasks, so both initial counts are honestly three.
- Selecting a task activates the real existing translated nav button for Journal, Reconciliation or Tax. This thin preview-only DOM bridge does not replace routing. The fixture provides only a destination module, not a record ID; the pane explains that a selection is **not a record-level deep link or approval**.
- Both Light and Dark use the same existing preview theme tokens. Original comparison hides the pane and restores full width without remounting the App.
- Modal drawers make both the App and preview strip inert, contain focus, close with Escape/backdrop, restore prior focus and scrolling, and close after task selection. Docked panes leave the App interactive.
- No task completion, approval or business writes are added. Read-only limits remain unchanged.

[Right-pane verification](../../07-reviews/2026-10-20-reskin-right-task-pane-review.md) · [Dark](../../90-assets/reskin-task-pane/right-pane-overview-dark.png) · [Light](../../90-assets/reskin-task-pane/right-pane-overview-light.png).

## Isolation and limitations

The preview copies the existing synthetic seed from `backend/app/monolith_seed.json`, adds the same two accounts as backend `initial_state()`, and changes only preview metadata, initial appearance options and revision. It never reads a real database. `seed.json` is a fixture snapshot, not a new canonical product dataset.

A preview-only fetch adapter is installed before mounting the App. It returns isolated in-memory workspace reads, permits validated appearance/language preferences, and rejects every business command and unknown fetch destination, including absolute URLs. It never delegates to network fetch. The local principal exposes the existing editors for visual inspection; visible save/approve/payment buttons do not imply permission to write. Trying them displays the read-only error through the existing application error handling. Offline exports retain existing behavior and contain demonstration data only.

No real login occurs. Sign out only explains that there is no live session. Existing period signing remains unavailable pending MFA; it is not simulated as successful. Preferences last only for the page session and reset on reload. No production frontend, backend, default entry, authentication, requirement status or existing prototype files were modified by this reskin implementation.

To confirm: final skin adoption and production rollout. Not covered: live business writes, authorization testing against a server, a new accounting model, replacing product navigation, complete accessibility or correcting existing module behavior.

## Verification

```bash
cd frontend
./node_modules/.bin/tsc
./node_modules/.bin/vite build --config vite.reskin-preview.config.ts
node --test src/reskin-preview/adapter.test.mjs
```

Standalone output is `frontend/dist/reskin-preview/`. Browser regression is `node frontend/src/reskin-preview/browser.check.mjs`, with a separately launched isolated Chrome CDP endpoint at `127.0.0.1:9236`. `CDP_URL`, `PREVIEW_URL` and `CAPTURE_DIR` can override QA defaults; never attach a personal profile.

[Verification record](../../07-reviews/2026-10-20-existing-frontend-reskin-review.md) · [Dark](../../90-assets/reskin-preview/overview-dark.png) · [Light](../../90-assets/reskin-preview/overview-light.png) · [Original comparison](../../90-assets/reskin-preview/overview-original-dark.png).
