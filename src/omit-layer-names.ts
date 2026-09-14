import { assignAssetFilenames } from "./assets";
import type { DesignContext, DesignNode } from "./types";

// This removes layer labels, not sensitive content in text, metadata, or asset bytes.
export function omitLayerNames(context: DesignContext): void {
  const visit = (node: DesignNode): void => {
    delete node.name;
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of context.roots) visit(root);
  for (const component of Object.values(context.definitions.components)) {
    component.name = component.id;
    for (const variant of component.variants ?? []) variant.name = variant.id;
  }
  for (const asset of context.assets) asset.name = asset.id;
  assignAssetFilenames(context);
}
