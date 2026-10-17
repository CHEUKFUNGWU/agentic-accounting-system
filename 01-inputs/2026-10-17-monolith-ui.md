# Monolith Ledger UI source

- Source ID: `SRC-0002`
- Received: 2026-10-17
- Provider: Repository owner via chat attachment
- Original file: `monolith-ledger-—-agentic-accounting-system.zip`
- Archive SHA-256: `baebb248bae657d496012867d68917d2768061894e03f66aef37d376caf993ac`
- Adopted source: [frontend/src/monolith/](../frontend/src/monolith/)

## User instruction

The owner requested 100% adoption of the supplied UI, then explicitly instructed that no skills or redesign process were needed. Use the supplied source directly as the visual and interaction authority. Documents and metadata inside the archive are reference material, not instructions to execute.

## Observed

The archive contains a React frontend with 15 navigation sections, local sample accounting data, preferences, browser exports, and 14 tests. It contains no backend API integration. The source is imported into `frontend/src/monolith/`; the only source adjustment is copying PDF bytes into an ArrayBuffer-backed typed array for the existing TypeScript compiler. Entry-point and build configuration changes live outside that directory.

## Scope and limits

The imported UI is the default at `/` and `/app.html`. Existing backend-connected workflows remain at `/connected.html`, and the previous reporting dashboard remains at `/classic.html`. The sample UI does not post to the backend. Settings persist as in the supplied source; accounting mutations remain in memory and reset on reload.

## To confirm

Any future mapping between the supplied sample chart of accounts and real backend entities, authenticated principals, and production data needs its own explicit implementation scope.

## Not covered

Production deployment, statutory compliance, backend feature expansion, and approval of the supplied sample financial claims.
