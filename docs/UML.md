# Comprehensive UML Diagrams: Agentic Accounting System for SMEs, OPCs & Sole Proprietors

This document contains the complete Unified Modeling Language (UML) models tailored for **SMEs (中小企)**, **OPCs (One-Person Companies / 一人有限公司)**, and **Sole Proprietors (個體戶 / Sole Traders)**, centered on generating **Standalone Three Financial Statement Working Papers (`單體三大報表底稿`)**:

1. **UML Component & Hybrid Stateless MCP Architecture Diagram**
2. **UML Domain Class Diagram** (Standalone Entity, Owner/Director Loan & Commingling Guard, Extended Trial Balance `ETB`, Lead Schedules `W/P A..EQ`, and 3-Statement Working Paper Pack)
3. **UML Sequence Diagram 1**: Bookkeeping, Mixed Personal/Business Expense Apportionment (`公私混用拆分`) & Bank Feed Reconciliation
4. **UML Sequence Diagram 2**: Month-End Adjusting Entries (`AJE`), Extended Trial Balance (`ETB`) Compilation & Standalone Three Financial Statement Working Paper Generation
5. **UML State Machine Diagrams**:
   - Working Paper Pack & Three-Statement Sign-Off Lifecycle
   - Journal Entry & Maker-Checker-CPA Governance State Machine

## 1. UML Component & Hybrid MCP Architecture Diagram

```mermaid
flowchart TB
    subgraph Agent_Team["SME / OPC Agent Accounting Team (Stateless MCP Clients)"]
        Bookkeeper_Agent["Bookkeeper & Bank Rec Agent\n(Maker: AP/AR, Bank Match, Personal Split %)"]
        Close_WP_Agent["Close & Working Paper Agent\n(Maker: AJE, Depreciation, Tax, ETB & 3-Statement Pack)"]
        Controller_Agent["Controller Reviewer Agent\n(Checker: SoD Review, Cross-Foot & Tax Guard)"]
        Tax_Audit_Agent["Tax & OPC Compliance Auditor Agent\n(Auditor: Div 7A / PRC Art.23 / UK s455 / BAS / Fapiao)"]
    end

    subgraph Human_Plane["Founder & CPA Command Center (TypeScript / React)"]
        WP_Dashboard["3-Statement Working Paper & ETB Viewer\n(ETB Worksheet, Lead Schedules W/P A-EQ, P&L, B/S, Cash Flow)"]
    end

    subgraph FastAPI_MCP_Server["FastAPI + Official MCP Python SDK Server (Stateless Streamable HTTP)"]
        MCP_Endpoint["Stateless Streamable HTTP Endpoint\nPOST /mcp (stateless_http=True)"]
        REST_API["REST & SSE API Gateway\n/api/v1/workpapers/* & /api/v1/webhooks/*"]
        SoD_Guard["Deterministic SoD & Invariant Guard\n(Maker!=Checker, Control Account Lock, DR==CR)"]
        Audit_Logger["Immutable MCP Audit Interceptor\n(Logs JSON-RPC Payload, Reasoning & SHA-256 Hash)"]
    end

    subgraph Orchestration_Plane["Hybrid Event-Driven Orchestrator"]
        Outbox_Worker["Transactional Outbox Worker (pg_notify)"]
        Event_Router["Agent Webhook / Stateless MCP Callback Dispatcher"]
    end

    subgraph Accounting_Core["Deterministic Standalone Accounting & Working Paper Core"]
        GL_Engine["Standalone Double-Entry Ledger Engine\n(IFRS / US GAAP / SME-FRS / PRC Small Enterprise)"]
        Split_Engine["OPC & Sole Trader Expense Split Engine\n(Business % vs. Owner Drawings / Director Loan W/P DD)"]
        Subledger_Engine["Sub-Ledger Engine\n(AP/AR, Bank Rec W/P A, Fixed Assets W/P F, Deferrals W/P C)"]
        Tax_Engine["6-Region SME/OPC Tax Engine\n(CN Fapiao/VAT, HK Two-Tier, SG SUTE/GST, AU BAS/Div7A, US Sched-C/UseTax, EU VAT)"]
        WP_Engine["Standalone 3-Statement Working Paper Engine\n(ETB -> W/P Schedules -> Income Statement, Balance Sheet & Direct/Indirect Cash Flow)"]
    end

    subgraph Persistence["Immutable Storage Layer"]
        PG[("PostgreSQL 16+ Database\nNUMERIC(19,4) + Append-Only Triggers + Working Paper Tables")]
        Vault[("Evidence Object Store\nReceipts, Invoices, Bank Statements, Contracts")]
    end

    Bookkeeper_Agent & Close_WP_Agent & Controller_Agent & Tax_Audit_Agent -->|"Stateless HTTP POST /mcp"| MCP_Endpoint
    WP_Dashboard <-->|"HTTPS REST / SSE"| REST_API
    MCP_Endpoint & REST_API --> SoD_Guard --> Audit_Logger
    Audit_Logger --> GL_Engine & Split_Engine & Subledger_Engine & Tax_Engine & WP_Engine
    GL_Engine & Split_Engine & Subledger_Engine & Tax_Engine & WP_Engine --> PG
    Subledger_Engine & GL_Engine --> Vault
    PG -->|"ACID Outbox Events"| Outbox_Worker --> Event_Router
    Event_Router -.->|"Wake Subscribed Agent"| Agent_Team
    Event_Router -.->|"Real-time SSE Update"| WP_Dashboard
```

