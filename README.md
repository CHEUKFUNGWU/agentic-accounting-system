# Agentic Accounting System product workspace

This repository manages product knowledge, requirements, versions, acceptance, and retrospectives alongside the application source code.

## Current workspace stage

- The English product workflow, directory structure, and collaboration rules are established.
- No formal requirements or version commitments have been registered in this workspace.
- Existing application documentation is retained below. Its claims are not automatically approved product baselines or release evidence.

## Workspace entry points

| Task | Entry point |
| --- | --- |
| Read collaboration rules and workflow | [AGENTS.md](AGENTS.md), [Rules](00-rules/README.md) |
| Register discussions, documents, and other inputs | [Raw inputs](01-inputs/README.md) |
| Find product background and terminology | [Product knowledge](02-product/README.md) |
| Explore the problem space, module map, and decisions | [Planning](03-planning/README.md) |
| View or register candidate requirements | [Requirement pool](04-requirement-pool/README.md) |
| Define and advance an individual requirement | [Requirement work packages](05-requirements/README.md) |
| Plan and track a version | [Versions](06-versions/README.md) |
| Record reviews, acceptance, and retrospectives | [Reviews](07-reviews/README.md) |
| Find shared assets | [Assets](90-assets/README.md) |
| Find closed or superseded materials | [Archive](99-archive/README.md) |
| Open the adopted Monolith UI | [Frontend entry points and verification](docs/monolith-ui.md) |
| Read backend setup instructions | [Backend README](backend/README.md) |
| Set up human logins and agent credentials | [Authentication setup and implementation scope](docs/auth-implementation.md) |

## Application overview

An enterprise-grade **Agentic Accounting System** tailored for **SMEs (中小企)**, **OPCs (One-Person Companies / 一人有限公司 / Single-Director Pty Ltd / Single-Member LLC)**, and **Sole Proprietors (個體工商戶 / 獨資東主 / Sole Traders)** across **China, Hong Kong, Singapore, Australia, North America, and Europe**.

Instead of heavyweight group consolidation, this architecture focuses deeply on **Standalone Entity Bookkeeping**, **Mixed Personal/Business Expense Apportionment (`公私混用拆分`)**, **Owner/Director Loan Compliance (`股東/董事往來內控`)**, and automated generation of **CPA-grade Standalone Three Financial Statement Working Papers (`單體三大報表底稿：延伸試算表 ETB + 明細底稿 W/P A~EQ + 損益表 + 資產負債表 + 現金流量表`)** via **Stateless Streamable HTTP MCP** and a **Hybrid Event-Driven Orchestrator**.

### Core Highlights

1. **Automated Standalone Three Financial Statement Working Paper Engine (`三大報表底稿引擎`)**:
   - **Extended Trial Balance (`ETB 延伸試算表總底稿`)**: Tracks `Opening Balance` $\rightarrow$ `Period Operational DR/CR` $\rightarrow$ `Unadjusted Trial Balance` $\rightarrow$ `Month-End Adjusting Entries (AJE)` $\rightarrow$ `Adjusted Trial Balance (ATB)` $\rightarrow$ deterministic split into `Income Statement (P&L)` and `Balance Sheet (B/S)` columns with Working Paper references (`W/P Ref`).
   - **Lead Schedules (`明細底稿 W/P A ~ W/P EQ`)**:
     - `W/P A`: Cash & Bank Reconciliation Schedule
     - `W/P B`: Accounts Receivable & Aging Schedule
     - `W/P C`: Prepayments & Input VAT/GST Recoverable Schedule
     - `W/P DD / E`: Director's Loan / Owner's Drawings Schedule (with automated commingling & statutory tax risk detection)
     - `W/P F`: Fixed Assets & Accumulated Depreciation Roll-Forward Schedule
     - `W/P AA`: Accounts Payable & Accrued Expenses Schedule
     - `W/P CC`: Statutory Taxes Payable Schedule (GST/VAT, PAYG/1099 Withholding, Income Tax Provision)
     - `W/P EQ`: Owner's Capital / Share Capital & Retained Earnings Roll-Forward Schedule
   - **Three Primary Statements (`損益表 + 資產負債表 + 現金流量表`)**:
     - **Income Statement (`W/P PL-SUMMARY`)**: Multi-step Revenue, Cost of Sales, Gross Profit & Margin %, Operating Expenses, EBITDA, Depreciation, EBT, Tax Provision, and Net Profit.
     - **Balance Sheet (`W/P BS-SUMMARY`)**: Enforces $\text{Total Assets} \equiv \text{Total Liabilities} + \text{Total Equity}$ (`Variance == 0.0000`).
     - **Dual-Method Cash Flow Statement (`W/P CFS-SUMMARY`)**: Simultaneously computes both the **Indirect Method** (IFRS IAS 7 / US GAAP ASC 230) and **Direct Method** (PRC CAS / 《小企業會計準則》), verifying $\text{Opening Cash} + \text{Net Cash Change} \equiv \text{Ending Balance Sheet Cash (`W/P A`)}$.

