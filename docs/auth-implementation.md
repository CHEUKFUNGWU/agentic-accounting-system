# Authentication implementation and local setup

Source: [AUTH.md](AUTH.md), authorized by [SRC-0004](../01-inputs/2026-10-17-auth-implementation.md). This records implemented behavior; the original proposal remains the design reference.

## Implemented

- Persistent `principals`, `principal_secrets`, `api_credentials`, `auth_sessions`, `auth_events`, and `auth_throttles` tables are created additively at startup.
- Human passwords use Argon2id. Sessions expire after a fixed eight hours, use an opaque HttpOnly / SameSite=Strict cookie, and are stored as hashes. `/auth/me` restores the session after a reload. Cookies default to Secure.
- Mutating cookie-authenticated requests require `X-CSRF-Token`. Login and session mutations validate browser Origin. CSRF tokens are returned in the login and `/auth/me` response and kept in browser memory. Passwords, raw session IDs, and agent keys are never stored in localStorage.
- Failed logins use a uniform message and persistent per-account/per-connection-peer throttling. Attempts are reserved atomically before password verification. Repeated failures impose increasing cooldowns. Forwarded IP headers are not trusted automatically.
- Agent credentials use `aas1.` plus cryptographically random bytes, expire within 90 days, and support overlapping rotation and immediate revocation. Only hashes and a display prefix are persisted. The old `tok-*` credentials no longer work or appear in surface inventory responses.
- REST and MCP resolve credentials against the same database on every request. Suspended accounts and revoked/expired keys or sessions fail their next request.
- All registered `/api/v1/*` routes require authentication except `POST /auth/login`. Client-supplied maker, reviewer, CPA, and document uploader identity fields have been removed from supported request contracts. JSON identity fields are rejected by the affected strict schemas. Voucher editing, submission, and attachment changes enforce preparer ownership and account scope.
- Monolith audit events include the authenticated principal and credential/session reference. New manual and agent journals remain drafts. Posting a journal requires a different authorized human reviewer at the required review level. Idempotency receipts are bound to the principal as well as the command.
- The Monolith login page retains the adopted monochrome styling. Human reporting roles enter the workspace; administrators enter a separate read-only account/authentication governance view. The backend rejects unauthorized commands independently of UI visibility.
- ADMIN has no accounting preparation, review, or ledger-reading authority. Provisioning, key issuance/revocation, password recovery, suspension, and forced sign-out use the trusted local operator CLI. There is no public registration or bootstrap endpoint, default password, or automatically issued agent credential.
- Explicit `AAS_ALLOWED_ORIGINS` replaces wildcard credentialed CORS.

## First local setup

Run from the repository's `backend/` directory, using the same data directory and database settings as your backend server:

```bash
uv sync --extra dev
uv run python -m app.auth_cli create-user your-finance-login --position FINANCE_MANAGER --name "Finance operator"
uv run python -m app.auth_cli create-user your-reviewer-login --position CPA_ADVISOR --name "External reviewer"
uv run python -m app.auth_cli create-user your-admin-login --position ADMIN --name "System administrator"
```

Each command prompts for a password and confirmation without echoing it. Use separate human accounts for preparation and review. Never place passwords in shell arguments or environment files committed to Git. A human finance operator needs a new principal key: the seeded `finance-manager-01` identity is an agent and cannot silently become a human.

For local HTTP development only:

```bash
AAS_COOKIE_SECURE=false \
AAS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 \
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start the frontend from `frontend/` with `npm run dev:web`. Its `/api` proxy defaults to port 8000; `VITE_BACKEND_URL` selects another backend. If you choose another frontend port, include its exact origin in `AAS_ALLOWED_ORIGINS`. For HTTPS deployments keep the default Secure cookie and configure the actual frontend origins. Human sessions last a fixed eight hours in this increment; sliding expiry in the proposal remains deferred.

The CLI does not provision credentials on the user's behalf automatically. Complete the password prompts locally, then use the principal key and chosen password on the login screen.

## Agent onboarding and recovery

Existing seeded agent identities have no usable keys until issued:

```bash
uv run python -m app.auth_cli issue-key ar-clerk-01 --days 90
uv run python -m app.auth_cli create-agent second-ar-agent --position AR_CLERK --name "Second AR agent"
uv run python -m app.auth_cli issue-key second-ar-agent
uv run python -m app.auth_cli revoke-key CREDENTIAL_ID --reason "Replaced during rotation"
uv run python -m app.auth_cli suspend PRINCIPAL_KEY --reason "Access removed"
uv run python -m app.auth_cli terminate-sessions HUMAN_PRINCIPAL_KEY --reason "Lost device"
uv run python -m app.auth_cli reset-password HUMAN_PRINCIPAL_KEY --reason "Operator-verified recovery"
```

The issuance command displays the raw API key once. Save it directly in the agent's secret store. Connect it with `Authorization: Bearer <issued-key>` to the matching `/mcp/<position>/` surface. Issue the replacement before revoking the old credential for uninterrupted rotation. Revocation takes a credential ID, not the raw key. Account suspension disables both session and API access; password resets revoke all of that person's existing sessions.

## Remaining design scope

- TOTP enrollment, recovery codes, MFA-confirmed signing, and authenticated period locking/reopening are not implemented. Both legacy REST signing/closing and Monolith lock/unlock requests fail closed with `MFA_REQUIRED`. Deterministic close validations remain in the accounting service and their tests.
- Web-based identity/credential mutations, detailed Agent activity/exception governance screens, and alerts remain future work. The initial governance UI shows accounts, credential/session counts, and authentication events. Existing governance REST reads remain permission protected.
- Scoped clerks cannot read the entire Monolith aggregate or unfiltered legacy REST lists. They use existing position-scoped MCP tools; scoped frontend projections remain to be built. The initial whole-workspace editor is the finance manager position; GL/CPA positions have review access and the founder has bill-approval access.
- Operational subledger actions retain their existing posting behavior. The new independent maker/checker requirement applies to manual/agent journal review; it is not a claim that every subledger workflow has a complete approval lifecycle.
- Legacy ledger and Monolith remain separate accounting stores. This increment does not unify them, add entity-bound credentials, or implement OAuth, passkeys, or multi-tenancy.
- Existing legacy UIs at `/connected.html` and `/classic.html` have not been migrated to the new login UX. Their API calls now require credentials and use the new identity contracts; use the default Monolith entry for this increment.
- The local operator CLI assumes trusted access to the company database. Remote deployment, PostgreSQL execution, load testing, and a full independent security review remain unverified.
