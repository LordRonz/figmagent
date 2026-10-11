import { performance } from "node:perf_hooks";
import { countNodes } from "../src/plain";
import { serializeFigm, serializeForAi, serializeJson } from "../src/serialize";
import { fixtureContext } from "../test/fixture";

async function main(): Promise<void> {
  for (const count of [1, 100, 500]) {
    const context = fixtureContext();
    const root = context.roots[0];
    if (!root) throw new Error("Missing benchmark root");
    context.roots = Array.from({ length: count }, (_, i) => {
      const clone = structuredClone(root);
      clone.id = `${root.id}:${i}`;
      return clone;
    });
    serializeFigm(context);
    const start = performance.now();
    const figm = serializeFigm(context);
    const formatted = performance.now();
    serializeJson(context);
    const json = performance.now();
    JSON.stringify(context);
    const bridge = performance.now();
    serializeForAi(context, figm);
    console.log(
      `${countNodes(context.roots)} nodes: FIGM ${(formatted - start).toFixed(2)} ms; pretty JSON ${(json - formatted).toFixed(2)} ms; compact JSON for a possible Wasm boundary ${(bridge - json).toFixed(2)} ms`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
