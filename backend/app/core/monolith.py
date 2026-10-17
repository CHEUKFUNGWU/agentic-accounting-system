"""Server-owned accounting commands for the adopted Monolith interface.

The aggregate is the sole persisted source for this workspace, separate from
legacy company files. Every command changes its journal, subledgers and audit
trail in a single revision-checked database transaction.
"""
from __future__ import annotations

import copy
from contextvars import ContextVar
import hashlib
import json
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.core.db import MonolithWorkspaceModel, db_manager

SEED_PATH = Path(__file__).resolve().parent.parent / "monolith_seed.json"
MONEY_UNIT = Decimal("0.0001")


class WorkspaceError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def money(value, *, positive=False, signed=False) -> Decimal:
    try:
        if isinstance(value, bool):
            raise ValueError()
        amount = Decimal(str(value))
        if not amount.is_finite() or abs(amount) > Decimal("1000000000000"):
            raise ValueError()
        amount = amount.quantize(MONEY_UNIT, rounding=ROUND_HALF_UP)
        if (not signed and amount < 0) or (positive and amount <= 0):
            raise ValueError()
        return amount
    except (ValueError, InvalidOperation, TypeError):
        raise WorkspaceError("INVALID_AMOUNT: Enter a finite amount within the supported range.")


def text(value, field: str, limit=500) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise WorkspaceError(f"INVALID_FIELD: {field} is required, up to {limit} characters.")
    return value.strip()


_actor: ContextVar = ContextVar("monolith_actor", default=None)

def iso_date(value, period=None) -> str:
    try:
        result = date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise WorkspaceError("INVALID_DATE: Use YYYY-MM-DD.")
    if period and result[:7] != period:
        raise WorkspaceError("PERIOD_MISMATCH: Accounting date must fall within the open period.")
    return result


def find(state, collection, record_id):
    record = next((r for r in state[collection] if r["id"] == record_id), None)
    if record is None:
        raise WorkspaceError(f"NOT_FOUND: {collection}/{record_id}", 404)
    return record


def account(state, code, category=None):
    result = next((r for r in state["accounts"] if r["code"] == code), None)
    if not result or (category and result["category"] != category):
        raise WorkspaceError(f"INVALID_ACCOUNT: {code} is not an eligible {category or 'ledger'} account.")
    return result


def posting_date(state):
    today = date.today().isoformat()
    return today if today[:7] == state["period"] else f"{state['period']}-01"


def append_entry(state, *, memo, reference, lines, entry_date=None, source="Manual Entry", status="Posted", attachments=None):
    """Validate at the server boundary, never accept client totals or account names."""
    if len(lines) < 2 or len(lines) > 200:
        raise WorkspaceError("INVALID_LINES: A journal needs between 2 and 200 lines.")
    normalized = []
    for line in lines:
        acct = account(state, line.get("accountCode"))
        dr, cr = money(line.get("debit", 0)), money(line.get("credit", 0))
        if (dr > 0) == (cr > 0):
            raise WorkspaceError("INVALID_LINE: Each line must contain a debit or a credit, exclusively.")
        normalized.append({"id": str(uuid4()), "accountCode": acct["code"], "accountName": acct["name"],
                           "description": str(line.get("description") or memo)[:500], "debit": float(dr), "credit": float(cr)})
    debit = sum((money(l["debit"]) for l in normalized), Decimal(0))
    credit = sum((money(l["credit"]) for l in normalized), Decimal(0))
    if debit != credit or debit <= 0:
        raise WorkspaceError("UNBALANCED_ENTRY: Journal debits and credits must be equal and positive.")
    entry = {"id": f"JE-{uuid4().hex[:12].upper()}", "date": iso_date(entry_date or posting_date(state), state["period"]),
             "reference": text(reference, "reference"), "memo": text(memo, "memo"), "source": source,
             "status": status, "lines": normalized, "attachments": attachments or [],
             "createdByPrincipalKey": _actor.get().principal_key if _actor.get() else None,
             "createdByPosition": _actor.get().position.position_id if _actor.get() else None}
    state["journalEntries"].insert(0, entry)
    if status == "Posted":
        cash = sum((money(l["debit"]) - money(l["credit"]) for l in normalized if l["accountCode"] == "1010"), Decimal(0))
        if cash:
            find(state, "closeChecklist", "CLS-03")["completed"] = False
            state["ledgerCashItems"].insert(0, {"id": f"LC-{uuid4().hex[:12]}", "date": entry["date"],
                "entryId": entry["id"], "memo": memo, "amount": float(cash), "reconciled": False})
    return entry


