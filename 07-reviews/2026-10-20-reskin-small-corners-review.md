# Small main-canvas corners verification

Date: 2026-10-20. Draft preview refinement under [SRC-0012](../01-inputs/2026-10-20-reskin-small-corners-request.md).

## Observed

- Main-only CSS uses 6px panels, 4px controls/tab groups and 3px bordered badges in both themes. No production components, default application entries or backend were changed.
- Preserves explicit rounded shapes, native checkbox/radio/range/file/hidden inputs, table cells, collapsed table borders, KPI interior dividers, SVG geometry and layout. No overflow clipping was added. Preview Original mode retains square corners.
- TypeScript and standalone preview build passed; 12 adapter/queue unit tests passed.
- [Browser report](../90-assets/reskin-small-corners/checks.json): 61 assertions passed, including all earlier 54 regressions plus computed radii in both themes, square original mode/grid internals/table cells, and an unclipped search dropdown. Zero real accounting API requests.
- First visual pass revealed inherited rounding on an internal KPI divider; excluded grid-section children from corner inheritance and added a regression. Final captures and 61-check run passed.
- Fresh read-only review inspected CSS and all five captures, returned ship for the independent preview with no material style findings. Test results were supplied, not rerun by the reviewer. No production-adoption decision recorded.
- Detector ran once. Only warning was the incumbent Inter font, retained to preserve current frontend typography.

## Subsequent increase under SRC-0013

The owner requested slightly larger corners. Preview tokens are now 10px panels, 6px controls and 4px labels. No selector, layout, table/grid or chart rule changed. TypeScript, standalone build and the updated 61 browser assertions passed again. [Updated browser report](../90-assets/reskin-larger-corners/checks.json), [Dark](../90-assets/reskin-larger-corners/overview-dark.png), [Light](../90-assets/reskin-larger-corners/overview-light.png), [Journal](../90-assets/reskin-larger-corners/journal-light.png). These later token values supersede the original 6/4/3px treatment; earlier captures below are retained as historical evidence.

## Captures

[Dark](../90-assets/reskin-small-corners/overview-dark.png), [Light](../90-assets/reskin-small-corners/overview-light.png), [Original square comparison](../90-assets/reskin-small-corners/overview-original-dark.png), [Journal Light](../90-assets/reskin-small-corners/journal-light.png), [Mobile Settings](../90-assets/reskin-small-corners/mobile-settings-light.png).

Local isolated-Chrome captures of the actual frontend with synthetic fixtures, using the established screenshot fallback and reduced motion. This is focused preview validation, not a complete accessibility or production audit.
