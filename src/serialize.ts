import { isRecord, stableStringify } from "./plain";
import type { DesignContext, DesignNode, JsonValue } from "./types";

const AI_PREAMBLE =
  "Implement this design faithfully. The FIGM/1 payload is authoritative, platform-neutral, and measured in pixels. Use the named companion assets where listed.\n\n";

function quote(value: string): string {
  return JSON.stringify(value);
}

function scalar(value: JsonValue): string {
  if (typeof value === "string") {
    return /^#[0-9A-F]{6,8}$/.test(value) || /^\$[\w/.-]+$/.test(value) ? value : quote(value);
  }
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}

function simplePaint(value: JsonValue | undefined): string | undefined {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return undefined;
  const paint = value[0];
  if (paint.type !== "SOLID" || typeof paint.color !== "string") return undefined;
  const opacity = typeof paint.opacity === "number" && paint.opacity !== 1 ? `/${paint.opacity}` : "";
  return `${paint.color}${opacity}`;
}

function pushSection(
  parts: string[],
  section: Record<string, JsonValue> | undefined,
  skip: Set<string> = new Set(),
) {
  if (!section) return;
  for (const [key, value] of Object.entries(section)) {
    if (!skip.has(key) && !isVisualDefault(key, value)) parts.push(`${key}=${scalar(value)}`);
  }
}

function isVisualDefault(key: string, value: JsonValue): boolean {
  return (
    (key === "opacity" && value === 1) ||
    (key === "blendMode" && value === "NORMAL") ||
    (key === "rotation" && value === 0) ||
    (key === "isMask" && value === false) ||
    (key === "clipsContent" && value === false) ||
    (key === "preserveRatio" && value === false) ||
    (key === "layoutMode" && value === "NONE") ||
    (key === "layoutWrap" && value === "NO_WRAP")
  );
}

function namedBindings(value: JsonValue, context: DesignContext): JsonValue {
  if (Array.isArray(value)) return value.map((item) => namedBindings(item, context));
  if (!isRecord(value)) return value;
  if (value.type === "VARIABLE_ALIAS" && typeof value.id === "string") {
    const variable = context.definitions.variables[value.id];
    if (!variable) return `$${value.id}`;
    return `$${variable.collection ? `${variable.collection}/` : ""}${variable.name}`;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, namedBindings(child, context)]),
  );
}

function namedStyleIds(value: JsonValue, context: DesignContext): JsonValue {
  if (Array.isArray(value)) return value.map((item) => namedStyleIds(item, context));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (/StyleId$/.test(key) && typeof child === "string") {
        const style = context.definitions.styles[child];
        return [key, style ? `$${style.name}` : child];
      }
      return [key, namedStyleIds(child, context)];
    }),
  );
}

function nodeLine(node: DesignNode, depth: number, context: DesignContext): string[] {
  const geometry = node.geometry;
  const parts = [node.type, quote(node.name), `id=${quote(node.id)}`];
  const width = geometry.width;
  const height = geometry.height;
  if (typeof width === "number" && typeof height === "number") parts.push(`size=${width}x${height}`);
  const x = geometry.x;
  const y = geometry.y;
  if ((typeof x === "number" && x !== 0) || (typeof y === "number" && y !== 0)) {
    parts.push(`position=${typeof x === "number" ? x : 0},${typeof y === "number" ? y : 0}`);
  }
  if (node.visible === false) parts.push("visible=false");

  pushSection(parts, geometry, new Set(["width", "height", "x", "y"]));
  pushSection(parts, node.layout);

  const fill = simplePaint(node.appearance?.fills);
  if (fill) parts.push(`fill=${fill}`);
  pushSection(parts, node.appearance ? (namedStyleIds(node.appearance, context) as Record<string, JsonValue>) : undefined, new Set(fill ? ["fills"] : []));

  if (node.text) {
    const characters = node.text.characters;
    if (typeof characters === "string") parts.push(`text=${quote(characters)}`);
    pushSection(parts, namedStyleIds(node.text, context) as Record<string, JsonValue>, new Set(["characters"]));
  }
  pushSection(parts, node.component);
  if (node.bindings) parts.push(`bindings=${scalar(namedBindings(node.bindings, context))}`);
  if (node.interactions?.length) parts.push(`interactions=${scalar(node.interactions)}`);
  if (node.annotations?.length) parts.push(`annotations=${scalar(node.annotations)}`);
  if (node.devStatus !== undefined) parts.push(`devStatus=${scalar(node.devStatus)}`);
  if (node.devResources?.length) parts.push(`devResources=${scalar(node.devResources)}`);
  if (node.assetRefs?.length) parts.push(`assets=${node.assetRefs.map(quote).join(",")}`);

  const lines = [`${"  ".repeat(depth)}${parts.join(" ")}`];
  for (const child of node.children ?? []) lines.push(...nodeLine(child, depth + 1, context));
  return lines;
}

function definitionLines(context: DesignContext): string[] {
  const lines: string[] = [];
  const variables = Object.values(context.definitions.variables);
  if (variables.length) {
    lines.push("variables:");
    for (const variable of variables.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = variable.collection ? `${variable.collection}/${variable.name}` : variable.name;
      const parts = [`  ${scalar(`$${path}`)}`, `id=${quote(variable.id)}`];
      if (variable.mode) parts.push(`mode=${quote(variable.mode)}`);
      if (variable.value !== undefined) parts.push(`value=${scalar(variable.value)}`);
      if (variable.valuesByMode) parts.push(`valuesByMode=${scalar(variable.valuesByMode)}`);
      lines.push(parts.join(" "));
    }
  }
  const components = Object.values(context.definitions.components);
  if (components.length) {
    lines.push("components:");
    for (const component of components.sort((a, b) => a.name.localeCompare(b.name))) {
      const parts = [`  ${quote(component.name)}`, `id=${quote(component.id)}`];
      if (component.description) parts.push(`description=${quote(component.description)}`);
      if (component.variants?.length) parts.push(`variants=${scalar(component.variants)}`);
      lines.push(parts.join(" "));
    }
  }
  const styles = Object.values(context.definitions.styles);
  if (styles.length) {
    lines.push("styles:");
    for (const style of styles.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${quote(style.name)} id=${quote(style.id)} type=${style.type}`);
    }
  }
  return lines;
}

export function serializeFigm(context: DesignContext): string {
  const lines = [
    "FIGM/1 units=px",
    `source document=${quote(context.source.document)} page=${quote(context.source.page)}`,
  ];
  for (const root of context.roots) lines.push(...nodeLine(root, 0, context));
  lines.push(...definitionLines(context));
  if (context.assets.length) {
    lines.push("assets:");
    for (const asset of context.assets) {
      const size =
        asset.width !== undefined && asset.height !== undefined
          ? ` size=${asset.width}x${asset.height}`
          : "";
      lines.push(`  ${quote(asset.id)} ${asset.kind} node=${quote(asset.nodeId)}${size} file=${quote(asset.filename)} status=${asset.status}`);
    }
  }
  if (context.warnings.length) {
    lines.push("warnings:");
    for (const warning of context.warnings) {
      lines.push(`  ${warning.code} ${quote(warning.message)}${warning.nodeId ? ` node=${quote(warning.nodeId)}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function serializeJson(context: DesignContext): string {
  return stableStringify(context);
}

export function serializeForAi(context: DesignContext): string {
  return AI_PREAMBLE + serializeFigm(context);
}
