# Monolith backend integration request

- Source ID: `SRC-0003`
- Received: 2026-10-17
- Provider: Repository owner via chat
- User request: "modify our backend to fit our frontend"
- Visual and interaction reference: [SRC-0002](2026-10-17-monolith-ui.md)

## Observed

The adopted frontend used local state, a different chart of accounts from the existing backend, and additional receivables, payables, bank, tax, asset, close, budget, and forecast workflows. Changes were lost on reload.

## Implementation scope

Add a canonical persistent Monolith workspace and explicit server-validated commands matching the frontend. Connect its existing controls to those commands while retaining its design. Keep existing company entities and APIs intact. Seed a separate workspace from the supplied demonstration records, identifying their origin in the interface.

## To confirm

Authentication for production users, migration of existing companies to the Monolith chart, multiple Monolith companies or periods, and external bank or tax integrations require additional scope.

## Not covered

Real bank disbursement, submission of tax returns, production deployment, or automatic migration of existing company files. Financial reports project the saved Monolith journals; the legacy ledger remains authoritative only for its original entities.
