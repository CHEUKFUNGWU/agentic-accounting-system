// Package mcproles mounts one streamable-HTTP MCP server per position at
// /mcp/<role>, mirroring backend/app/mcp_roles.py.
//
// P4 (ADR-0002 §3). Everything an agent can touch hides behind the mount:
// tool visibility per position, aas1. Bearer credential resolution with
// argon2 verification, the human-only tool wall (approval, rejection,
// sign-off, close — agents are always refused; control O2-g), per-call
// audit, and position-scoped projections on every response.
//
// Absorbed findings: BL-06 (one reviewer-authorization policy across REST
// and MCP), BL-07 (scoped projections everywhere), BL-08 (evidence ownership
// and active-evidence checks), BL-31 (non-solo segregation; solo mode per
// SRC-0028).
package mcproles
