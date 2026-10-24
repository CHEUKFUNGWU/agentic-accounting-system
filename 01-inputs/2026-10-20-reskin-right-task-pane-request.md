# Reskin preview right task pane request

Source: SRC-0011. Received 2026-10-20, repository owner via chat. Extends [SRC-0010](2026-10-20-existing-frontend-reskin-request.md), not a replacement of its existing-component boundary.

## Original instruction

> 感覺不錯。這次可以考慮把之前prototype的右側欄加上

The user attached [this screenshot](../90-assets/ui-references/2026-10-20-right-task-pane-reference.png), copied unchanged from the provided local attachment. Its right pane contains a pending queue, search, pending/all filters and selected rows.

## Interpretation and limits

Observed: The owner likes the existing frontend reskin and requests adding the earlier prototype's right-pane idea.

Inferred: Add a collapsible, theme-aware task pane outside the unchanged existing App. Populate it from the existing synthetic Agent Queue rather than importing earlier prototype data or rebuilding the central review UI. A selection opens the task's actual existing destination module. Narrow screens use a dismissible drawer rather than compressing the accounting tables.

To confirm: production adoption, record-level deep links and future writable review flows. Not covered: restoring the earlier prototype architecture, live accounting, adding approval capabilities, or changing the actual product frontend.
