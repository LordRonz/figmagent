import assert from "node:assert/strict";
import test from "node:test";
import { assignAssetFilenames } from "../src/assets";
import { compareContexts, serializeDelta } from "../src/delta";
import { omitLayerNames } from "../src/omit-layer-names";
import { serializeFigm, serializeForAi, serializeJson } from "../src/serialize";
import type { DesignNode } from "../src/types";
import { fixtureContext } from "./fixture";

test("omits layer labels throughout exports while preserving implementation data", () => {
  const context = fixtureContext();
  const label = "INTERNAL-LAYER-LABEL";
  const labelNodes = (nodes: DesignNode[]): void => {
    for (const node of nodes) {
      node.name = label;
      labelNodes(node.children ?? []);
    }
  };
  labelNodes(context.roots);
  for (const component of Object.values(context.definitions.components)) {
    component.name = label;
    component.variants = [{ id: "variant:1", name: label, properties: { State: "Active" } }];
  }
  for (const asset of context.assets) {
    asset.name = label;
    asset.filename = `${label}.png`;
  }
  const original = structuredClone(context);
  omitLayerNames(context);
  const checkNodes = (nodes: DesignNode[], before: DesignNode[]): void => {
    for (const [index, node] of nodes.entries()) {
      const expected = { ...before[index] };
      delete expected.name;
      delete expected.children;
      const { children, ...actual } = node;
      assert.deepEqual(actual, expected);
      checkNodes(children ?? [], before[index]?.children ?? []);
    }
  };
  checkNodes(context.roots, original.roots);
  assert.deepEqual(context.source, original.source);
  assert.deepEqual(context.definitions.variables, original.definitions.variables);
  assert.deepEqual(context.definitions.styles, original.definitions.styles);
  assert.deepEqual(context.warnings, original.warnings);
  assignAssetFilenames(context); // Later handoff preparation must not restore names.
  for (const serialize of [serializeFigm, serializeForAi, serializeJson]) {
    const output = serialize(context);
    assert.ok(!output.includes(label));
    assert.match(output, /Payment\\nmethod/);
  }
  assert.match(serializeFigm(context), /FRAME id="12:4"/);
  const baseline = structuredClone(context);
  const root = context.roots[0];
  assert.ok(root);
  root.geometry.width = 400;
  const delta = serializeDelta(compareContexts(baseline, context));
  assert.ok(!delta.includes(label));
  assert.match(delta, /400/);
  const once = serializeJson(context);
  omitLayerNames(context);
  assert.equal(serializeJson(context), once);
});
