#!/usr/bin/env python3
"""Generate golden fixtures for the localization module (REQ-0035 P1).

The frozen Python reference (backend/app/core/localization.py) is the source
of every expected value: this script imports it and records what it returns.
Known defects (SRC-0026 findings) are NOT exercised here. In particular the
BL-22 scenario class — tax identifiers accepted on string length alone — is
excluded from the golden baseline by design (ADR-0002 D3) and belongs to the
expected-divergence registry in fixtures/divergences.yaml, never to fixtures.
Only identifier inputs that pass the Go-side structured validation (a valid
ABN checksum, a 20-digit fapiao code, an EIN-shaped TIN, a VIES-shaped VAT
ID) or absent identifiers appear.

Run (from the backend directory):
    cd backend && env -u DATABASE_URL uv run python ../backend-go/tools/gen_localization.py

Output: backend-go/fixtures/localization/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.
"""

from __future__ import annotations

import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures" / "localization"
sys.path.insert(0, str(REPO / "backend"))

from app.core.localization import GlobalLocalizationEngine, Jurisdiction

ENGINE = GlobalLocalizationEngine


def write(module: str, name: str, case_input: dict, output=None, error: str | None = None) -> None:
    """Write one fixture case file. output xor expected_error is present."""
    doc = {"module": module, "case": name, "input": case_input}
    if error is not None:
        doc["expected_error"] = error
    else:
        doc["output"] = output
    path = OUT / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def tax_result(r) -> dict:
    """Render a TaxCalculationResult with money as decimal strings."""
    return {
        "jurisdiction": r.jurisdiction.value,
        "tax_code": r.tax_code,
        "net_amount": str(r.net_amount),
        "tax_amount": str(r.tax_amount),
        "recoverable_tax_amount": str(r.recoverable_tax_amount),
        "non_recoverable_tax_amount": str(r.non_recoverable_tax_amount),
        "withholding_tax_amount": str(r.withholding_tax_amount),
        "reverse_charge_output_tax": str(r.reverse_charge_output_tax),
        "net_payable_to_counterparty": str(r.net_payable_to_counterparty),
        "statutory_return_boxes": {k: str(v) for k, v in r.statutory_return_boxes.items()},
        "compliance_warnings": list(r.compliance_warnings),
    }


def lease_result(d) -> dict:
    def entries(rows):
        return [
            {"account": e["account"], "debit": str(e["debit"]), "credit": str(e["credit"])}
            for e in rows
        ]

    return {
        "topic": d.topic,
        "ifrs_book_entries": entries(d.ifrs_book_entries),
        "us_gaap_delta_entries": entries(d.us_gaap_delta_entries),
        "rationale": d.rationale,
    }


# (name, jurisdiction, net, tax_code, counterparty_tax_id, einvoice_code,
#  is_cross_border_b2b, hk_profit_source)
#
# Identifier inputs are limited to values that pass the Go-side structured
# validation of tax_identifier.go (or absence) — see the BL-22 note above.
EVALUATE_CASES = [
    # Australia: GST 10%, BAS boxes, ATO No-ABN 47% withholding and its
    # AUD 75 threshold.
    ("au_gst10_no_abn_wht", "AU", "1000", "AU_GST_10", None, None, False, None),
    ("au_gst10_valid_abn", "AU", "1000", "AU_GST_10", "51 824 753 556", None, False, None),
    ("au_gst_free_rate_lookup_miss", "AU", "500", "AU_GST_FREE", None, None, False, None),
    ("au_below_wht_threshold", "AU", "50", "AU_GST_10", None, None, False, None),
    ("au_wht_threshold_boundary", "AU", "75", "AU_GST_10", None, None, False, None),
    ("au_net_quantize_tie_half_up", "AU", "100.00005", "AU_GST_10", "51 824 753 556", None, False, None),
    ("au_exact_decimal_large_net", "AU", "999999999999.9997", "AU_GST_10", None, None, False, None),
    # Mainland China: VAT rates, Golden Tax IV gating of input-VAT credit,
    # the small-scale exclusion. Only all-digit 20-character codes appear.
    ("cn_vat13_unverified", "CN", "1000", "CN_VAT_13", None, None, False, None),
    ("cn_vat13_verified_20_digit", "CN", "1000", "CN_VAT_13", None, "12345678901234567890", False, None),
    ("cn_vat3_small_not_creditable", "CN", "500", "CN_VAT_3_SMALL", None, "12345678901234567890", False, None),
    ("cn_unknown_rate_code", "CN", "1000", "CN_UNKNOWN", None, None, False, None),
    # Singapore: reverse charge by code or cross-border flag, standard-rated
    # GST, GST F5 boxes.
    ("sg_reverse_charge_flag", "SG", "1000", "SG_GST_9_SR", None, None, True, None),
    ("sg_reverse_charge_code", "SG", "2000", "SG_GST_9_RC", None, None, False, None),
    ("sg_standard_rated", "SG", "1000", "SG_GST_9_SR", None, None, False, None),
    ("sg_unknown_rate_code", "SG", "1000", "SG_GST_ZR", None, None, False, None),
    # Hong Kong: no indirect tax, territorial source tagging, signed-zero
    # quantize on a tiny negative net.
    ("hk_onshore", "HK", "1000", "", None, None, False, None),
    ("hk_offshore_source_tag", "HK", "2500", "", None, None, False, "OFFSHORE"),
    ("hk_negative_zero_quantize", "HK", "-0.00001", "", None, None, False, None),
    # North America: use-tax self-accrual, 24% backup withholding, sales tax.
    ("us_consumer_use_no_tin", "US", "1000", "US_CONSUMER_USE_TAX_8_25", None, None, False, None),
    ("us_consumer_use_valid_ein", "US", "1000", "US_CONSUMER_USE_TAX_8_25", "12-3456789", None, False, None),
    ("us_sales_tax", "US", "1000", "US_SALES_TAX_8_25", None, None, False, None),
    ("us_unknown_rate_code", "US", "1000", "US_EXEMPT", None, None, False, None),
    # Europe: standard VAT, intra-community reverse charge with and without a
    # valid-format VIES ID; the UK rides the same branch by flag.
    ("eu_standard_vat", "EU", "1000", "EU_VAT_20_STD", None, None, False, None),
    ("eu_reverse_charge_valid_vies", "EU", "1000", "EU_IC_REVERSE_CHARGE_20", "DE123456789", None, False, None),
    ("eu_reverse_charge_missing_vies", "EU", "1000", "EU_IC_REVERSE_CHARGE_20", None, None, False, None),
    ("uk_reverse_charge_flag", "UK", "500", "", None, None, True, None),
    # Canada: enum member without an engine branch — the zeroed fallthrough.
    ("ca_unsupported_fallthrough", "CA", "1000", "CA_GST_5", None, None, False, None),
    # Rejection paths the reference itself raises.
    ("unknown_jurisdiction_rejected", "JP", "1000", "X", None, None, False, None),
    ("invalid_net_amount_rejected", "AU", "abc", "AU_GST_10", None, None, False, None),
    ("net_quantize_overflow_rejected", "HK", "99999999999999999999999999999", "", None, None, False, None),
    # A 28-digit net passes every earlier quantize and overflows when the
    # net-payable sum is quantized (the reference raises InvalidOperation).
    ("payable_quantize_overflow_rejected", "CN", "999999999999999999999999.9999", "CN_VAT_13", None, None, False, None),
]