## 2. UML Domain Class Diagram (Standalone SME / OPC & Working Paper Model)

```mermaid
classDiagram
    class LegalEntity {
        +UUID entity_id
        +String entity_code
        +String legal_name
        +EntityLegalStructure entity_structure
        +JurisdictionCode jurisdiction
        +CurrencyCode functional_currency
        +AccountingStandard primary_standard
        +String tax_registration_no
        +Boolean is_small_taxpayer_or_sbe
    }

    class ChartOfAccount {
        +UUID account_id
        +String account_code
        +String account_name
        +AccountType account_type
        +FSCategory fs_category
        +String default_wp_ref
        +CashFlowActivity cash_flow_activity
        +Boolean is_control_account
        +Boolean allow_manual_je
    }

    class JournalEntry {
        +UUID journal_id
        +UUID entity_id
        +UUID period_id
        +EntryLayer entry_layer
        +String entry_number
        +JournalStatus status
        +Date accounting_date
        +String prev_entry_hash
        +String entry_hash
        +UUID created_by_principal_id
        +UUID approved_by_principal_id
        +Decimal ai_confidence_score
        +String ai_reasoning_summary
        +validateBalanced()
    }

    class JournalLine {
        +UUID line_id
        +UUID journal_id
        +Int line_number
        +UUID account_id
        +Decimal tx_debit
        +Decimal tx_credit
        +Decimal func_debit
        +Decimal func_credit
        +Decimal business_use_pct
        +String cash_flow_direct_tag
        +String wp_ref_override
    }

    class OwnerDirectorLoanLedger {
        +UUID loan_tx_id
        +UUID entity_id
        +UUID journal_id
        +String tx_category
        +Decimal debit_advance_to_owner
        +Decimal credit_funding_from_owner
        +Decimal running_balance
        +evaluateComminglingAndDiv7ARisk()
    }

    class WorkingPaperPack {
        +UUID pack_id
        +UUID entity_id
        +UUID period_id
        +WorkpaperStatus status
        +Boolean etb_balanced
        +Boolean bs_equation_balanced
        +Boolean cash_flow_reconciled
        +UUID prepared_by_agent_id
        +UUID reviewed_by_cpa_id
        +compileExtendedTrialBalance()
        +generateIncomeStatementWP()
        +generateBalanceSheetWP()
        +generateCashFlowStatementWP()
    }

    class ETBWorksheetLine {
        +UUID etb_line_id
        +UUID pack_id
        +String account_code
        +String wp_ref
        +Decimal opening_balance
        +Decimal period_op_debit
        +Decimal period_op_credit
        +Decimal unadjusted_ending
        +Decimal aje_debit
        +Decimal aje_credit
        +Decimal adjusted_ending
        +String statement_destination
    }

    class LeadSchedule {
        +UUID schedule_id
        +UUID pack_id
        +String wp_ref
        +String schedule_title
        +Decimal gl_agreed_balance
        +Decimal subledger_or_external_balance
        +Decimal variance
        +List~String~ audit_tickmarks
    }

    LegalEntity "1" --> "*" ChartOfAccount : defines
    LegalEntity "1" --> "*" JournalEntry : records
    LegalEntity "1" --> "*" OwnerDirectorLoanLedger : monitors
    LegalEntity "1" --> "*" WorkingPaperPack : produces
    JournalEntry "1" *-- "2..*" JournalLine : contains
    ChartOfAccount "1" --> "*" JournalLine : classifies
    WorkingPaperPack "1" *-- "*" ETBWorksheetLine : compiles
    WorkingPaperPack "1" *-- "*" LeadSchedule : reconciles via
```

