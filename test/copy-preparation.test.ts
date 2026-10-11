import assert from "node:assert/strict";
import test from "node:test";
import { exportAsset, extractSelection, prepareHandoffAssets } from "../src/extract";

function mockFigma(t: test.TestContext, failResources = false, hangResources = false) {
  const calls: { nodeId: string; includeChildren: boolean }[] = [];
  let imageReads = 0;
  const resources = [
    { nodeId: "root", name: "Root docs", url: "https://example.com/root" },
    {
      nodeId: "nested",
      inheritedNodeId: "main",
      name: "Inherited",
      url: "https://example.com/main",
    },
    { nodeId: "hidden", name: "Hidden docs", url: "https://example.com/hidden" },
  ];
  const node = (id: string, type = "FRAME", visible = true) => ({
    id,
    type,
    visible,
    name: "Image",
    width: 10,
    height: 10,
    x: 0,
    y: 0,
    exportSettings: [],
    isAsset: false,
    fills: id === "nested" ? [{ type: "IMAGE", imageHash: "image" }] : [],
    getMainComponentAsync: async () => ({ id: "main", name: "Main", key: "key", remote: false }),
    getDevResourcesAsync: async ({ includeChildren }: { includeChildren: boolean }) => {
      calls.push({ nodeId: id, includeChildren });
      if (failResources) throw new Error("Resources offline");
      if (hangResources) return new Promise<never>(() => {});
      return includeChildren ? resources : resources.filter((resource) => resource.nodeId === id);
    },
  });
  const nested = node("nested", "INSTANCE");
  const hidden = node("hidden", "INSTANCE", false);
  const child = { ...node("child", "INSTANCE"), children: [nested, hidden] };
  const raw = {
    id: "root",
    type: "FRAME",
    children: [
      {
        id: "child",
        type: "INSTANCE",
        children: [
          { id: "nested", type: "INSTANCE" },
          { id: "hidden", type: "INSTANCE", visible: false },
        ],
      },
    ],
  };
  const root = {
    ...node("root"),
    children: [child],
    findAll: () => [child, nested, hidden],
    exportAsync: async ({ format }: { format: string }) =>
      format === "JSON_REST_V1" ? { document: raw } : new Uint8Array([137, 80, 78, 71]),
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "figma");
  Object.defineProperty(globalThis, "figma", {
    configurable: true,
    value: {
      currentPage: { selection: [root], name: "Page" },
      root: { name: "Document" },
      getNodeByIdAsync: async () => root,
      getImageByHash: () => ({
        getBytesAsync: async () => {
          imageReads += 1;
          return new Uint8Array([137, 80, 78, 71]);
        },
      }),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "figma", original);
    else Reflect.deleteProperty(globalThis, "figma");
  });
  return { calls, imageReads: () => imageReads, resources };
}

const options = { includeHidden: false, includeAllVariantsAndModes: false };

test("copy batches subtree resources, preserves inherited links, and never reads image bytes", async (t) => {
  const mock = mockFigma(t);
  const output = await extractSelection(options);
  assert.deepEqual(mock.calls, [{ nodeId: "root", includeChildren: true }]);
  assert.equal(mock.imageReads(), 0);
  const root = output.context.roots[0];
  assert.deepEqual(root?.devResources, [mock.resources[0]]);
  assert.deepEqual(root?.children?.[0]?.children?.[0]?.devResources, [mock.resources[1]]);
  assert.equal(root?.children?.[0]?.children?.length, 1);
  assert.doesNotMatch(output.figm, /Hidden docs/);
  const raster = output.context.assets.find((asset) => asset.kind === "raster");
  assert.ok(raster);
  assert.match(raster.filename, /\.bin$/);
  assert.ok(output.figm.includes(`assets/${raster.filename}`));
  const individual = await exportAsset(raster);
  assert.equal(
    individual.filename,
    raster.filename,
    "individual downloads must match copied references",
  );
  assert.equal(individual.mime, "image/png");
  const handoff = await prepareHandoffAssets(output);
  const image = handoff.find((asset) => asset.id === raster.id);
  assert.ok(image);
  assert.match(image.filename, /\.png$/);
  assert.ok(output.figm.includes(image.filename));
  assert.equal(mock.imageReads(), 2, "read once per requested individual or bundle download");
});

test("failed subtree resource lookup reports one warning and still exports nested components", async (t) => {
  const mock = mockFigma(t, true);
  const output = await extractSelection(options);
  assert.deepEqual(mock.calls, [{ nodeId: "root", includeChildren: true }]);
  assert.equal(output.nodeCount, 3);
  assert.deepEqual(output.context.warnings, [
    {
      code: "DEV_RESOURCES_UNAVAILABLE",
      message: "Resources offline",
      nodeId: "root",
    },
  ]);
});

test("unresponsive developer resources cannot block copying the design indefinitely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockFigma(t, false, true);
  const pending = extractSelection(options);
  t.mock.timers.tick(3_000);
  const output = await pending;
  assert.equal(output.nodeCount, 3);
  assert.deepEqual(output.context.warnings, [
    {
      code: "DEV_RESOURCES_UNAVAILABLE",
      message: "Developer resources timed out after 3 seconds",
      nodeId: "root",
    },
  ]);
});
