package posting

import (
	"strings"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/voucher"
)

// This file ports the review-metadata update of mcp_roles._review_voucher as
// a pure state transition: the verdict's checklist/reason guards, the
// structured review_notes payload the reviewer's decision becomes, and the
// status/reject_reason deltas. The reviewer identity, the verdict and the
// timestamp arrive as arguments — review has no clock and no self-derived
// authority here. The authority rules (who may review whom,
// reviewer.authorize_review) are the reviewer module's seam, upstream of
// this transition.
//
// The legacy mcp_server.review_and_approve_proposal path differs (it writes
// reject_reason unstripped and mutates ai_reasoning_summary instead of the
// structured notes); the role-scoped surface below is the current one.

// Verdicts of the review decision (reviewer.validate_verdict's set).
const (
	VerdictApprove  = "APPROVE"
	VerdictReject   = "REJECT"
	VerdictEscalate = "ESCALATE"
)

// ReviewDecision is one review act. ReviewedAt is the ISO timestamp the
// reference stamps with datetime.now(UTC); it arrives as an argument.
type ReviewDecision struct {
	Verdict              string   `json:"verdict"`
	ReviewerPosition     string   `json:"reviewer_position"`
	ReviewerPrincipalKey string   `json:"reviewer_principal_key"`
	Checked              []string `json:"checked"`
	Reason               string   `json:"reason"`
	ReviewedAt           string   `json:"reviewed_at"`
}

// ReviewOutcome is the transition's result: the metadata to store and, for
// an approval, the instruction to run the posting sequence.
type ReviewOutcome struct {
	// ReviewNotes is the payload mcp_roles stores (json.dumps,
	// ensure_ascii=False, the reference's default separators).
	ReviewNotes string         `json:"review_notes"`
	Status      voucher.Status `json:"status"`
	// RejectReason is set on a rejection (the reference's reason.strip()).
	RejectReason *string `json:"reject_reason"`
	// ProceedToPost marks an approval: the caller continues into Plan with
	// the review notes already on the submitted snapshot.
	ProceedToPost bool `json:"proceed_to_post"`
}

// ApplyReview applies a review decision to a reviewable voucher, in the
// reference's check order: state first, then verdict, then the
// content-the-review-owes rules, then the metadata. The current voucher is
// never mutated.
func ApplyReview(current Journal, d ReviewDecision) (ReviewOutcome, error) {
	if current.Status != voucher.StatusPendingChecker && current.Status != voucher.StatusAwaitingCPA {
		return ReviewOutcome{}, refusal(KindInvalidState,
			"憑證 "+pyVoucherNo(current.VoucherNo)+
				" 狀態為 "+string(current.Status)+"，不在待複核佇列。")
	}
	verdict := strings.ToUpper(d.Verdict)
	if verdict != VerdictApprove && verdict != VerdictReject && verdict != VerdictEscalate {
		return ReviewOutcome{}, refusal(KindInvalidVerdict,
			"verdict must be APPROVE / REJECT / ESCALATE")
	}
	// 複核要有內容：核准必須附上檢查清單，否則只是蓋章。
	if verdict == VerdictApprove && len(d.Checked) == 0 {
		return ReviewOutcome{}, refusal(KindReviewChecklistRequired,
			"核准必須在 checked 列出你實際核對過的項目"+
				"（例如「金額與發票相符」「科目性質正確」「期間正確」）。沒有檢查清單的複核不算複核。")
	}
	if verdict != VerdictApprove && strings.TrimSpace(d.Reason) == "" {
		return ReviewOutcome{}, refusal(KindReasonRequired,
			"駁回或升級必須填寫理由。")
	}
	out := ReviewOutcome{
		ReviewNotes: ReviewNotes(verdict, d),
	}
	switch verdict {
	case VerdictReject:
		out.Status = voucher.StatusRejected
		reason := strings.TrimSpace(d.Reason)
		out.RejectReason = &reason
	case VerdictEscalate:
		out.Status = voucher.StatusAwaitingCPA
	default:
		out.Status = current.Status
		out.ProceedToPost = true
	}
	return out, nil
}

// ReviewNotes builds the review_notes payload: the reference's json.dumps of
// the decision dict, insertion-order keys, ensure_ascii=False (non-ASCII
// stays literal), default separators (", ", ": ").
func ReviewNotes(verdict string, d ReviewDecision) string {
	checked := d.Checked
	if checked == nil {
		checked = []string{}
	}
	var b strings.Builder
	b.WriteString(`{"verdict": `)
	b.WriteString(pyJSONText(verdict))
	b.WriteString(`, "reviewer_position": `)
	b.WriteString(pyJSONText(d.ReviewerPosition))
	b.WriteString(`, "reviewer_principal_key": `)
	b.WriteString(pyJSONText(d.ReviewerPrincipalKey))
	b.WriteString(`, "checked": `)
	b.WriteString(pyJSONList(checked))
	b.WriteString(`, "reason": `)
	b.WriteString(pyJSONText(d.Reason))
	b.WriteString(`, "reviewed_at": `)
	b.WriteString(pyJSONText(d.ReviewedAt))
	b.WriteString(`}`)
	return b.String()
}

// pyJSONText renders one string the way Python json.dumps(ensure_ascii=
// False) does: quote/backslash escaped, control characters as their short
// escapes or \uXXXX, every other rune literal.
func pyJSONText(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r < 0x20:
			b.WriteString(`\u`)
			const hex = "0123456789abcdef"
			b.WriteByte(hex[(r>>12)&0xF])
			b.WriteByte(hex[(r>>8)&0xF])
			b.WriteByte(hex[(r>>4)&0xF])
			b.WriteByte(hex[r&0xF])
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// pyJSONList renders a JSON array of strings with the default separators.
func pyJSONList(items []string) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, item := range items {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(pyJSONText(item))
	}
	b.WriteByte(']')
	return b.String()
}
