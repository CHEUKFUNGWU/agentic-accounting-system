# Existing frontend reskin preview request

Source: SRC-0010. Received 2026-10-20, repository owner via chat. This supersedes SRC-0009 as the active direction for this task; prior inputs and artifacts remain historical records.

## Original instructions

> 忘掉这个prototype以及原有的prototype。用我们产品已有的前端设计，套之前给你发的那张图片的左侧side pane和主画面

After the assistant confirmed actual existing frontend components, navigation and interactions, rather than the blueprint-derived prototype, and asked about scope:

> 先做现有前端的独立换肤预览

The [previously supplied screenshot](../90-assets/ui-references/2026-10-20-sidebar-canvas-reference.png) remains the sidebar/canvas visual reference. Light / Dark remains requested by the preceding clarification.

## Scope interpretation

Observed: Reuse the actual existing frontend. Independent preview only, not a new product UX or a replacement of the default frontend. No production changes authorized.

Inferred implementation boundary: Directly mount existing `frontend/src/monolith/App.tsx` and its 15 modules unchanged. Preview-only CSS skins sidebar/canvas and coordinates theme colors. Reuse the existing synthetic seed through an isolated in-memory adapter. Business writes are blocked, while appearance preferences work locally. A preview-only Original / Reskin switch permits comparison without replacing components.

To confirm: adoption of the skin, full production rollout and business-write behavior. Not covered: new navigation, new business flows, backend integration, original prototype reuse or live accounting.