def pair(debit_code, credit_code, amount):
    return [{"accountCode": debit_code, "debit": float(amount), "credit": 0},
            {"accountCode": credit_code, "debit": 0, "credit": float(amount)}]


def audit(state, category, action, target, summary, amount=0):
    previous = state["auditLogs"][0]["hash"] if state["auditLogs"] else "GENESIS"
    event = {"id": f"AUD-{uuid4().hex[:12].upper()}", "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
             "actorType": "User" if not _actor.get() or _actor.get().is_human else "Agent",
             "actorId": _actor.get().principal_key if _actor.get() else "Imported local operation",
             "credentialId": _actor.get().credential_id if _actor.get() else None, "category": category, "action": action,
             "targetId": target, "summary": summary, "impactAmount": float(amount), "previousHash": previous}
    event["hash"] = hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    state["auditLogs"].insert(0, event)


def reconcile(state, bank_id, ledger_id):
    bank = find(state, "bankItems", bank_id)
    ledger = find(state, "ledgerCashItems", ledger_id)
    if bank["status"] == "Matched" or ledger["reconciled"]:
        raise WorkspaceError("ALREADY_RECONCILED: A bank or ledger item can only be matched once.", 409)
    if money(bank["amount"], signed=True) != money(ledger["amount"], signed=True):
        raise WorkspaceError("MATCH_AMOUNT_MISMATCH: Bank and ledger amounts must match, including direction.")
    bank.update(status="Matched", matchedLedgerId=ledger_id, matchConfidence=100)
    ledger["reconciled"] = True
    if all(r["status"] == "Matched" for r in state["bankItems"]) and all(r["reconciled"] for r in state["ledgerCashItems"]):
        find(state, "closeChecklist", "CLS-03")["completed"] = True
    audit(state, "Bank Reconciliation", "Reconcile Match", bank_id, f"Matched {bank_id} to {ledger_id}", bank["amount"])