## 3. UML Sequence Diagram 1: Mixed Personal/Business Expense Apportionment (`公私混用拆分`) & Bank Rec

```mermaid
sequenceDiagram
    autonumber
    participant Bank as Bank Feed / Receipt OCR
    participant API as FastAPI Ingestion
    participant DB as PostgreSQL (Ledger + Outbox)
    participant Orch as Event-Driven Orchestrator
    actor BK_Agent as Bookkeeper Agent (Maker)
    participant MCP as Stateless MCP Endpoint (POST /mcp)
    participant Split as Expense Split & Tax Engine
    actor Ctrl_Agent as Controller Agent (Checker)

    Bank->>API: Upload Receipt + Bank Line (AUD 1,100 Home Fibre & Cloud Server, incl. AUD 100 GST)
    API->>DB: Insert `bank_statement_lines` + Emit `expense_receipt.uploaded` in `outbox_events`
    DB-->>Orch: pg_notify `accounting_outbox_channel`
    Orch->>BK_Agent: Wake `Bookkeeper-Agent` with receipt & entity structure (`OPC_LIMITED` / `SOLE_PROPRIETOR`)

    BK_Agent->>MCP: POST /mcp `tools/call` `propose_expense_with_personal_split` (business_use_pct=0.70)
    MCP->>Split: Compute 70% Business vs. 30% Personal Apportionment
    Split-->>MCP: DR 6100 Cloud/Internet Expense (700.00) + DR 1420 Recoverable GST (70.00) + DR 2190 Director Loan / 3200 Drawings (330.00, 0% GST credit) / CR 1110 Bank (1,100.00)
    MCP->>DB: Save Proposal (`PENDING_CHECKER`) + Update `W/P DD` (Director Loan Schedule) + Emit `proposal.pending_checker`
    MCP-->>BK_Agent: Return Proposal ID & `W/P DD` Commingling Check

    Orch->>Ctrl_Agent: Wake `Controller-Checker-Agent`
    Ctrl_Agent->>MCP: POST /mcp `tools/call` `review_and_approve_proposal` (Verify Maker != Checker & GST apportionment)
    MCP->>DB: Seal Journal (`POSTED` + SHA-256 `entry_hash`)
```

## 4. UML Sequence Diagram 2: Month-End Adjusting Entries (`AJE`) & Standalone 3-Statement Working Paper Pack

