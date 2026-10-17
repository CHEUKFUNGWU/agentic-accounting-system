# Monolith backend contract

Implements [SRC-0003](../01-inputs/2026-10-17-monolith-backend.md) for the interface adopted from [SRC-0002](../01-inputs/2026-10-17-monolith-ui.md).

## Start the connected app

Start the backend from `backend/`:

```bash
uv sync --extra dev
uv run python -m app.auth_cli create-user your-finance-login --position FINANCE_MANAGER
AAS_COOKIE_SECURE=false uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The provisioning command prompts for a password. See [authentication setup](auth-implementation.md) for reviewer and administrator accounts. The cookie exception above is only for local HTTP development.

Start the frontend from `frontend/`:

```bash
npm run dev:web -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/`. The development server proxies `/api` to `http://127.0.0.1:8000`. To use another backend, set `VITE_BACKEND_URL` when starting Vite. A separately hosted build can use `VITE_API_BASE_URL` at build time, or its host must reverse-proxy `/api` to FastAPI. There is no browser-only fallback when the API is unavailable.

## Canonical data

`monolith_workspaces` stores the Monolith workspace as one revisioned aggregate. Its journals, subledgers, planning data, preferences, command receipts, and audit events commit together. SQLite and PostgreSQL use the existing SQLAlchemy database manager. Each command uses a compare-and-swap update on the revision, preventing simultaneous writers from overwriting one another.

The first read seeds the workspace from `backend/app/monolith_seed.json`, extracted from the supplied UI's example data. The source-data label is visible in the interface. Subsequent reads use the saved company file; refreshing the browser or restarting the backend does not reseed it.

This workspace has its own chart, USD currency, and October 2026 period. It is separate from the older six regional company entities and their existing journal tables, MCP tools, and APIs. It does not migrate, relabel, or overwrite those companies. Reports and exports project the canonical Monolith journals. Existing frontend sample constants remain fixtures for unit tests and historical comparison examples, not the live workspace store.

## HTTP endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/monolith/workspace` | Complete saved workspace in the frontend's existing field names, plus revision and source metadata |
| `POST /api/v1/monolith/commands` | Validated business operation, returning the complete committed workspace |
| `GET /api/v1/monolith/trial-balance` | Server-derived trial balance with decimal strings and a balancing proof |

Command request:

```json
{
  "action": "invoice.collect",
  "payload": { "id": "INV-9012" },
  "revision": 0,
  "commandId": "f376bb7c-4597-4b51-a455-dc226e23cf0a"
}
```

The UUID identifies one operation. Repeating the same command and UUID returns the current workspace without repeating the action. Reusing its UUID with a different action or payload is refused. Stale revisions and invalid state transitions return HTTP 409; invalid fields return 422; missing records return 404. The client serializes saves, refreshes after a failed command, and cancels subsequent queued edits rather than replaying them against another session's changes.

## Commands and controls

| Commands | Server behavior |
| --- | --- |
| `journal.create`, `journal.review` | Validate date, known accounts, per-line debit/credit exclusivity, and exact balanced totals. Generate IDs and account names on the server. New manual and agent journals remain drafts until review by a separate authorized human. Only posted entries affect ledger projections and cash movements. |
| `invoice.create`, `invoice.collect` | Record invoice and receivable journal; collection records cash against receivables. Reject repeated collection. |
| `bill.create`, `bill.approve`, `bill.pay` | Record bill and payable journal. Require approval before recording payment and refuse repeated payments. |
| `bank.reconcile`, `bank.batch`, `bank.exception` | Match equal signed amounts exactly once. Record exceptions through the same journal validation path. |
| `tax.update`, `tax.provision` | Recompute the provision using saved inputs, refuse a mismatched amount or duplicate provision, and record the accrual. These commands do not file a tax return. |
| `asset.register`, `asset.depreciate` | Validate life, cost, and salvage. Registration records the asset register; acquisition journals are separate. Post depreciation once per asset and period to dedicated expense and accumulated-depreciation accounts. |
| `close.checklist`, `close.amortize` | Save checklist decisions and recognition journals. Prevent repeated recognition for the same schedule and period. |
| `period.lock`, `period.unlock` | Authenticated API calls are blocked with `MFA_REQUIRED` pending MFA enrollment. The service retains its deterministic close validations. |
| `agent.resolve` | Process the supplied queue items with the same commands. A proposed journal remains a draft; a confidence score does not authorize posting. |
| `budget.save`, `forecast.save` | Save validated plans, scenarios, drivers, and cell overrides. Additional budget rows are planning allocations, not new GL accounts. |
| `preferences.update` | Save language, theme, font family, and font size using the supported options. |

Monetary inputs are checked with Python `Decimal` at four decimal places and rejected if negative where inappropriate, non-finite, or outside the supported range. The JSON UI contract uses numbers. Percentage and asset-life fields have additional bounds. Journal attachment bytes are saved with the journal and their hashes are recomputed by the server.

Authentication and local account setup are documented in [auth-implementation.md](auth-implementation.md).

New accounting and planning audit events receive a server timestamp and SHA-256 hash linked to the preceding event. Historical sample audit rows remain imported examples. This application-level chain is not an externally notarized audit store.

## Verification

```bash
# From backend/
uv run pytest tests -q

# From frontend/
npm run test:monolith
npm run build:web
```

Tests cover persistence, balanced journals, drafts, repeated actions, concurrent revisions, idempotency, matching, tax calculation, depreciation, close gates, planning, settings, and attachments. Browser verification uses a separate temporary company file and includes an invoice collection surviving both browser reload and backend restart.

## Current boundaries

The service now authenticates human and agent callers using the shared database-backed layer described in [authentication setup](auth-implementation.md). New events identify the authenticated caller. MFA signing, complete IAM governance, and production deployment remain deferred. External payment execution, live bank feeds, tax filing, production deployment, migration of old entities into this chart, and additional Monolith companies or periods are not implemented. The existing role-scoped MCP servers continue to operate on their legacy entities, not this workspace. Historical Q3/FY chart comparisons are labeled sample data; current-quarter cash and P&L charts use posted journals.
