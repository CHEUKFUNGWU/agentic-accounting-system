package workflow

import (
	"errors"
	"fmt"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/ledger"
	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/domain/positions"
)

// The frozen reference raises WorkspaceError with an UPPER_SNAKE kind prefix
// followed by user-facing text (the message is user-facing; the tests pin the
// kind, never the text). The port splits the two like the ledger package: the
// sentinel is the classified kind — the parity harness and callers branch on
// it, and tools/gen_workflow.py writes the same kinds into fixture
// expected_error fields — while the wrapped message keeps the reference's
// user-facing text.
//
// The reference's kind is the WHOLE message for a few refusals
// (INVALID_ASSET_CATEGORY, UNKNOWN_ACTION) that carry no user text.
var (
	// Ports of the reference's WorkspaceError kinds.
	ErrInvalidAmount        = errors.New("invalid_amount")
	ErrInvalidField         = errors.New("invalid_field")
	ErrInvalidDate          = errors.New("invalid_date")
	ErrPeriodMismatch       = errors.New("period_mismatch")
	ErrInvalidLines         = errors.New("invalid_lines")
	ErrInvalidLine          = errors.New("invalid_line")
	ErrUnbalancedEntry      = errors.New("unbalanced_entry")
	ErrInvalidAccount       = errors.New("invalid_account")
	ErrInvalidSource        = errors.New("invalid_source")
	ErrInvalidBillState     = errors.New("invalid_bill_state")
	ErrAlreadyReconciled    = errors.New("already_reconciled")
	ErrMatchAmountMismatch  = errors.New("match_amount_mismatch")
	ErrNotFound             = errors.New("not_found")
	ErrAlreadyPosted        = errors.New("already_posted")
	ErrProvisionMismatch    = errors.New("provision_mismatch")
	ErrInvalidAsset         = errors.New("invalid_asset")
	ErrInvalidAssetCategory = errors.New("invalid_asset_category")
	ErrInvalidTaxUpdate     = errors.New("invalid_tax_update")
	ErrFilingNotConnected   = errors.New("filing_not_connected")
	ErrPeriodLocked         = errors.New("period_locked")
	ErrAlreadyPaid          = errors.New("already_paid")
	ErrNoDepreciationDue    = errors.New("no_depreciation_due")

	// Refusal kinds introduced by the absorbed findings (the reference
	// accepted the defect behaviour instead). Each maps to one BL-XX in
	// doc.go and is pinned by the finding's TestBL regression.
	ErrDuplicateBill           = errors.New("duplicate_bill")                      // BL-32
	ErrMissingCreator          = errors.New("missing_creator")                     // BL-31
	ErrMissingEntryLink        = errors.New("missing_entry_link")                  // BL-10 (subledger linkage)
	ErrSODMakerChecker         = errors.New("sod_maker_checker_violation")         // BL-31
	ErrHumanReviewer           = errors.New("human_reviewer_required")             // BL-31
	ErrDutySeparation          = errors.New("duty_separation_violation")           // BL-31
	ErrControlAllocation       = errors.New("control_account_allocation_required") // BL-10
	ErrInvalidAllocation       = errors.New("invalid_allocation")                  // BL-10
	ErrMissingDocumentDate     = errors.New("missing_document_date")               // BL-34
	ErrMissingAccountingDate   = errors.New("missing_accounting_date")             // BL-34
	ErrDocumentAfterAccounting = errors.New("document_after_accounting_date")      // BL-34
	ErrProvisionInputsFrozen   = errors.New("provision_inputs_frozen")             // BL-21
	ErrAssetNotCapitalized     = errors.New("asset_not_capitalized")               // BL-11
	ErrCapitalizationNotPosted = errors.New("capitalization_not_posted")           // BL-11
	ErrCapitalizationMismatch  = errors.New("capitalization_amount_mismatch")      // BL-11
	ErrPaidBillNotVoidable     = errors.New("paid_bill_not_voidable")              // BL-33
	ErrBillAlreadyResolved     = errors.New("bill_already_resolved")               // BL-33
	ErrOriginalEntryMismatch   = errors.New("original_entry_mismatch")             // BL-33
)

// fail wraps a kind sentinel with the reference's user-facing message text.
func fail(kind error, msg string) error {
	return fmt.Errorf("%w: %s", kind, msg)
}

// kindedSentinels lists every sentinel whose text IS its fixture kind (the
// parity harness's classify in parity_test.go walks the list with errors.Is;
// the reference message text is never pinned). The crossed-package ledgers
// appear too: the workflow rules call the ledger period validation, and the
// money parser's kinds are mapped beside them.
var kindedSentinels = []error{
	ErrInvalidAmount, ErrInvalidField, ErrInvalidDate, ErrPeriodMismatch,
	ErrInvalidLines, ErrInvalidLine, ErrUnbalancedEntry, ErrInvalidAccount,
	ErrInvalidSource, ErrInvalidBillState, ErrAlreadyReconciled,
	ErrMatchAmountMismatch, ErrNotFound, ErrAlreadyPosted, ErrProvisionMismatch,
	ErrInvalidAsset, ErrInvalidAssetCategory, ErrInvalidTaxUpdate,
	ErrFilingNotConnected, ErrPeriodLocked, ErrAlreadyPaid, ErrNoDepreciationDue,
	ErrDuplicateBill, ErrMissingCreator, ErrMissingEntryLink, ErrSODMakerChecker,
	ErrHumanReviewer, ErrDutySeparation, ErrControlAllocation, ErrInvalidAllocation,
	ErrMissingDocumentDate, ErrMissingAccountingDate, ErrDocumentAfterAccounting,
	ErrProvisionInputsFrozen, ErrAssetNotCapitalized, ErrCapitalizationNotPosted,
	ErrCapitalizationMismatch, ErrPaidBillNotVoidable, ErrBillAlreadyResolved,
	ErrOriginalEntryMismatch,
	ledger.ErrPeriodLocked, ledger.ErrPeriodDateMismatch,
	ledger.ErrInvalidAccountingDate, ledger.ErrInvalidPeriod,
}

// sodDecisionErr maps a positions.CheckSelfApproval refusal reason onto the
// workflow's classified kinds (BL-31).
func sodDecisionErr(reason string) error {
	switch reason {
	case positions.KindSODMakerCheckerViolation:
		return fail(ErrSODMakerChecker, "SOD_MAKER_CHECKER_VIOLATION: Another authorized person must approve this bill.")
	case "HUMAN_REVIEWER_REQUIRED":
		return fail(ErrHumanReviewer, "HUMAN_REVIEWER_REQUIRED: Only a human may approve.")
	}
	return fail(ErrHumanReviewer, reason)
}
