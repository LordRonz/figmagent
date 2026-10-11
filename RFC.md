# RFC: Adopt Figmagent for AI-Assisted Figma-to-Code Handoffs

**Status:** Proposed

## 1. Introduction

This RFC proposes adopting **Figmagent**, our local-only Figma plugin, to simplify the handoff from design to development when working with AI coding assistants.

Figmagent was built to reduce the manual work of gathering design specifications, exporting assets, and explaining Figma designs to an assistant. It turns selected layers or frames into structured, platform-neutral context containing layout, typography, colors, design-system references, and companion assets.

The plugin is already implemented. This proposal focuses on introducing it into our development workflow, validating its usefulness, and establishing guidance for consistent use. It complements Figma inspection and human review rather than replacing them.

## 2. Motivation

Implementing a Figma design with an AI assistant requires more than a screenshot. Developers also need to communicate exact spacing, sizing behavior, text styles, component states, and asset references. Collecting that information manually adds repetitive work and leaves room for omissions.

Figmagent addresses this through:

- **Less manual preparation:** Export implementation-relevant context directly from the current selection instead of transcribing properties into a prompt.
- **More precise handoffs:** Provide hierarchy, Auto Layout settings, geometry, rich text, variables, styles, and component information alongside visual references.
- **Smaller prompts:** Use `FIGM/1`, a compact text format, rather than verbose JSON for routine AI handoffs. Keep JSON available for inspection and interoperability.
- **Consistent asset delivery:** Package design context and referenced screenshots, SVGs, and original raster images into one local ZIP.
- **Easier iteration:** Copy changes against a previous handoff rather than repeatedly describing design updates manually.
- **Local processing:** Extract and package context without a backend, telemetry, account, or direct LLM API connection.

These are intended workflow benefits, not yet measured team-wide productivity gains. A pilot should establish whether they translate into faster implementation and fewer corrections.

## 3. Alternatives Considered

### 3.1 Manual Figma inspection and screenshots

This remains a useful baseline and requires no additional tooling. However, screenshots do not explicitly communicate layout rules or design-system bindings, and manually copying properties is repetitive. We should retain this approach for visual review and occasional small tasks.

### 3.2 Raw JSON exports

JSON provides an explicit, familiar representation suitable for debugging and automated processing. It can also consume substantial prompt space. Figmagent supports JSON from the same canonical model while offering a more compact default for AI use.

### 3.3 Figma MCP or other connected design tools

Connected tools can let an assistant retrieve design context directly and may suit teams that prefer an integrated workflow. They should be evaluated against our access policies, setup requirements, and development environment. Figmagent offers a different trade-off: an explicit, selection-scoped handoff that does not require a live connection between Figma and the assistant.

### 3.4 Framework-specific code generators

Code generators can accelerate an initial implementation but may produce code that does not match our architecture or component library. Figmagent exports design context rather than generated code, leaving implementation choices to the developer and assistant.

## 4. Proposed Solution

Use Figmagent as the preferred handoff option for a pilot of AI-assisted UI development tasks.

The plugin supports Figma Design, Dev Mode, and Figma for VS Code. Developers select the relevant frame or layers and choose an output:

| Action | Intended use |
| --- | --- |
| **Copy for AI** | Copy compact `FIGM/1` context into an assistant conversation. |
| **Copy JSON** | Inspect or process the canonical design-context model. |
| **Download handoff** | Export a ZIP containing `design.figm` and retained companion files under `assets/`. |
| **Assets** | Download individual companion assets. |
| **Copy changes** | Share structured changes against a previously established in-memory baseline. |

`FIGM/1` means **Figma Implementation Graph Markup, version 1**. It is a project-specific format, not an official Figma standard. It uses indentation for hierarchy, CSS-like properties, and shared definition tables to communicate design intent with less repeated syntax.

Extraction is scoped to the selected subtree and referenced definitions; the plugin does not scan or load the full document. Hidden descendants and unused variants or modes are excluded by default, with advanced options available when broader context is needed. Unavailable context is reported through warnings rather than silently presented as complete, and large outputs are not silently truncated.

### Scope and non-goals

