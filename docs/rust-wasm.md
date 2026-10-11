# Rust/Wasm performance

The handoff ZIP's CRC-32 checksum runs in Rust compiled to `wasm32-unknown-unknown`. The release module is embedded as base64 in the UI bundle, with no runtime download or Rust installation. It uses slicing by eight and a reusable 64 KiB input buffer. The TypeScript wrapper copies bounded chunks into Wasm and carries the checksum between chunks, avoiding a second full-size Wasm allocation for large assets.

Initialization starts when context generation or Download handoff is requested, alongside extraction and asset export, and is cached for the plugin session. Failed initialization selects JavaScript implementations. Snapshots use the fallback until initialization completes, so early copies do not wait for compilation. ZIP creation awaits initialization and rechecks request validity before continuing. Both paths produce identical snapshot IDs and archive bytes.

## Measurements

Run `npm run benchmark:performance`. The benchmark verifies checksums and complete archive equality before timing warmed runs. Timings include calls and copies into Wasm, text-independent ZIP headers, and archive assembly; initialization is reported separately.

Initial local Node.js 26.10.0 results on Apple Silicon:

| Asset bytes | JavaScript ZIP | Rust/Wasm ZIP | Speedup |
| ---: | ---: | ---: | ---: |
| 65,536 | 0.386 ms | 0.053 ms | 7.35× |
| 1,048,576 | 6.037 ms | 0.799 ms | 7.56× |
| 16,777,216 | 97.959 ms | 13.258 ms | 7.39× |

The module was 8,965 bytes; first initialization took 4.27 ms. Measurements vary with engine, hardware, and compiler. These compare the original byte-at-a-time JavaScript algorithm with Rust's slicing-by-eight algorithm, so the gain includes both the algorithm change and Wasm execution. They are synthetic packaging measurements, not end-to-end Figma handoff timings. Small first downloads may still wait for initialization if asset export finishes first.

## Scope

