# Backend Go migration decision

- Source ID: SRC-0024
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: backend implementation language, migration timing, and the migration approach this decision authorizes

## Original messages

The owner asked what the current technology stack is, then questioned the Node.js part of the answer. The assistant confirmed: the product runtime is Python (FastAPI), Go (mygo desktop shell) and static frontend files; Node.js exists only as the frontend build toolchain.

The owner then asked for an investigation: if the whole backend were rewritten in Go, how large would the benefit be. The assistant's investigation (recorded as ADR-0002 §1) concluded: the benefit is real but concentrated in packaging and distribution (single static binary for the desktop target, smaller self-hosted container, lower memory); performance benefit is near zero for this workload; the full-rewrite cost is high (about 10,100 source lines plus 3,400 test lines, 345 decimal touchpoints, a dual SQLite/PostgreSQL test matrix). The assistant recommended deferring the rewrite and bridging desktop distribution with PyInstaller or Nuitka, keeping Python as the reference implementation and porting with golden-file differential testing only if desktop embedding later proved to be the main adoption path.

The owner decided:

> 那我認為有必要用Go了。趁目前我們還是初代版本，不如先全面換Go，避免日後重構的風險

## Owner decision

- Observed: the owner decided the backend will be fully reimplemented in Go, starting now. The stated rationale: the system is still in its first generation, so the rewrite is cheapest now and avoids a larger refactor risk later.
- Observed: this overrides the assistant's recommendation to defer. The conflict is recorded here and in [ADR-0002](../03-planning/adr-0002-backend-golang-migration.md) §5; it is not silently reconciled.
- Observed: the owner accepted that this is a multi-session effort; ADR-0002 fixes the phase order and the parity gates each phase must pass.

## Not covered

- No version commitment: the phases in ADR-0002 are authorized work, not a release scope. Target version stays `To confirm` in the [requirement pool](../04-requirement-pool/requirement-pool.md) (REQ-0035).
- The assistant's distribution-bridge recommendation (PyInstaller) was superseded by this decision and will not be implemented.
