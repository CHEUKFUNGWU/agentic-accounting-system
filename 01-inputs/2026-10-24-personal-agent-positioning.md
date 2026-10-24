# Personal agent positioning and paying customer

- Source ID: SRC-0022
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: product positioning for personal agents (ChatGPT, Claude and similar), target markets, paying customer and the accountant's role

## Original messages

> 你是專業的AI Agent專家和商業分析師。我感覺2026年下半年的Personal Agent大爆發，有一種感覺，做AI Agent不值錢，給Personal Agent寫應用更有市場

After the assistant's answer:

> 我在想的是一些更專業的應用。例如我們的accounting system

The assistant asked which jurisdiction to target and whether accountants or bookkeepers would pay. The owner answered:

> 1.澳洲，香港，中國大陸，新加坡。
>
> 2. 我覺得會計師和記賬員沒有興趣付錢，有興趣的是一些小企業，OPC

The owner then agreed to record this input and to review a draft PRODUCT.md change before it is applied.

### Owner decision (2026-10-24)

After reviewing the recorded conflicts and the draft, the owner wrote:

> 市場順序維持 SRC-0005，北美保留；PRODUCT.md 照草稿寫入

The owner then gave the reason:

> 我覺得最主要是我更熟悉香港和中國大陸，所以沒有採納優先澳洲～

- Observed: the market order stays as recorded in [SRC-0005](2026-10-18-roadmap-request.md): Mainland China, Hong Kong, Australia, North America. North America is kept. The assistant's suggested order below was not selected.
- Observed: the PRODUCT.md `Users` change was approved and applied.
- To confirm: where Singapore fits in the SRC-0005 order. The decision did not place it.

## Interpretation

### Owner statements

- Observed: the owner named Australia, Hong Kong, Mainland China and Singapore as target markets. The message does not say whether the list is an order.
- Observed: the owner expects small businesses and one-person companies (OPC) to pay, and does not expect accountants or bookkeepers to pay.

### Assistant analysis

Recorded as analysis. The owner has not decided any of it.

- Inferred: as personal agents absorb general planning and tool use, value moves to systems that hold state the agent must trust: a correct ledger, evidence, approval records and jurisdiction rules. The MCP server is the distribution channel; the controls and the hosted service are what is defensible. The code is open source and is not itself a moat.
- Inferred: the product has three parties. The owner's personal agent submits documents and proposals; the system validates and keeps the record; a human approves.
- Inferred: if OPCs pay and accountants are not in the daily loop, the owner is the daily approver. This is consistent with the one-person company profile already decided in [ADR-0001](../03-planning/adr-0001-agent-first-mcp-architecture.md) (O2, [SRC-0017](2026-10-21-agent-first-mcp-architecture-request.md)). A non-accountant owner may approve without reading, so routine items should go through deterministic policies and exceptions should be explained in plain language.
- Inferred: accountants still appear at statutory points (Hong Kong annual audit, Mainland agency bookkeeping, tax agent lodgment in Australia). The assistant suggested treating them as invited, non-paying collaborators and as a referral channel.
- Inferred: Mainland China differs structurally: ChatGPT and Claude are unavailable, domestic agent platforms are used instead, data must be hosted in China, and VAT invoicing is central. It may need a separately deployed edition.
- Inferred: the assistant suggested the order Australia, Singapore, Hong Kong, Mainland China, mainly because ChatGPT and Claude directories reach Australia and Singapore directly and both use Peppol e-invoicing.

## Conflicts for the owner

Both conflicts were resolved by the owner decision of 2026-10-24 above.

- Market order: [SRC-0005](2026-10-18-roadmap-request.md) remains the baseline (Mainland China, Hong Kong, Australia, North America). This input had added Singapore without naming North America, and the assistant had again suggested starting with Australia.
- Audience: [PRODUCT.md](../PRODUCT.md) previously named accountants as the primary audience. It now separates the paying customer (small business, OPC) from the reviewing user.

## To confirm

- Where Singapore fits in the SRC-0005 market order.
- Whether a hosted service will be offered (ADR-0001 O5, REQ-0034); a paying-OPC model and directory listing both depend on it.

## Not covered

- Pricing, willingness-to-pay evidence and customer interviews.
- Market-specific legal entity types, audit thresholds and tax rules; see [SRC-0007](2026-10-18-roadmap-primary-sources.md) for the existing research, which does not cover Singapore.
- Facts about the personal agent market after the assistant's knowledge cutoff (June 2026). No web research was done for this input.