[Figma's plugin runtime](https://developers.figma.com/docs/plugins/how-plugins-run/) exposes the scene through its JavaScript sandbox, while browser APIs belong to the UI iframe. [Figma explicitly supports WebAssembly in that iframe](https://developers.figma.com/docs/plugins/). Document access, metadata resolution, and image/SVG exports therefore remain in TypeScript.

Serialization and structural snapshot comparison remain in TypeScript. Snapshot hashing now runs in Rust over the sorted JSON already present in the UI, avoiding another traversal, sort, and serialization of the same context. Extraction and asset-filename refresh reuse the generated FIGM string when adding the AI preamble, avoiding a duplicate serialization pass.

Before moving more logic, profile representative Figma selections and asset-heavy handoffs in the plugin. Compare total action latency, UI responsiveness, memory, and serialized data-transfer costs, rather than assuming a language change accelerates Figma API calls.

## Initial Copy for AI

The Copy for AI action does not create a ZIP, so the Rust checksum kernel does not accelerate it. Preparation still requires Figma's REST JSON export, metadata and definition resolution, and FIGM/JSON formatting.

Initial copy assigns safe collision-free raster `.bin` names without reading full images. Individual downloads preserve those names and use the detected MIME type. Handoff export detects real extensions from the bytes it already needs, then updates filenames and `design.figm` together. The regression tests check that copied references and downloaded files agree. Unavailable raster bytes are now reported when requested for download, rather than before the initial copy.

Developer resources are fetched once per selected root using `includeChildren: true`, concurrently with the REST export. Results are grouped by their attached `nodeId`, preserving inherited links. A three-second timeout reports a `DEV_RESOURCES_UNAVAILABLE` warning instead of blocking indefinitely; slow links may be omitted with that warning. The underlying Figma request cannot be cancelled, but late results do not modify an already generated output.

`npm run benchmark:copy` measures pure formatter cost. An initial local 2,000-node repeated fixture took roughly 9–12 ms to format FIGM; this is not a measurement of a real Figma selection.

A desktop baseline on a real 127-layer frame with 27 assets took 21,446 ms to prepare: extraction took 10,566 ms, and raster extension detection plus output refresh took 10,880 ms. FIGM formatting alone took 70 ms. Developer-resource requests returned permission errors and were repeated through nested instances. These measurements motivated reducing Figma API work; no Rust formatter speedup is claimed.

With deferred image reads and one subtree resource lookup, the same frame prepared in 3,245 ms (about 6.6× faster, 85% less time). The resource lookup completed in 2,652 ms, normalization in 365 ms, FIGM formatting in 35 ms, and clipboard access in 38 ms. This comparison uses the same open document with fresh plugin sessions, not controlled cold caches; Figma API latency can vary. The final build was also exercised after removing profiling logs: Copy for AI succeeded, then a 25,081,708-byte handoff ZIP downloaded with 28 entries (design plus 27 assets), no missing FIGM references, and valid CRCs for every entry. Its assets comprised 13 PNGs (including the screenshot), four JPEGs, and ten SVGs.

## Large-selection snapshot hashing and comparison

Run `npm run benchmark:logic`. It builds fixtures with unique node IDs, rich text, styles, component properties, nested children, and one vector asset per card. It asserts snapshot-ID and complete delta parity, warms each operation, and reports the median of five runs. Baseline creation includes the JSON parse needed to keep an immutable context; Rust timings include copying UTF-16 code units into the shared 64 KiB buffer. No new plugin-to-UI message or serialized payload is needed.

Local Node.js 26.10.0 measurements on Apple Silicon:

| Layers | Previous baseline creation | Reused JSON, JavaScript | Reused JSON, Rust/Wasm | JavaScript hash only | Rust hash, including copies |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2,001 | 15.99 ms | 11.69 ms | 10.10 ms | 6.88 ms | 5.37 ms |
| 10,001 | 81.18 ms | 63.52 ms | 50.65 ms | 39.16 ms | 26.95 ms |
| 20,001 | 158.22 ms | 124.06 ms | 99.81 ms | 79.86 ms | 54.36 ms |

At 20,001 layers, baseline creation saves about 37% overall; Rust hashing itself is about 1.47× faster than the optimized JavaScript whitespace-skipping hash. These are CPU benchmarks, not total Copy for AI latency. Figma API waits are excluded. The expanded module is 9,407 bytes; initialization measured 3.54 ms in this run.

The Rust kernel hashes the same UTF-16 code units as the original FNV-1a snapshot function. It skips formatting whitespace only outside JSON strings, and carries quoted/escaped state across chunks. Keys are already sorted by `serializeJson`; the kernel does not parse or reorder objects. Tests cover whitespace within strings, escaped quotes/backslashes, emoji, non-Latin characters, lone surrogates, chunk boundaries, shared CRC/hash buffer reuse, initialization, and fallback.

Comparison originally rebuilt node maps, searched descriptor arrays, and walked every node's ancestry for every rendered asset. The new path reuses maps, indexes asset descriptors, and marks affected ancestors in both snapshots. Before this change, a single text edit took about 74 / 785 / 2,569 ms at the three sizes. The current UI path, including a Rust hash for the new snapshot and reuse of the baseline ID, took 27.15 / 134.67 / 276.42 ms. The larger gain comes from algorithm changes and avoiding repeated hashes, not from Rust alone. Removed descendants and moves now also invalidate screenshots of their former ancestors; focused regression tests catch the previous omissions.

Formatting and normalization were measured but not ported: duplicating their full logic and transferring another representation has no demonstrated benefit in this implementation. Snapshot hashing can consume the existing JSON directly, so it was the smaller measured migration.

The rebuilt plugin was exercised in Figma desktop on the same real 127-layer frame: Copy for AI succeeded with the original `77f9415d` baseline ID, and Copy changes reported no changes. An extraction attempt invalidated by Figma's document-change event was discarded before retrying. Large-selection CPU timings above remain synthetic Node measurements; they do not establish a new end-to-end desktop speedup.
