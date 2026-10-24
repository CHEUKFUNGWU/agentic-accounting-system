# Approved UI adoption verification

Date: 2026-10-20. Implementation authorized by [SRC-0014](../01-inputs/2026-10-20-ui-adoption-request.md). [Current appearance documentation](../docs/ui-appearance.md).

## Implementation

- Default authenticated entry imports `monolith/skin.css`: approved sidepane/canvas, Light/Dark, 10px panels, 6px controls and 4px bordered labels. Existing 15 business modules are retained.
- `TaskQueuePane.tsx` receives live workspace tasks, company, period, currency and language. It uses direct App state navigation, not the preview DOM-click bridge. Selection clears stale search/account focus and submits no business action.
- Pane counts/list update from returned server workspace state. Context keys reset per company/period; disappearing tasks do not retain an obsolete notice. All existing language options have task-pane copy.
- Wide panes reserve 300px. Smaller drawers portal outside the inert application root, contain focus, restore scrolling/focus and close on selection/Escape/backdrop. Resizing to a narrow viewport closes docking.
- Existing API/authentication implementation, command queue/revision guards, permissions, human-review and MFA restrictions were preserved. Backend source, frontend `api.ts` and `auth.ts` are unchanged.
- No preview fixture, fake principal, fetch adapter, comparison strip or preview-only read-only behavior is imported by the product entry. Independent preview explicitly passes `showTaskPane={false}` so its own historical pane does not duplicate the native pane.
- Unauthenticated/governance/position-scoped screens follow system appearance without fetching accounting preferences. Authenticated workspace preferences remain server-authoritative. No new browser persistence was added.

## Executed verification

- `npm run build:web`: TypeScript and production Vite build passed. Existing connected-entry >500 kB chunk warning remains non-blocking.
- `npm run test:monolith`: 21 tests passed, including four new live-task counting/filtering/localization/period-context tests.
- Isolated backend regression: `env -u DATABASE_URL .venv/bin/python -m pytest tests/test_auth.py tests/test_monolith_api.py tests/test_audit_security_fixes.py -q`: 40 passed. The existing test fixture selected a temporary data directory.
- [Authenticated browser report](../90-assets/ui-adoption/checks.json): 46 assertions passed against the actual AuthGate/App and real HTTP/CSRF API, not an adapter. Covered all 15 modules, real login/logout, persistent themes/session reload, live task resolution updates, navigation without commands, language, MFA restriction, portal/focus/scroll behavior, administrator separation, position-scoped access and real session-expiry handling. No unhandled browser exceptions.
- Browser QA used a new disposable SQLite directory, QA-only random-password identities, backend 8064 with application workers disabled, frontend 5180 and an isolated local Chrome profile. Neither the existing backend on 8000 nor a personal company file/browser profile was used. Credentials remained in a mode-600 temporary file outside Git and were removed after verification.
- An initial browser run reached the final expiry step but used an English button label after a persisted Chinese preference. Corrected that QA selector, reset only the disposable workspace/sessions and reran successfully. No product behavior change was required.
- [Independent preview regression](../90-assets/ui-adoption/preview-regression-checks.json): all existing 61 assertions passed after integration, including original/reskin DOM comparison, right-pane behavior and zero real API traffic in preview.
- Fresh independent code review returned **ship at the implementation scope**. Reviewer inspected relevant changes, screenshot evidence and authenticated report, and independently reran 21 frontend tests. Backend/browser/build evidence was reviewed but not rerun by the reviewer.
- Mechanical detector ran once. Only incumbent Inter-font warning; retained to match the owner-approved existing frontend typography.
- `git diff --check` passed. Earlier uncommitted prototype/configuration work was preserved, not removed or treated as new product behavior.

## Visual evidence

Local captures of synthetic QA data, not a real company or generated imagery:

[Login Light](../90-assets/ui-adoption/login-light.png), [Workspace Light](../90-assets/ui-adoption/workspace-light.png), [Workspace Dark](../90-assets/ui-adoption/workspace-dark.png), [Journal Dark](../90-assets/ui-adoption/journal-dark.png), [Mobile task drawer](../90-assets/ui-adoption/task-drawer-mobile-dark.png), [Mobile Settings Light](../90-assets/ui-adoption/settings-mobile-light.png), [Governance Light](../90-assets/ui-adoption/governance-light.png).

Capture/browser automation used an isolated local Chrome profile because Ego screenshot capture was unavailable in preceding verification. Motion was reduced for deterministic captures. Desktop 1680 × 1000; mobile 390 × 844.

## Limits

This records local source adoption and isolated runtime verification. It is not production deployment, desktop binary release, a full accounting/accessibility audit, completed MFA or a formal requirement lifecycle advancement. Existing business-module limitations remain unchanged. Tasks link to modules, not individual records. Deployment and live release verification remain to confirm.
