# Agentic Accounting System collaboration rules

## Rule entry points

Detailed rules are maintained in `00-rules/`. This file contains the index and hard boundaries only.

| Rule | Canonical location |
| --- | --- |
| Directory responsibilities and naming | [naming-and-structure.md](00-rules/naming-and-structure.md) |
| Product workflow and collaboration | [product-workflow.md](00-rules/product-workflow.md) |
| Requirement statuses and gates | [status-and-gates.md](00-rules/status-and-gates.md) |
| Information ownership and references | [source-of-truth.md](00-rules/source-of-truth.md) |

Update the relevant canonical rule before adjusting its references elsewhere. Follow the general execution requirements and hard boundaries in [product-workflow.md](00-rules/product-workflow.md#collaboration-boundaries), including scope confirmation, source traceability, owner approval for formal transitions, and exclusion of secrets.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph, where a `.codegraph/` directory exists at the repo root, use CodeGraph before grep/find or reading files to understand or locate code.

- MCP: `codegraph_explore` returns relevant symbols' verbatim source and call paths, including dynamic-dispatch hops. Name a file or symbol to read its current line-numbered source. If deferred, load it by name through tool search.
- Shell: `codegraph explore "<symbol names or question>"` provides the same output.

If there is no `.codegraph/` directory, skip CodeGraph. Indexing is the user's decision.
<!-- CODEGRAPH_END -->
