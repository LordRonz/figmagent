import type { DesignContext, DesignNode } from "../src/types";
import { fixtureContext } from "../test/fixture";

export function largeSelection(cards: number): DesignContext {
  const context = fixtureContext();
  const template = context.roots[0];
  if (!template) throw new Error("Missing fixture root");
  context.assets = [];
  const children = Array.from({ length: cards }, (_, index) => {
    const card = structuredClone(template);
    const remap = (node: DesignNode): void => {
      node.id = `${node.id}:${index}`;
      if (node.assetRefs) {
        node.assetRefs = [`vector:${node.id}`];
        context.assets.push({
          id: `vector:${node.id}`,
          kind: "vector",
          nodeId: node.id,
          name: "Icon",
          filename: `icon-${index}.svg`,
          status: "available",
        });
      }
      for (const child of node.children ?? []) remap(child);
    };
    remap(card);
    return card;
  });
  context.roots = [{ id: "root", type: "FRAME", name: "Large selection", geometry: {}, children }];
  context.source.selection = ["root"];
  context.assets.push({
    id: "screenshot:root",
    kind: "screenshot",
    nodeId: "root",
    name: "Reference",
    filename: "reference.png",
    status: "available",
  });
  return context;
}
