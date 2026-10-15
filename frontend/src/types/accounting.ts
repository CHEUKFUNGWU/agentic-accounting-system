/**
 * Strict TypeScript Interfaces for SME, OPC & Sole Proprietor Agentic Accounting System
 * and Standalone Three Financial Statement Working Papers (單體三大報表底稿).
 */

export type EntityLegalStructure = "SOLE_PROPRIETOR" | "OPC_LIMITED" | "SME_CORP";

export type JurisdictionCode = "CN" | "HK" | "SG" | "AU" | "US" | "CA" | "EU" | "UK";

export interface ETBWorksheetRow {
  account_code: string;
  account_name: string;
  account_type: string;
  wp_ref: string;
  opening_balance: string;
  period_op_debit: string;
  period_op_credit: string;
  unadjusted_dr: string;
  unadjusted_cr: string;
  aje_debit: string;
  aje_credit: string;
  adjusted_dr: string;
  adjusted_cr: string;
  statement_destination: "INCOME_STATEMENT (P&L)" | "BALANCE_SHEET (B/S)";
}

export interface ETBTotals {
  total_open_dr: string;
  total_open_cr: string;
  total_op_dr: string;
  total_op_cr: string;
  total_unadj_dr: string;
  total_unadj_cr: string;
  total_aje_dr: string;
  total_aje_cr: string;
  total_adjusted_dr: string;
  total_adjusted_cr: string;
}

export interface StatementLine {
  wp_ref?: string;
  label: string;
  amount: string;
  margin_pct?: string;
  is_subtotal?: boolean;
}

export interface IncomeStatementWorkingPaper {
  wp_schedule_code: string;
  period: string;
  currency: string;
  line_items: StatementLine[];
}

export interface BalanceSheetWorkingPaper {
  wp_schedule_code: string;
  as_of_period: string;
  currency: string;
  current_assets: StatementLine[];
  total_current_assets: string;
  non_current_assets: StatementLine[];
  total_assets: string;
  current_liabilities: StatementLine[];
  total_liabilities: string;
  equity: StatementLine[];
  total_equity: string;
  total_liabilities_and_equity: string;
}

export interface CashFlowStatementWorkingPaper {
  wp_schedule_code: string;
  period: string;
  currency: string;
  indirect_method_operating: StatementLine[];
  direct_method_operating_memo: StatementLine[];
  net_cash_from_operating_activities: string;
  investing_activities: StatementLine[];
  net_cash_from_investing_activities: string;
  financing_activities: StatementLine[];
  net_cash_from_financing_activities: string;
  net_increase_in_cash: string;
  opening_cash_balance: string;
  ending_cash_balance: string;
}

export interface LeadScheduleItem {
  item: string;
  amount: string;
  note: string;
}

export interface LeadScheduleDetail {
  wp_ref: string;
  title: string;
  gl_balance: string;
  subledger_balance: string;
  variance: string;
  prepared_by: string;
  reviewed_by: string;
  tickmark: string;
  evidence_sha256: string;
  agent_reasoning: string;
  items: LeadScheduleItem[];
}

export interface StatutoryTaxWorkpaper {
  wp_ref: string;
  jurisdiction: JurisdictionCode;
  return_form_name: string;
  relief_applied: string;
  filing_boxes: Record<string, string>;
  total_statutory_tax_payable: string;
  ending_cash_balance: string;
  recommended_tax_vault_reserve: string;
  safe_to_spend_operating_cash: string;
}

export interface CloseChecklistItem {
  step: number;
  code: string;
  title: string;
  wp_ref: string;
  agent: string;
  status: "COMPLETED" | "WARNING" | "PENDING" | "BLOCKED";
}

export interface OpcComplianceCheck {
  rule: string;
  status: "PASS" | "WARNING" | "APPLIED";
  detail: string;
}

export interface ReconciliationProofs {
  etb_unadjusted_balanced: boolean;
  etb_adjustments_balanced: boolean;
  etb_adjusted_balanced: boolean;
  balance_sheet_equation_balanced: boolean;
  balance_sheet_variance: string;
  cash_flow_reconciles_to_bs_cash: boolean;
  cash_flow_variance: string;
  net_profit_flows_to_equity: boolean;
}

export interface KpiSummary {
  total_revenue: string;
  net_profit: string;
  gross_margin_pct: string;
  net_margin_pct: string;
  ending_cash: string;
  tax_reserve_required: string;
  safe_to_spend_cash: string;
  director_loan_net: string;
  director_loan_status: "OVERDRAWN_ASSET" | "CREDIT_OWED_TO_FOUNDER";
}

export interface ThreeStatementWorkingPaperPack {
  entity_code: string;
  legal_name: string;
  entity_structure: EntityLegalStructure;
  jurisdiction: JurisdictionCode;
  accounting_standard: string;
  currency: string;
  period: string;
  pack_status: "READY_FOR_CPA" | "CPA_SIGNED_LOCKED";
  etb_rows: ETBWorksheetRow[];
  etb_totals: ETBTotals;
  income_statement_wp: IncomeStatementWorkingPaper;
  balance_sheet_wp: BalanceSheetWorkingPaper;
  cash_flow_statement_wp: CashFlowStatementWorkingPaper;
  lead_schedules: Record<string, LeadScheduleDetail>;
  statutory_tax_workpaper: StatutoryTaxWorkpaper;
  close_checklist: CloseChecklistItem[];
  opc_and_sme_compliance_checks: OpcComplianceCheck[];
  reconciliation_proofs: ReconciliationProofs;
  kpi_summary: KpiSummary;
}
