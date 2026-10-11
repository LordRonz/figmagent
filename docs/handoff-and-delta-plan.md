# FIGM handoff bundles and change exports

Status: planned; implementation has not started.

## Scope

Build two capabilities in order:

1. **Download handoff:** a ZIP containing FIGM and its companion assets, with no JSON file.
2. **Copy changes:** a compact delta against the last successful FIGM handoff.

Keep the existing Copy JSON action. Both features run locally, with no backend or network access.

## 1. Download handoff

Add a **Download handoff** button that produces a bundle such as:

```text
checkout.zip
├── design.figm
└── assets/
    ├── checkout-reference.png
    ├── logo.svg
    └── hero.jpg
```

### Behavior

- Include FIGM, reference screenshots, and assets referenced by that FIGM. Do not include JSON.
- Reuse the existing extraction, serializer, and asset exporter.
- Resolve actual raster extensions before serializing the bundled FIGM. Current descriptors use `.image`, while downloads detect extensions such as `.png` and `.jpg`.
- Assign deterministic, collision-safe filenames and write matching `assets/...` references into FIGM.
- Export only the assets retained by FIGM serialization, rather than every asset in the canonical context.
- Show progress during asset export and packaging.
- If a required asset fails, explain the failure and allow retry. Do not present an incomplete bundle as successful. Preserve extraction warnings in FIGM.
- Discard an in-progress export if the selection, options, or design changes, so text and images represent the same state.

### Implementation

- Extract shared asset-selection logic from `src/serialize.ts` so packaging and serialization agree on required files.
- Reuse `exportAsset` in `src/extract.ts`, retaining detected raster filenames and bytes for packaging.
- Extend `src/messages.ts` and `src/code.ts` for bundle requests, progress, and result delivery.
- Track request scope and design revisions across asynchronous generation; ignore obsolete responses in `src/ui.ts`.
- Package files in the UI with a small bundled ZIP library, using the existing Blob download mechanism.
- Add the control and progress feedback in `src/ui.html` and `src/ui.ts`.
- Update the README to remove ZIP packaging from the excluded capabilities and document the handoff workflow.

### Acceptance checks

- Open a generated ZIP and verify that every FIGM file reference resolves to an archive entry.
- Verify that no JSON file is included.
- Cover duplicate names, unsafe filename characters, and detected raster extensions.
- Cover required-asset failures and invalidation during export.
- Manually exercise a multi-frame selection with screenshots, vectors, and original raster images in Figma.

## 2. Copy changes

Add **Copy changes**, comparing the current selection with its last successful FIGM handoff.

### Baseline lifecycle

- A successful **Copy for AI** or **Download handoff** establishes the baseline. For downloads, success means packaging and browser download dispatch completed; the plugin cannot confirm that the file was saved to disk.
- Previewing output, preparing assets, copying JSON, or downloading individual assets does not establish a baseline.
- Keep one baseline in memory, scoped to the page, selected root IDs, and export options.
- Changing that scope requires a new full handoff. Closing the plugin clears the baseline.
- Design edits invalidate generated output but preserve the baseline for comparison.
- Successful **Copy changes** advances the baseline. Failed copying leaves it intact.
- Explain when a full handoff is needed before changes can be copied.

### Delta semantics

- Clearly label the payload as a delta and include baseline and current snapshot identifiers.
- Use stable Figma node IDs to identify added, removed, and updated nodes.
- Include parent and child-order information for moves and reordering.
- Emit complete current properties for updated nodes, with explicit replacement semantics so removed properties cannot linger.
- Include complete current definition tables and the asset references needed to interpret the change. Defer definition-level compaction until size measurements justify it.
- Detect changes from the canonical context, including variable-only and asset changes; do not rely solely on comparing serialized FIGM lines.
- Report **No changes** without copying an empty payload or advancing the baseline.
- If a delta is larger than a full export, copy full context, explain the fallback, and advance the baseline only after copying succeeds.
- Document the delta format separately from the existing full `FIGM/1` grammar before implementation.

### Assets

Clipboard text cannot carry replacement images. When assets change, show that companion files are required and offer the full handoff download from stage one. Defer a separate delta ZIP.

Asset-change detection must account for rendered vector and screenshot changes, not just stable asset IDs or filenames. Reuse canonical subtree changes for conservative detection; raster image hashes identify original image changes.

### Implementation

- Add a pure snapshot comparison and delta serialization module using existing canonical types and stable serialization helpers.
- Keep baseline ownership and advancement in the UI, where clipboard and download outcomes are known.
- Reuse request-scope and revision handling from stage one so stale results cannot become baselines.
- Add the Copy changes control, baseline status, no-change feedback, and companion-asset notice.
- Document snapshot scope, replacement semantics, full-export fallback, and the requirement that the receiving agent already has the baseline.

### Acceptance checks

- Cover node additions, removals, property clearing, moves, and child reordering.
- Cover variable-only changes, raster replacements, and rendered vector changes.
- Cover unchanged output and the full-export size fallback.
- Verify successful actions advance the baseline and failed actions do not.
- Verify scope changes require a new baseline, while ordinary design edits preserve it.
- Verify obsolete asynchronous responses cannot update output or the baseline.

## Delivery sequence

- [ ] Fix export consistency and asset filename handling.
- [ ] Implement and verify the FIGM-and-assets ZIP.
- [ ] Document delta semantics and implement snapshot comparison.
- [ ] Add baseline lifecycle and Copy changes UI.
- [ ] Run `npm run check`, the existing format benchmark, and focused tests for the new behavior.
- [ ] Manually verify both workflows in Figma and update user documentation.

## Deferred

- JSON files inside bundles.
- Persistent snapshot history or multiple baselines.
- Separate delta ZIP packaging.
- Definition-level delta optimization.
- Cloud storage, direct LLM calls, framework code generation, or a custom MCP server.
