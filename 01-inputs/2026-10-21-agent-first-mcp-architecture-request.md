# Agent-first MCP architecture request

- Source ID: SRC-0017
- Received: 2026-10-21
- Provider: repository owner via this conversation
- Scope: open-source distribution, deployment and storage topology, MCP connection identity, multi-tenant identity and tiered autonomy

## Original messages

On integrating Supabase:

> 你是專業的Head of AI Engineer & information system engineer。 我想把supabase給融入我們的agentic accounting system，你覺得如何？

On self-hosting:

> supabase是開源的，我們自託管可以的吧？

On the product goal:

> 我就是打算做一套開源的agentic accounting system。別人可以直接拿去用

> 我的目標是給各種AI Agent根據MCP接入，覆蓋掉大部分人手工作

The documentation instruction:

> Write the agent-first MCP architecture (OAuth for MCP connections, tiered autonomy policy, multi-tenant identity, standard Postgres with Supabase optional) as a 01-inputs requirement record and an ADR. List the license and autonomy thresholds as open decisions for me.

## Assistant analysis given in the conversation

The assistant's replies were recommendations, not owner decisions. In summary:

1. Supabase should be one optional hosting target. The core should run on SQLite (desktop) or standard PostgreSQL and use no Supabase-specific feature.
2. Agents must reach the system only through domain-level MCP tools. They must never get database-level MCP or SQL tools such as the Supabase MCP server.
3. Gaps for accepting arbitrary agents: OAuth 2.1 for MCP connections, credentials scoped to tenant × entity × position, a configurable autonomy policy, a durable work queue, structured error codes, idempotency, and an evaluation dataset.
4. Prerequisites for open source: a license, versioned database migrations, no built-in default secrets, full data export, and versioned tax rule packs with a professional-advice disclaimer.

## Interpretation

- Observed: the owner intends to publish the system as open source for others to deploy and use directly.
- Observed: the owner's goal is for a range of AI agents to connect through MCP and take over most manual accounting work.
- Observed: the owner asked for the four named architecture elements to be recorded, with the license and autonomy thresholds left as decisions for the owner.
- Inferred: open-source distribution raises the cost of every required runtime dependency, because adopters bear the deployment.
- To confirm: the license; autonomy thresholds and default posture; whether an agent may act as a checker (see the conflict below); tenancy isolation model; OAuth authorization-server choice; the first two MCP clients for interoperability testing; release rights for the supplied Monolith UI ([SRC-0002](2026-10-17-monolith-ui.md)) and reference assets in `90-assets/`.
- Not covered: implementation, requirement status changes, release commitment, choice of hosting provider, and statutory or tax approval.

## Conflict to resolve

The assistant's conversation reply described an "agent review" tier in which a checker agent approves ordinary entries. That conflicts with:

