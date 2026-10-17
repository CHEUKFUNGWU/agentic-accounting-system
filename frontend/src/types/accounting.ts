/**
 * Strict TypeScript Interfaces for SME, OPC & Sole Proprietor Agentic Accounting System
 * and Standalone Three Financial Statement Statements (單體三大報表).
 */

export type EntityLegalStructure = "SOLE_PROPRIETOR" | "OPC_LIMITED" | "SME_CORP";

export type JurisdictionCode = "CN" | "HK" | "SG" | "AU" | "US" | "CA" | "EU" | "UK";

export interface TrialBalanceSheetRow {
  account_code: string;
  account_name: string;
  account_type: string;
  statement_ref: string;
  opening_balance: string;
  period_op_debit: string;
  period_op_credit: string;
  unadjusted_debit: string;
  unadjusted_credit: string;
  adjustment_debit: string;
  adjustment_credit: string;
  adjusted_debit: string;
  adjusted_credit: string;
  statement_destination: "INCOME_STATEMENT (P&L)" | "BALANCE_SHEET (B/S)";
}

export interface TrialBalanceSheetTotals {
  total_opening_debit: string;
  total_opening_credit: string;
  total_period_debit: string;
  total_period_credit: string;
  total_unadjusted_debit: string;
  total_unadjusted_credit: string;
  total_adjustment_debit: string;
  total_adjustment_credit: string;
  total_adjusted_debit: string;
  total_adjusted_credit: string;
}

export interface StatementLine {
  statement_ref?: string;
  label: string;
  amount: string;
  margin_pct?: string;
  is_subtotal?: boolean;
}

export interface IncomeStatementWorkingPaper {
  statement_code: string;
  period: string;
  currency: string;
  line_items: StatementLine[];
}

export interface BalanceSheetWorkingPaper {
  statement_code: string;
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
  statement_code: string;
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
  statement_ref: string;
  title: string;
  gl_balance: string;
  subledger_balance: string;
  variance: string;
  prepared_by: string;
  reviewed_by: string;
  note: string;
  evidence_sha256: string;
  agent_reasoning: string;
  items: LeadScheduleItem[];
}

export interface StatutoryTaxSchedule {
  statement_ref: string;
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
  statement_ref: string;
  agent: string;
  status: "COMPLETED" | "WARNING" | "PENDING" | "BLOCKED";
}

export interface OpcComplianceCheck {
  rule: string;
  status: "PASS" | "WARNING" | "APPLIED";
  detail: string;
}

export interface ReconciliationProofs {
  trial_balance_balanced: boolean;
  adjustments_balanced: boolean;
  reported_balance_balanced: boolean;
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

export interface ReportingPack {
  entity_code: string;
  legal_name: string;
  entity_structure: EntityLegalStructure;
  jurisdiction: JurisdictionCode;
  accounting_standard: string;
  currency: string;
  period: string;
  reporting_status: "READY" | "REVIEWED_AND_LOCKED";
  trial_balance_rows: TrialBalanceSheetRow[];
  trial_balance_totals: TrialBalanceSheetTotals;
  income_statement: IncomeStatementWorkingPaper;
  balance_sheet: BalanceSheetWorkingPaper;
  cash_flow_statement: CashFlowStatementWorkingPaper;
  detail_schedules: Record<string, LeadScheduleDetail>;
  statutory_tax_schedule: StatutoryTaxSchedule;
  close_checklist: CloseChecklistItem[];
  opc_and_sme_compliance_checks: OpcComplianceCheck[];
  consistency_checks: ReconciliationProofs;
  kpi_summary: KpiSummary;
}