# (name, monthly_lease_payment, opening_lease_liability, monthly_discount_rate,
#  straight_line_ifrs_rou_amortization, straight_line_asc842_single_lease_cost)
LEASE_CASES = [
    ("lease_ifrs16_asc842_standard", "25000", "4850000", "0.0035", "18500", "19750"),
    # 100 × 0.1234565 = 12.34565 → the ROUND_HALF_UP tie pins the q4 rounding.
    ("lease_ifrs16_asc842_half_up_tie", "80", "100", "0.1234565", "50", "60"),
]


def gen_evaluate() -> int:
    count = 0
    for name, jur, net, code, cp_id, einv, border, hk_src in EVALUATE_CASES:
        case_input = {
            "op": "evaluate_tax",
            "jurisdiction": jur,
            "net_amount": net,
            "tax_code": code,
        }
        if cp_id is not None:
            case_input["counterparty_tax_id"] = cp_id
        if einv is not None:
            case_input["einvoice_code"] = einv
        if border:
            case_input["is_cross_border_b2b"] = True
        if hk_src is not None:
            case_input["hk_profit_source"] = hk_src
        try:
            j = Jurisdiction(jur)
        except ValueError:
            write("localization", name, case_input, error="invalid_jurisdiction")
            count += 1
            continue
        try:
            net_dec = Decimal(net)
        except InvalidOperation:
            write("localization", name, case_input, error="invalid_parse")
            count += 1
            continue
        try:
            r = ENGINE.evaluate_indirect_and_withholding_tax(
                j,
                net_dec,
                code,
                counterparty_tax_id=cp_id,
                einvoice_code=einv,
                is_cross_border_b2b=border,
                hk_profit_source=hk_src if hk_src is not None else "ONSHORE",
            )
        except InvalidOperation:
            write("localization", name, case_input, error="invalid_quantize")
            count += 1
            continue
        write("localization", name, case_input, output=tax_result(r))
        count += 1
    return count


def gen_lease() -> int:
    count = 0
    for name, pay, liab, rate, rou, single in LEASE_CASES:
        case_input = {
            "op": "lease_delta",
            "monthly_lease_payment": pay,
            "opening_lease_liability": liab,
            "monthly_discount_rate": rate,
            "straight_line_ifrs_rou_amortization": rou,
            "straight_line_asc842_single_lease_cost": single,
        }
        d = ENGINE.compute_lease_ifrs16_vs_asc842_delta(
            Decimal(pay), Decimal(liab), Decimal(rate), Decimal(rou), Decimal(single)
        )
        write("localization", name, case_input, output=lease_result(d))
        count += 1
    return count


def main() -> None:
    total = gen_evaluate() + gen_lease()
    print(f"generated {total} localization fixtures under {OUT}")


if __name__ == "__main__":
    main()
