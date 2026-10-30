// Package chain implements the audit hash chain: canonical serialization,
// SHA-256, parent links, append and verify (ADR-0002 D2 freezes the byte
// format emitted by the frozen Python reference).
//
// P2 owns the implementation against real ledgers, including byte-identical
// reproduction of Python-produced chain heads; parity failures stop the
// migration — history is never recomputed (work order rule 5). Interface per
// design.md: Append(st Store, entry ChainEntry) and Verify(st Store, from
// Index). BL-25 (serialized entity chain allocation) was already fixed in
// Python and ports as-is.
package chain
