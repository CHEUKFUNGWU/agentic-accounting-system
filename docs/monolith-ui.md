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
| `/` and `/app.html` | Supplied Monolith UI connected to a persistent Monolith backend workspace |
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

The UI now loads and saves through the [Monolith backend contract](monolith-backend.md). It initially uses the supplied example dataset in a separate workspace, then persists changes in the company database. Refreshing the browser or restarting the backend preserves journals, subledgers, plans, preferences, and audit events.

The visual design is retained. Loading, save failures, pending saves, source metadata, and explicit draft review now reflect real server responses. Financial mutations are validated on the server before success is shown. The backend receives commands rather than unrestricted client state replacements.

Payments record disbursements in the books; they do not initiate bank transfers. Tax provision posting records an accrual and does not submit a tax return. Existing regional company records remain separate and accessible through their earlier interfaces.
