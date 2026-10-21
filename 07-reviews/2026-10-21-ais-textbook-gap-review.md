# AIS textbook gap review

Date: 2026-10-21. Engineering review against a standard accounting information systems control framework. It is not a statutory audit opinion or production approval.

## Sources and baseline

- SRC-0018: [owner request and reference material](../01-inputs/2026-10-21-ais-textbook-gap-review-request.md).
- SRC-0019: this dated inspection record.
- Reference: Romney and Steinbart, *Accounting Information Systems*. It is held locally only and excluded from Git. Citations give table and control numbers, for example "13-2 control 21.6", and paraphrase the book without reproducing it.
- Baseline: commit `6914136402862342fe5ddae0ff9e58602204c765` plus the uncommitted working tree on 2026-10-21. Line numbers will move as code changes.
- Exclusions: findings BL-01 to BL-29 in the [business logic audit](2026-10-21-business-logic-audit.md) are being remediated separately and are not repeated here. This record does not change that file.

## Scope and method

The review compared the code against these chapters:

- Chapter 2: transaction processing and audit trail.
- Chapter 7: internal control.
- Chapter 10: processing integrity and data entry controls (Table 10-1).
- Chapter 12: revenue cycle (Table 12-1).
- Chapter 13: expenditure cycle (Table 13-2).
- Chapter 16: general ledger and reporting (Table 16-1).

The threat and control tables and their supporting sections were read; not every page of the book was read. Inventory, production (chapter 14) and payroll (chapter 15) are excluded from v1.0 by the [roadmap](../03-planning/product-roadmap.md) and were not assessed.

Two findings were reproduced with a temporary script against an isolated SQLite database (`DATABASE_URL` unset, temporary data directory). The script was deleted after use; repairs must add checked-in regression tests. Other findings are from code inspection.

## Findings

Each row is an Observed defect unless its text says otherwise. An unchecked box means remediation has not been verified. Severity uses the same scale as the business logic audit.

### Master data

- [ ] **BL-30, high: counterparties are created implicitly, and name variants crash.** `backend/app/core/ledger.py:335` (`resolve_counterparty`), called from `backend/app/api_documents.py:99`.
  - A document upload creates a vendor master record from the counterparty name, with no approval and no change record. Whoever submits a document, including an agent, can add a supplier.
  - Reproduced: after "Acme Pty Ltd" was created, resolving "ACME Pty Ltd." raised `IntegrityError` on `counterparties.counterparty_id`. Lookup is by exact name, but the key is a lowercase slug of the name, so variants collide instead of matching.
  - Book reference: 13-2 controls 1.2, 1.3, 10.1, 21.9 and 21.10. The book singles out the default that lets the person recording payables also create new suppliers as a segregation-of-duties failure.
  - Required: explicit, authorized counterparty creation and change, with a reviewable change log; normalized matching that warns on near-duplicates; and no master-data writes as a side effect of document intake.

### Expenditure cycle (Monolith)

