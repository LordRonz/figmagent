# Figmagent

Figmagent is a local-only Figma plugin that turns the current selection into precise, platform-neutral context for an LLM. It produces a compact `FIGM/1` document, readable JSON, reference screenshots, SVG assets, and original raster images. `FIGM` means **Figma Implementation Graph Markup**; see the [FIGM/1 format guide](docs/FIGM-1.md).

It runs in Figma Design, Dev Mode, and Figma for VS Code. It has no backend, telemetry, account, or runtime dependency.

## Set up

Requirements: current Node.js/npm and the current Figma desktop app for local plugin registration.

1. Install and build:

   ```sh
   npm install
   npm run check
   ```

2. In Figma desktop, choose **Plugins → Development → Import plugin from manifest…** and select this repository's `manifest.json`.
3. Select a layer or frame and run **Figmagent**. **Copy for AI** or **Copy JSON** prepares the selection and copies the result when it is ready. **Download handoff** creates a FIGM-and-assets ZIP; **Assets** exposes individual downloads.

Run `npm run dev` while editing the plugin sandbox. Re-run `npm run build` after UI changes, then use Figma's development-plugin reload.

## Output

Both text formats come from the same `figmagent.design-context/v1` model. The model captures the selected subtree's implementation-relevant geometry, layout, appearance, rich text, variables, styles, components, interactions, annotations, developer resources, and asset references.

`FIGM/1`—**Figma Implementation Graph Markup, version 1**—is an indentation-based, CSS-like format:

```text
FIGM/1 units=px
source document="Checkout" page="Mobile"
FRAME "Payment card" id="12:4" size=343x188 layoutMode="VERTICAL" itemSpacing=16 padding=24 fill=#FFFFFF cornerRadius=16
  TEXT "Title" id="12:5" size=295x24 position=24,24 text="Payment method" font="Inter"/600/20 lineHeight=24 bindings={"fills":["$Text/Primary"]}
variables:
  $Text/Primary id="VariableID:color" mode="Light" value=#1E1E1E
assets:
  "card-logo" vector node="12:9" size=40x24 file="assets/card-logo.svg"
```

Rules:

- Hierarchy is represented by two-space indentation.
- Strings use JSON escaping; dimensions use pixels; colors use `#RRGGBB` or `#RRGGBBAA`.
- Properties use deterministic ordering and familiar Figma/CSS terminology.
- Visual defaults and normalized API bookkeeping are omitted only from `FIGM/1`; JSON retains the canonical model. Equal padding uses `padding=n`, while rich-text `runs` contain only ranges that differ from the common `font` and `lineHeight`.
- Fixed children are marked `fixed=true`; clipped children are marked `clipped=partial|full`; prototype overflow, Auto Layout sizing, non-default constraints, and absolute positions remain explicit.
- Instance lines keep resolved component names, variants, and effective properties without repeating REST override bookkeeping already represented by the rendered subtree.
- Variable aliases are rendered as `$Collection/Variable` and defined once.
- Companion assets are referenced by stable IDs and downloaded separately to avoid spending LLM tokens on binary or SVG payloads.
- A handoff ZIP contains `design.figm` and only the retained companion files under `assets/`; it never contains the JSON representation.
- The output is never silently truncated. Large selections produce warnings.

## Handoff and changes

Use **Download handoff** when the receiving agent needs the FIGM file and its screenshots, vectors, or original raster files. The ZIP is created locally after every required asset exports successfully. Extraction warnings remain in `design.figm`; a failed asset export leaves no partial download and can be retried.

After a successful **Copy for AI** or **Download handoff**, **Copy changes** compares the current canonical selection with that one in-memory baseline. It reports additions, removals, property replacements, moves, child reordering, and complete current definition tables. The baseline is scoped to the page, selected roots, and export options; changing any of those requires a new full handoff. See the [FIGM delta format](docs/FIGM-delta.md) for replacement semantics and asset-change handling.

By default, hidden descendants and unused variants/modes are excluded. Advanced options can include hidden layers plus the complete variant and mode matrix for referenced components and variables. The plugin never scans or loads the full document.

## Layer names and sharing

**Export options → Omit layer names** removes node names from both FIGM and JSON, uses IDs for component/variant labels and asset filenames, and names handoff archives `handoff.zip`. IDs, hierarchy, visible text, geometry, and component properties remain intact. Names are omitted by default. Uncheck this option when meaningful labels would help implementation. Changing this option requires a new full handoff before copying changes.

This is **not anonymization**: document/page names, variable/style names, visible text, annotations, descriptions, developer resources, warnings, and asset contents may still contain internal information. Review exports and companion assets before sharing. Figmagent makes no uploads; pasting or uploading an export to an AI service shares it with that service.

`npm run benchmark` reports token savings from this option using `o200k_base`. Its small/medium/large fixtures are synthetic repetitions of one representative design, not a survey of real Figma files; savings depend on naming and design complexity. Current net savings (including ID-based component labels and asset filenames):

| Fixture | FIGM tokens saved | Pretty JSON tokens saved | Compact JSON tokens saved |
| --- | ---: | ---: | ---: |
| Small | 7 (1.3%) | 20 (1.3%) | 8 (0.9%) |
| Medium | 71 (3.7%) | 160 (2.8%) | 100 (3.1%) |
| Large | 311 (4.4%) | 685 (3.2%) | 445 (3.7%) |

These fixtures do not support the claim that layer names make up most of the JSON.

## Development

```sh
npm run typecheck   # strict TypeScript check
npm test            # focused node:test serializer checks
npm run benchmark   # o200k_base token comparison
npm run build       # dist/code.js and dist/ui.html
npm run lint        # Biome linting
npm run format      # Biome formatting
npm run check       # lint, format check, typecheck, tests, and production build
```

The benchmark enforces at least 60% median token savings against pretty JSON, rejects `FIGM/1` if it becomes materially larger than compact JSON, and asserts that core implementation signals survive compaction. Current representative fixtures cover Auto Layout, absolute geometry, mixed rich text, gradients, effects, variables, instances, variants, hidden content, interactions, escaping, warnings, and assets.

## Boundaries

- Complex vectors and raster pixels are companion assets, not inline prompt content.
- Remote variables/components are included when Figma exposes the referenced definition; inaccessible definitions are reported as warnings.
- The plugin describes design intent and current rendered state. It does not reproduce Figma's private `.fig` storage format or generate framework-specific code.
- FigJam, Slides, Buzz, cloud sync, and direct LLM API calls are intentionally out of scope.

The implementation follows Figma's current [Plugin API](https://developers.figma.com/docs/plugins/), [dynamic page loading](https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/), and [Dev Mode](https://developers.figma.com/docs/plugins/working-in-dev-mode/) requirements.