```mermaid
sequenceDiagram
    autonumber
    actor CPA as Founder / External CPA
    participant API as FastAPI Server
    participant Orch as Event-Driven Orchestrator
    actor WP_Agent as Close & Working Paper Agent (Maker)
    participant MCP as Stateless MCP Endpoint (POST /mcp)
    participant WPEngine as Standalone 3-Statement Working Paper Engine
    actor Ctrl_Agent as Controller Agent (Checker)

    CPA->>API: Trigger Month-End Close (`SOFT_CLOSE` for Period `2026-10`)
    API->>Orch: Emit `period.soft_closed`
    Orch->>WP_Agent: Wake `Close-WP-Agent` with Prompt `sme-opc-month-end-workpaper-sop`

    WP_Agent->>MCP: POST /mcp `tools/call` `propose_adjusting_workpaper_entry` (Depreciation W/P F, Accruals W/P AA, Tax Provision W/P CC)
    MCP-->>WP_Agent: Created Adjusting Journal Entries (`AJE` layer)

    Orch->>Ctrl_Agent: Wake `Controller-Checker-Agent` to review & approve `AJE` batch
    Ctrl_Agent->>MCP: Approve `AJE` entries -> Status `POSTED`

    WP_Agent->>MCP: POST /mcp `tools/call` `generate_three_statements_working_paper` (entity_code, period=`2026-10`)
    MCP->>WPEngine: 1. Compile Extended Trial Balance (Opening + Op DR/CR = Unadjusted TB + AJE = Adjusted TB)
    MCP->>WPEngine: 2. Reconcile Lead Schedules (W/P A Cash, W/P B AR, W/P DD Director Loan, W/P F Fixed Assets, W/P CC Tax)
    MCP->>WPEngine: 3. Generate Income Statement (W/P PL) & roll Net Profit into Equity (W/P EQ)
    MCP->>WPEngine: 4. Generate Balance Sheet (W/P BS) & verify Total Assets == Total Liabilities + Equity
    MCP->>WPEngine: 5. Generate Cash Flow Statement (Indirect + Direct Methods) & verify Opening Cash + Net CF == Ending Cash
    MCP->>WPEngine: 6. Run OPC/SME Compliance Checks (AU Div 7A / CN Art. 23 / HK Cap. 622 / UK s.455)
    WPEngine-->>MCP: Return Cross-Reconciled 3-Statement Working Paper Pack (`READY_FOR_CPA_SIGNOFF`)
    MCP-->>CPA: Stream complete Working Paper Pack to TypeScript Dashboard
```

## 5. UML State Machine: Working Paper Pack & Three-Statement Lifecycle

```mermaid
stateDiagram-v2
    [*] --> BOOKKEEPING_IN_PROGRESS : Operational Period OPEN

    state "BOOKKEEPING_IN_PROGRESS (日常記帳與銀行對帳)" as BOOKKEEPING_IN_PROGRESS
    state "UNADJUSTED_TB_GENERATED (產出調整前試算表 UTB)" as UTB
    state "AJE_IN_PROGRESS (提列折舊/應計/稅項/公私拆分調整分錄)" as AJE
    state "ETB_AND_SCHEDULES_RECONCILED (延伸試算表與明細底稿勾稽完成)" as ETB_OK
    state "THREE_STATEMENTS_DRAFTED (三大報表底稿產出並通過平衡驗證)" as WP_DRAFT
    state "CPA_SIGNED_AND_LOCKED (會計師/創辦人簽核封存)" as LOCKED

    BOOKKEEPING_IN_PROGRESS --> UTB : Period Cut-off (`SOFT_CLOSE`)\n[Guard: Sum(Unadjusted DR) == Sum(Unadjusted CR)]
    UTB --> AJE : Close Agent Proposes Month-End AJEs\n[W/P C, W/P F, W/P AA, W/P CC, W/P DD]
    AJE --> ETB_OK : Checker Agent Approves AJEs\n[Guard: Sub-ledgers == Control Accounts & Bank Rec Variance == 0]
    ETB_OK --> WP_DRAFT : Working Paper Engine Compiles 3 Statements\n[Guard: Assets == Liab + Equity & Cash Flow Ending == B/S Cash]
    WP_DRAFT --> AJE : CPA / Auditor Requests Additional Adjustment
    WP_DRAFT --> LOCKED : Human CPA Signs Off Working Paper Pack\n[Period transitions to HARD_CLOSE / LOCKED]
```
