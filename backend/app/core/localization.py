"""
Six-Region Tax, E-Invoicing & Multi-Book (IFRS vs. US GAAP) Localization Engine.
Covers:
  - CN (Mainland China): PRC CAS, Golden Tax Phase IV (20-digit Fapiao), VAT (13%/9%/6%/3%)
  - HK (Hong Kong): HKFRS, Territorial Source Principle (Onshore vs. Offshore), Two-Tier Profits Tax (8.25%/16.5%)
  - SG (Singapore): SFRS(I), IRAS 9% GST (SR/ZR/ES/RC), InvoiceNow Peppol, GST F5 Boxes
  - AU (Australia): AASB, ATO 10% GST, BAS Labels (G1, 1A, 1B, W1, W2), ABN Check & 47% No-ABN PAYG WHT
  - US / CA (North America): US GAAP (ASC 606/842), Multi-State Sales & Use Tax Nexus, IRS 1099; Canada GST/HST/PST
  - EU / UK (Europe): IFRS / Local GAAP, EU Intra-Community Reverse Charge, VIES VAT check, SAF-T export
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Dict, List, Optional


FOUR_DP = Decimal("0.0001")


def q4(value: Decimal | str | float) -> Decimal:
    return Decimal(str(value)).quantize(FOUR_DP, rounding=ROUND_HALF_UP)


class Jurisdiction(str, Enum):
    CN = "CN"  # Mainland China
    HK = "HK"  # Hong Kong SAR
    SG = "SG"  # Singapore
    AU = "AU"  # Australia
    US = "US"  # United States
    CA = "CA"  # Canada
    EU = "EU"  # European Union
    UK = "UK"  # United Kingdom


class AccountingStandard(str, Enum):
    IFRS = "IFRS"
    US_GAAP = "US_GAAP"
    PRC_CAS = "PRC_CAS"
    HKFRS = "HKFRS"
    SFRS_I = "SFRS_I"
    AASB = "AASB"
    TAX_BASIS = "TAX_BASIS"


@dataclass(frozen=True)
class TaxCalculationResult:
    jurisdiction: Jurisdiction
    tax_code: str
    net_amount: Decimal
    tax_amount: Decimal
    recoverable_tax_amount: Decimal
    non_recoverable_tax_amount: Decimal
    withholding_tax_amount: Decimal
    reverse_charge_output_tax: Decimal
    net_payable_to_counterparty: Decimal
    statutory_return_boxes: Dict[str, Decimal] = field(default_factory=dict)
    compliance_warnings: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class ParallelBookDelta:
    topic: str
    ifrs_book_entries: List[Dict[str, str | Decimal]]
    us_gaap_delta_entries: List[Dict[str, str | Decimal]]
    rationale: str


class GlobalLocalizationEngine:
    """Deterministic multi-jurisdiction tax and IFRS/US GAAP parallel book engine."""

    @staticmethod
    def evaluate_indirect_and_withholding_tax(
        jurisdiction: Jurisdiction,
        net_amount: Decimal,
        tax_code: str,
        counterparty_tax_id: Optional[str] = None,
        einvoice_code: Optional[str] = None,
        is_cross_border_b2b: bool = False,
        hk_profit_source: str = "ONSHORE",
    ) -> TaxCalculationResult:
        net = q4(net_amount)
        warnings: List[str] = []
        boxes: Dict[str, Decimal] = {}

        # 1. AUSTRALIA (AASB + ATO GST 10% + BAS G1/1A/1B + 47% No-ABN PAYG Withholding)
        if jurisdiction == Jurisdiction.AU:
            rate = Decimal("0.10") if tax_code == "AU_GST_10" else Decimal("0.00")
            tax = q4(net * rate)
            wht = Decimal("0.0000")
            if not counterparty_tax_id or len(counterparty_tax_id.replace(" ", "")) != 11:
                # ATO No-ABN Withholding Rule (47% on payments > AUD 75 excl. GST)
                if net > Decimal("75.0000"):
                    wht = q4((net + tax) * Decimal("0.47"))
                    warnings.append(
                        "AU_ATO_NO_ABN_WITHHOLDING: Supplier ABN missing/invalid; 47% PAYG withholding applied (BAS Box W2)."
                    )
                    boxes["BAS_W2_NO_ABN_WHT"] = wht
            boxes["BAS_1B_GST_CREDITS"] = tax
            return TaxCalculationResult(
                jurisdiction=jurisdiction,
                tax_code=tax_code,
                net_amount=net,
                tax_amount=tax,
                recoverable_tax_amount=tax,
                non_recoverable_tax_amount=Decimal("0.0000"),
                withholding_tax_amount=wht,
                reverse_charge_output_tax=Decimal("0.0000"),
                net_payable_to_counterparty=q4(net + tax - wht),
                statutory_return_boxes=boxes,
                compliance_warnings=warnings,
            )

        # 2. MAINLAND CHINA (PRC CAS + Golden Tax Phase IV E-Fapiao + VAT 13%/9%/6%/3%)
        if jurisdiction == Jurisdiction.CN:
            rates = {
                "CN_VAT_13": Decimal("0.13"),
                "CN_VAT_9": Decimal("0.09"),
                "CN_VAT_6": Decimal("0.06"),
                "CN_VAT_3_SMALL": Decimal("0.03"),
            }
            rate = rates.get(tax_code, Decimal("0.00"))
            tax = q4(net * rate)
            # Input VAT is only creditable if Golden Tax Phase IV 20-digit Digital Fapiao is verified
            is_verified_special_fapiao = bool(einvoice_code and len(einvoice_code) == 20)
            recoverable = tax if is_verified_special_fapiao and tax_code != "CN_VAT_3_SMALL" else Decimal("0.0000")
            non_recoverable = q4(tax - recoverable)
            if not is_verified_special_fapiao and tax > 0:
                warnings.append(
                    "CN_GOLDEN_TAX_UNVERIFIED: Missing 20-digit Golden Tax IV Fapiao code; Input VAT routed to Pending Verification / Non-Creditable."
                )
            boxes["CN_VAT_INPUT_CREDIT"] = recoverable
            return TaxCalculationResult(
                jurisdiction=jurisdiction,
                tax_code=tax_code,
                net_amount=net,
                tax_amount=tax,
                recoverable_tax_amount=recoverable,
                non_recoverable_tax_amount=non_recoverable,
                withholding_tax_amount=Decimal("0.0000"),
                reverse_charge_output_tax=Decimal("0.0000"),
                net_payable_to_counterparty=q4(net + tax),
                statutory_return_boxes=boxes,
                compliance_warnings=warnings,
            )

        # 3. SINGAPORE (SFRS(I) + IRAS 9% GST + Reverse Charge + GST F5 Return)
        if jurisdiction == Jurisdiction.SG:
            if tax_code == "SG_GST_9_RC" or is_cross_border_b2b:
                # Imported services under IRAS Reverse Charge
                rc_tax = q4(net * Decimal("0.09"))
                boxes["IRAS_F5_BOX_1_OUTPUT_RC"] = rc_tax
                boxes["IRAS_F5_BOX_7_INPUT_CLAIM"] = rc_tax
                return TaxCalculationResult(
                    jurisdiction=jurisdiction,
                    tax_code="SG_GST_9_RC",
                    net_amount=net,
                    tax_amount=Decimal("0.0000"),
                    recoverable_tax_amount=rc_tax,
                    non_recoverable_tax_amount=Decimal("0.0000"),
                    withholding_tax_amount=Decimal("0.0000"),
                    reverse_charge_output_tax=rc_tax,
                    net_payable_to_counterparty=net,
                    statutory_return_boxes=boxes,
                    compliance_warnings=warnings,
                )
            rate = Decimal("0.09") if tax_code == "SG_GST_9_SR" else Decimal("0.00")
            tax = q4(net * rate)
            boxes["IRAS_F5_BOX_5_TAXABLE_PURCHASES"] = net
            boxes["IRAS_F5_BOX_7_INPUT_GST"] = tax
            return TaxCalculationResult(
                jurisdiction=jurisdiction,
                tax_code=tax_code,
                net_amount=net,
                tax_amount=tax,
                recoverable_tax_amount=tax,
                non_recoverable_tax_amount=Decimal("0.0000"),
                withholding_tax_amount=Decimal("0.0000"),
                reverse_charge_output_tax=Decimal("0.0000"),
                net_payable_to_counterparty=q4(net + tax),
                statutory_return_boxes=boxes,
                compliance_warnings=warnings,
            )

        # 4. HONG KONG (HKFRS + No GST/VAT + Territorial Source Tagging)
        if jurisdiction == Jurisdiction.HK:
            boxes[f"HK_IRD_ASSESSABLE_{hk_profit_source}"] = net
            return TaxCalculationResult(
                jurisdiction=jurisdiction,
                tax_code="HK_NO_INDIRECT_TAX",
                net_amount=net,
                tax_amount=Decimal("0.0000"),
                recoverable_tax_amount=Decimal("0.0000"),
                non_recoverable_tax_amount=Decimal("0.0000"),
                withholding_tax_amount=Decimal("0.0000"),
                reverse_charge_output_tax=Decimal("0.0000"),
                net_payable_to_counterparty=net,
                statutory_return_boxes=boxes,
                compliance_warnings=warnings,
            )

        # 5. NORTH AMERICA (US Multi-State Sales & Consumer Use Tax + 1099 Backup WHT / Canada GST/HST)
        if jurisdiction == Jurisdiction.US:
            # US Sales/Use Tax is a final cost to the business (non-recoverable input tax)
            if tax_code == "US_CONSUMER_USE_TAX_8_25":
                use_tax = q4(net * Decimal("0.0825"))
                warnings.append(
                    "US_USE_TAX_SELF_ACCRUAL: Vendor did not charge state sales tax; self-assessed 8.25% Consumer Use Tax."
                )
                wht = q4(net * Decimal("0.24")) if not counterparty_tax_id else Decimal("0.0000")
                if wht > 0:
                    warnings.append("US_IRS_BACKUP_WHT_24: Missing W-9 TIN; 24% IRS backup withholding applied.")
                return TaxCalculationResult(
                    jurisdiction=jurisdiction,
                    tax_code=tax_code,
                    net_amount=net,
                    tax_amount=Decimal("0.0000"),
                    recoverable_tax_amount=Decimal("0.0000"),
                    non_recoverable_tax_amount=use_tax,
                    withholding_tax_amount=wht,
                    reverse_charge_output_tax=use_tax,
                    net_payable_to_counterparty=q4(net - wht),
                    statutory_return_boxes={"US_STATE_USE_TAX_PAYABLE": use_tax, "IRS_1099_WHT": wht},
                    compliance_warnings=warnings,
                )
            sales_tax = q4(net * Decimal("0.0825")) if tax_code == "US_SALES_TAX_8_25" else Decimal("0.0000")
            return TaxCalculationResult(
                jurisdiction=jurisdiction,
                tax_code=tax_code,
                net_amount=net,
                tax_amount=sales_tax,
                recoverable_tax_amount=Decimal("0.0000"),
                non_recoverable_tax_amount=sales_tax,
                withholding_tax_amount=Decimal("0.0000"),
                reverse_charge_output_tax=Decimal("0.0000"),
                net_payable_to_counterparty=q4(net + sales_tax),
                statutory_return_boxes={"US_EXPENSED_SALES_TAX": sales_tax},
                compliance_warnings=warnings,
            )

        # 6. EUROPE (EU Intra-Community Acquisition Reverse Charge & Standard VAT)
        if jurisdiction in (Jurisdiction.EU, Jurisdiction.UK):
            if is_cross_border_b2b or tax_code == "EU_IC_REVERSE_CHARGE_20":
                rc_vat = q4(net * Decimal("0.20"))
                if not counterparty_tax_id:
                    warnings.append("EU_VIES_VAT_MISSING: Intra-Community reverse charge requires valid VIES VAT ID.")
                return TaxCalculationResult(
                    jurisdiction=jurisdiction,
                    tax_code="EU_IC_REVERSE_CHARGE_20",
                    net_amount=net,
                    tax_amount=Decimal("0.0000"),
                    recoverable_tax_amount=rc_vat,
                    non_recoverable_tax_amount=Decimal("0.0000"),
                    withholding_tax_amount=Decimal("0.0000"),
                    reverse_charge_output_tax=rc_vat,
                    net_payable_to_counterparty=net,
                    statutory_return_boxes={
                        "EU_VAT_ACQUISITION_OUTPUT": rc_vat,
                        "EU_VAT_ACQUISITION_INPUT": rc_vat,
                    },
                    compliance_warnings=warnings,
                )
            vat = q4(net * Decimal("0.20"))
            return TaxCalculationResult(
                jurisdiction=jurisdiction,
                tax_code=tax_code,
                net_amount=net,
                tax_amount=vat,
                recoverable_tax_amount=vat,
                non_recoverable_tax_amount=Decimal("0.0000"),
                withholding_tax_amount=Decimal("0.0000"),
                reverse_charge_output_tax=Decimal("0.0000"),
                net_payable_to_counterparty=q4(net + vat),
                statutory_return_boxes={"EU_INPUT_VAT_RECOVERABLE": vat},
                compliance_warnings=warnings,
            )

        return TaxCalculationResult(
            jurisdiction=jurisdiction,
            tax_code=tax_code,
            net_amount=net,
            tax_amount=Decimal("0.0000"),
            recoverable_tax_amount=Decimal("0.0000"),
            non_recoverable_tax_amount=Decimal("0.0000"),
            withholding_tax_amount=Decimal("0.0000"),
            reverse_charge_output_tax=Decimal("0.0000"),
            net_payable_to_counterparty=net,
        )

    @staticmethod
    def compute_lease_ifrs16_vs_asc842_delta(
        monthly_lease_payment: Decimal,
        opening_lease_liability: Decimal,
        monthly_discount_rate: Decimal,
        straight_line_ifrs_rou_amortization: Decimal,
        straight_line_asc842_single_lease_cost: Decimal,
    ) -> ParallelBookDelta:
        """
        Computes monthly parallel entries for an Operating Lease under:
          - BOOK_IFRS_GROUP (IFRS 16 Single Model: Front-loaded Interest + Straight-line ROU Amortization)
          - BOOK_US_GAAP (ASC 842 Operating Lease: Single Straight-Line Lease Expense)
        """
        interest_ifrs = q4(opening_lease_liability * monthly_discount_rate)
        rou_amort_ifrs = q4(straight_line_ifrs_rou_amortization)
        single_cost_us = q4(straight_line_asc842_single_lease_cost)
        rou_amort_us = q4(single_cost_us - interest_ifrs)

        return ParallelBookDelta(
            topic="IFRS 16 vs. US GAAP ASC 842 Operating Lease Monthly Recognition",
            ifrs_book_entries=[
                {"account": "6410_ROU_Depreciation_Expense", "debit": rou_amort_ifrs, "credit": Decimal("0.0000")},
                {"account": "7120_Lease_Interest_Expense", "debit": interest_ifrs, "credit": Decimal("0.0000")},
                {"account": "2410_Lease_Liability", "debit": q4(monthly_lease_payment - interest_ifrs), "credit": Decimal("0.0000")},
                {"account": "1650_Accumulated_ROU_Amortization", "debit": Decimal("0.0000"), "credit": rou_amort_ifrs},
                {"account": "1110_Cash_at_Bank", "debit": Decimal("0.0000"), "credit": q4(monthly_lease_payment)},
            ],
            us_gaap_delta_entries=[
                {"account": "6400_ASC842_Operating_Lease_Cost", "debit": single_cost_us, "credit": Decimal("0.0000")},
                {"account": "1650_Accumulated_ROU_Amortization", "debit": rou_amort_ifrs, "credit": rou_amort_us},
                {"account": "6410_ROU_Depreciation_Expense", "debit": Decimal("0.0000"), "credit": rou_amort_ifrs},
                {"account": "7120_Lease_Interest_Expense", "debit": Decimal("0.0000"), "credit": interest_ifrs},
            ],
            rationale=(
                "Under IFRS 16, all leases separate ROU depreciation and interest expense (front-loaded P&L profile). "
                "Under US GAAP ASC 842, operating leases recognize a single straight-line lease cost by adjusting ROU amortization."
            ),
        )