- [ ] **BL-31, high: bill recording, approval, payment and bank reconciliation are not segregated.** `backend/app/core/monolith.py:196–214`, `backend/app/core/positions.py:325`.
  - The finance manager position holds `bill.create`, `bill.approve`, `bill.pay`, `bank.reconcile` and `bank.batch`.
  - Bills do not record who created them, and approval does not check that the approver differs from the creator. One person can record, approve and pay a fictitious bill, then reconcile the bank account that would reveal it.
  - Book reference: 13-2 controls 21.6 and 21.8; 12-1 control 17.1.
  - Required: record the creator and approver on each bill; reject approval by the creator; and keep payment recording and bank reconciliation independent of payables recording.
  - Owner decision 2026-10-21 ([SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21-one-person-company-profile), [ADR-0001 one-person company profile](../03-planning/adr-0001-agent-first-mcp-architecture.md#一人公司模式owner-已於-2026-10-21-決定)): in a one-person company the owner may record, approve and pay their own bills. Such approvals must be flagged as self-approved and listed in the year-end audit pack. No external accountant review is required, and agents still cannot approve. For one-person companies, the finding is narrowed to recording the creator and approver and flagging self-approval. The full segregation requirement still applies to all other entities.
- [ ] **BL-32, high: duplicate bills are accepted.** `backend/app/core/monolith.py:196`.
  - `bill.create` does not check the vendor, supplier invoice reference, amount or date against existing bills. The same supplier invoice can be recorded and paid twice.
  - BL-05 covers duplicate document uploads in the regional ledger; it does not cover this path.
  - Book reference: 13-2 threat 20 and controls 20.1 to 20.3.
  - Required: business duplicate detection on supplier and invoice reference, with an explicit override that is recorded and reviewed.
- [ ] **BL-33, medium: bills cannot be rejected or voided.** `backend/app/core/monolith.py:196–214`.
  - A bill posts expense and payables when created in `Pending`, but the only transitions are approve and pay. A disputed, wrong or fictitious bill stays in the ledger unless someone writes a manual correcting journal, which leaves no link to the bill.
  - Book reference: 13-2 controls 16.1 and 20.1.
  - Required: a reject or void transition that reverses the original entry through the correction workflow and keeps the audit link.

### Cutoff and receivables (Monolith)

- [ ] **BL-34, medium: invoice and bill dates cannot be supplied.** `backend/app/core/monolith.py:80–83`, used at lines 183 and 200.
  - The date is today when today falls in the workspace period, and otherwise the first day of the period. A supplier invoice dated in a prior period is recognized in the current one.
  - This contradicts control C04 in the [accounting control matrix](../03-planning/accounting-control-matrix.md), which forbids defaulting to the first day of a month. BL-04 covered the regional ledger only.
  - Required: separate document date and accounting date, validated against open periods, with late documents routed to the correction process.
- [ ] **BL-35, medium: receivable aging is never recalculated.** `backend/app/core/monolith.py:183,194`.
  - New invoices are stored with aging bucket "Current", and collection resets it to "Current". No code recomputes the bucket from the due date, so overdue receivables stay "Current". Only seed data shows other buckets.
  - Book reference: 12-1 control 7.3.
  - Required: derive aging from due date and an as-of date at query time, not store it as a static field.

### Audit trail

- [ ] **BL-36, medium: voucher numbers are not guaranteed unique and gaps are not reported.** `backend/app/core/vouchers.py:129`, `backend/app/core/db.py:149`.
  - `voucher_no` has an index but no unique constraint. `next_voucher_no` picks the lowest unused number before anything is saved.
  - Reproduced: three concurrent calls for the same entity and period all returned `記-2026-10-0001`. A complete duplicate save was not run end to end, so persisted duplicates are inferred, not observed.
  - Numbers are allocated at draft creation, so rejected drafts leave gaps in the posted sequence, and no report shows gaps.
  - Book reference: chapter 2 prenumbering and audit trail; chapter 10 sequence checks.
  - Required: a unique constraint per entity and period, allocation inside the posting transaction or an explicit reservation, and a gap report.
  - Owner decision 2026-10-21 ([SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21-remaining-recommendations)): drafts use a separate draft ID. The voucher number is allocated only at posting, under a unique constraint per entity and period, so posted vouchers are numbered continuously in every jurisdiction. This meets the strictest requirement, Mainland voucher practice, and costs nothing elsewhere. The number format is still to confirm with an accounting lead.

## Capability gaps

These are missing capabilities, not defects in approved features. The roadmap already covers:

- receivable and payable lifecycles, including partial settlement, credit memos and refunds (REQ-0011)
- bank import and reconciliation (REQ-0012)
- asset, prepayment and accrual schedules (REQ-0013)
- month-end close and signing (REQ-0015)
- backup and recovery (BL-23, REQ-0016)
- original electronic evidence (REQ-0010)

At review time, no requirement candidate covered the following. On 2026-10-21 the owner confirmed their registration in the [requirement pool](../04-requirement-pool/requirement-pool.md) as REQ-0024 to REQ-0030, in the same order.

| ID | Capability | What is missing | Book reference |
| --- | --- | --- | --- |
| GAP-01 | Master data governance | Approval for creating and changing suppliers, customers, accounts and tax codes. A periodic change report for independent review. Independent verification of supplier bank detail changes, which matters more when agents read documents that may ask for payment to new accounts. | 12-1, 13-2 and 16-1 controls 1.2 and 1.3; 13-2 control 21.9 |
| GAP-02 | Customer credit control | Credit limits. Approval of sales to new customers or over the limit by someone other than the seller. Write-off and credit memo authority separate from sales entry and customer account maintenance. | 12-1 controls 7.1, 7.2 and 16.1 |
| GAP-03 | Payables and payment controls | Duplicate invoice detection on every path. Confirmation that goods or services were received before payment. Payment approval separate from payables recording. Dual approval above a threshold. A reviewable payment run. | 13-2 threats 19 to 21 |
| GAP-04 | Journal entry review and analytics | A periodic report of entries for independent review: manual entries, entries after close, agent-prepared entries, round amounts, amounts just under approval or policy limits, weekend or out-of-hours postings, and unusual reversals. This is the main detective control for an agent-driven ledger and would detect splitting to evade ADR-0001 cumulative limits. | 16-1 controls 1.3, 4.3, 5.3 and 7.3 |
| GAP-05 | Input validation | Format and check-digit validation for tax identifiers such as the Australian ABN, the Mainland unified social credit code and the Hong Kong business registration number. Closed-loop verification that displays the name for an entered identifier. Reasonableness checks against a counterparty's history. `tax_id_number` is free text today. | Chapter 10 data entry controls |
| GAP-06 | Sensitive data protection | Encryption or masking of tax identifiers and bank details, with field-level read access. Read access to financial data restricted to need. | Chapter 9; 16-1 control 2.x |
| GAP-07 | Management reporting from the ledger | Budget against actual and a cash flow budget calculated from posted data. Monolith has budget and forecast commands; whether their figures come from the ledger rather than seed data was not verified. | 12-1 control 18.3; 13-2 control 23.1; 16-1 control 10.1 |

## Not covered

Inventory, production and payroll controls; IT general controls beyond those already in ADR-0001 and BL-23; XBRL; live PostgreSQL behaviour; and jurisdiction-specific statutory requirements. Findings BL-30 to BL-36 have no remediation evidence yet. The owner set the one-person company policy for BL-31 on 2026-10-21; which entity types qualify is still to confirm. The owner set the BL-36 numbering rule on 2026-10-21; the number format is still to confirm. GAP-01 to GAP-07 were registered as requirement candidates REQ-0024 to REQ-0030 on 2026-10-21.
