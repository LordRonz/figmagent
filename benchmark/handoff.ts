import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extractSelection, prepareHandoffAssets } from "../src/extract";
import { createZip } from "../src/zip";

function mockIconFrame(count: number): void {
  const icons = Array.from({ length: count }, (_, index) => ({
    id: `node:${index}`,
    type: "VECTOR",
    name: "Icon",
    width: 20,
    height: 20,
    isAsset: true,
    exportSettings: [],
    exportAsync: async () => "<svg/>",
  }));
  const document = {
    id: "root",
    type: "FRAME",
    name: "Root",
    children: icons.map(({ id, type, name }) => ({ id, type, name })),
  };
  const root = {
    ...document,
    children: icons,
    width: 1000,
    height: 1000,
    exportSettings: [],
    findAll: () => icons,
    getDevResourcesAsync: async () => [],
    exportAsync: async ({ format }: { format: string }) =>
      format === "PNG" ? new Uint8Array(256) : { document },
  };
  const byId = new Map(icons.map((node) => [node.id, node]));
  Reflect.set(globalThis, "figma", {
    currentPage: { selection: [root], name: "Page" },
    root: { name: "Document" },
    getNodeByIdAsync: async (id: string) => (id === root.id ? root : byId.get(id)),
  });
}

async function measure(omitLayerNames: boolean) {
  const start = performance.now();
  const output = await extractSelection({
    includeHidden: false,
    includeAllVariantsAndModes: false,
    omitLayerNames,
  });
  const extracted = performance.now();
  const assets = await prepareHandoffAssets(output);
  const archive = createZip([
    { name: "design.figm", data: output.figm },
    ...assets.map(({ filename, data }) => ({ name: filename, data })),
  ]);
  const end = performance.now();
  assert.equal(assets.length, output.nodeCount);
  return {
    total: end - start,
    afterExtraction: end - extracted,
    digest: createHash("sha256").update(archive).update(output.json).digest("hex"),
  };
}

async function main(): Promise<void> {
  for (const icons of [100, 1_500, 5_000]) {
    mockIconFrame(icons);
    for (const omitLayerNames of [true, false]) {
      const warmup = await measure(omitLayerNames);
      const total = [];
      const afterExtraction = [];
      for (let i = 0; i < 5; i++) {
        const sample = await measure(omitLayerNames);
        assert.equal(sample.digest, warmup.digest);
        total.push(sample.total);
        afterExtraction.push(sample.afterExtraction);
      }
      const median = (values: number[]) => values.sort((a, b) => a - b)[2]?.toFixed(1);
      console.log(
        `${icons} icons, names ${omitLayerNames ? "omitted" : "kept"}: extraction through ZIP ${median(total)} ms; after extraction ${median(afterExtraction)} ms; SHA-256 ${warmup.digest}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