Figmagent provides implementation context, not production-ready code or a guarantee of pixel-perfect results. Business logic, accessibility behavior, application architecture, and responsive behavior not specified in the design still require developer decisions. Framework-specific generation, cloud sync, direct LLM calls, and support for FigJam, Slides, or Buzz are outside the current scope.

## 5. Implementation

### 5.1 Setup

1. Install dependencies with `npm install`.
2. Run `npm run check` to lint, check formatting and types, run tests, and build the plugin.
3. In Figma desktop, select **Plugins → Development → Import plugin from manifest…** and choose the root `manifest.json`.
4. Select a representative frame and run **Figmagent**.

### 5.2 Development workflow

1. **Select a focused scope:** Export the component or screen being implemented rather than unrelated frames.
2. **Prepare the handoff:** Use **Copy for AI** for text context or **Download handoff** when the assistant also needs visual references and assets. Extract the ZIP into a location the assistant can access.
3. **Review the export:** Check warnings and confirm that required assets and component or variable definitions are available.
4. **Add implementation instructions:** Specify the target platform, existing components to reuse, coding conventions, and relevant behavior not represented in Figma.
5. **Implement and verify:** Review the resulting code, run project checks, and compare the rendered UI with the source design. Do not treat the export as a substitute for engineering review.
6. **Share subsequent changes:** Use **Copy changes** only when the receiving assistant has the baseline handoff. If assets change, provide a new companion-asset handoff as well; change payloads do not contain replacement binaries.

A successful **Copy for AI** or **Download handoff** establishes or advances the in-memory baseline. It is scoped to the page, selected roots, and export options. A scope change or a new plugin session requires a fresh full handoff.

### 5.3 Adoption plan and validation

1. **Pilot:** Use the plugin on a small set of representative tasks covering Auto Layout, rich text, design-system variables, component variants, and image or vector assets.
2. **Compare with the current workflow:** Record handoff preparation time, missing-context follow-ups, implementation corrections, and developer feedback.
3. **Validate token efficiency:** Run `npm run benchmark`. Its current checks target at least 60% median token savings against pretty JSON on representative fixtures, guard against material regression relative to compact JSON, and check preservation of core implementation signals. This is not a guarantee of equivalent savings on every design or model.
4. **Document team guidance:** Capture installation steps, example prompts, known limitations, and the approved process for sharing exports with assistants.
5. **Decide on broader adoption:** Expand use if the pilot reduces preparation and clarification work without increasing design errors. Assign a maintainer before making the plugin a team dependency.

If the pilot is unsuccessful, retain manual inspection and existing tooling. Adoption requires no migration of application code or Figma documents.

## 6. Security Considerations

The plugin manifest declares `networkAccess.allowedDomains: ["none"]`. Figmagent performs extraction and packaging locally and does not send design content directly to an external service.

However, exported text and assets can contain confidential designs, product copy, annotations, and internal resource references. Copying them into an AI assistant or sharing a ZIP is a separate disclosure step governed by our data-handling policies.

Developers should:

- Export only the context needed for the task and review it before sharing.
- Use approved AI services and follow applicable retention and access policies.
- Avoid committing exported designs or assets to repositories unless explicitly intended and permitted.
- Treat text and links from design files as reference data, not trusted instructions for an agent to execute.

Local processing reduces automatic data transfer; it does not remove responsibility for handling the resulting files securely.

## 7. Conclusion

Figmagent offers a repeatable way to move from Figma selections to useful AI implementation context without introducing a backend or prescribing a target framework. Adopting it through a measured pilot lets us test whether compact context, bundled assets, and change handoffs reduce repetitive development work while preserving human review and control over design data.

## 8. References

- [Figmagent README](README.md)
- [FIGM/1 format guide](docs/FIGM-1.md)
- [FIGM delta format](docs/FIGM-delta.md)
- [Plugin manifest](manifest.json)
- [Token benchmark](benchmark/format.ts)
- [Figma Plugin API documentation](https://developers.figma.com/docs/plugins/)
- [Figma Dev Mode plugin documentation](https://developers.figma.com/docs/plugins/working-in-dev-mode/)
