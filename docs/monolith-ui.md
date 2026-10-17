# Monolith Ledger interface

The default frontend directly adopts the user-supplied Monolith Ledger React UI. Source provenance and the archive fingerprint are recorded in [SRC-0002](../01-inputs/2026-10-17-monolith-ui.md).

## Open locally

From `frontend/`:

```bash
npm run dev:web -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/` or `http://127.0.0.1:5173/app.html`.

| URL | Interface and data |
| --- | --- |
| `/` and `/app.html` | Supplied Monolith UI with its original browser-side sample data |
| `/connected.html` | Existing backend-connected accounting workspace, requires the backend on port 8000 |
| `/classic.html` | Previous reporting dashboard, requires the backend on port 8000 |
| `/prototype.html` | Previous bilingual review and close prototype |

## Included sections

Overview, Journal Entry, General Ledger, Receivables, Payables, Fixed Assets, Trial Balance, Statements, Budgeting, Forecasting, Reconciliation, Tax, Period Close, Audit Log, and Settings.

The supplied layout, monochrome theme, typography controls, navigation, search, charts, tables, CSV/PDF exports, and local interactions are retained. English is the supplied default. Its additional language choices are Simplified Chinese, Spanish, and Japanese.

## Verification

```bash
npm run build:web
npm run test:monolith
```

The supplied tests run using Node.js's native TypeScript support, requiring Node 22.18+ or a newer supported release. Browser builds exclude the Node-only test file from TypeScript checking. Application source remains under the existing strict compiler settings.

## Data behavior

This UI uses the sample data and state model included in the archive. Accounting actions modify that browser session and reset on reload. Appearance preferences use the supplied `monolith_preferences_v1` local-storage key. These actions do not change backend books, authorize real payments, file tax returns, or create production audit evidence.

The existing backend and its connected interfaces are retained. No environment files, AI Studio metadata, or private service credentials were imported from the archive.