- [SRC-0005](2026-10-18-roadmap-request.md): "其餘由人覆核" (everything not auto-posted is reviewed by a person).
- [Accounting control matrix](../03-planning/accounting-control-matrix.md#提案與批准狀態): non-human agents cannot call the human approval endpoint, and a policy executor must not pose as a human checker.

The ADR keeps the confirmed baseline and records the agent-checker question as an open decision. It does not reconcile the two silently.

## Owner decision 2026-10-21

After the assistant recommended keeping approval with a person, the owner replied:

> Agreed: anything outside auto-post policy is approved by a human; the checker agent pre-reviews and advises only. Record this in ADR-0001 and the control matrix, then close the MCP gap so agent credentials can't approve, with a regression test.

- Observed: ADR-0001 open decision O2-g is resolved. Approval of anything outside an auto-post policy requires a human, and a checker agent may only pre-review and advise. This resolves the conflict above in favour of the confirmed baseline.
- Observed: the owner authorized a code fix that blocks agent credentials from approving, with a regression test.
- Not covered: the remaining O2 thresholds, O1 license, and approval of ADR-0001 as a whole.

## Owner decision 2026-10-21: one-person company profile

After the assistant recommended external-accountant review for an owner's own entries, the owner replied:

> OPC不需要外部會計師看，他們年末會找會計師做審計報告的，所以沒什麼關係，讓他們方便的用，把我們Repo的名聲給傳出去先～

After the assistant proposed a one-person company profile, the owner instructed:

> Record the one-person company profile as my decision: the owner can approve their own entries (flagged as self-approved), no external accountant review, agents still can't approve, one policy approval from the owner, lighter shadow mode, and the year-end audit pack. Update ADR-0001 O2-f/O2-h, BL-31

- Observed: for one-person companies, the owner may approve entries they created; such approvals are flagged as self-approved. No external accountant review is required.
- Observed: agents still cannot approve, consistent with O2-g above.
- Observed: one approval from the owner is enough to enable or change an automatic posting policy, and the shadow-mode bar is lighter than for other entities.
- Observed: a year-end audit pack is in scope as a product capability.
- Observed: the owner's priority is ease of use and adoption of the open-source project.
- Inferred: the rationale is that a one-person company has no internal segregation of duties to protect. The year-end audit premise holds for Hong Kong but generally not for Australian proprietary companies, US single-member LLCs or small Singapore companies, which usually have no audit. The decision stands on the first rationale.
- To confirm: which legal entity types count as one-person companies in each market, including sole traders; the exact lighter shadow-mode bar (the assistant proposed 10 consecutive agreeing samples per template); and the Mainland audit requirement for one-person companies under the current Company Law.
- Not covered: implementation. The current position model routes one-person-company review to the external CPA position, and the founder position cannot review; code changes are not yet made.

## Owner decision 2026-10-21: remaining recommendations

The owner deferred the license:

> 開源license的問題先擱置一下。我再想想

The owner then adopted the assistant's remaining recommendations:

> 其他都照你建議～

The adopted recommendations, as given in the conversation, are:

1. Commit this session's work as four separate commits, `.gitignore` first, leaving other uncommitted work untouched.
2. Accept the ADR-0001 direction (D1 to D6) now; O1, O3 and O4 stay open.
3. Autonomy thresholds for entities other than one-person companies (O2-a to O2-f, O2-h), recorded in [ADR-0001 O2](../03-planning/adr-0001-agent-first-mcp-architecture.md#o2-自主權門檻).
4. Voucher numbering for BL-36: drafts use a separate draft ID; the voucher number is allocated at posting under a unique constraint, with no gaps.
5. Keep third-party UI reference screenshots in `90-assets/ui-references/` out of the public repository.
6. Register GAP-01 to GAP-07 and open-source release preparation as requirement candidates, with the proposed priorities.
7. Development order: high-severity BL fixes first, then BL-30 with master-data governance and the agent pre-review tool, then opening external agent access (REQ-0006).

- Observed: the owner adopted the items above and deferred O1 (license).
- Inferred: "其他" excludes the license, which the owner had just deferred, and the one-person company profile, which was decided separately above.
- Inferred: two further suggestions from the same conversation are registered as candidates under item 6: implementing the one-person company profile with the year-end audit pack, and the first-run experience (one-command install, demo company, connecting an MCP client within minutes).
- To confirm: the bank-fee per-item limit (suggested starting point CNY 200 or AUD 50) and the voucher number format, with an accounting lead; whether the Monolith UI ([SRC-0002](2026-10-17-monolith-ui.md)) was created by the owner or by a third party.
- Not covered: actions only the owner can take. These are: appointing an accounting lead; telling the colleague about the human-approver change and agreeing who edits `monolith.py`; and recording the textbook edition in [SRC-0018](2026-10-21-ais-textbook-gap-review-request.md).

## Owner decision 2026-10-21: contribution policy

> 另外我不想讓所有人都能提交pull request。他們可以提issue。我一個人是無法處理那麼多PR的。

- Observed: anyone may open issues; pull requests are not open to everyone. The reason is the owner's review capacity as the sole maintainer.
- Inferred: with outside code contributions closed, contributor terms (CLA or DCO under O1) matter much less, and the owner keeps the freedom to relicense later.
- To confirm: who may submit pull requests (the owner only, or invited collaborators); and which repository-host mechanism enforces it. The assistant has not verified current GitHub settings.
- Not covered: changes to repository settings, a CONTRIBUTING file, or issue templates.

## References

- [ADR-0001: Agent-first MCP architecture](../03-planning/adr-0001-agent-first-mcp-architecture.md)
- Related candidates in the [requirement pool](../04-requirement-pool/requirement-pool.md): REQ-0002, REQ-0003, REQ-0006, REQ-0007, REQ-0008, REQ-0016 and REQ-0023.
