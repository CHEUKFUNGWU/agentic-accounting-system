# Initial authentication implementation verification

Sources: [SRC-0004](../01-inputs/2026-10-17-auth-implementation.md), [AUTH.md](../docs/AUTH.md). Current behavior and setup: [auth-implementation.md](../docs/auth-implementation.md).

## Observed

- Backend suite: **52 passed**, including credential hashing, cookie attributes, CSRF/origin enforcement, uniform login failures, persistent throttling, concurrent first login attempts, expiration/revocation/suspension, administrator separation, identity forgery refusal, authenticated maker/checker handling, and MCP position boundaries. Existing accounting and database-upgrade regressions remain covered.
- Frontend accounting suite: **17 passed**.
- Strict TypeScript and Vite production build passed. The existing large-chunk advisory remains for the legacy connected bundle.
- Browser verification against an isolated temporary database: finance user login, workspace rendering, session restoration after reload, logout, administrator login into the separate governance view, visible account/authentication event records, and administrator logout.
- Live MCP request against the running preview: a newly issued AR credential successfully called `tools/list` on `/mcp/ar-clerk/`; the same credential was refused on `/mcp/cashier/` with HTTP 403. The temporary credential was revoked after verification.
- CLI entry point and help were executed. No real user passwords or production credentials were provisioned. Browser verification used synthetic identities in `/private/tmp/aas-auth-preview-20261017`.
- Documentation records that period signing/closing is unavailable until MFA, unfiltered workspace access requires an appropriate position, and the older frontend entry points still need login integration.

## To confirm / not covered

- The owner must create their own human login via the local password prompt and choose deployment origins. No default credential is installed.
- TOTP/recovery, full IAM mutation UI, agent-governance screens/alerts, entity-scoped credentials, and later design phases remain unimplemented.
- PostgreSQL execution, production HTTPS/reverse-proxy deployment, independent security review, and production operations have not been validated by these checks.
- These are implementation verification observations, not a formal requirement approval or live-release record.
