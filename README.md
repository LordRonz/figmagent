# Figmagent

Figmagent is a local-only Figma plugin that turns the current selection into precise, platform-neutral context for an LLM. It produces a compact `FIGM/1` document, readable JSON, reference screenshots, SVG assets, and original raster images.

It runs in Figma Design, Dev Mode, and Figma for VS Code. It has no backend, telemetry, account, or runtime dependency.

## Set up

Requirements: current Node.js/npm and the current Figma desktop app for local plugin registration.

1. Install and build:

   ```sh
   npm install
   npm run check
   ```

2. In Figma desktop, open **Plugins → Development → New plugin**, choose a custom-UI Figma Design plugin, and let Figma assign an ID.
3. Replace `000000000000000000` in `manifest.json` with that assigned numeric ID.
4. Choose **Plugins → Development → Import plugin from manifest…** and select this repository's `manifest.json`.
5. Select a layer or frame and run **Figmagent**. The first copy click prepares the selection; click the same button again to copy from an explicit user gesture. **Prepare assets** exposes individual downloads.

Run `npm run dev` while editing the plugin sandbox. Re-run `npm run build` after UI changes, then use Figma's development-plugin reload.

## Output

Both text formats come from the same `figmagent.design-context/v1` model. The model captures the selected subtree's implementation-relevant geometry, layout, appearance, rich text, variables, styles, components, interactions, annotations, developer resources, and asset references.

`FIGM/1` is an indentation-based, CSS-like format:

```text
FIGM/1 units=px
source document="Checkout" page="Mobile"
FRAME "Payment card" id="12:4" size=343x188 layoutMode="VERTICAL" itemSpacing=16 paddingTop=24 fill=#FFFFFF cornerRadius=16
  TEXT "Title" id="12:5" size=295x24 position=24,24 text="Payment method" bindings={"fills":["$Text/Primary"]}
variables:
  $Text/Primary id="VariableID:color" mode="Light" value=#1E1E1E
assets:
  "card-logo" vector node="12:9" size=40x24 file="card-logo.svg"
```

Rules:

- Hierarchy is represented by two-space indentation.
- Strings use JSON escaping; dimensions use pixels; colors use `#RRGGBB` or `#RRGGBBAA`.
- Properties use their Figma/API names and deterministic ordering.
- Visual defaults such as opacity `1`, zero rotation, normal blending, and no-wrap are omitted only from `FIGM/1`; JSON retains the canonical model.
- Variable aliases are rendered as `$Collection/Variable` and defined once.
- Companion assets are referenced by stable IDs and downloaded separately to avoid spending LLM tokens on binary or SVG payloads.
- The output is never silently truncated. Large selections produce warnings.

By default, hidden descendants and unused variants/modes are excluded. Advanced options can include hidden layers plus the complete variant and mode matrix for referenced components and variables. The plugin never scans or loads the full document.

## Development

```sh
npm run typecheck   # strict TypeScript check
npm test            # focused node:test serializer checks
npm run benchmark   # o200k_base token comparison
npm run build       # dist/code.js and dist/ui.html
npm run check       # typecheck, tests, and production build
```

The benchmark enforces at least 30% median token savings against pretty JSON and rejects `FIGM/1` if it becomes materially larger than compact JSON. Current representative fixtures cover Auto Layout, absolute geometry, mixed rich text, gradients, effects, variables, instances, variants, hidden content, interactions, escaping, warnings, and assets.

## Boundaries

- Complex vectors and raster pixels are companion assets, not inline prompt content.
- Remote variables/components are included when Figma exposes the referenced definition; inaccessible definitions are reported as warnings.
- The plugin describes design intent and current rendered state. It does not reproduce Figma's private `.fig` storage format or generate framework-specific code.
- FigJam, Slides, Buzz, cloud sync, ZIP packaging, and direct LLM API calls are intentionally out of scope.

The implementation follows Figma's current [Plugin API](https://developers.figma.com/docs/plugins/), [dynamic page loading](https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/), and [Dev Mode](https://developers.figma.com/docs/plugins/working-in-dev-mode/) requirements.
