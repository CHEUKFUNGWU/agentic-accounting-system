# Agentic Accounting System - Backend Service

High-performance Enterprise Accounting Engine and Stateless Streamable HTTP MCP Server.

## Features
- Standalone 3-Statement Working Paper Generation (ETB, W/P A~EQ, P&L, Balance Sheet, Dual-Method Cash Flow)
- Mixed Personal/Business Expense Apportionment (`propose_expense_with_personal_split`)
- Maker-Checker Segregation of Duties (SoD) & Cryptographic SHA-256 Hash Chaining
- Stateless Streamable HTTP Model Context Protocol (MCP) server mounted at `/mcp`
- Six-Region Statutory Tax & Internal Control Guardrails (AU, CN, HK, SG, US, EU)

## Quickstart with uv

```bash
uv sync --extra dev
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
