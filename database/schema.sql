-- =============================================================================
-- STANDALONE AGENTIC ACCOUNTING SYSTEM FOR SMEs, OPCs & SOLE PROPRIETORS
-- POSTGRESQL 16+ PRODUCTION SCHEMA & THREE-STATEMENT WORKING PAPER ENGINE
-- Target Segments: SME (中小企), OPC (一人有限公司), Sole Proprietor (個體工商戶 / Sole Trader)
-- Regions: CN, HK, SG, AU, US, CA, EU, UK (IFRS / US GAAP / SME-FRS / Small Enterprise)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. LEGAL ENTITIES (SME / OPC / SOLE PROPRIETOR), BOOKS & FISCAL PERIODS
-- -----------------------------------------------------------------------------

CREATE TABLE legal_entities (
    entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_code VARCHAR(32) NOT NULL UNIQUE,
    legal_name VARCHAR(255) NOT NULL,
    entity_structure VARCHAR(24) NOT NULL CHECK (entity_structure IN (
        'SOLE_PROPRIETOR',  -- 個體工商戶 / 獨資東主 / Sole Trader / Schedule C
        'OPC_LIMITED',      -- 一人有限公司 / Single-Director Pty Ltd / Single-Member LLC
        'SME_CORP'          -- 一般中小企有限公司
    )),
    jurisdiction VARCHAR(8) NOT NULL CHECK (jurisdiction IN ('CN', 'HK', 'SG', 'AU', 'US', 'CA', 'EU', 'UK')),
    functional_currency CHAR(3) NOT NULL,
    primary_standard VARCHAR(32) NOT NULL CHECK (primary_standard IN (
        'IFRS', 'US_GAAP', 'PRC_SMALL', 'PRC_CAS', 'SME_FRS_HK', 'SFRS_SMALL', 'AASB_TIER2', 'UK_FRS102_1A', 'UK_FRS105'
    )),
    tax_registration_no VARCHAR(64) NOT NULL,
    is_vat_gst_registered BOOLEAN NOT NULL DEFAULT TRUE,
    is_small_taxpayer_relief BOOLEAN NOT NULL DEFAULT TRUE,
    owner_director_profile JSONB NOT NULL DEFAULT '{}'::JSONB,
    localization_config JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE accounting_books (
    book_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    book_code VARCHAR(32) NOT NULL,
    accounting_standard VARCHAR(32) NOT NULL CHECK (accounting_standard IN (
        'IFRS', 'US_GAAP', 'PRC_SMALL', 'PRC_CAS', 'SME_FRS_HK', 'SFRS_SMALL', 'AASB_TIER2', 'TAX_BASIS'
    )),
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (entity_id, book_code)
);

CREATE TABLE agent_principals (
    principal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type VARCHAR(32) NOT NULL CHECK (principal_type IN ('AI_AGENT_STATELESS_MCP', 'HUMAN_CPA', 'FOUNDER_OWNER', 'SYSTEM_ORCHESTRATOR')),
    agent_name VARCHAR(128) NOT NULL UNIQUE,
    role VARCHAR(32) NOT NULL CHECK (role IN (
        'MAKER_BOOKKEEPER', 'MAKER_CLOSE_WP', 'CHECKER_CONTROLLER', 'AUDITOR_INTERNAL', 'HUMAN_CPA'
    )),
    max_auto_approve_func_amount NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (max_auto_approve_func_amount >= 0),
    min_confidence_threshold NUMERIC(5, 4) NOT NULL DEFAULT 0.9500 CHECK (min_confidence_threshold BETWEEN 0.0000 AND 1.0000),
    allowed_mcp_tools JSONB NOT NULL DEFAULT '[]'::JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fiscal_periods (
    period_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 2200),
    period_number INT NOT NULL CHECK (period_number BETWEEN 1 AND 13),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'FUTURE' CHECK (status IN ('FUTURE', 'OPEN', 'SOFT_CLOSE', 'HARD_CLOSE', 'LOCKED')),
    closed_by_principal_id UUID REFERENCES agent_principals(principal_id),
    closed_at TIMESTAMPTZ,
    CHECK (end_date >= start_date),
    UNIQUE (entity_id, fiscal_year, period_number)
);

-- -----------------------------------------------------------------------------
-- 2. CHART OF ACCOUNTS (WITH W/P REF & CASH FLOW TAGS) & 6-REGION TAX ENGINE
-- -----------------------------------------------------------------------------

CREATE TABLE chart_of_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    parent_account_id UUID REFERENCES chart_of_accounts(account_id),
    account_code VARCHAR(32) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(16) NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    normal_balance VARCHAR(8) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    fs_category VARCHAR(32) NOT NULL CHECK (fs_category IN (
        'CASH', 'AR', 'PREPAY_TAX', 'INVENTORY', 'FIXED_ASSET', 'CONTRA_ASSET',
        'AP_ACCRUAL', 'DEFERRED_REV', 'TAX_PAYABLE', 'DIRECTOR_LOAN', 'LONG_TERM_DEBT',
        'EQUITY', 'OWNER_DRAWINGS', 'REVENUE', 'COGS', 'OPEX', 'DEPRECIATION', 'TAX_EXPENSE'
    )),
    default_wp_ref VARCHAR(16) NOT NULL DEFAULT 'W/P TB',
    cash_flow_activity VARCHAR(24) NOT NULL DEFAULT 'OPERATING_WC' CHECK (cash_flow_activity IN (
        'CASH_EQUIV', 'OPERATING_WC', 'NON_CASH', 'INVESTING', 'FINANCING'
    )),
    is_control_account BOOLEAN NOT NULL DEFAULT FALSE,
    allow_manual_je BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (NOT (is_control_account = TRUE AND allow_manual_je = TRUE)),
    UNIQUE (entity_id, account_code)
);

