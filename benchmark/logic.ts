import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createWasmKernels } from "../src/crc32";
import { compareContexts, snapshotId } from "../src/delta";
import { countNodes, normalizeValue } from "../src/plain";
import { serializeFigm, serializeJson } from "../src/serialize";
import { snapshotIdFromJson } from "../src/snapshot-hash";
import { largeSelection } from "./selections";

function measure(run: () => unknown): number {
  run();
  const samples = Array.from({ length: 5 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  return samples.sort((a, b) => a - b)[2] ?? 0;
}

async function main() {
  const start = performance.now();
  const kernels = await createWasmKernels(
    readFileSync("wasm/target/wasm32-unknown-unknown/release/figmagent_core.wasm"),
  );
  console.log(`Wasm initialization ${(performance.now() - start).toFixed(2)} ms`);
  for (const cards of [500, 2_500, 5_000]) {
    const context = largeSelection(cards);
    const current = structuredClone(context);
    const title = current.roots[0]?.children?.[0]?.children?.[0];
    if (!title?.text) throw new Error("Missing text node");
    title.text.characters = "Updated payment method 🚀";
    const json = serializeJson(context);
    const currentJson = serializeJson(current);
    const baselineId = snapshotIdFromJson(json, kernels.hashJson);
    assert.deepEqual(
      compareContexts(context, current, {
        baseline: baselineId,
        current: snapshotIdFromJson(currentJson, kernels.hashJson),
      }),
      compareContexts(context, current),
    );
    assert.equal(snapshotIdFromJson(json), snapshotId(context));
    assert.equal(snapshotIdFromJson(json, kernels.hashJson), snapshotId(context));
    console.log(
      JSON.stringify({
        nodes: countNodes(context.roots),
        jsonChars: json.length,
        normalizationMs: measure(() => normalizeValue(context)),
        figmMs: measure(() => serializeFigm(context)),
        jsonMs: measure(() => serializeJson(context)),
        baselineMs: measure(() => snapshotId(JSON.parse(json))),
        baselineReusedJsonJsMs: measure(() => {
          JSON.parse(json);
          snapshotIdFromJson(json);
        }),
        baselineRustMs: measure(() => {
          JSON.parse(json);
          snapshotIdFromJson(json, kernels.hashJson);
        }),
        hashJsMs: measure(() => snapshotIdFromJson(json)),
        hashRustMs: measure(() => snapshotIdFromJson(json, kernels.hashJson)),
        diffMs: measure(() => compareContexts(context, current)),
        diffReusedIdsRustMs: measure(() =>
          compareContexts(context, current, {
            baseline: baselineId,
            current: snapshotIdFromJson(currentJson, kernels.hashJson),
          }),
        ),
      }),
    );
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
