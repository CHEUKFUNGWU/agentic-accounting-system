from decimal import Decimal
import pytest
from app.mcp_server import ENTITIES, generate_three_statements_working_paper

@pytest.mark.asyncio
async def test_all_six_entities_etb_balanced():
    """
    Validates that the 10-column Extended Trial Balance (ETB) is mathematically balanced
    (sum(DR) == sum(CR)) across all 6 jurisdictions (AU, CN, HK, SG, US, EU) for SMEs, OPCs, and Sole Proprietors.
    """
    assert len(ENTITIES) == 6, f"Expected 6 jurisdictions seeded, got {len(ENTITIES)}"

    for entity_code in ENTITIES.keys():
        pack = await generate_three_statements_working_paper(entity_code=entity_code, period="2026-10")
        assert pack.get("status") != "ERROR", f"Error generating pack for {entity_code}: {pack.get('reason')}"

        totals = pack["etb_totals"]
        
        # 1. Unadjusted Trial Balance balancing proof
        unadj_dr = Decimal(totals["total_unadj_dr"])
        unadj_cr = Decimal(totals["total_unadj_cr"])
        assert unadj_dr == unadj_cr, (
            f"[{entity_code}] Unadjusted ETB unbalanced: DR={unadj_dr} vs CR={unadj_cr}"
        )

        # 2. Adjusting Journal Entries (AJE) balancing proof
        aje_dr = Decimal(totals["total_aje_dr"])
        aje_cr = Decimal(totals["total_aje_cr"])
        assert aje_dr == aje_cr, (
            f"[{entity_code}] AJE adjustments unbalanced: DR={aje_dr} vs CR={aje_cr}"
        )

        # 3. Adjusted Trial Balance balancing proof
        adj_dr = Decimal(totals["total_adjusted_dr"])
        adj_cr = Decimal(totals["total_adjusted_cr"])
        assert adj_dr == adj_cr, (
            f"[{entity_code}] Adjusted ETB unbalanced: DR={adj_dr} vs CR={adj_cr}"
        )

        # 4. Reconciliation proof flags
        proofs = pack["reconciliation_proofs"]
        assert proofs["etb_unadjusted_balanced"] is True
        assert proofs["etb_adjustments_balanced"] is True
        assert proofs["etb_adjusted_balanced"] is True
