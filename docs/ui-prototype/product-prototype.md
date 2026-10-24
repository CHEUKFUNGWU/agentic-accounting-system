# Current-product UX prototype

Draft independent prototype. Product-flow reference: [UI/UX workflow blueprint](../../03-planning/ux-workflow-blueprint.md), which remains Draft. Current accounting-table conventions come from the adopted Monolith interface. Visual/scope direction: [SRC-0009](../../01-inputs/2026-10-20-product-prototype-clarification.md), refining SRC-0008.

## Open

Run `cd frontend && npm run dev:web -- --host 127.0.0.1`, then open <http://127.0.0.1:5173/product-prototype.html>.

This is a new URL. `/prototype.html`, `/reader-prototype.html`, the default `/`, and the production backend remain unchanged. The only shared runtime configuration change is an additional Vite build entry.

## Implemented discussion flows

| Product entry | Working prototype views / interactions |
| --- | --- |
| 工作台 | Decision tasks, missing documents, recent activity and computed close blockers |
| 单据与交易 | Documents, status filtering, three-column review, required acknowledgement, return reason, replacement evidence and fresh review, payable recognition status, counterparties |
| 银行对账 | Bank/book comparison; selecting and matching two existing records without creating duplicate entries |
| 账簿与报表 | Journals, account ledger, trial balance, dynamic profit summary; amount → account → journal → synthetic document |
| 月结 | Computed blockers; snapshot preview; acknowledgement; simulated period lock |
| Agent 与控制 | Delegated-scope explanation; simulated stop/resume; failed-run inspection and closure; session audit |
| 设置 | Appearance, fixed company/book context, scope explanation and reset link |

Only these secondary views are implemented. This is not the full roadmap. Receivables, payments, upload/OCR, automatic policy authoring, complex reconciliation, statutory reports, onboarding, reopening and MFA remain outside this draft. No fake buttons claim those capabilities.

## Light and Dark

- Shared geometry: inset rounded sidepane, uninterrupted canvas, subdued separators and sage selection. No reading-app typography, chapter navigation, teal desktop frame or legacy review queue.
- Dark: canvas `#171819`, sidepane `#232426`, selected `#303c36`, primary text `#e4e6df`, secondary `#a3aaa2`.
- Light: canvas `#f8f9f7`, sidepane `#eeefec`, selected `#dce5dc`, primary text `#282e29`, secondary `#666d65`.
- Installed Inter Variable plus system Chinese sans preserves the accounting app's typography. Numeric amounts are tabular and right aligned. Both themes cover tables, review evidence, search, notices and settings.
- Sidebar theme selector, header toggle and Settings theme controls stay synchronized. First visit follows OS preference. Only theme is saved under `monolith-product-mock-theme`; no transaction state is persisted.
- Desktop has seven primary entries. Mobile uses a focus-trapped drawer and stacks review evidence/entry/control sections. This stacked mobile review is a deliberate limited draft, not the blueprint's complete tabbed adaptive design.

## Isolation and truthfulness

Observed: application imports only local `model.ts`, React, installed fonts/icons and its own CSS. It does not import either earlier prototype or the production API. All business data is newly authored synthetic CNY data, fixed to October 2026 and an explicitly fictional company. Integer-fen amounts are used; expense recognition updates journals, trial balance and profit summary. No jurisdiction-approved tax treatment is attempted.

All actions are local simulations. Evidence is an HTML facsimile, not a processed real PDF. Matching never sends a transfer. Closing does not execute real signing/MFA. Stopping the Agent changes local policy presentation only, not credentials. Refresh resets transactions. No production configuration, pages, backend or requirement statuses were changed.

To confirm: adoption, full secondary-page scope, company/jurisdiction configuration, comprehensive responsive review, accessibility and production accounting/control behavior. This artifact is for discussion, not approval or release evidence.

## Verify

- Build: `cd frontend && npm run build:web`.
- Local model: `node --test src/product-prototype/model.test.mjs` from `frontend/`.
- Browser regression: `node frontend/src/product-prototype/browser.check.mjs`. Requires a separately launched isolated Chrome CDP endpoint at `http://127.0.0.1:9235`; override via `CDP_URL`, `PROTOTYPE_URL`, `CAPTURE_DIR`. Do not point it at a personal browser profile. It resets mock transactions and theme during testing.

See [dated verification](../../07-reviews/2026-10-20-product-prototype-review.md) and [Light](../../90-assets/product-prototype/desktop-light.png) / [Dark](../../90-assets/product-prototype/desktop-dark.png) captures.
