# User plugin extension via moe.js

- Source ID: SRC-0025
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: future user-extensibility direction (mounting user-written plugins); recorded as a constraint note in ADR-0002 §8 and registered as candidate REQ-0036

## Original message

Sent while ADR-0002 (backend Go migration) was being written:

> 未来还可以加入moe.js, 這樣子用戶可以掛載他們自己寫的插件

The owner later answered the identity question the same day:

> https://github.com/Calcium-Ion/moejs

## Assistant findings

### Identity (confirmed 2026-10-24)

- Observed (repository inspection, 2026-10-24): [Calcium-Ion/moejs](https://github.com/Calcium-Ion/moejs) is, per its README, "a JavaScript runtime in pure Go, for running JavaScript plugins inside Go programs." Sandboxed by design: all imports go through a Go-provided function, `eval`/`new Function` can be capped or disabled, per-runtime memory limits, interrupts from any goroutine. Supports ES modules, classes, async/await, Proxy, BigInt and TypeScript type-stripping; passes 79,385 test262 tests with 0 failures. Builds with `CGO_ENABLED=0`; depends only on the Go standard library; requires Go 1.25+.
- Observed: license Apache-2.0; 384 stars, 11 forks, 12 commits; README states the project is alpha and the API may change between releases.
- Inferred: Apache-2.0 is compatible with the AGPL-3.0-or-later core ([ADR-0001 O1](../03-planning/adr-0001-agent-first-mcp-architecture.md)), so embedding moejs in the backend would not conflict with the license decision. ADR-0001 D6 item 3 (dependency license scan) still applies before release.
- Inferred: this direction reinforces the backend Go migration ([ADR-0002](../03-planning/adr-0002-backend-golang-migration.md)): user plugins in JavaScript embed naturally inside the Go backend; a Python backend would need a separate embedding mechanism. The earlier "goja" example in ADR-0002 §8 is superseded by the owner-named moejs.

### Controls

- Inferred: any plugin system must not create a second write path into the ledger; writes go through the domain command service and existing controls (same reasoning as [ADR-0001 D1](../03-planning/adr-0001-agent-first-mcp-architecture.md)). Frontend-side plugin mounting is independent of the backend language; server-side JS plugins would run on the embedded moejs runtime (recorded in [ADR-0002 §8](../03-planning/adr-0002-backend-golang-migration.md)).

## To confirm

- Whether plugins are meant to run in the backend (data/view extensions), the frontend (UI extensions), the desktop shell, or a combination.
- The permission model for plugins: what data and tools a third-party plugin may touch, and how this interacts with ADR-0001 D1 (agents get domain MCP tools only) and the marketplace direction REQ-0034.
- moejs API stability before any adoption: the project is alpha and states its API may change between releases.

## Not covered

- No design or implementation decision was made. Registered as candidate REQ-0036 only.