2. **OPC, Sole Proprietor & SME Specific Guardrails Across 6 Regions**:
   - **Mixed Personal/Business Expense Split (`propose_expense_with_personal_split`)**: Automatically splits home office, internet, vehicle, travel, or corporate card receipts into **Business Deductible %** (with proportional VAT/GST credit) and **Personal %** (routed to `2190 Director's Loan` or `3200 Owner's Drawings` with `0%` tax credit).
   - **Australia (`AU`)**: AASB Tier 2, ATO **Division 7A** Debit Director Loan warning, **47% No-ABN PAYG Withholding**, $20k Instant Asset Write-Off, and BAS (`G1/1A/1B/W1/W2`).
   - **Mainland China (`CN`)**: 《小企業會計準則》 / PRC CAS, **Article 23 of PRC Company Law (新公司法第23條一人公司財產混同連帶責任)** commingling check, Golden Tax Phase IV 20-digit Digital Fapiao check, and Small-Scale Taxpayer (`小規模納稅人`) VAT relief.
   - **Hong Kong (`HK`)**: SME-FRS / HKFRS, **Companies Ordinance Cap. 622 s.380 Director's Loan disclosure**, Territorial Source (`ONSHORE` vs. `OFFSHORE`), and Two-Tiered Profits Tax (`8.25%` / `16.5%`).
   - **Singapore (`SG`)**: SFRS for Small Entities, IRAS **Start-Up Tax Exemption (SUTE)** / Partial Tax Exemption, 9% GST & Reverse Charge, and InvoiceNow (Peppol).
   - **North America (`US`/`CA`)**: US Single-Member LLC (**IRS Schedule C**) vs. S-Corp, Multi-State Sales & Consumer Use Tax accrual, 24% IRS 1099 Backup Withholding; Canada CCPC Small Business Deduction & GST/HST/PST.
   - **Europe (`EU`/`UK`)**: IFRS / FRS 102 Section 1A / FRS 105, **UK CTA 2010 s.455 (33.75% overdrawn Director's Loan tax)**, EU Intra-Community Reverse Charge, VIES & SAF-T.

3. **Stateless Streamable HTTP MCP + Event-Driven Agent Orchestrator**:
   - Built on [`modelcontextprotocol/python-sdk`](https://github.com/modelcontextprotocol/python-sdk) (`stateless_http=True`) following the [MCP Streamable HTTP Specification (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), paired with a PostgreSQL `LISTEN/NOTIFY` Transactional Outbox Orchestrator.

### Application repository structure

```text
agentic-accounting-system/
├── README.md                          # Overview & quickstart
├── docs/
│   ├── ARCHITECTURE.md                # SME/OPC/Sole Trader architecture & 3-Statement Working Paper Engine
│   ├── UML.md                         # Mermaid UML diagrams (Component, Class, Sequence, State Machine)
│   └── ERD.md                         # Mermaid ERD & data dictionary (ETB, Lead Schedules, 3 Statements, W/P DD)
├── database/
│   └── schema.sql                     # PostgreSQL 16+ DDL, Working Paper tables & balance proof triggers
├── backend/
│   ├── pyproject.toml                 # Python 3.11+ dependencies (FastAPI, mcp, SQLAlchemy, asyncpg)
│   └── app/
│       ├── main.py                    # FastAPI app mounting Stateless MCP (/mcp) + Working Paper REST API
│       ├── mcp_server.py              # Stateless MCP Server (Tools, Resources, Prompts for 3-Statement Workpapers)
│       ├── core/
│       │   ├── working_papers.py      # Standalone 3-Statement & ETB Working Paper Engine (P&L, B/S, Cash Flow)
│       │   ├── sod_guard.py           # Deterministic Double-Entry, Control Account & Maker-Checker SoD Guard
│       │   └── localization.py        # 6-Region Tax & Compliance Engine (CN, HK, SG, AU, NA, EU)
│       └── orchestrator/
│           └── event_bus.py           # Hybrid Transactional Outbox Event-Driven Orchestrator
└── frontend/
    ├── package.json                   # TypeScript + React (Vite) configuration
    ├── tsconfig.json                  # Strict TypeScript configuration
    └── src/
        ├── types/
        │   └── accounting.ts          # TypeScript interfaces for ETB, 3 Statements, Lead Schedules & Compliance
        ├── api/
        │   └── client.ts              # FastAPI Working Paper & Mixed Expense Split API client
        └── components/
            └── AgentGovernanceDashboard.tsx # Interactive 3-Statement Working Paper, ETB & Lead Schedule UI
```
