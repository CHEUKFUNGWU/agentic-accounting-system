package posting

// This file ports the hash-chain allocation decisions of
// repository.get_latest_posted_hash and repository.get_next_block_index —
// the BL-25 remediation: the next block index and parent hash derive from
// the entity's current head, and the head's query includes sealed reversed
// vouchers, so a reversed entry can never fork the chain. The serialization
// itself (SQLite BEGIN IMMEDIATE / the entity row lock) is P2 store work.

// ChainEntry is one sealed entry of an entity's chain as the allocator sees
// it. Status is the stored string ("POSTED" or "REVERSED" qualify);
// EntryHash empty means unsealed. PostedAt and CreatedAt are the ISO strings
// the reference's ORDER BY tie-breaks on.
type ChainEntry struct {
	JournalID  string `json:"journal_id"`
	Status     string `json:"status"`
	EntryHash  string `json:"entry_hash"`
	BlockIndex int64  `json:"block_index"`
	PostedAt   string `json:"posted_at"`
	CreatedAt  string `json:"created_at"`
}

// genesisBlock is the chain root the reference's queries fall back to
// (repository.get_latest_posted_hash's `or "GENESIS_BLOCK_…"`).
const genesisBlock = "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"

// ChainHead ports the two allocation queries: it filters the entries the
// predicate admits (status POSTED or REVERSED with a non-null entry hash),
// takes the head by block_index (then posted_at, then created_at, the
// reference's DESC order) and returns the parent hash plus the next block
// index. With no sealed entry the parent is the genesis block and the next
// index is 1 — including the first chain block in the serialized allocation
// is the BL-25 fix. Equal sort keys are corrupted duplicate blocks; the port
// keeps the first maximal entry in input order.
func ChainHead(entries []ChainEntry) (prevHash string, nextIndex int64) {
	sealed := make([]ChainEntry, 0, len(entries))
	for _, e := range entries {
		if (e.Status == "POSTED" || e.Status == "REVERSED") && e.EntryHash != "" {
			sealed = append(sealed, e)
		}
	}
	if len(sealed) == 0 {
		return genesisBlock, 1
	}
	head := sealed[0]
	for _, e := range sealed[1:] {
		if chainKeyLess(head, e) {
			head = e
		}
	}
	return head.EntryHash, head.BlockIndex + 1
}

// chainKeyLess reports whether b sorts after a under the reference's
// ORDER BY block_index DESC, posted_at DESC, created_at DESC.
func chainKeyLess(a, b ChainEntry) bool {
	if a.BlockIndex != b.BlockIndex {
		return a.BlockIndex < b.BlockIndex
	}
	if a.PostedAt != b.PostedAt {
		return a.PostedAt < b.PostedAt
	}
	return a.CreatedAt < b.CreatedAt
}
