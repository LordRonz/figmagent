# FIGM/1

**FIGM** means **Figma Implementation Graph Markup**. `FIGM/1` is Figmagent's version-1, platform-neutral text format for communicating implementation-relevant Figma design context to language models.

Pronounce it “fig-em.”

FIGM is a project-specific format, not an industry standard or Figma-owned format. The header always declares its major version:

```text
FIGM/1 units=px
```

## Name

- **Figma** identifies the source design model.
- **Implementation** limits the payload to information useful for reproducing the design in software; it is not an archival `.fig` representation.
- **Graph** describes the layer tree plus references between nodes, components, variables, styles, interactions, and companion assets.
- **Markup** identifies a deterministic, human-readable textual representation rather than framework-specific generated code.
- **`/1`** is the major format version. A backward-incompatible syntax or meaning change requires a new major version.

## Philosophy

FIGM aims for **maximum implementation fidelity with minimum prompt syntax**.

Its design principles are:

1. **Platform-neutral:** describe design intent without assuming HTML, React, Flutter, SwiftUI, or another target.
2. **Model-readable:** use familiar hierarchy, CSS-like properties, JSON string escaping, explicit units, and semantic names.
3. **Token-efficient:** omit repeated structural punctuation and documented visual defaults while preserving significant values.
4. **Deterministic:** keep stable ordering, rounding, identifiers, and escaping so unchanged selections produce unchanged output.
5. **Design-system aware:** preserve named variables, styles, components, variants, and modes instead of emitting only resolved literals or opaque IDs.
6. **Asset-conscious:** reference screenshots, vectors, and raster images as companion files instead of embedding token-heavy binary content.
7. **Honest about loss:** report unavailable or unsupported context as warnings rather than silently pretending the export is complete.

## Relationship to JSON

FIGM/1 and JSON are serializers over the same canonical `figmagent.design-context/v1` model:

- JSON is the explicit interoperability and debugging representation.
- FIGM/1 is the compact representation intended for LLM prompts.

FIGM is therefore not the source of truth inside the plugin. The canonical model is, which prevents the compact serializer from gaining behavior unavailable to JSON.

## Shape

```text
FIGM/1 units=px
source document="Checkout" page="Mobile"
FRAME "Payment card" id="12:4" size=343x188 layoutMode="VERTICAL" itemSpacing=16 padding=24 fill=#FFFFFF cornerRadius=16
  TEXT "Title" id="12:5" size=295x24 text="Payment method" font="Inter"/600/20 lineHeight=24 bindings={"fills":["$Text/Primary"]}
variables:
  $Text/Primary id="VariableID:color" mode="Light" value=#1E1E1E
assets:
  "card-logo" vector node="12:9" size=40x24 file="assets/card-logo.svg"
```

The essential conventions are:

- Two spaces represent one hierarchy level.
- Each node begins with its uppercase Figma node type, optional quoted name, and stable ID. With **Omit layer names**, for example: `FRAME id="12:4" size=343x188`. JSON likewise omits node `name` fields. Component/variant labels and asset filenames use IDs instead of layer names; implementation properties remain unchanged.
- Properties use `key=value`; strings use JSON escaping.
- Measurements default to the header's declared unit, currently `px`.
- Colors use `#RRGGBB` or `#RRGGBBAA`.
- Variable references use `$Collection/Variable` and are defined once.
- Shared definitions, assets, and warnings follow the node tree as named sections.
- Visual defaults may be omitted only when their omission is defined and does not change meaning.

## Compact projection

JSON retains every field in the canonical model. FIGM projects that model into the smaller set an implementation agent needs, without changing the underlying extraction:

- Identity transforms, default left/top constraints, null min/max sizes, empty paints/effects, zero spacing/radii, normal/pass-through blending, and other documented API defaults are omitted.
- Equal padding is written once as `padding=16`; unequal padding is `padding=top,right,bottom,left`.
- Solid fills and strokes use `fill=#RRGGBBAA` and `stroke=#RRGGBBAA`. Gradients, images, effects, and asymmetric values remain explicit objects or properties.
- Common text styling is written as `font="Family"/weight/size`, `lineHeight=value`, alignment, resizing, and other non-default text properties. Rich-text boundaries use `runs=[{"range":"start:end",…}]` and contain only differences from the common style.
- Instances use the resolved component name plus compact `variants` and non-variant `properties`. The rendered subtree is authoritative, so REST override bookkeeping and duplicate component-property objects are omitted.
- `numberOfFixedChildren` remains on the parent and each affected topmost child is marked `fixed=true`. Figma [orders children back-to-front](https://developers.figma.com/docs/plugins/api/properties/nodes-children/) and [keeps fixed children above scrolling children](https://developers.figma.com/docs/plugins/api/properties/nodes-numberoffixedchildren/), so this removes ambiguity without inventing state.
- A direct child extending beyond a clipping parent is marked `clipped=partial`; a fully obscured child is `clipped=full`. Its complete subtree remains available as supporting implementation context.
- A retained vector asset replaces its descendant path subtree in FIGM, and nested vector assets already covered by that ancestor are omitted from the FIGM asset table. JSON retains the complete node tree and every descriptor from canonical extraction.
- Repeated warnings with the same code and message are consolidated and list their affected node IDs once.
- `status=available` is implicit for assets; unavailable assets remain explicit.

The serializer deliberately retains exact node sizes and relative positions, Auto Layout sizing and gaps, non-default constraints, clipping and scrolling, typography, resolved colors, variables/styles, component states, interactions, and companion-asset references. These are the fields required to reconstruct the visible design rather than merely recognize it.

The executable definition of the current serializer lives in [`src/serialize.ts`](../src/serialize.ts), with behavior locked by [`test/serializers.test.ts`](../test/serializers.test.ts) and the token benchmark in [`benchmark/format.ts`](../benchmark/format.ts).
