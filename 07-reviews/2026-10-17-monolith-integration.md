# Monolith backend integration verification

- Date: 2026-10-17
- Scope: [SRC-0003](../01-inputs/2026-10-17-monolith-backend.md)
- Contract: [Monolith backend](../docs/monolith-backend.md)
- Record type: Implementation verification, not production release approval

## Observed

- Backend suite: 42 tests passed, including the pre-existing accounting tests and new Monolith persistence and command tests.
- Frontend suite: 17 tests passed, including exclusion of drafts, non-cash depreciation reconciliation, and live cash movements.
- Strict TypeScript checking and the Vite production build passed for all entry points. The retained legacy interface still produces a bundle-size warning.
- Through the browser, a $123.45 invoice was issued, collected, and shown as paid after browser reload and a backend process restart. Separate invoice and collection journals were visible.
- A $12.34 manual journal was confirmed by the server before the success message appeared.
- A budget value of 812345 survived leaving and reopening its screen.
- A forecast revenue-growth driver of 14 and dark-mode preference survived browser reload. The preview was restored to light mode.
- The connected server trial balance returned equal debit and credit totals, with a difference of 0.0000.

Browser checks used a separate company file under the system temporary directory. Existing company files were not used for test mutations.

## To confirm

Production user authentication, additional Monolith entities and periods, migration from the older company charts, and connectivity to external bank and tax services require further work and explicit scope.

## Not covered

Production deployment, real payment execution, tax filing, native desktop packaging, PostgreSQL runtime testing, and a complete acceptance review of every screen and edge case. Automated balance checks do not establish statutory compliance.