CREATE TABLE tax_codes (
    tax_code_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    jurisdiction VARCHAR(8) NOT NULL CHECK (jurisdiction IN ('CN', 'HK', 'SG', 'AU', 'US', 'CA', 'EU', 'UK')),
    tax_code VARCHAR(32) NOT NULL,
    description VARCHAR(255) NOT NULL,
    tax_mechanism VARCHAR(32) NOT NULL CHECK (tax_mechanism IN (
        'VAT_GST_CREDIT', 'SMALL_SCALE_VAT', 'US_SALES_TAX', 'US_USE_TAX_ACCRUAL',
        'REVERSE_CHARGE', 'WITHHOLDING', 'EXEMPT', 'ZERO_RATED'
    )),
    rate NUMERIC(9, 6) NOT NULL CHECK (rate >= 0.000000),
    recoverable_pct NUMERIC(5, 4) NOT NULL DEFAULT 1.0000 CHECK (recoverable_pct BETWEEN 0.0000 AND 1.0000),
    statutory_return_box VARCHAR(32),
    tax_account_id UUID NOT NULL REFERENCES chart_of_accounts(account_id),
    UNIQUE (entity_id, tax_code)
);

-- -----------------------------------------------------------------------------
-- 3. IMMUTABLE GENERAL LEDGER & OWNER / DIRECTOR LOAN COMMINGLING SUB-LEDGER
-- -----------------------------------------------------------------------------

CREATE TABLE journal_entries (
    journal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    period_id UUID NOT NULL REFERENCES fiscal_periods(period_id),
    entry_layer VARCHAR(24) NOT NULL DEFAULT 'OPERATIONAL' CHECK (entry_layer IN (
        'OPERATIONAL', 'AJE_MONTH_END', 'RJE_RECLASS', 'REVERSAL'
    )),
    entry_number VARCHAR(64) UNIQUE,
    statutory_voucher_no VARCHAR(64),
    source_module VARCHAR(24) NOT NULL CHECK (source_module IN (
        'GL_MANUAL', 'AP', 'AR', 'BANK_REC', 'EXPENSE_SPLIT', 'FA_DEP', 'DEFERRAL', 'TAX_PROV'
    )),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT', 'PENDING_CHECKER', 'AWAITING_CPA', 'POSTED', 'REVERSED', 'REJECTED'
    )),
    accounting_date DATE NOT NULL,
    tx_currency CHAR(3) NOT NULL,
    exchange_rate NUMERIC(19, 8) NOT NULL DEFAULT 1.00000000 CHECK (exchange_rate > 0),
    reversal_of_journal_id UUID REFERENCES journal_entries(journal_id),
    prev_entry_hash VARCHAR(64),
    entry_hash VARCHAR(64),
    created_by_principal_id UUID NOT NULL REFERENCES agent_principals(principal_id),
    approved_by_principal_id UUID REFERENCES agent_principals(principal_id),
    ai_confidence_score NUMERIC(5, 4) CHECK (ai_confidence_score BETWEEN 0.0000 AND 1.0000),
    ai_reasoning_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at TIMESTAMPTZ,
    CHECK (approved_by_principal_id IS NULL OR approved_by_principal_id <> created_by_principal_id)
);

