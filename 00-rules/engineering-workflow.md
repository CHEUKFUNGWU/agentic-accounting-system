# Engineering workflow

How agents and people change this repository. It adapts two public agent workflows to an accounting system:

- Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack): route each request to a playbook, keep every playbook step visible, verify against the real artifact, and review the diff before reporting success.
- Matt Pocock's engineering skills: grill to shared understanding, write a spec, design deep modules at agreed seams, slice into tracer-bullet tickets, build test-first, and review on two axes.

The product workflow, status gates and source rules still apply. This file covers how the work is done, not who approves it.

## 1. Route the request

Classify the request before acting. Copy the matched playbook's steps into the task list in order. If you skip a step, keep it in the list with the reason.

| Request | Playbook |
| --- | --- |
| A question about how or why something works | [Investigation](#investigation) |
| Something is broken, including an audit finding (BL-XX) | [Bug fix](#bug-fix) |
| New or changed behaviour | [Feature](#feature) |
| Change structure without changing behaviour | [Refactor](#refactor) |
| A fact that only an experiment can settle | [Prototype](#prototype) |
| A decision, plan, review or source record | [Record](#record) |

Size decides how much ceremony a feature needs:

| Size | Test | Steps you may skip, with the reason recorded |
| --- | --- | --- |
| Small | One module, behaviour is obvious, no accounting control touched | Spec, design and tickets |
| Medium | Several modules or a new interface, one session | Tickets |
| Large | More than one session, or several independent parts | None. Plan with decision tickets before building. |

Any change to an accounting control (see [§3](#3-accounting-invariants)) counts as at least Medium.

## 2. Playbooks

### Investigation

Read-only. Do not change code.

1. **How.** Trace the runtime path from the entry point (REST route, MCP tool, Monolith command) through to storage. Name the modules, the data shapes and the sharp edges.
2. **Why.** Look for intent in Git history, [source records](../01-inputs/source-register.md), ADRs in `03-planning/` and reviews in `07-reviews/`. If you found no recorded reason, say so.
3. **Answer.** Label each claim `Observed`, `Inferred`, `To confirm` or `Not covered`, with the file and line or the source ID.

### Bug fix

1. **Reproduce** on the surface where the bug was reported (API, MCP or UI). For an audit finding, reproduce the scenario in the review record.
2. **Write a failing test** at the highest seam that shows the bug. Confirm it fails for the reported reason.
3. **Find the root cause.** List competing explanations and rule them out with evidence. When two fixes built on one assumption have failed, test that assumption directly before writing a third.
4. **Fix the cause**, not the symptom. A guard counts as a fix only when the state it handles is legitimate.
5. **Verify** with the original reproduction and the full test suite.
6. **Record evidence.** For a BL finding, tick its box in the review record with the test name and commit. Do not tick a finding you did not verify.

### Feature

1. **Ground.** Read the pool entry, the work package, the ADRs in the area, and the [control matrix](../03-planning/accounting-control-matrix.md). Trace the current code with the Investigation steps.
2. **Grill.** Resolve open questions one at a time, each with your recommended answer. Look up facts yourself. Put decisions to the owner and wait. Stop when you share an understanding of the result.
3. **Spec.** Write or update the PRD in the work package `05-requirements/req-XXXX-short-name/`. It contains:
   - the problem and the solution, from the user's side;
   - user stories, including the agent, the human reviewer and the auditor;
   - implementation decisions: modules, interfaces, schema and API contracts, without file paths;
   - testing decisions: the seams under test, agreed with the owner;
   - accounting controls affected, with control matrix IDs;
   - exclusions, open questions and source IDs.
4. **Design.** Sketch two or three interface shapes, starting from how callers use them. Prefer a deep module: a small interface over a lot of behaviour. Put tests at the fewest, highest seams. Use existing seams before adding new ones.
5. **Slice.** Split the spec into tracer-bullet tickets. Each ticket is a narrow path through every layer it needs, can be verified on its own, fits one session and lists the tickets that block it. Do any prefactoring first. A wide mechanical change goes expand, migrate, contract instead.
6. **Build test-first.** For each ticket: one failing test at an agreed seam, then the least code that passes it, then the next. Tests assert behaviour that callers can observe, with expected values from an independent source such as a worked accounting example. Refactor during review, not inside the loop.
7. **Verify on the real interface.** Call the API, MCP tool or UI as a user or agent would. A passing type check or a mocked test is not enough.
8. **Review.** Run the [review](#4-review) before reporting done.
9. **Deliver.** Commit to a branch with a message that cites the REQ and source IDs. Store acceptance evidence in `07-reviews/` and link it from the work package.

If implementation keeps forcing casts, always-present optional fields, special cases or parameters the design did not expect, the design is wrong. Go back to step 4.

### Refactor

1. **Pin behaviour** with characterization tests, or with the existing suite if it covers the path.
2. **Subtract first.** Delete dead code and one-caller wrappers before adding structure.
3. **Move in small steps**, running the pinned tests after each.
4. **Migrate callers, then delete** the old interface in the same change. Do not leave both forms.
5. **Review** for depth and locality: did the change shrink interfaces and gather what changes together?

### Prototype

Build the smallest throwaway artifact that answers one question, such as a layout, a query plan or a parser's behaviour on real documents. State the question first and the answer last. A prototype is evidence for a decision, not production code or adoption ([product workflow](product-workflow.md)). Keep UI prototypes under `90-assets/` or as separate frontend entry points.

### Record

For decisions, plans, reviews and source records:

1. Register the input in the [source register](../01-inputs/source-register.md) and preserve the original words.
2. Write in the maintained home given by [source-of-truth.md](source-of-truth.md). Link instead of copying.
3. Label conclusions. Record conflicts with earlier sources instead of reconciling them silently.
4. Check that every relative link and anchor resolves.

## 3. Accounting invariants

Every playbook protects these. A test that needs one weakened is a wrong test, not a reason to weaken the control.

- Every posted entry balances: total debits equal total credits, in exact decimal money.
- Posted entries are never edited or deleted. Corrections go through reversal or the correction workflow.
- Closed and locked periods reject postings. Document date and accounting date are separate.
- The maker never approves their own entry. The only exception is the one-person company profile, where self-approval is allowed and flagged ([ADR-0001](../03-planning/adr-0001-agent-first-mcp-architecture.md)).
- Agents never approve, reject or escalate. Only humans do, or an automatic policy the owner approved. Tests that approve use human principals.
- Commands are idempotent, and a timeout is resolved by querying with the same key, not by retrying with a new one.
- The audit trail and hash chain record every state change and are never rewritten.
- Agents reach the system only through domain MCP tools. They never get SQL, database MCP servers or direct storage access.

## 4. Review

Review every change before reporting it done. Run each axis in a separate subagent where the tool allows, so they don't bias each other. Then read the diff yourself. You own what the subagents found.

| Axis | Question |
| --- | --- |
| Spec | Does the change do what the spec or finding asked, and nothing it did not ask? |
| Standards | Does it follow this repo's rules and the surrounding code's idiom? Check for unclear names, duplication, shallow wrappers, speculative generality and scattered edits. |
| Controls | Does any path bypass an invariant in [§3](#3-accounting-invariants)? Try the counterexamples in the control matrix: split amounts, replay, privilege escalation and instructions hidden in documents. |

Treat automated review comments with skepticism. Fix the real ones and dismiss the rest with a concrete reason.

## 5. Evidence before "done"

Report a change as done only with evidence from this session:

- Backend: `cd backend && uv run --extra dev pytest -q`, and `uv run --extra dev ruff check` on the files you touched. The codebase had 688 existing ruff errors on 2026-10-21; add no new ones, and clean up a file only as its own change.
- Frontend: `cd frontend && npm run build:web` and `npm run test:monolith`.
- Behaviour: the reproduction or real-interface check from the playbook.

Give each claim its evidence or its label in the same sentence. Name anything not run or not verified. Never hand the owner a check you could have run.

## 6. Autonomy

Proceed without asking on reversible work inside the requested scope: reading, running tests, editing on a branch, local commits the owner asked for.

Always stop for the owner before:

- pushing, merging into `main`, force-pushing or deleting branches;
- deleting data or files you did not create;
- publishing, sending messages or changing repository settings;
- a formal status transition or any owner decision ([status-and-gates.md](status-and-gates.md));
- changing an accounting control, an autonomy threshold or a permission.

If a fact can be settled by running something, run it instead of asking. Ask only for product or preference decisions. When asked for an opinion, give your real judgment, including "no".

## 7. Delegation

- Send wide searches and independent reviews to subagents. Keep summaries, not raw output, in the main thread.
- Give each subagent the brief, every later instruction and file paths. Start a fresh subagent for each new round rather than resuming an old one.
- Two writers never edit the same files at once.

## 8. Writing

- Short declarative sentences. One idea per sentence.
- Match the surrounding code's comment density. A comment explains a non-obvious reason, not what the code does.
- Never invent a link, citation or result. Link only what you produced or read.
- Commit messages and PR descriptions say what changed for the user and the maintainer, cite REQ, BL and SRC IDs, and list what was verified.

## 9. Issues and pull requests

The project is open to issues from anyone. Pull requests are limited to the owner and invited collaborators ([ADR-0001 D6](../03-planning/adr-0001-agent-first-mcp-architecture.md#d6-開源發布的前提)).

Triage an incoming issue into one category, `bug` or `enhancement`, and one state:

| State | Meaning |
| --- | --- |
| `needs-triage` | The owner has not evaluated it |
| `needs-info` | Waiting on the reporter |
| `ready-for-agent` | Fully specified; an agent can take it through a playbook |
| `ready-for-human` | Needs a person, such as an accounting judgment or an owner decision |
| `wontfix` | Will not be done, with the reason |

An enhancement that needs definition becomes a candidate in the [requirement pool](../04-requirement-pool/requirement-pool.md), with the issue registered as a source.

## 10. Improve the workflow

When you give the same instruction a second time, encode it as a test, a lint rule or a script instead of more text. Change this file when a playbook step keeps getting skipped or keeps failing, and record why in the commit message.
