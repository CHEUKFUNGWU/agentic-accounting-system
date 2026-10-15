"""
Deterministic Segregation of Duties (SoD) & Accounting Invariant Guard.
Enforces:
  1. Dual-currency double-entry balance (sum(DR) == sum(CR) in both TX and Functional currencies)
  2. Sub-ledger Control Account isolation (no manual journal entries to AR, AP, Cash, Inventory, FA control accounts)
  3. Fiscal Period cut-off (OPEN vs. SOFT_CLOSE vs. HARD_CLOSE/LOCKED)
  4. Maker-Checker-Auditor role separation (approver != creator; materiality & confidence thresholds)
  5. SHA-256 cryptographic hash-chaining including journal lines protection for POSTED entries
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID


class AgentRole(str, Enum):
    MAKER_BOOKKEEPER = "MAKER_BOOKKEEPER"
    MAKER_AP = "MAKER_AP"
    MAKER_AR_REVREC = "MAKER_AR_REVREC"
    MAKER_BANK_REC = "MAKER_BANK_REC"
    MAKER_INV_FA = "MAKER_INV_FA"
    MAKER_CLOSE_CONSOL = "MAKER_CLOSE_CONSOL"
    CHECKER_CONTROLLER = "CHECKER_CONTROLLER"
    AUDITOR_INTERNAL = "AUDITOR_INTERNAL"
    HUMAN_CPA = "HUMAN_CPA"


class PeriodStatus(str, Enum):
    FUTURE = "FUTURE"
    OPEN = "OPEN"
    SOFT_CLOSE = "SOFT_CLOSE"
    HARD_CLOSE = "HARD_CLOSE"
    LOCKED = "LOCKED"


class JournalStatus(str, Enum):
    DRAFT = "DRAFT"
    PENDING_CHECKER = "PENDING_CHECKER"
    AWAITING_CPA = "AWAITING_CPA"
    POSTED = "POSTED"
    REVERSED = "REVERSED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class ProposedLine:
    line_number: int
    account_code: str
    is_control_account: bool
    tx_debit: Decimal
    tx_credit: Decimal
    func_debit: Decimal
    func_credit: Decimal
    tax_code: Optional[str] = None
    memo: str = ""


@dataclass(frozen=True)
class AgentIdentity:
    principal_id: UUID
    agent_name: str
    role: AgentRole
    max_auto_approve_func_amount: Decimal
    min_confidence_threshold: Decimal


class AccountingInvariantError(Exception):
    """Raised when a deterministic accounting invariant or SoD policy is violated."""


class DeterministicSoDGuard:
    """Validates accounting invariants and Maker-Checker-Auditor governance before state transitions."""

    OPERATIONAL_MODULES = {"AP", "AR", "BANK_REC", "INVENTORY", "EXPENSE_SPLIT"}
    CLOSING_MODULES = {"FA", "LEASE", "REV_REC", "FX_REVAL", "IC_ELIM", "GL_MANUAL", "AJE"}

    @classmethod
    def validate_proposal_submission(
        cls,
        maker: AgentIdentity,
        source_module: str,
        period_status: PeriodStatus,
        lines: List[ProposedLine],
        evidence_uris: List[str],
        confidence_score: Decimal,
    ) -> None:
        # 1. Verify Maker Role Permissions: Must strictly be a Maker role
        if not maker.role.value.startswith("MAKER_"):
            raise AccountingInvariantError(
                f"SOD_ROLE_VIOLATION: Principal '{maker.agent_name}' with role '{maker.role}' cannot create proposals."
            )

        # 2. Verify Period Cut-Off
        if period_status in (PeriodStatus.FUTURE, PeriodStatus.HARD_CLOSE, PeriodStatus.LOCKED):
            raise AccountingInvariantError(
                f"PERIOD_CUTOFF_VIOLATION: Cannot submit journal proposals to a period in '{period_status}' status."
            )
        if period_status == PeriodStatus.SOFT_CLOSE and source_module in cls.OPERATIONAL_MODULES:
            raise AccountingInvariantError(
                f"SOFT_CLOSE_VIOLATION: Operational module '{source_module}' is blocked during SOFT_CLOSE."
            )

        # 3. Verify Evidence Attachment & Confidence
        if not evidence_uris:
            raise AccountingInvariantError(
                "EVIDENCE_REQUIRED_VIOLATION: Every agentic journal proposal must include at least one immutable evidence URI."
            )
        if not (Decimal("0.0000") <= confidence_score <= Decimal("1.0000")):
            raise AccountingInvariantError("INVALID_CONFIDENCE_SCORE: Confidence score must be between 0.0000 and 1.0000.")

        # 4. Verify Double-Entry Balancing & Control Account Isolation
        if len(lines) < 2:
            raise AccountingInvariantError("DOUBLE_ENTRY_VIOLATION: Journal entry must contain at least 2 lines.")

        tx_dr = sum((line.tx_debit for line in lines), Decimal("0.0000"))
        tx_cr = sum((line.tx_credit for line in lines), Decimal("0.0000"))
        func_dr = sum((line.func_debit for line in lines), Decimal("0.0000"))
        func_cr = sum((line.func_credit for line in lines), Decimal("0.0000"))

        for line in lines:
            if (line.tx_debit > 0 and line.tx_credit > 0) or (line.tx_debit <= 0 and line.tx_credit <= 0):
                raise AccountingInvariantError(
                    f"LINE_EXCLUSIVITY_VIOLATION: Line {line.line_number} must have strictly positive debit OR credit."
                )
            if line.is_control_account and source_module == "GL_MANUAL":
                raise AccountingInvariantError(
                    f"CONTROL_ACCOUNT_ISOLATION_VIOLATION: Account '{line.account_code}' is a Sub-Ledger Control Account "
                    "and cannot be posted via GL_MANUAL."
                )

        if tx_dr != tx_cr or func_dr != func_cr or tx_dr <= Decimal("0.0000"):
            raise AccountingInvariantError(
                f"UNBALANCED_ENTRY_VIOLATION: Debits and Credits do not balance "
                f"(TX DR={tx_dr}, TX CR={tx_cr}; FUNC DR={func_dr}, FUNC CR={func_cr})."
            )

    @classmethod
    def evaluate_approval_transition(
        cls,
        created_by_principal_id: UUID,
        reviewer: AgentIdentity,
        total_func_debit: Decimal,
        proposal_confidence: Decimal,
        involves_intercompany_or_statutory_adj: bool = False,
    ) -> JournalStatus:
        """
        Determines whether a Reviewer approval transitions the entry directly to POSTED
        or escalates to AWAITING_CPA (Human-in-the-Loop).
        """
        if reviewer.principal_id == created_by_principal_id:
            raise AccountingInvariantError(
                "SOD_MAKER_CHECKER_VIOLATION: Approver Principal ID cannot equal Creator Principal ID."
            )

        if reviewer.role not in (AgentRole.CHECKER_CONTROLLER, AgentRole.HUMAN_CPA):
            raise AccountingInvariantError(
                f"SOD_APPROVAL_ROLE_VIOLATION: Role '{reviewer.role}' is not authorized to approve proposals."
            )

        # Human CPA can finalize posting directly
        if reviewer.role == AgentRole.HUMAN_CPA:
            return JournalStatus.POSTED

        # Controller Agent can auto-post only within materiality & confidence gates
        if (
            not involves_intercompany_or_statutory_adj
            and total_func_debit <= reviewer.max_auto_approve_func_amount
            and proposal_confidence >= reviewer.min_confidence_threshold
        ):
            return JournalStatus.POSTED

        return JournalStatus.AWAITING_CPA

    @staticmethod
    def compute_lines_sha256(lines: List[Dict[str, Any]]) -> str:
        """Computes deterministic SHA-256 hash of line items to prevent line alteration."""
        sorted_lines = sorted(lines, key=lambda l: l.get("line_number", 0))
        canonical = json.dumps(
            [
                {
                    "line_number": l.get("line_number"),
                    "account_code": l.get("account_code"),
                    "debit": str(l.get("debit", "0.0000")),
                    "credit": str(l.get("credit", "0.0000")),
                }
                for l in sorted_lines
            ],
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def compute_entry_sha256_hash(
        prev_entry_hash: str,
        journal_id: str,
        entity_code: str,
        accounting_date: str,
        func_debit: Decimal,
        func_credit: Decimal,
        lines_sha256: str,
        created_by: str,
        approved_by: str,
    ) -> str:
        """Computes immutable cryptographic hash linking entry to previous block and line contents."""
        payload = (
            f"{prev_entry_hash}|{journal_id}|{entity_code}|{accounting_date}|"
            f"{func_debit:.4f}|{func_credit:.4f}|{lines_sha256}|{created_by}|{approved_by}"
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @classmethod
    def verify_hash_chain(cls, journals: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Validates cryptographic integrity and uninterrupted chaining of posted journals.
        Returns {"valid": True} or details of tampering/breakage.
        """
        posted = [j for j in journals if j.get("status") == JournalStatus.POSTED.value and j.get("entry_hash")]
        # Sort chronologically by posting sequence/timestamp
        posted.sort(key=lambda j: j.get("created_at", ""))

        prev_hash = "GENESIS_BLOCK_0000000000000000000000000000000000000000000000000000000000"
        for idx, j in enumerate(posted):
            expected_prev = j.get("prev_entry_hash")
            if expected_prev != prev_hash:
                return {
                    "valid": False,
                    "error": f"Chain broken at entry index {idx} ({j.get('journal_id')}): expected prev {prev_hash}, got {expected_prev}",
                }
            lines = j.get("lines", [])
            lines_hash = cls.compute_lines_sha256(lines)
            computed = cls.compute_entry_sha256_hash(
                prev_entry_hash=expected_prev,
                journal_id=str(j.get("journal_id")),
                entity_code=str(j.get("entity_code")),
                accounting_date=str(j.get("accounting_date")),
                func_debit=Decimal(str(j.get("total_debit"))),
                func_credit=Decimal(str(j.get("total_credit"))),
                lines_sha256=lines_hash,
                created_by=str(j.get("created_by_principal_id")),
                approved_by=str(j.get("approved_by_principal_id")),
            )
            if computed != j.get("entry_hash"):
                return {
                    "valid": False,
                    "error": f"Hash mismatch at entry {j.get('journal_id')}: computed {computed} vs stored {j.get('entry_hash')}",
                }
            prev_hash = computed
        return {"valid": True, "verified_blocks_count": len(posted)}
