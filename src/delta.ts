import { assetPath, retainedAssetIds, retainedAssets } from "./assets";
import { stableStringify } from "./plain";
import type {
  AssetDescriptor,
  DefinitionTable,
  DesignContext,
  DesignNode,
  ExportWarning,
  JsonObject,
} from "./types";

export interface NodePosition {
  parentId: string | null;
  index: number;
}

export interface AddedNode extends NodePosition {
  id: string;
  node: DesignNode;
}

export interface RemovedNode extends NodePosition {
  id: string;
}

export interface UpdatedNode extends NodePosition {
  id: string;
  replace: true;
  node: JsonObject;
}

export interface MovedNode {
  id: string;
  from: NodePosition;
  to: NodePosition;
}

export interface SnapshotDelta {
  baseline: string;
  current: string;
  changed: boolean;
  assetChanges: string[];
  changes: {
    added: AddedNode[];
    removed: RemovedNode[];
    updated: UpdatedNode[];
    moved: MovedNode[];
  };
  scope: DesignContext["source"];
  definitions: DefinitionTable;
  assets: AssetDescriptor[];
  warnings: ExportWarning[];
}

interface FlattenedNode {
  node: DesignNode;
  parentId: string | null;
  index: number;
}

function flatten(
  nodes: DesignNode[],
  parentId: string | null,
  result = new Map<string, FlattenedNode>(),
): Map<string, FlattenedNode> {
  for (const [index, node] of nodes.entries()) {
    result.set(node.id, { node, parentId, index });
    flatten(node.children ?? [], node.id, result);
  }
  return result;
}

function nodeProperties(node: DesignNode): JsonObject {
  const { children: _children, ...properties } = node;
  return properties;
}

function same(value: unknown, other: unknown): boolean {
  return stableStringify(value as object, 0) === stableStringify(other as object, 0);
}

function position(item: FlattenedNode): NodePosition {
  return { parentId: item.parentId, index: item.index };
}

function descendantsOf(rootId: string, nodes: Map<string, FlattenedNode>): Set<string> {
  // ponytail: O(n²) ancestor walk; selections are bounded by extraction warnings, so an index is not worth the code yet.
  const result = new Set<string>();
  for (const [id, item] of nodes) {
    let parentId = item.parentId;
    while (parentId !== null) {
      if (parentId === rootId) {
        result.add(id);
        break;
      }
      parentId = nodes.get(parentId)?.parentId ?? null;
    }
  }
  result.add(rootId);
  return result;
}

function descriptorChanged(baseline: DesignContext, current: DesignContext, id: string): boolean {
  const before = baseline.assets.find((asset) => asset.id === id);
  const after = current.assets.find((asset) => asset.id === id);
  return !same(before ?? null, after ?? null);
}

function changedAssetIds(
  baseline: DesignContext,
  current: DesignContext,
  changedNodeIds: Set<string>,
): string[] {
  const ids = new Set([
    ...baseline.assets.map((asset) => asset.id),
    ...current.assets.map((asset) => asset.id),
  ]);
  const beforeNodes = flatten(baseline.roots, null);
  const afterNodes = flatten(current.roots, null);
  const beforeRetained = retainedAssetIds(baseline);
  const afterRetained = retainedAssetIds(current);
  const changed = new Set<string>();
  for (const id of ids) {
    if (
      descriptorChanged(baseline, current, id) ||
      beforeRetained.has(id) !== afterRetained.has(id)
    ) {
      changed.add(id);
      continue;
    }
    const asset = current.assets.find((candidate) => candidate.id === id);
    if (!asset || (asset.kind !== "vector" && asset.kind !== "screenshot")) continue;
    const subtree = descendantsOf(asset.nodeId, afterNodes);
    if ([...changedNodeIds].some((nodeId) => subtree.has(nodeId))) changed.add(id);
    if (!afterNodes.has(asset.nodeId) && beforeNodes.has(asset.nodeId)) changed.add(id);
  }
  return [...changed].sort();
}

export function snapshotId(context: DesignContext): string {
  const text = stableStringify(context, 0);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `snapshot:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function compareContexts(baseline: DesignContext, current: DesignContext): SnapshotDelta {
  const before = flatten(baseline.roots, null);
  const after = flatten(current.roots, null);
  const addedIds = new Set<string>();
  const removedIds = new Set<string>();
  const added: AddedNode[] = [];
  const removed: RemovedNode[] = [];
  const updated: UpdatedNode[] = [];
  const moved: MovedNode[] = [];

  for (const id of after.keys()) {
    if (!before.has(id)) addedIds.add(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removedIds.add(id);
  }

  for (const [id, item] of [...after].sort(([a], [b]) => a.localeCompare(b))) {
    if (!addedIds.has(id) || (item.parentId !== null && addedIds.has(item.parentId))) continue;
    added.push({ id, parentId: item.parentId, index: item.index, node: item.node });
  }
  for (const [id, item] of [...before].sort(([a], [b]) => a.localeCompare(b))) {
    if (!removedIds.has(id) || (item.parentId !== null && removedIds.has(item.parentId))) continue;
    removed.push({ id, parentId: item.parentId, index: item.index });
  }

  for (const [id, item] of [...after].sort(([a], [b]) => a.localeCompare(b))) {
    const previous = before.get(id);
    if (!previous || addedIds.has(id)) continue;
    if (!same(nodeProperties(previous.node), nodeProperties(item.node))) {
      updated.push({
        id,
        parentId: item.parentId,
        index: item.index,
        replace: true,
        node: nodeProperties(item.node),
      });
    }
    if (previous.parentId !== item.parentId || previous.index !== item.index) {
      moved.push({ id, from: position(previous), to: position(item) });
    }
  }

  const assetChanges = changedAssetIds(
    baseline,
    current,
    new Set([
      ...updated.map((item) => item.id),
      ...moved.map((item) => item.id),
      ...addedIds,
      ...removedIds,
    ]),
  );
  const definitionsChanged = !same(baseline.definitions, current.definitions);
  const sourceChanged = !same(baseline.source, current.source);
  const warningsChanged = !same(baseline.warnings, current.warnings);
  const changed =
    added.length > 0 ||
    removed.length > 0 ||
    updated.length > 0 ||
    moved.length > 0 ||
    definitionsChanged ||
    assetChanges.length > 0 ||
    sourceChanged ||
    warningsChanged;

  return {
    baseline: snapshotId(baseline),
    current: snapshotId(current),
    changed,
    assetChanges,
    changes: { added, removed, updated, moved },
    scope: current.source,
    definitions: current.definitions,
    assets: retainedAssets(current),
    warnings: current.warnings,
  };
}

export function serializeDelta(delta: SnapshotDelta): string {
  return `FIGM/DELTA/1\n${stableStringify({
    baseline: delta.baseline,
    current: delta.current,
    scope: delta.scope,
    changes: delta.changes,
    assetChanges: delta.assetChanges,
    definitions: delta.definitions,
    assets: delta.assets.map((asset) => ({ ...asset, file: assetPath(asset) })),
    warnings: delta.warnings,
  })}`;
}

export const compareSnapshots = compareContexts;
export const serializeSnapshotDelta = serializeDelta;
