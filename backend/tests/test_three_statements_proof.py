from decimal import Decimal
import pytest
from app.mcp_server import ENTITIES, generate_three_statements_working_paper

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
        pack = await generate_three_statements_working_paper(entity_code=entity_code, period="2026-10")
        assert pack.get("status") != "ERROR"

        proofs = pack["reconciliation_proofs"]
        bs = pack["balance_sheet_wp"]
        cf = pack["cash_flow_statement_wp"]
        lead = pack["lead_schedules"]

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

        # 4. Lead Schedules Subledger vs GL tying (e.g. W/P A Cash, W/P B AR, W/P AA AP)
        wp_a = lead["W/P A"]
        assert wp_a["variance"] == "0.0000"
        assert Decimal(wp_a["gl_balance"]) == Decimal(wp_a["subledger_balance"])

        wp_b = lead["W/P B"]
        assert wp_b["variance"] == "0.0000"
        assert Decimal(wp_b["gl_balance"]) == Decimal(wp_b["subledger_balance"])

        wp_aa = lead["W/P AA"]
        assert wp_aa["variance"] == "0.0000"
        assert Decimal(wp_aa["gl_balance"]) == Decimal(wp_aa["subledger_balance"])
