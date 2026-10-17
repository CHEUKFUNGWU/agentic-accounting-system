from decimal import Decimal
import pytest
from app.mcp_server import ENTITIES, generate_three_statements_reporting

@pytest.mark.asyncio
async def test_three_financial_statements_mathematical_proofs():
    """
    Validates the rigorous CPA mathematical proofs across all 6 jurisdictions:
      1. Balance Sheet: Total Assets == Total Liabilities + Total Equity (Delta == 0.0000)
      2. Dual-Method Cash Flow: Ending Cash == Balance Sheet Cash
      3. Dual-Method Cash Flow: Direct Operating Cash == Indirect Operating Cash
      4. Lead Schedules: Subledger balances tie to General Ledger accounts (Delta == 0.0000)
    """
    for entity_code in ENTITIES.keys():
        pack = await generate_three_statements_reporting(entity_code=entity_code, period="2026-10")
        assert pack.get("status") != "ERROR"

        proofs = pack["consistency_checks"]
        bs = pack["balance_sheet"]
        cf = pack["cash_flow_statement"]
        lead = pack["detail_schedules"]

        # 1. Fundamental Balance Sheet Equation: Assets == Liabilities + Equity
        assert proofs["balance_sheet_equation_balanced"] is True
        assert proofs["balance_sheet_variance"] == "0.0000"
        
        assets = Decimal(bs["total_assets"])
        liab_and_equity = Decimal(bs["total_liabilities_and_equity"])
        assert assets == liab_and_equity, f"[{entity_code}] BS out of balance: Assets={assets} vs L+E={liab_and_equity}"

        # 2. Dual-Method Cash Flow reconciles with Balance Sheet Cash
        assert proofs["cash_flow_reconciles_to_bs_cash"] is True
        assert proofs["cash_flow_variance"] == "0.0000"

        cf_ending = Decimal(cf["ending_cash_balance"])
        bs_cash = Decimal(pack["kpi_summary"]["ending_cash"])
        assert cf_ending == bs_cash, f"[{entity_code}] Cash mismatch: CF={cf_ending} vs BS={bs_cash}"

        # 3. Dual-Method Operating Cash Flow reconciliation (Direct == Indirect)
        indirect_op_cash = sum(Decimal(it["amount"]) for it in cf["indirect_method_operating"])
        direct_op_cash = sum(Decimal(it["amount"]) for it in cf["direct_method_operating_memo"])
        net_op_cash = Decimal(cf["net_cash_from_operating_activities"])
        assert indirect_op_cash == net_op_cash, f"[{entity_code}] Indirect CF discrepancy"
        assert direct_op_cash == net_op_cash, f"[{entity_code}] Direct CF discrepancy"

        # 4. Lead Schedules: W/P A transparently flags external unperformed bank feed, while internal roll-forwards tie to GL
        wp_a = lead["CASH"]
        assert wp_a["reconciliation_status"] == "NOT_PERFORMED"
        assert wp_a["evidence_sha256"] is None
        assert Decimal(wp_a["gl_balance"]) == bs_cash

        # W/P DD (Director's Loan & Drawings) rolls forward accurately
        wp_dd = lead["DIRECTOR"]
        assert wp_dd["variance"] == "0.0000"
        assert Decimal(wp_dd["gl_balance"]) == Decimal(pack["kpi_summary"]["director_loan_net"])

        # W/P EQ (Equity) rolls forward to Balance Sheet total equity
        wp_eq = lead["EQ"]
        assert wp_eq["variance"] == "0.0000"
        assert Decimal(wp_eq["gl_balance"]) == -Decimal(bs["total_equity"])