CREATE TABLE counterparties (
    counterparty_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    counterparty_type VARCHAR(16) NOT NULL CHECK (counterparty_type IN ('VENDOR', 'CUSTOMER', 'OWNER_DIRECTOR', 'TAX_AUTHORITY')),
    legal_name VARCHAR(255) NOT NULL,
    country_code CHAR(2) NOT NULL,
    tax_id_number VARCHAR(64),
    tax_id_verified BOOLEAN NOT NULL DEFAULT FALSE,
    withholding_rule VARCHAR(32) NOT NULL DEFAULT 'NONE' CHECK (withholding_rule IN (
        'NONE', 'AU_NO_ABN_47', 'US_1099_BACKUP_24', 'US_W8BEN_30', 'SG_NON_RES_15', 'CN_WHT_10'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_lines (
    line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID NOT NULL REFERENCES journal_entries(journal_id) ON DELETE CASCADE,
    line_number INT NOT NULL CHECK (line_number > 0),
    account_id UUID NOT NULL REFERENCES chart_of_accounts(account_id),
    counterparty_id UUID REFERENCES counterparties(counterparty_id),
    tx_debit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (tx_debit >= 0),
    tx_credit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (tx_credit >= 0),
    func_debit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (func_debit >= 0),
    func_credit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (func_credit >= 0),
    business_use_pct NUMERIC(5, 4) NOT NULL DEFAULT 1.0000 CHECK (business_use_pct BETWEEN 0.0000 AND 1.0000),
    tax_code_id UUID REFERENCES tax_codes(tax_code_id),
    func_tax_amount NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    profit_source_tag VARCHAR(16) NOT NULL DEFAULT 'ONSHORE' CHECK (profit_source_tag IN ('ONSHORE', 'OFFSHORE')),
    cash_flow_direct_tag VARCHAR(32) CHECK (cash_flow_direct_tag IN (
        'CF_SALES_IN', 'CF_SUPPLIER_OUT', 'CF_OPEX_OUT', 'CF_TAX_OUT', 'CF_CAPEX_OUT', 'CF_OWNER_CAPITAL', 'CF_DIRECTOR_LOAN'
    )),
    wp_ref VARCHAR(16),
    line_memo TEXT,
    CHECK ((tx_debit > 0 AND tx_credit = 0 AND func_debit > 0 AND func_credit = 0) OR
           (tx_credit > 0 AND tx_debit = 0 AND func_credit > 0 AND func_debit = 0)),
    UNIQUE (journal_id, line_number)
);

-- Dedicated Sub-Ledger for OPC Director's Loan & Sole Proprietor Drawings (W/P DD / E)
CREATE TABLE owner_director_loan_ledger (
    loan_tx_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    period_id UUID NOT NULL REFERENCES fiscal_periods(period_id),
    journal_id UUID NOT NULL REFERENCES journal_entries(journal_id),
    tx_type VARCHAR(40) NOT NULL CHECK (tx_type IN (
        'PERSONAL_EXPENSE_SPLIT', 'OWNER_CASH_DRAWING', 'FOUNDER_CAPITAL_INJECTION', 'BUSINESS_EXPENSE_PAID_PRIVATELY'
    )),
    debit_due_from_owner NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (debit_due_from_owner >= 0),
    credit_owed_to_owner NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (credit_owed_to_owner >= 0),
    running_net_balance NUMERIC(19, 4) NOT NULL,
    statutory_compliance_flag VARCHAR(32) NOT NULL DEFAULT 'CLEAN' CHECK (statutory_compliance_flag IN (
        'CLEAN', 'AU_DIV7A_UNFRANKED_DIV_RISK', 'CN_ART23_COMMINGLING_RISK', 'UK_S455_TAX_RISK', 'HK_CAP622_S380_DISCLOSURE'
    )),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. STANDALONE THREE FINANCIAL STATEMENT WORKING PAPER TABLES (三大報表底稿表)
-- -----------------------------------------------------------------------------

CREATE TABLE working_paper_packs (
    pack_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    period_id UUID NOT NULL REFERENCES fiscal_periods(period_id),
    pack_version VARCHAR(16) NOT NULL DEFAULT 'v1.0',
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFTING' CHECK (status IN (
        'DRAFTING', 'ETB_BALANCED', 'READY_FOR_CPA', 'CPA_SIGNED_LOCKED'
    )),
    unadjusted_tb_balanced BOOLEAN NOT NULL DEFAULT FALSE,
    aje_balanced BOOLEAN NOT NULL DEFAULT FALSE,
    adjusted_tb_balanced BOOLEAN NOT NULL DEFAULT FALSE,
    balance_sheet_balanced BOOLEAN NOT NULL DEFAULT FALSE,
    cash_flow_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
    total_assets_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    total_liab_and_equity_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    net_profit_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    ending_cash_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    recommended_tax_reserve_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    safe_to_spend_cash_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    prepared_by_agent_id UUID NOT NULL REFERENCES agent_principals(principal_id),
    signed_by_cpa_id UUID REFERENCES agent_principals(principal_id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signed_at TIMESTAMPTZ,
    UNIQUE (entity_id, period_id, pack_version)
);

CREATE TABLE etb_worksheet_lines (
    etb_line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES working_paper_packs(pack_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(account_id),
    account_code VARCHAR(32) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    wp_ref VARCHAR(16) NOT NULL,
    opening_balance_signed NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    period_op_debit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    period_op_credit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    unadjusted_ending_dr NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    unadjusted_ending_cr NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    aje_debit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    aje_credit NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    adjusted_ending_dr NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    adjusted_ending_cr NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    statement_destination VARCHAR(24) NOT NULL CHECK (statement_destination IN ('INCOME_STATEMENT', 'BALANCE_SHEET')),
    UNIQUE (pack_id, account_code)
);

CREATE TABLE lead_schedules (
    schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES working_paper_packs(pack_id) ON DELETE CASCADE,
    wp_ref VARCHAR(16) NOT NULL,
    schedule_title VARCHAR(255) NOT NULL,
    gl_adjusted_balance NUMERIC(19, 4) NOT NULL,
    supporting_subledger_balance NUMERIC(19, 4) NOT NULL,
    unreconciled_variance NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    schedule_breakdown_rows JSONB NOT NULL DEFAULT '[]'::JSONB,
    agent_reasoning_trace TEXT,
    evidence_uris JSONB NOT NULL DEFAULT '[]'::JSONB,
    audit_tickmark VARCHAR(128) NOT NULL DEFAULT '✓ Agreed to General Ledger & Sub-Ledger',
    UNIQUE (pack_id, wp_ref)
);

CREATE TABLE statement_line_items (
    stmt_line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES working_paper_packs(pack_id) ON DELETE CASCADE,
    statement_type VARCHAR(24) NOT NULL CHECK (statement_type IN (
        'INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW_INDIRECT', 'CASH_FLOW_DIRECT'
    )),
    display_order INT NOT NULL,
    wp_ref VARCHAR(16),
    line_code VARCHAR(64) NOT NULL,
    line_label VARCHAR(255) NOT NULL,
    current_period_amount NUMERIC(19, 4) NOT NULL,
    prior_period_amount NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    is_subtotal_or_total BOOLEAN NOT NULL DEFAULT FALSE
);

-- Month-End Close & Working Paper Readiness Checklist Table (月結關帳與底稿檢核步驟表)
CREATE TABLE close_checklist_items (
    checklist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES working_paper_packs(pack_id) ON DELETE CASCADE,
    step_order INT NOT NULL,
    step_code VARCHAR(32) NOT NULL,
    step_title VARCHAR(255) NOT NULL,
    wp_ref VARCHAR(16) NOT NULL,
    assigned_agent_role VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'WARNING', 'BLOCKED')),
    verification_note TEXT,
    verified_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pack_id, step_code)
);

-- Statutory Tax Filing & Cash Tax Reserve Working Paper (W/P CC 各國稅務申報與預留稅款底稿表)
CREATE TABLE statutory_tax_filings (
    filing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES working_paper_packs(pack_id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    jurisdiction VARCHAR(8) NOT NULL,
    return_form_name VARCHAR(128) NOT NULL, -- e.g. "ATO BAS", "CN Golden Tax IV VAT & CIT", "HK BIR51/52", "IRAS GST F5"
    filing_boxes JSONB NOT NULL DEFAULT '{}'::JSONB,
    indirect_tax_net_payable NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    withholding_tax_payable NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    estimated_income_tax_provision NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    total_recommended_tax_reserve NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    effective_income_tax_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    relief_applied VARCHAR(255),
    filing_due_date DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT_WORKPAPER' CHECK (status IN ('DRAFT_WORKPAPER', 'CPA_VERIFIED', 'LODGED'))
);

-- Working Paper Audit Comments & Tickmarks (底稿審計註記與穿透憑證表)
CREATE TABLE working_paper_comments_and_tickmarks (
    comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES working_paper_packs(pack_id) ON DELETE CASCADE,
    wp_ref VARCHAR(16) NOT NULL,
    author_principal_id UUID NOT NULL REFERENCES agent_principals(principal_id),
    tickmark_symbol VARCHAR(16) NOT NULL DEFAULT '✓',
    comment_text TEXT NOT NULL,
    evidence_sha256 CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. SUB-LEDGERS: AP/AR, BANK REC, FIXED ASSETS, DEFERRALS, AUDIT & OUTBOX
-- -----------------------------------------------------------------------------

CREATE TABLE subledger_invoices (
    invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    subledger_type VARCHAR(24) NOT NULL CHECK (subledger_type IN ('AP_BILL', 'AR_INVOICE', 'EXPENSE_RECEIPT')),
    counterparty_id UUID NOT NULL REFERENCES counterparties(counterparty_id),
    external_invoice_no VARCHAR(128) NOT NULL,
    einvoice_verification_code VARCHAR(128),
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    currency CHAR(3) NOT NULL,
    net_amount NUMERIC(19, 4) NOT NULL,
    tax_amount NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    withholding_tax_amount NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    gross_amount NUMERIC(19, 4) NOT NULL,
    business_use_pct NUMERIC(5, 4) NOT NULL DEFAULT 1.0000 CHECK (business_use_pct BETWEEN 0.0000 AND 1.0000),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTED', 'PAID')),
    posted_journal_id UUID REFERENCES journal_entries(journal_id)
);

CREATE TABLE bank_accounts (
    bank_account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    gl_control_account_id UUID NOT NULL REFERENCES chart_of_accounts(account_id),
    bank_name VARCHAR(128) NOT NULL,
    account_identifier VARCHAR(64) NOT NULL,
    currency CHAR(3) NOT NULL,
    is_dedicated_business_account BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE bank_statement_lines (
    stmt_line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(bank_account_id),
    value_date DATE NOT NULL,
    external_tx_id VARCHAR(128) NOT NULL UNIQUE,
    amount NUMERIC(19, 4) NOT NULL,
    currency CHAR(3) NOT NULL,
    counterparty_raw VARCHAR(255),
    remittance_raw TEXT,
    reconciliation_status VARCHAR(24) NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_status IN (
        'UNMATCHED', 'PROPOSED', 'RECONCILED', 'EXCEPTION'
    ))
);

CREATE TABLE fixed_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES legal_entities(entity_id),
    asset_tag VARCHAR(64) NOT NULL UNIQUE,
    asset_name VARCHAR(255) NOT NULL,
    acquisition_date DATE NOT NULL,
    acquisition_cost_func NUMERIC(19, 4) NOT NULL CHECK (acquisition_cost_func >= 0),
    salvage_value_func NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    useful_life_months INT NOT NULL CHECK (useful_life_months > 0),
    dep_method VARCHAR(32) NOT NULL CHECK (dep_method IN (
        'STRAIGHT_LINE', 'DIMINISHING_VALUE', 'AU_INSTANT_ASSET_WRITEOFF', 'US_SEC_179'
    ))
);

CREATE TABLE mcp_audit_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    principal_id UUID NOT NULL REFERENCES agent_principals(principal_id),
    request_id VARCHAR(128) NOT NULL UNIQUE,
    mcp_protocol_version VARCHAR(16) NOT NULL DEFAULT '2026-07-28',
    mcp_primitive VARCHAR(16) NOT NULL CHECK (mcp_primitive IN ('TOOL_CALL', 'RESOURCE_READ', 'PROMPT_GET')),
    target_name VARCHAR(128) NOT NULL,
    request_payload JSONB NOT NULL,
    response_payload JSONB NOT NULL,
    reasoning_trace TEXT,
    outcome VARCHAR(32) NOT NULL
);

CREATE TABLE outbox_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(64) NOT NULL,
    entity_id UUID REFERENCES legal_entities(entity_id),
    aggregate_id UUID NOT NULL,
    event_payload JSONB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'FAILED', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. DATABASE-LEVEL ACCOUNTING INVARIANT & WORKING PAPER TRIGGERS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_enforce_control_account_isolation()
RETURNS TRIGGER AS $$
DECLARE
    v_is_control BOOLEAN;
    v_source_module VARCHAR(24);
BEGIN
    SELECT is_control_account INTO v_is_control
    FROM chart_of_accounts WHERE account_id = NEW.account_id;

    SELECT source_module INTO v_source_module
    FROM journal_entries WHERE journal_id = NEW.journal_id;

    IF v_is_control = TRUE AND v_source_module = 'GL_MANUAL' THEN
        RAISE EXCEPTION 'ACCOUNTING_INVARIANT_VIOLATION: Direct manual journal entry to Control Account (%) is forbidden.', NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_control_account_isolation
BEFORE INSERT OR UPDATE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION fn_enforce_control_account_isolation();

CREATE OR REPLACE FUNCTION fn_verify_working_paper_pack_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('READY_FOR_CPA', 'CPA_SIGNED_LOCKED') THEN
        IF NEW.unadjusted_tb_balanced = FALSE OR NEW.aje_balanced = FALSE OR NEW.adjusted_tb_balanced = FALSE THEN
            RAISE EXCEPTION 'WORKPAPER_ETB_UNBALANCED: Extended Trial Balance (ETB) columns do not cross-foot.';
        END IF;
        IF NEW.balance_sheet_balanced = FALSE OR NEW.total_assets_func <> NEW.total_liab_and_equity_func THEN
            RAISE EXCEPTION 'WORKPAPER_BS_UNBALANCED: Balance Sheet Assets (%) != Liabilities + Equity (%).',
                NEW.total_assets_func, NEW.total_liab_and_equity_func;
        END IF;
        IF NEW.cash_flow_reconciled = FALSE THEN
            RAISE EXCEPTION 'WORKPAPER_CFS_UNRECONCILED: Cash Flow Statement Ending Cash does not agree to Balance Sheet W/P A.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verify_working_paper_pack_balance
BEFORE INSERT OR UPDATE ON working_paper_packs
FOR EACH ROW EXECUTE FUNCTION fn_verify_working_paper_pack_balance();

CREATE OR REPLACE FUNCTION fn_notify_outbox_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('accounting_outbox_channel', NEW.event_id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_outbox_event
AFTER INSERT ON outbox_events
FOR EACH ROW EXECUTE FUNCTION fn_notify_outbox_event();
