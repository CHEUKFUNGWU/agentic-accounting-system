# Agentic Accounting System backend

FastAPI service for source documents, vouchers, ledger-derived reporting, and role-scoped MCP tools.

## Current capabilities

- Source-document capture and attachment retrieval.
- Draft vouchers, submission, separate review, and hash-linked posting.
- Chart of accounts, fiscal periods, counterparties, tax codes, ledger movements, and trial balances.
- Standalone income statement, balance sheet, cash flow statement, and supporting schedules.
- Ten MCP role surfaces, with position-specific tool registration and audit records.

The implementation is maintained in [main.py](app/main.py), [api_documents.py](app/api_documents.py), [api_vouchers.py](app/api_vouchers.py), and [mcp_roles.py](app/mcp_roles.py).

## Local development

Run from `backend/`:

```bash
uv sync --extra dev
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The default company file uses SQLite. Set `AGENTIC_ACCOUNTING_DATA_DIR` to choose a local data directory. `DATABASE_URL` selects an explicit database connection instead.

Reporting is available at `/api/v1/reporting/{entity_code}/{period}`. MCP endpoints use `/mcp/<position>/`, such as `/mcp/ap-clerk/`; the former shared `/mcp` surface has been removed. The development inventory is available at `/api/v1/mcp/surfaces`.

## Monolith frontend integration

The default Monolith UI uses `/api/v1/monolith/workspace` and `/api/v1/monolith/commands`. This persistent workspace supports its journal, subledger, reconciliation, tax-provision, asset, close, budget, forecast, preference, and audit workflows. It is initially seeded from the supplied demonstration dataset and remains separate from the existing regional company records. See [the contract and setup](../docs/monolith-backend.md).

## Verification

```bash
uv run pytest tests -q
```

Tests use temporary company files. They cover report balancing, maker/checker separation, duplicate approval refusal, source-document conversion, posting, backups, and preservation of legacy SQLite balances and lock status.

## Development limits

- MCP currently accepts fixed demonstration credentials, exposed by the local surface inventory. REST endpoints do not yet authenticate the caller and still accept principal identifiers in request bodies. This build is for trusted local development. The proposed authentication work is recorded in [AUTH.md](../docs/AUTH.md).
- Document conversion creates manual draft vouchers. Control-account lines can be refused by the submission guard; a complete invoice-to-payables subledger workflow is not implemented by that conversion endpoint.
- SQLite startup handles the legacy table and column names. Upgrading an existing PostgreSQL schema requires a separate migration; `create_all` does not upgrade existing tables.
- Automated checks do not establish statutory compliance or production readiness. Native desktop packaging, production deployment, concurrent posting, and a full browser acceptance pass are outside the checks performed for this commit preparation.
