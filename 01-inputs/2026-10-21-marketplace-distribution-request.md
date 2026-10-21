# Marketplace distribution request

- Source ID: SRC-0021
- Received: 2026-10-21
- Provider: repository owner via this conversation
- Scope: distributing the MCP servers through the ChatGPT and Claude plugin or connector directories, and the permission model for those clients

## Original messages

> 我有點好奇，是否能把我們的agentic accounting system的MCP做成Plugins upload到ChatGPT和Claude的plugin market，但是那個權限得如何設計呢，需不需要讓用戶綁定固定chatgpt/claude裡的thread/session id

After the assistant's answer, the owner asked:

> Record the marketplace distribution and permission design as a candidate requirement, with an ADR-0001 note

## Reference material

Read on 2026-10-21:

- OpenAI, "Upload and submit your plugin": <https://developers.openai.com/plugins/deploy/submission>. Primary source.
- Storyflow, "ChatGPT Apps vs Connectors vs MCP Servers, Explained": <https://storyflow.so/blog/chatgpt-apps-vs-connectors-vs-mcp-servers-explained-2026>. Secondary source.
- Search results from Sunpeak and MCPJam on Claude Connectors Directory submission. Secondary sources; the Anthropic page itself was not read.
- Claude Help Center, "Get started with custom connectors using remote MCP": <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>. Read only as a search-result summary.
- MCP SEP-1036, URL mode elicitation: <https://modelcontextprotocol.io/seps/1036-url-mode-elicitation-for-secure-out-of-band-intera>. Read only as a search-result summary.

## Interpretation

### Platform facts

- Observed (OpenAI documentation):
  - a ChatGPT plugin is submitted as a ZIP and can contain MCP connections, skills or both;
  - submission requires domain verification, a verified developer identity and review test cases;
  - when sign-in is required, it also requires a dedicated reviewer test account with sample data;
  - after publication, changes to the hosted MCP server's tools are picked up through automated scans.
- Inferred (secondary source): ChatGPT replaced its app directory with a plugin directory in July 2026.
- Inferred (secondary sources): the Claude Connectors Directory takes submissions from Team or Enterprise organizations. Any user can add a remote MCP server by URL as a custom connector.
- Inferred: a directory listing points at one public HTTPS MCP server. Listing therefore implies a hosted service that keeps customers' books. Self-hosted instances each have their own URL and would connect as custom connectors instead.

### Permission design

Recorded as a proposal. The owner has not decided it.

1. Identity comes from the OAuth grant of [ADR-0001 D2](../03-planning/adr-0001-agent-first-mcp-architecture.md#d2-mcp-連線採-oauth-21), not from a host thread or session ID. The reasons:
   - the server cannot verify a thread ID;
   - the MCP `Mcp-Session-Id` identifies a transport connection, not a conversation;
   - binding to a thread does not stop prompt injection inside that thread.

   A host-supplied conversation reference may be stored as audit metadata only.
2. Every call from ChatGPT or Claude is an agent call, even when the owner typed the instruction. The host's own confirmation dialog is not verifiable server-side. This follows O2-g.
3. Third-party clients may be granted read and propose scopes only. Approve, reject, post, period close, policy and credential administration are never granted to them.
4. Approval happens in the system's own interface after its own sign-in, optionally through MCP URL mode elicitation. One-person company self-approval also happens there and is flagged.
5. Each host gets a separate grant, bound to a tenant, entities and a position, revocable on its own. The O2-d rate limits apply per grant.
6. Tool outputs enter the host model's context. Outputs are minimised, bank account numbers are masked, and the privacy policy says so. Tools carry read-only or non-destructive annotations.

### Status

- Inferred: the proposal needs OAuth (D2) and multi-entity scope (D3), and neither is implemented. Current credentials are static `aas1.` keys bound to a single entity.
- To confirm:
  - whether a hosted service will be offered, which is the prerequisite for any directory listing;
  - whether ChatGPT and Claude support URL mode elicitation;
  - Anthropic's current directory requirements, from its own documentation.
- Not covered: pricing, data-processing agreements, and jurisdiction-specific data residency for a hosted service.
