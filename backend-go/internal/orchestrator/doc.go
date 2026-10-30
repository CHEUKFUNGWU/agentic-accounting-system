// Package orchestrator is the durable outbox and dispatcher, mirroring
// backend/app/orchestrator/event_bus.py.
//
// P5 (ADR-0002 §3). Durable-then-dispatch: events are committed with the
// accounting command (enlisted by the store adapter inside the command
// transaction — design rule 5) and dispatched with persistent per-subscriber
// retry state, so delivery failures never masquerade as dispatched.
// Absorbed findings: BL-24 (failed delivery marked dispatched), BL-26 (no
// durable transactional outbox; aligned with REQ-0008).
package orchestrator
