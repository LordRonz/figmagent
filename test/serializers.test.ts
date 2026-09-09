import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assignAssetFilenames, retainedAssetIds, retainedAssets } from "../src/assets";
import { compareContexts, serializeDelta } from "../src/delta";
import { createVirtualRoot, sniffImage } from "../src/extract";
import {
  countNodes,
  isRecord,
  normalizeValue,
  sanitizeFilename,
  stableStringify,
} from "../src/plain";
import { serializeFigm, serializeForAi, serializeJson } from "../src/serialize";
import type { DesignNode } from "../src/types";
import { createZip } from "../src/zip";
import { fixtureContext } from "./fixture";

test("normalizes colors, floating point values, keys, and special values", () => {
  assert.deepEqual(
    normalizeValue({ z: 1.23456, color: { r: 1, g: 0.5, b: 0, a: 0.5 }, a: undefined }),
    {
      color: "#FF800080",
      z: 1.235,
    },
  );
  assert.equal(
    stableStringify({ z: 1, a: { z: 2, a: 3 } }),
    '{\n  "a": {\n    "a": 3,\n    "z": 2\n  },\n  "z": 1\n}',
  );
  assert.equal(sanitizeFilename(" Card / Lögö! "), "card-logo");
});

test("serializes deterministic valid JSON without losing the canonical model", () => {
  const context = fixtureContext();
  const first = serializeJson(context);
  const second = serializeJson(context);
  assert.equal(first, second);
  assert.deepEqual(JSON.parse(first), context);
});

test("serializes FIGM hierarchy, rich text, bindings, assets, and warnings", () => {
  const context = fixtureContext();
  const figm = serializeFigm(context);
  assert.match(figm, /^FIGM\/1 units=px\nsource document="Checkout" page="Mobile"/);
  assert.match(figm, /FRAME "Payment card" id="12:4" size=343x188/);
  assert.match(figm, / {2}TEXT "Title \\"primary\\"" id="12:5" size=295x24 position=24,24/);
  assert.match(figm, /text="Payment\\nmethod"/);
  assert.match(figm, /bindings=\{"fills":\["\$Text\/Primary"\]\}/);
  assert.match(figm, /RECTANGLE "Hidden alternate"[^\n]+visible=false/);
  assert.match(figm, /"vector:12:9" vector node="12:9" size=40x24 file="assets\/card-logo.svg"/);
  assert.match(figm, /REMOTE_REFERENCE "A remote definition was unavailable" node="12:4"/);
  assert.doesNotMatch(figm, /opacity=1/);
  assert.doesNotMatch(figm, /blendMode="NORMAL"/);
  assert.doesNotMatch(figm, /layoutWrap="NO_WRAP"/);
  assert.equal(countNodes(context.roots), 4);
});

