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
FRAME "Payment card" id="12:4" size=343x188 layoutMode="VERTICAL" itemSpacing=16
  TEXT "Title" id="12:5" size=295x24 text="Payment method" bindings={"fills":["$Text/Primary"]}
variables:
  $Text/Primary id="VariableID:color" mode="Light" value=#1E1E1E
assets:
  "card-logo" vector node="12:9" size=40x24 file="card-logo.svg" status=available
```

The essential conventions are:

- Two spaces represent one hierarchy level.
- Each node begins with its uppercase Figma node type, quoted name, and stable ID.
- Properties use `key=value`; strings use JSON escaping.
- Measurements default to the header's declared unit, currently `px`.
- Colors use `#RRGGBB` or `#RRGGBBAA`.
- Variable references use `$Collection/Variable` and are defined once.
- Shared definitions, assets, and warnings follow the node tree as named sections.
- Visual defaults may be omitted only when their omission is defined and does not change meaning.

The executable definition of the current serializer lives in [`src/serialize.ts`](../src/serialize.ts), with behavior locked by [`test/serializers.test.ts`](../test/serializers.test.ts) and the token benchmark in [`benchmark/format.ts`](../benchmark/format.ts).