def apply_command(state, action, payload):
    """Commands are explicit business operations, never arbitrary client state writes."""
    if state["isPeriodLocked"] and action not in {"period.unlock", "preferences.update", "budget.save", "forecast.save"}:
        raise WorkspaceError("PERIOD_LOCKED: Unlock the period before changing its accounting records.", 409)
    p = payload
    if action == "journal.create":
        source = p.get("source", "Manual Entry")
        if source not in {"Manual Entry", "Agentic Auto-Draft"}:
            raise WorkspaceError("INVALID_SOURCE: Use the appropriate subledger action for system entries.")
        attachments = p.get("attachments", [])
        if not isinstance(attachments, list) or len(attachments) > 20:
            raise WorkspaceError("INVALID_ATTACHMENTS: At most 20 attachments are supported.")
        import base64
        for item in attachments:
            data = item.get("dataUrl", "")
            try:
                prefix, encoded = data.split(",", 1)
                if not prefix.startswith("data:") or not prefix.endswith(";base64"):
                    raise ValueError()
                raw = base64.b64decode(encoded, validate=True)
                if len(raw) > 15 * 1024 * 1024:
                    raise ValueError()
            except (ValueError, TypeError):
                raise WorkspaceError("INVALID_ATTACHMENT: Attach a base64 file of at most 15 MB.")
            item["id"] = str(uuid4())
            item["name"] = text(item.get("name"), "attachment name", 200)
            item["uploadedAt"] = datetime.now(timezone.utc).isoformat()
            item["sizeBytes"] = len(raw)
            item["sha256"] = hashlib.sha256(raw).hexdigest()
        entry = append_entry(state, memo=p.get("memo"), reference=p.get("reference"), lines=p.get("lines", []),
                             entry_date=p.get("date"), source=source,
                             status="Draft" if _actor.get() or source == "Agentic Auto-Draft" else "Posted", attachments=attachments)
        audit(state, "Journal Entry", "Create Entry", entry["id"], f"Recorded {entry['status'].lower()} journal: {entry['memo']}")
    elif action == "invoice.create":
        amount = money(p.get("amount"), positive=True)
        acct = account(state, p.get("revenueAccountCode"), "Revenue")
        record = {"id": f"INV-{uuid4().hex[:10].upper()}", "customer": text(p.get("customer"), "customer"),
                  "issueDate": posting_date(state), "dueDate": iso_date(p.get("dueDate")), "agingBucket": "Current",
                  "revenueAccountCode": acct["code"], "amount": float(amount), "paidAmount": 0, "status": "Open"}
        state["receivables"].insert(0, record)
        append_entry(state, memo=f"Invoice to {record['customer']}", reference=record["id"], lines=pair("1100", acct["code"], amount))
        audit(state, "Accounts Receivable", "Issue Invoice", record["id"], f"Issued invoice to {record['customer']}", amount)
    elif action == "invoice.collect":
        record = find(state, "receivables", p.get("id"))
        amount = money(record["amount"]) - money(record["paidAmount"])
        if record["status"] == "Paid" or amount <= 0:
            raise WorkspaceError("ALREADY_PAID: This invoice has no outstanding balance.", 409)
        append_entry(state, memo=f"Collection from {record['customer']}", reference=record["id"], lines=pair("1010", "1100", amount))
        record.update(paidAmount=record["amount"], status="Paid", agingBucket="Current")
        audit(state, "Accounts Receivable", "Collect Payment", record["id"], "Recorded invoice collection", amount)
    elif action == "bill.create":
        amount = money(p.get("amount"), positive=True)
        acct = account(state, p.get("expenseAccountCode"), "Expense")
        record = {"id": f"BILL-{uuid4().hex[:10].upper()}", "vendor": text(p.get("vendor"), "vendor"),
                  "reference": text(p.get("reference"), "reference"), "billDate": posting_date(state),
                  "dueDate": iso_date(p.get("dueDate")), "expenseAccountCode": acct["code"], "expenseAccountName": acct["name"],
                  "amount": float(amount), "status": "Pending"}
        state["payables"].insert(0, record)
        append_entry(state, memo=f"Bill from {record['vendor']}", reference=record["reference"], lines=pair(acct["code"], "2010", amount))
        audit(state, "Accounts Payable", "Record Bill", record["id"], f"Recorded bill from {record['vendor']}", amount)
    elif action in {"bill.approve", "bill.pay"}:
        record = find(state, "payables", p.get("id"))
        expected = "Pending" if action == "bill.approve" else "Approved"
        if record["status"] != expected:
            raise WorkspaceError(f"INVALID_BILL_STATE: Expected {expected}; found {record['status']}.", 409)
        if action == "bill.pay":
            append_entry(state, memo=f"Payment to {record['vendor']}", reference=record["reference"], lines=pair("2010", "1010", money(record["amount"])))
        record["status"] = "Approved" if action == "bill.approve" else "Paid"
        audit(state, "Accounts Payable", "Approve Bill" if action == "bill.approve" else "Pay Bill", record["id"], f"Bill {record['status'].lower()}", record["amount"])
    elif action == "bank.reconcile":
        reconcile(state, p.get("bankId"), p.get("ledgerId"))
    elif action == "bank.batch":
        for record in state["bankItems"]:
            if record["status"] == "Unmatched" and record.get("suggestedLedgerId"):
                reconcile(state, record["id"], record["suggestedLedgerId"])
    elif action == "bank.exception":
        record = find(state, "bankItems", p.get("id"))
        if record["status"] == "Matched":
            raise WorkspaceError("ALREADY_RECONCILED: This bank item has been recorded.", 409)
        amount = money(record["amount"], signed=True)
        if not amount:
            raise WorkspaceError("INVALID_AMOUNT: Zero bank movements cannot be posted.")
        lines = pair("6800", "1010", -amount) if amount < 0 else pair("1010", "4020", amount)
        entry = append_entry(state, memo=record["counterparty"], reference=record["bankReference"], lines=lines,
                             entry_date=record["date"], source="Reconciliation Adjustment")
        ledger = next(l for l in state["ledgerCashItems"] if l["entryId"] == entry["id"])
        reconcile(state, record["id"], ledger["id"])
        if record["id"] == "BF-906":
            find(state, "agentTasks", "AGT-102")["resolved"] = True
    elif action == "tax.update":
        record = find(state, "taxSchedules", p.get("id"))
        changes = p.get("updates", {})
        if set(changes) - {"taxableBase", "creditsAndDeductions", "status"}:
            raise WorkspaceError("INVALID_TAX_UPDATE: Only the calculation inputs and review status are editable.")
        for field in ("taxableBase", "creditsAndDeductions"):
            if field in changes:
                record[field] = float(money(changes[field]))
        if "status" in changes:
            if changes["status"] not in {"In Review", "Ready to File", "Nexus Warning"}:
                raise WorkspaceError("FILING_NOT_CONNECTED: A local update cannot mark a return as filed.")
            record["status"] = changes["status"]
        audit(state, "Tax Provision", "Update Tax Schedule", record["id"], "Updated tax schedule calculation inputs; no tax filing submitted")
    elif action == "tax.provision":
        record = next((r for r in state["taxSchedules"] if r["formCode"] == p.get("formCode") and r["jurisdiction"] == p.get("jurisdiction")), None)
        if not record:
            raise WorkspaceError("NOT_FOUND: Unknown tax schedule.", 404)
        if record.get("provisionJournalId"):
            raise WorkspaceError("ALREADY_POSTED: This provision has already been recorded.", 409)
        gross = (money(record["taxableBase"]) * money(record["statutoryRate"]) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        amount = max(Decimal(0), gross - money(record["creditsAndDeductions"]))
        if money(p.get("amount")) != money(amount):
            raise WorkspaceError("PROVISION_MISMATCH: Refresh the tax calculation before posting.")
        entry = append_entry(state, memo=f"Tax provision: {record['jurisdiction']}", reference=record["formCode"],
                             lines=pair("6800", "2150", money(amount, positive=True)), source="System Accrual")
        record["provisionJournalId"] = entry["id"]
        audit(state, "Tax Provision", "Post Tax Accrual", record["id"], "Recorded tax provision; no return filed", amount)
    elif action == "asset.register":
        cost, salvage = money(p.get("costBasis"), positive=True), money(p.get("salvageValue", 0))
        life = p.get("usefulLifeMonths")
        if isinstance(life, bool) or not isinstance(life, int) or not 1 <= life <= 1200 or salvage > cost:
            raise WorkspaceError("INVALID_ASSET: Useful life must be 1–1200 months and salvage cannot exceed cost.")
        if p.get("category") not in {"Compute Cluster", "Networking", "Leasehold", "Workstations"}:
            raise WorkspaceError("INVALID_ASSET_CATEGORY")
        record = {"id": f"FA-{uuid4().hex[:10].upper()}", "name": text(p.get("name"), "asset name"), "category": p["category"],
                  "inServiceDate": posting_date(state), "usefulLifeMonths": life, "costBasis": float(cost), "salvageValue": float(salvage),
                  "accumulatedDepreciation": 0, "lastDepreciatedPeriod": "", "status": "Active"}
        state["fixedAssets"].insert(0, record)
        find(state, "closeChecklist", "CLS-05")["completed"] = False
        audit(state, "Fixed Assets", "Register Asset", record["id"], f"Registered {record['name']}; acquisition posting is separate", cost)
    elif action == "asset.depreciate":
        total = Decimal(0)
        for record in state["fixedAssets"]:
            if record["lastDepreciatedPeriod"] >= state["period"]:
                continue
            base = money(record["costBasis"]) - money(record["salvageValue"])
            remaining = max(Decimal(0), base - money(record["accumulatedDepreciation"]))
            amount = min((base / record["usefulLifeMonths"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), remaining)
            record["accumulatedDepreciation"] = float(money(record["accumulatedDepreciation"]) + amount)
            record["lastDepreciatedPeriod"] = state["period"]
            record["status"] = "Fully Depreciated" if amount == remaining else "Active"
            total += amount
        if total <= 0:
            raise WorkspaceError("NO_DEPRECIATION_DUE: No assets need depreciation for this period.", 409)
        # Dedicated contra-asset and expense accounts, rather than reducing prepaid cloud balances.
        append_entry(state, memo="Monthly fixed asset depreciation", reference=f"DEPR-{state['period']}",
                     lines=pair("6900", "1590", total), source="System Accrual")
        next(c for c in state["closeChecklist"] if c["id"] == "CLS-05")["completed"] = True
        audit(state, "Fixed Assets", "Run Depreciation", state["period"], "Posted monthly depreciation", total)
    elif action == "close.checklist":
        record = find(state, "closeChecklist", p.get("id"))
        if record["id"] == "CLS-06":
            raise WorkspaceError("USE_PERIOD_LOCK: The reporting gate is completed by locking the period.")
        record["completed"] = not record["completed"]
        audit(state, "Period Close", "Toggle Close Task", record["id"], f"Checklist task {'completed' if record['completed'] else 'reopened'}")
    elif action == "close.amortize":
        record = find(state, "amortizationSchedules", p.get("id"))
        if record.get("lastPostedPeriod") == state["period"] or record["status"] == "Posted Q4" or record["remainingMonths"] <= 0:
            raise WorkspaceError("ALREADY_POSTED: This schedule has no recognition due this period.", 409)
        amount = min(money(record["monthlyRecognition"]), money(record["totalContractAmount"]) - money(record["recognizedToDate"]))
        debit, credit = (record["balanceSheetAccount"], record["pnlAccount"]) if record["type"] == "Deferred Revenue" else (record["pnlAccount"], record["balanceSheetAccount"])
        append_entry(state, memo=f"{record['type']} amortization: {record['counterparty']}", reference=record["contractRef"], lines=pair(debit, credit, amount), source="System Accrual")
        record.update(recognizedToDate=float(money(record["recognizedToDate"]) + amount), remainingMonths=record["remainingMonths"] - 1,
                      status="Posted Q4", lastPostedPeriod=state["period"])
        audit(state, "Period Close", "Post Amortization", record["id"], "Posted scheduled recognition", amount)
    elif action == "period.lock":
        if not trial_balance(state)["balanced"]:
            raise WorkspaceError("UNBALANCED_LEDGER: The trial balance must balance before close.", 409)
        if any(not r["completed"] for r in state["closeChecklist"] if r["id"] != "CLS-06"):
            raise WorkspaceError("CLOSE_INCOMPLETE: Complete the checklist before locking the period.", 409)
        if any(r["lastDepreciatedPeriod"] < state["period"] and r["status"] == "Active" for r in state["fixedAssets"]):
            raise WorkspaceError("DEPRECIATION_DUE: Run depreciation before closing.", 409)
        if any(r["status"] != "Matched" for r in state["bankItems"]):
            raise WorkspaceError("UNRECONCILED_BANK: Match or record all bank items before closing.", 409)
        if any(not r["reconciled"] for r in state["ledgerCashItems"]):
            raise WorkspaceError("UNRECONCILED_LEDGER: Resolve outstanding book cash movements before closing.", 409)
        if any(r["status"] != "Posted" for r in state["journalEntries"]):
            raise WorkspaceError("UNPOSTED_JOURNALS: Resolve draft and flagged journals before closing.", 409)
        if any(r["status"] == "Scheduled" and r["remainingMonths"] > 0 for r in state["amortizationSchedules"]):
            raise WorkspaceError("UNPOSTED_SCHEDULES: Record scheduled amortization before closing.", 409)
        state["isPeriodLocked"] = True
        find(state, "closeChecklist", "CLS-06")["completed"] = True
        audit(state, "Period Close", "Lock Period", state["period"], "Locked the accounting period")
    elif action == "period.unlock":
        if not state["isPeriodLocked"]:
            raise WorkspaceError("PERIOD_ALREADY_OPEN", 409)
        state["isPeriodLocked"] = False
        find(state, "closeChecklist", "CLS-06")["completed"] = False
        audit(state, "Period Close", "Unlock Period", state["period"], "Reopened the accounting period")
    elif action == "agent.resolve":
        record = find(state, "agentTasks", p.get("id"))
        if record["resolved"]:
            raise WorkspaceError("ALREADY_RESOLVED", 409)
        if record["id"] == "AGT-101":
            append_entry(state, memo="Citadel Quantitative Systems annual SaaS proposal", reference="INV-9012", source="Agentic Auto-Draft", status="Draft",
                         lines=[{"accountCode": "1010", "debit": 240000}, {"accountCode": "4010", "credit": 60000}, {"accountCode": "2400", "credit": 180000}])
        elif record["id"] == "AGT-102":
            apply_command(state, "bank.exception", {"id": "BF-906"})
        elif record["id"] == "AGT-103":
            apply_command(state, "tax.update", {"id": "TAX-CA-FRAN", "updates": {"status": "Ready to File"}})
        record["resolved"] = True
        audit(state, "Journal Entry", "Auto-Draft Post", record["id"], "Processed agent suggestion; proposed journals remain drafts pending human review")
    elif action == "journal.review":
        record = find(state, "journalEntries", p.get("id"))
        if record["status"] == "Posted":
            raise WorkspaceError("ALREADY_POSTED", 409)
        actor = _actor.get()
        if actor and record.get("createdByPrincipalKey") == actor.principal_key:
            raise WorkspaceError("SOD_MAKER_CHECKER_VIOLATION: Another authorized person must review this journal.", 403)
        if actor and record.get("createdByPosition"):
            from app.core.positions import POSITIONS, may_review
            if not may_review(actor.position, POSITIONS[record["createdByPosition"]]):
                raise WorkspaceError("REVIEW_LEVEL_REQUIRED: This preparer's work requires a higher reviewer.", 403)
        # Validate again and generate cash movements through the same posting path.
        entry = append_entry(state, memo=record["memo"], reference=record["reference"], lines=record["lines"],
                             entry_date=record["date"], source=record["source"], attachments=record.get("attachments"))
        state["journalEntries"].remove(record)
        temporary_id = entry["id"]
        entry["id"] = record["id"]
        entry["createdByPrincipalKey"] = record.get("createdByPrincipalKey")
        entry["createdByPosition"] = record.get("createdByPosition")
        entry["reviewedByPrincipalKey"] = _actor.get().principal_key if _actor.get() else None
        for cash in state["ledgerCashItems"]:
            if cash["entryId"] == temporary_id:
                cash["entryId"] = record["id"]
        audit(state, "Journal Entry", "Create Entry", record["id"], "Human operator reviewed and posted the proposal")
    elif action == "preferences.update":
        allowed = {"language": {"en", "zh", "es", "ja"}, "theme": {"light", "dark"}, "fontSize": {"sm", "md", "lg"}, "fontFamily": {"inter", "jakarta", "jetbrains"}}
        if not p or set(p) - set(allowed):
            raise WorkspaceError("INVALID_PREFERENCE")
        for key, value in p.items():
            if value not in allowed[key]:
                raise WorkspaceError(f"INVALID_PREFERENCE: {key}")
        state["preferences"].update(p)
    elif action == "budget.save":
        rows = p.get("allocations")
        if not isinstance(rows, list) or len(rows) > 200:
            raise WorkspaceError("INVALID_BUDGET")
        codes = set()
        for row in rows:
            code = text(row.get("accountCode"), "budget account code", 32)
            if code in codes or row.get("category") not in {"Revenue", "Expense"}:
                raise WorkspaceError("INVALID_BUDGET_ACCOUNT")
            codes.add(code)
            acct = next((a for a in state["accounts"] if a["code"] == code), None)
            if acct and acct["category"] != row["category"]:
                raise WorkspaceError("INVALID_BUDGET_CATEGORY")
            # Extra budget rows are planning allocations, not new ledger accounts.
            row["accountName"] = text(row.get("accountName"), "budget account name", 200)
            if row.get("department") not in {"Revenue", "Infrastructure", "Engineering", "GTM & Growth", "G&A & Legal", "Tax"}:
                raise WorkspaceError("INVALID_BUDGET_DEPARTMENT")
            row["q4Budget"] = float(money(row.get("q4Budget")))
            if row.get("customActual") is not None:
                row["customActual"] = float(money(row["customActual"]))
        state["budgetAllocations"] = rows
        audit(state, "Period Close", "Update Budget", state["period"], "Saved budget allocations")
    elif action == "forecast.save":
        drivers = p.get("drivers", {})
        expected = {"scenarioId", "scenarioName", "quarterlyRevGrowthPct", "cloudCogsRatioPct", "quarterlyOpexGrowthPct", "effectiveTaxRatePct"}
        if set(drivers) != expected or drivers["scenarioId"] not in {"base", "bull", "conservative"}:
            raise WorkspaceError("INVALID_FORECAST")
        drivers["scenarioName"] = text(drivers["scenarioName"], "scenario name", 100)
        for key in expected - {"scenarioId", "scenarioName"}:
            value = money(drivers[key], signed=True)
            if value < -100 or value > 100:
                raise WorkspaceError("INVALID_FORECAST_RATE: Use a percentage between -100 and 100.")
        overrides = p.get("overrides", {})
        import re
        if not isinstance(overrides, dict) or len(overrides) > 16:
            raise WorkspaceError("INVALID_FORECAST_OVERRIDES")
        for key, value in overrides.items():
            if not re.fullmatch(r"(saas|otherRev|cloudCogs|rndAndGtmOpex)-[1-4]", key):
                raise WorkspaceError("INVALID_FORECAST_CELL")
            overrides[key] = float(money(value))
        state.update(forecastDrivers=drivers, forecastOverrides=overrides)
        audit(state, "Period Close", "Update Forecast", state["period"], "Saved forecast drivers and cell overrides")
    else:
        raise WorkspaceError("UNKNOWN_ACTION", 422)



def trial_balance(state):
    balances = {a["code"]: money(a["openingBalance"], signed=True) * (1 if a["normalBalance"] == "debit" else -1) for a in state["accounts"]}
    for entry in state["journalEntries"]:
        if entry["status"] != "Posted":
            continue
        for line in entry["lines"]:
            code = line["accountCode"]
            if code not in balances:
                raise WorkspaceError(f"INVALID_ACCOUNT: {code}")
            balances[code] += money(line["debit"]) - money(line["credit"])
    debit = sum((max(Decimal(0), b) for b in balances.values()), Decimal(0))
    credit = sum((max(Decimal(0), -b) for b in balances.values()), Decimal(0))
    return {"rows": [{"accountCode": code, "signedBalance": str(value)} for code, value in balances.items()],
            "debit": str(debit), "credit": str(credit), "difference": str(debit-credit), "balanced": debit == credit}


def initial_state():
    state = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    state["accounts"].extend([
        {"code": "1590", "name": "Accumulated depreciation", "category": "Asset", "normalBalance": "credit", "openingBalance": 0},
        {"code": "6900", "name": "Depreciation expense", "category": "Expense", "normalBalance": "debit", "openingBalance": 0},
    ])
    # Historical demonstration audit rows are retained as imported evidence, not relabeled as server events.
    return state


async def load_workspace():
    async with db_manager.session_factory() as session:
        record = await session.get(MonolithWorkspaceModel, "monolith")
        if not record:
            record = MonolithWorkspaceModel(workspace_id="monolith", revision=0, payload_json=json.dumps(initial_state()), receipts_json="{}")
            session.add(record)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                record = await session.get(MonolithWorkspaceModel, "monolith")
        return {**json.loads(record.payload_json), "revision": record.revision}


async def execute_command(action, payload, revision, command_id, principal):
    await load_workspace()
    digest = hashlib.sha256(json.dumps([principal.principal_key, action, payload], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    async with db_manager.session_factory() as session:
        record = await session.get(MonolithWorkspaceModel, "monolith")
        receipts = json.loads(record.receipts_json)
        if command_id in receipts:
            if receipts[command_id] != digest:
                raise WorkspaceError("COMMAND_ID_REUSED: An idempotency key cannot identify different commands.", 409)
            return {**json.loads(record.payload_json), "revision": record.revision}
        if record.revision != revision:
            raise WorkspaceError("STALE_REVISION: Another session changed this workspace. Refresh before retrying.", 409)
        from app.core.auth import monolith_actions
        if action not in monolith_actions(principal):
            message = "MFA_REQUIRED" if action in {"period.lock", "period.unlock"} else "COMMAND_NOT_AUTHORIZED"
            raise WorkspaceError(message, 403)
        if action == "journal.review" and not principal.is_human:
            raise WorkspaceError("HUMAN_REVIEW_REQUIRED", 403)
        state = json.loads(record.payload_json)
        actor_token = _actor.set(principal)
        try:
            apply_command(state, action, copy.deepcopy(payload))
        except (KeyError, TypeError, AttributeError, InvalidOperation) as exc:
            raise WorkspaceError("INVALID_PAYLOAD: Check the command fields and try again.") from exc
        finally:
            _actor.reset(actor_token)
        receipts[command_id] = digest
        result = await session.execute(update(MonolithWorkspaceModel).where(
            MonolithWorkspaceModel.workspace_id == "monolith", MonolithWorkspaceModel.revision == revision
        ).values(payload_json=json.dumps(state, allow_nan=False), revision=revision + 1, receipts_json=json.dumps(receipts)))
        if result.rowcount != 1:
            await session.rollback()
            raise WorkspaceError("STALE_REVISION: Another session changed this workspace. Refresh before retrying.", 409)
        await session.commit()
        return {**state, "revision": revision + 1}