test("FIGM omits normalized noise while preserving implementation intent", () => {
  const context = fixtureContext();
  const root = context.roots[0];
  const title = root?.children?.[0];
  assert.ok(root && title);

  root.geometry = {
    ...root.geometry,
    constraints: { horizontal: "LEFT", vertical: "TOP" },
    layoutAlign: "INHERIT",
    layoutGrow: 0,
    layoutPositioning: "AUTO",
    maxHeight: null,
    maxWidth: null,
    minHeight: null,
    minWidth: null,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    targetAspectRatio: null,
  };
  root.layout = {
    ...root.layout,
    counterAxisAlignContent: "AUTO",
    counterAxisSpacing: 0,
    gridColumnCount: 0,
    gridColumnGap: 0,
    gridRowCount: 0,
    gridRowGap: 0,
    itemReverseZIndex: false,
    layoutGrids: [],
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "HUG",
    numberOfFixedChildren: 1,
    overflowDirection: "VERTICAL_SCROLLING",
    paddingBottom: 24,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 24,
    primaryAxisAlignItems: "MIN",
    scrollBehavior: "FIXED",
    strokesIncludedInLayout: false,
  };
  root.appearance = {
    ...root.appearance,
    backgroundColor: "#FFFFFF",
    bottomLeftRadius: 16,
    bottomRightRadius: 16,
    clipsContent: true,
    cornerSmoothing: 0,
    dashPattern: [],
    effectStyleId: "",
    effects: [],
    fillStyleId: "",
    maskType: "ALPHA",
    strokeAlign: "INSIDE",
    strokeCap: "NONE",
    strokeJoin: "MITER",
    strokeStyleId: "",
    strokeWeight: 1,
    strokes: [],
    topLeftRadius: 16,
    topRightRadius: 16,
  };
  root.component = {
    componentId: "ComponentID:card",
    componentProperties: { State: { type: "VARIANT", value: "Selected" } },
    exposedInstances: [],
    isExposedInstance: false,
    mainComponent: "ComponentID:card",
    overrides: [{ id: "12:4", overriddenFields: ["width"] }],
    properties: { State: { type: "VARIANT", value: "Selected" } },
    variantProperties: { State: "Selected" },
  };
  title.text = {
    ...title.text,
    characterStyleOverrides: [],
    hangingList: false,
    hangingPunctuation: false,
    listSpacing: 0,
    maxLines: null,
    paragraphIndent: 0,
    paragraphSpacing: 0,
    style: {
      fontFamily: "Inter",
      fontPostScriptName: "Inter-SemiBold",
      fontSize: 20,
      fontStyle: "Semi Bold",
      fontWeight: 600,
      letterSpacing: 0,
      lineHeightPercent: 100,
      lineHeightPx: 24,
      lineHeightUnit: "PIXELS",
      textAlignHorizontal: "LEFT",
      textAlignVertical: "TOP",
      textAutoResize: "HEIGHT",
    },
    styleOverrideTable: {},
    textAlignHorizontal: "LEFT",
    textAlignVertical: "TOP",
    textAutoResize: "HEIGHT",
    textTruncation: "DISABLED",
  };
  const titleRuns = title.text.runs;
  assert.ok(Array.isArray(titleRuns) && isRecord(titleRuns[1]));
  titleRuns[1].lineHeight = {};
  titleRuns[1].fills = [
    {
      gradientStops: [
        { color: "#FF0000", position: 0 },
        { color: "#0000FF", position: 1 },
      ],
      type: "GRADIENT_LINEAR",
    },
  ];
  const icon = root.children?.[1];
  assert.ok(icon?.appearance);
  icon.geometry.y = 180;
  icon.appearance.fills = [{ color: "#E9EFFC", opacity: 0.3, type: "SOLID", visible: false }];
  context.warnings.push(
    { code: "REMOTE_REFERENCE", message: "A remote definition was unavailable", nodeId: "12:5" },
    { code: "REMOTE_REFERENCE", message: "A remote definition was unavailable", nodeId: "12:9" },
  );

  const figm = serializeFigm(context);
  const rootLine = figm.split("\n").find((line) => line.startsWith('FRAME "Payment card"'));
  const titleLine = figm.split("\n").find((line) => line.startsWith('  TEXT "Title'));
  const fixedLine = figm
    .split("\n")
    .find((line) => line.startsWith('  RECTANGLE "Hidden alternate"'));
  const iconLine = figm.split("\n").find((line) => line.startsWith('  VECTOR "Card / logo"'));
  assert.ok(rootLine && titleLine && fixedLine && iconLine);

  assert.match(rootLine, /layoutMode="VERTICAL"/);
  assert.match(rootLine, /padding=24/);
  assert.match(rootLine, /layoutSizingVertical="HUG"/);
  assert.match(rootLine, /overflowDirection="VERTICAL_SCROLLING"/);
  assert.match(rootLine, /numberOfFixedChildren=1/);
  assert.match(rootLine, /scrollBehavior="FIXED"/);
  assert.match(rootLine, /component="Payment card"/);
  assert.match(rootLine, /variants=\{"State":"Selected"\}/);
  assert.match(titleLine, /font="Inter"\/600\/20/);
  assert.match(titleLine, /lineHeight=24/);
  assert.match(titleLine, /runs=\[/, "mixed rich text must retain its styled ranges");
  assert.match(titleLine, /"fills":\[/, "non-solid run paints must stay explicit");
  assert.match(fixedLine, /fixed=true/, "the topmost fixed child must be explicit");
  assert.match(iconLine, /clipped=partial/, "partially clipped content must be explicit");
  assert.doesNotMatch(
    figm,
    /undefined|#E9EFFC/,
    "invalid run values and hidden paints stay omitted",
  );

  for (const noise of [
    "relativeTransform=",
    "constraints=",
    "layoutAlign=",
    "layoutGrow=0",
    'layoutPositioning="AUTO"',
    "minWidth=null",
    "backgroundColor=",
    'blendMode="PASS_THROUGH"',
    'maskType="ALPHA"',
    "strokes=[]",
    "effects=[]",
    'fillStyleId=""',
    "componentId=",
    "componentProperties=",
    "overrides=",
    "isExposedInstance=",
    "characterStyleOverrides=",
    "styleOverrideTable=",
    "lineHeightPercent",
    "fontPostScriptName",
  ]) {
    assert.doesNotMatch(rootLine + titleLine, new RegExp(noise));
  }

  assert.match(
    figm,
    /REMOTE_REFERENCE "A remote definition was unavailable" count=3 nodes=\["12:4","12:5","12:9"\]/,
  );
});

test("FIGM lifts a uniform text run and deduplicates nested vector assets only in projection", () => {
  const context = fixtureContext();
  const root = context.roots[0];
  const title = root?.children?.[0];
  const icon = root?.children?.[1];
  assert.ok(root && title?.text && icon);
  const runs = title.text.runs;
  assert.ok(Array.isArray(runs) && isRecord(runs[0]));
  runs[0].textStyleId = "S:heading";
  title.text.characters = "Payment";
  title.text.runs = [runs[0]];

  const nested: DesignNode = {
    id: "12:11",
    type: "VECTOR",
    name: "Nested logo path",
    geometry: { height: 10, width: 10, x: 2, y: 2 },
    assetRefs: ["vector:12:11"],
  };
  icon.children = [nested];
  context.assets.push({
    id: "vector:12:11",
    kind: "vector",
    nodeId: "12:11",
    name: "Nested logo path",
    filename: "nested-logo-path.svg",
    status: "available",
    width: 10,
    height: 10,
  });

  const figm = serializeFigm(context);
  const titleLine = figm.split("\n").find((line) => line.startsWith('  TEXT "Title'));
  assert.ok(titleLine);
  assert.doesNotMatch(titleLine, /runs=/);
  assert.match(titleLine, /font="Inter"\/600\/20/);
  assert.match(titleLine, /lineHeight=24/);
  assert.match(titleLine, /textStyleId=\$Heading\/Small/);
  const keys = [...titleLine.matchAll(/(?:^| )([A-Za-z][A-Za-z0-9]*)=/g)].map((match) => match[1]);
  assert.equal(new Set(keys).size, keys.length, "uniform text must not emit duplicate keys");
  assert.doesNotMatch(figm, /Nested logo path/, "vector assets replace their descendant paths");
  assert.doesNotMatch(figm, /assets="vector:12:11"|"vector:12:11" vector/);

  const vectorAsset = context.assets.find((asset) => asset.id === icon.assetRefs?.[0]);
  assert.ok(vectorAsset);
  vectorAsset.status = "unavailable";
  assert.match(
    serializeFigm(context),
    /Nested logo path/,
    "unavailable vectors must keep their implementation fallback hierarchy",
  );

  const json = serializeJson(context);
  assert.match(json, /"id": "vector:12:11"/);
  assert.match(json, /"assetRefs": \[\n\s+"vector:12:11"/);
});

test("AI output adds only the documented compact instruction", () => {
  const context = fixtureContext();
  const figm = serializeFigm(context);
  const ai = serializeForAi(context);
  assert.ok(ai.endsWith(figm));
  assert.match(ai, /^Implement this design faithfully\./);
});

test("builds a stable virtual root for multiple selected nodes", () => {
  const first = fixtureContext().roots[0];
  const second = structuredClone(first);
  assert.ok(first && second);
  second.id = "22:4";
  second.name = "Second card";
  const virtual = createVirtualRoot(
    [first, second],
    [
      { x: 100, y: 200, width: 343, height: 188 },
      { x: 500, y: 250, width: 343, height: 188 },
    ],
  );
  assert.deepEqual(virtual.geometry, { x: 100, y: 200, width: 743, height: 238 });
  assert.deepEqual(
    virtual.children?.map((node) => [node.geometry.x, node.geometry.y]),
    [
      [0, 0],
      [400, 50],
    ],
  );
});

test("sniffs supported original image formats", () => {
  assert.deepEqual(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), {
    mime: "image/png",
    extension: "png",
  });
  assert.deepEqual(sniffImage(new Uint8Array([0xff, 0xd8])), {
    mime: "image/jpeg",
    extension: "jpg",
  });
  assert.deepEqual(sniffImage(new Uint8Array([0x47, 0x49, 0x46])), {
    mime: "image/gif",
    extension: "gif",
  });
});

test("retains only FIGM assets and assigns safe collision-free names", () => {
  const context = fixtureContext();
  const root = context.roots[0];
  assert.ok(root);
  root.assetRefs = ["vector:12:9", "vector:extra", "image:photo"];
  context.assets.push(
    {
      id: "vector:extra",
      kind: "vector",
      nodeId: "12:9",
      name: "Card / logo",
      filename: "unsafe.svg",
      status: "available",
    },
    {
      id: "image:photo",
      kind: "raster",
      nodeId: "12:4",
      name: "Card / logo",
      filename: "old.image",
      status: "available",
      imageHash: "hash",
    },
    {
      id: "vector:unused",
      kind: "vector",
      nodeId: "12:10",
      name: "Card / logo",
      filename: "unused.svg",
      status: "available",
    },
  );
  assert.equal(retainedAssetIds(context).has("vector:unused"), false);
  assignAssetFilenames(context, new Map([["image:photo", "jpg"]]));
  const names = retainedAssets(context).map((asset) => asset.filename);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
  assert.ok(names.includes("card-logo-2.svg"));
  assert.ok(names.includes("card-logo.jpg"));
});

test("compares canonical snapshots, including replacements, moves, definitions, and rendered assets", () => {
  const baseline = fixtureContext();
  const unchanged = structuredClone(baseline);
  assert.equal(compareContexts(baseline, unchanged).changed, false);

  const current = structuredClone(baseline);
  const root = current.roots[0];
  assert.ok(root?.children);
  const title = root.children[0];
  const icon = root.children[1];
  assert.ok(title && icon);
  root.children = [icon, title, ...root.children.slice(2)];
  if (root.appearance) delete root.appearance.cornerRadius;
  title.text = { ...title.text, characters: "Updated payment" };
  root.children.push({
    id: "12:30",
    type: "RECTANGLE",
    name: "New row",
    geometry: { x: 0, y: 160, width: 100, height: 20 },
  });
  const variable = current.definitions.variables["VariableID:color"];
  assert.ok(variable);
  variable.value = "#FFFFFF";

  const delta = compareContexts(baseline, current);
  assert.equal(delta.changed, true);
  assert.ok(delta.changes.added.some((item) => item.id === "12:30"));
  assert.ok(delta.changes.moved.some((item) => item.id === "12:5"));
  const updatedRoot = delta.changes.updated.find((item) => item.id === "12:4");
  assert.ok(updatedRoot);
  assert.equal(updatedRoot.replace, true);
  assert.equal("cornerRadius" in updatedRoot.node, false);
  assert.match(serializeDelta(delta), /^FIGM\/DELTA\/1\n/);
  assert.match(serializeDelta(delta), /"definitions"/);
});

test("marks rendered vector and screenshot changes as companion-asset changes", () => {
  const baseline = fixtureContext();
  const current = structuredClone(baseline);
  const root = current.roots[0];
  assert.ok(root?.children);
  const title = root.children[0];
  const icon = root.children[1];
  assert.ok(title && icon);
  icon.geometry.width = 48;
  title.text = { ...title.text, characters: "Changed" };
  const delta = compareContexts(baseline, current);
  assert.ok(delta.assetChanges.includes("screenshot:12:4"));
  assert.ok(delta.assetChanges.includes("vector:12:9"));
});

test("creates a readable ZIP without JSON and rejects unsafe or duplicate entries", () => {
  const archive = createZip([
    { name: "design.figm", data: "FIGM/1" },
    { name: "assets/logo.svg", data: "<svg />" },
  ]);
  const read16 = (offset: number): number =>
    (archive[offset] ?? 0) | ((archive[offset + 1] ?? 0) << 8);
  const read32 = (offset: number): number => read16(offset) | (read16(offset + 2) << 16);
  const names: string[] = [];
  for (let offset = 0; read32(offset) === 0x04034b50; ) {
    const nameLength = read16(offset + 26);
    const extraLength = read16(offset + 28);
    const size = read32(offset + 18) >>> 0;
    names.push(new TextDecoder().decode(archive.slice(offset + 30, offset + 30 + nameLength)));
    offset += 30 + nameLength + extraLength + size;
  }
  assert.deepEqual(names, ["design.figm", "assets/logo.svg"]);
  assert.doesNotMatch(names.join("\n"), /\.json/);
  assert.throws(() => createZip([{ name: "../secret", data: "no" }]));
  assert.throws(() =>
    createZip([
      { name: "same", data: "1" },
      { name: "same", data: "2" },
    ]),
  );
});

test("plugin UI keeps every scripted control and result target", () => {
  const html = readFileSync("src/ui.html", "utf8");
  for (const id of [
    "copy-ai",
    "copy-json",
    "copy-changes",
    "download-handoff",
    "prepare",
    "include-hidden",
    "include-all",
    "status",
    "status-bar",
    "baseline-status",
    "companion-notice",
    "download-from-notice",
    "selection-card",
    "selection-name",
    "selection-meta",
    "output-panel",
    "output-meta",
    "preview",
    "warnings-panel",
    "warnings",
    "assets-panel",
    "assets",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /https?:\/\//, "the local-only UI must not load remote resources");
});

test("copy actions copy generated output when processing finishes", () => {
  const ui = readFileSync("src/ui.ts", "utf8");
  assert.match(ui, /await copyText\(kind === "ai" \? output\.ai : output\.json\)/);
  const start = ui.lastIndexOf('if (message.type === "RESULT")');
  assert.notEqual(start, -1);
  const resultHandler = ui.slice(start);
  assert.match(resultHandler, /await copyOutput\(\s*action\.kind,\s*message\.output,/);
  assert.doesNotMatch(resultHandler, /click .* again to copy/);
});
