import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVirtualRoot, sniffImage } from "../src/extract";
import { countNodes, normalizeValue, sanitizeFilename, stableStringify } from "../src/plain";
import { serializeFigm, serializeForAi, serializeJson } from "../src/serialize";
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
  assert.match(figm, /"vector:12:9" vector node="12:9" size=40x24 file="card-logo.svg"/);
  assert.match(figm, /REMOTE_REFERENCE "A remote definition was unavailable" node="12:4"/);
  assert.doesNotMatch(figm, /opacity=1/);
  assert.doesNotMatch(figm, /blendMode="NORMAL"/);
  assert.doesNotMatch(figm, /layoutWrap="NO_WRAP"/);
  assert.equal(countNodes(context.roots), 4);
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

test("plugin UI keeps every scripted control and result target", () => {
  const html = readFileSync("src/ui.html", "utf8");
  for (const id of [
    "copy-ai",
    "copy-json",
    "prepare",
    "include-hidden",
    "include-all",
    "status",
    "status-bar",
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
