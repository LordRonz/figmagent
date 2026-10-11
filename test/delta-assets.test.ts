import assert from "node:assert/strict";
import test from "node:test";
import { compareContexts, snapshotId } from "../src/delta";
import { serializeJson } from "../src/serialize";
import { snapshotIdFromJson } from "../src/snapshot-hash";
import { fixtureContext } from "./fixture";

test("removing a descendant invalidates its ancestor screenshot", () => {
  const baseline = fixtureContext();
  const root = baseline.roots[0];
  assert.ok(root?.children);
  root.children = root.children.slice(0, 1);
  const current = structuredClone(baseline);
  current.roots[0]?.children?.shift();
  assert.ok(compareContexts(baseline, current).assetChanges.includes("screenshot:12:4"));
});

test("reusing serialized snapshot IDs preserves every delta field", () => {
  const baseline = fixtureContext();
  const current = structuredClone(baseline);
  const title = current.roots[0]?.children?.[0];
  assert.ok(title?.text);
  title.text.characters = "Updated 🚀";
  const fast = compareContexts(baseline, current, {
    baseline: snapshotId(baseline),
    current: snapshotIdFromJson(serializeJson(current)),
  });
  assert.deepEqual(fast, compareContexts(baseline, current));
});

test("moving a descendant invalidates both the old and new rendered ancestors", () => {
  const baseline = fixtureContext();
  const root = baseline.roots[0];
  assert.ok(root?.children);
  root.children = root.children.slice(0, 1);
  baseline.roots.push({ id: "other", type: "FRAME", geometry: {}, children: [] });
  baseline.assets.push({
    id: "screenshot:other",
    kind: "screenshot",
    nodeId: "other",
    name: "Other",
    filename: "other.png",
    status: "available",
  });
  const current = structuredClone(baseline);
  const title = current.roots[0]?.children?.shift();
  assert.ok(title);
  current.roots[1]?.children?.push(title);
  const changed = compareContexts(baseline, current).assetChanges;
  assert.ok(changed.includes("screenshot:12:4"));
  assert.ok(changed.includes("screenshot:other"));
});
