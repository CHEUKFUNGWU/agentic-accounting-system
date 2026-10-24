# Main canvas small-corner request

Source: SRC-0012. Received 2026-10-20, repository owner via chat.

## Original instruction

> 我想把主畫面的原素從直角變成小圓角

Observed: Refine main-canvas elements in the current independent reskin preview, extending SRC-0010 and SRC-0011. No change to production adoption or business behavior.

Inferred: Use 6px panel corners, 4px controls and 3px small badges, scoped to the preview main area and both themes. Preserve existing explicit rounded shapes, checkbox/radio controls, table grid geometry, SVG/chart shapes and overall layout. Original comparison stays square.

To confirm: final production adoption. Not covered: new layouts, larger rounded cards, changing sidebar geometry, clipping interactive content or modifying production components.
