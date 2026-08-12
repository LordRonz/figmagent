import type { JsonObject, JsonValue } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byte(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function color(value: Record<string, unknown>): string | undefined {
  const keys = Object.keys(value);
  if (
    !keys.every((key) => key === "r" || key === "g" || key === "b" || key === "a") ||
    typeof value.r !== "number" ||
    typeof value.g !== "number" ||
    typeof value.b !== "number"
  ) {
    return undefined;
  }
  const alpha = typeof value.a === "number" ? byte(value.a) : "";
  return `#${byte(value.r)}${byte(value.g)}${byte(value.b)}${alpha}`;
}

export function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000) / 1_000;
}

export function normalizeValue(value: unknown): JsonValue | undefined {
  if (value === undefined || typeof value === "function") return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return round(value);
  if (typeof value === "symbol") return "mixed";
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = normalizeValue(item);
      return normalized === undefined ? [] : [normalized];
    });
  }
  if (isRecord(value)) {
    const normalizedColor = color(value);
    if (normalizedColor) return normalizedColor;
    const result: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeValue(value[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  return String(value);
}

export function normalizeObject(value: unknown): JsonObject {
  const normalized = normalizeValue(value);
  return isRecord(normalized) ? (normalized as JsonObject) : {};
}

export function stableStringify(value: JsonValue | object, space = 2): string {
  return JSON.stringify(sortDeep(value), null, space);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

export function sanitizeFilename(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned.slice(0, 80) || "asset";
}

export function countNodes(nodes: Array<{ children?: unknown[] }>): number {
  return nodes.reduce(
    (total, node) =>
      total + 1 + countNodes((node.children ?? []) as Array<{ children?: unknown[] }>),
    0,
  );
}
