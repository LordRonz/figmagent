import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { serializeFigm, serializeJson } from "../src/serialize";
import type { DesignContext, DesignNode } from "../src/types";
import { fixtureContext } from "../test/fixture";

function cloneNode(node: DesignNode, suffix: number): DesignNode {
  const clone = structuredClone(node);
  const rewrite = (current: DesignNode): void => {
    current.id = `${current.id}-${suffix}`;
    for (const child of current.children ?? []) rewrite(child);
  };
  rewrite(clone);
  return clone;
}

function sized(count: number): DesignContext {
  const context = fixtureContext();
  const root = context.roots[0];
  if (!root) return context;
  context.roots = Array.from({ length: count }, (_, index) => cloneNode(root, index));
  context.source.selection = context.roots.map((node) => node.id);
  return context;
}

const fixtures = [sized(1), sized(5), sized(20)];
const savings = fixtures.map((context, index) => {
  const figmTokens = encode(serializeFigm(context)).length;
  const prettyTokens = encode(serializeJson(context)).length;
  const compactTokens = encode(JSON.stringify(context)).length;
  const saved = 1 - figmTokens / prettyTokens;
  console.log(
    `${["small", "medium", "large"][index]}: FIGM ${figmTokens}, pretty JSON ${prettyTokens}, compact JSON ${compactTokens}, saved ${(saved * 100).toFixed(1)}%`,
  );
  if (figmTokens > compactTokens * 1.05) {
    throw new Error("FIGM is materially larger than compact JSON for a benchmark fixture");
  }
  return saved;
});

const median = [...savings].sort((a, b) => a - b)[Math.floor(savings.length / 2)] ?? 0;
if (median < 0.3) throw new Error(`Median token savings ${(median * 100).toFixed(1)}% is below 30%`);
console.log(`median savings: ${(median * 100).toFixed(1)}%`);
