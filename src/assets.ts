import { sanitizeFilename } from "./plain";
import type { AssetDescriptor, DesignContext } from "./types";

export function retainedAssetIds(context: DesignContext): Set<string> {
  const kinds = new Map(context.assets.map((asset) => [asset.id, asset.kind]));
  const retained = new Set(
    context.assets.filter((asset) => asset.kind === "screenshot").map((asset) => asset.id),
  );
  const visit = (node: DesignContext["roots"][number], vectorAncestor: boolean): void => {
    const refs = node.assetRefs ?? [];
    const hasVector = refs.some((id) => kinds.get(id) === "vector");
    for (const id of refs) {
      if (kinds.get(id) !== "vector" || !vectorAncestor) retained.add(id);
    }
    for (const child of node.children ?? []) visit(child, vectorAncestor || hasVector);
  };
  for (const root of context.roots) visit(root, false);
  return retained;
}

export function retainedAssets(context: DesignContext): AssetDescriptor[] {
  const retained = retainedAssetIds(context);
  return context.assets
    .filter((asset) => retained.has(asset.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function assetPath(asset: Pick<AssetDescriptor, "filename">): string {
  return `assets/${asset.filename}`;
}

function extensionFromFilename(filename: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  if (!match || match[1] === "image") return undefined;
  return match[1]?.toLowerCase();
}

function safeExtension(value: string | undefined): string {
  const extension = value?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return extension || "bin";
}

function assetStem(asset: AssetDescriptor): string {
  const stem = sanitizeFilename(asset.name).replace(/\.(?:bin|gif|image|jpe?g|png|svg)$/i, "");
  return asset.kind === "screenshot" ? `${stem || "asset"}-reference` : stem || "asset";
}

function assetExtension(asset: AssetDescriptor, extensions: Map<string, string>): string {
  if (asset.kind === "screenshot") return "png";
  if (asset.kind === "vector") return "svg";
  return safeExtension(extensions.get(asset.id) ?? extensionFromFilename(asset.filename));
}

function uniqueFilename(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem}-${suffix++}${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function assignAssetFilenames(
  context: DesignContext,
  extensions: Map<string, string> = new Map(),
): void {
  const used = new Set<string>();
  for (const asset of [...context.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = `${assetStem(asset)}.${assetExtension(asset, extensions)}`;
    asset.filename = uniqueFilename(base, used);
  }
}
