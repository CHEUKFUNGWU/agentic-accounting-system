package voucher

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
)

// This file ports the submitted-snapshot guard of posting.post_voucher:
// "Reviewers may change review metadata, but not the submitted accounting
// snapshot." Between the reviewer's read and the posting commit, any change
// to a snapshot field refuses the approval (VOUCHER_SNAPSHOT_CHANGED); the
// reviewer reloads before approving. Field-level, order-preserving, and
// value-exact like the reference.

// SnapshotFields mirrors posting.SNAPSHOT_FIELDS, in the tuple's order: the
// order the changed-field list is rendered in.
var SnapshotFields = []string{
	"revision", "entity_code", "source_module", "accounting_date", "currency", "period",
	"total_debit", "total_credit", "created_by_principal_key",
	"created_by_principal_id", "lines", "entry_layer", "basis", "memo",
	"evidence_uris", "reversal_of_journal_id", "proposal_json",
	"ai_confidence_score", "ai_reasoning_summary", "voucher_no",
}

// KindVoucherSnapshotChanged is the refusal kind of post_voucher's snapshot
// guard.
const KindVoucherSnapshotChanged = "VOUCHER_SNAPSHOT_CHANGED"

// Snapshot is one voucher snapshot as the guard sees it: the journal-dict
// fields that may not drift between submission and approval, in their JSON
// wire form (amounts cross as strings; lines is the list of stored-line
// objects; evidence_uris the decoded list). A missing key is the reference's
// None.
type Snapshot map[string]json.RawMessage

// get decodes one field value; a missing key or JSON null is the reference's
// None (nil). ok is false only for undecodable bytes — corruption the store
// produced, which never compares equal to anything.
func (s Snapshot) get(field string) (value any, ok bool) {
	raw, present := s[field]
	if !present || len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&value); err != nil {
		return nil, false
	}
	return value, true
}

// ChangedSnapshotFields mirrors post_voucher's snapshot check:
// [field for field in SNAPSHOT_FIELDS if submitted.get(field) !=
// current.get(field)], in SNAPSHOT_FIELDS order. Equality is deep JSON
// equality with numbers compared as literal text (amounts are strings on
// the wire, so this matches the reference's value comparisons).
func ChangedSnapshotFields(submitted, current Snapshot) []string {
	changed := []string{}
	for _, field := range SnapshotFields {
		a, aOK := submitted.get(field)
		b, bOK := current.get(field)
		if !aOK || !bOK || !reflect.DeepEqual(a, b) {
			changed = append(changed, field)
		}
	}
	return changed
}

// CheckSnapshot refuses the approval when any snapshot field drifted.
func CheckSnapshot(submitted, current Snapshot) error {
	if changed := ChangedSnapshotFields(submitted, current); len(changed) > 0 {
		return &PostingError{
			Kind:    KindVoucherSnapshotChanged,
			Message: "VOUCHER_SNAPSHOT_CHANGED: " + strings.Join(changed, ", ") + ". Reload before approval.",
		}
	}
	return nil
}
