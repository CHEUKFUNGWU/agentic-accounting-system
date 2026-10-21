# Agent workflow request

- Source ID: SRC-0020
- Received: 2026-10-21
- Provider: repository owner via this conversation
- Scope: how agents and people change the repository; `AGENTS.md` and the engineering workflow rule

## Original message

> 幫我設計一份AGENTS.md。我覺得至少我們的流程應該要像curosr的poteto的pstack，matt-pocock的spec/codebase design/code review工作流

## Reference material

- Lauren Tan (poteto), pstack, a Cursor plugin: <https://github.com/cursor/plugins/tree/main/pstack>. Read on 2026-10-21 through its `poteto-mode` skill and Flavio Copes' overview, <https://flaviocopes.com/pstack/>.
- Matt Pocock's engineering skills, read from the locally installed copies on 2026-10-21: `grilling`, `to-spec`, `to-prd`, `to-tickets`, `codebase-design`, `tdd`, `implement`, `code-review`, `triage`, `wayfinder`.
- The rule paraphrases these workflows. It does not copy their text.

## Interpretation

- Observed: the owner asked for an `AGENTS.md` whose workflow at least matches pstack and Matt Pocock's spec, codebase-design and code-review workflows.
- Inferred: the detailed workflow belongs in a new canonical rule, [engineering-workflow.md](../00-rules/engineering-workflow.md), because `AGENTS.md` indexes rules in `00-rules/`.
- Inferred adaptations:
  - specs live in requirement work packages, not in an issue tracker, per [source-of-truth.md](../00-rules/source-of-truth.md);
  - code review gains a third axis for accounting controls;
  - pstack's "just do it" autonomy is narrowed by the existing collaboration boundaries;
  - Cursor-specific parts are left out: per-role model assignment, `/setup-pstack` and model arenas.
- To confirm: whether issue labels and a public issue template should be set up on GitHub; whether a domain glossary (Matt Pocock's `CONTEXT.md`) should be written in `02-product/`.
- Not covered: installing pstack or the skills for other contributors, and repository settings.
