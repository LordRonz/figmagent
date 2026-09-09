import { assetPath, retainedAssetIds } from "./assets";
import { groupWarnings, isRecord, stableStringify } from "./plain";
import type { DesignContext, DesignNode, JsonObject, JsonValue } from "./types";

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
  if (paint.type !== "SOLID" || typeof paint.color !== "string" || paint.visible === false)
    return undefined;
  const opacity =
    typeof paint.opacity === "number" && paint.opacity !== 1 ? `/${paint.opacity}` : "";
  return `${paint.color}${opacity}`;
}

function visiblePaints(value: JsonValue | undefined): JsonValue | undefined {
  if (!Array.isArray(value)) return value;
  const visible = value.filter((paint) => !isRecord(paint) || paint.visible !== false);
  return visible.length ? visible : undefined;
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
    Object.entries(value).map(([key, child]) => [key, namedBindings(child as JsonValue, context)]),
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
      return [key, namedStyleIds(child as JsonValue, context)];
    }),
  );
}

function isDefaultConstraints(value: JsonValue): boolean {
  return (
    isRecord(value) &&
    value.horizontal === "LEFT" &&
    value.vertical === "TOP" &&
    Object.keys(value).length === 2
  );
}

function isTranslationTransform(
  value: JsonValue,
  x: JsonValue | undefined,
  y: JsonValue | undefined,
): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const first = value[0];
  const second = value[1];
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === 3 &&
    second.length === 3 &&
    first[0] === 1 &&
    first[1] === 0 &&
    first[2] === (typeof x === "number" ? x : 0) &&
    second[0] === 0 &&
    second[1] === 1 &&
    second[2] === (typeof y === "number" ? y : 0)
  );
}

function pushGeometry(parts: string[], geometry: JsonObject): void {
  const omitted = new Set(["width", "height", "x", "y"]);
  for (const [key, value] of Object.entries(geometry)) {
    if (omitted.has(key) || value === null) continue;
    if (key === "relativeTransform" && isTranslationTransform(value, geometry.x, geometry.y))
      continue;
    if (key === "constraints" && isDefaultConstraints(value)) continue;
    if (
      (key === "rotation" && value === 0) ||
      (key === "layoutAlign" && value === "INHERIT") ||
      (key === "layoutGrow" && value === 0) ||
      (key === "layoutPositioning" && value === "AUTO") ||
      (key === "preserveRatio" && value === false)
    )
      continue;
    parts.push(`${key}=${scalar(value)}`);
  }
}

function paddingValue(layout: JsonObject): string | undefined {
  const keys = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;
  const values = keys.map((key) => layout[key]);
  if (!values.every((value): value is number => typeof value === "number")) return undefined;
  if (values.every((value) => value === 0)) return "";
  if (values.every((value) => value === values[0])) return String(values[0]);
  return values.join(",");
}

function pushLayout(parts: string[], layout: JsonObject | undefined): void {
  if (!layout) return;
  const mode = layout.layoutMode;
  const isAutoLayout = mode === "HORIZONTAL" || mode === "VERTICAL" || mode === "GRID";
  const padding = paddingValue(layout);
  const paddingKeys = new Set(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);

  for (const [key, value] of Object.entries(layout)) {
    if (paddingKeys.has(key) || value === null) continue;
    if (
      (key === "layoutMode" && value === "NONE") ||
      (key === "layoutWrap" && value === "NO_WRAP") ||
      (key === "counterAxisAlignContent" && value === "AUTO") ||
      (key === "itemSpacing" && value === 0) ||
      (key === "counterAxisSpacing" && value === 0) ||
      (key === "layoutSizingHorizontal" && value === "FIXED") ||
      (key === "layoutSizingVertical" && value === "FIXED") ||
      (key === "strokesIncludedInLayout" && value === false) ||
      (key === "itemReverseZIndex" && value === false) ||
      (key === "gridRowCount" && value === 0) ||
      (key === "gridColumnCount" && value === 0) ||
      (key === "gridRowGap" && value === 0) ||
      (key === "gridColumnGap" && value === 0) ||
      (key === "layoutGrids" && Array.isArray(value) && value.length === 0) ||
      (key === "overflowDirection" &&
        value === "NONE" &&
        (typeof layout.numberOfFixedChildren !== "number" || layout.numberOfFixedChildren === 0)) ||
      (key === "numberOfFixedChildren" && value === 0) ||
      (key === "scrollBehavior" && value === "SCROLLS")
    )
      continue;
    if (
      !isAutoLayout &&
      [
        "primaryAxisSizingMode",
        "counterAxisSizingMode",
        "primaryAxisAlignItems",
        "counterAxisAlignItems",
      ].includes(key)
    )
      continue;
    if ((key === "primaryAxisAlignItems" || key === "counterAxisAlignItems") && value === "MIN")
      continue;
    parts.push(`${key}=${scalar(value)}`);
  }
  if (padding) parts.push(`padding=${padding}`);
}

function pushAppearance(
  parts: string[],
  appearance: JsonObject | undefined,
  context: DesignContext,
): string | undefined {
  if (!appearance) return undefined;
  const named = namedStyleIds(appearance, context) as JsonObject;
  const fills = visiblePaints(named.fills);
  const strokes = visiblePaints(named.strokes);
  const fill = simplePaint(fills);
  const stroke = simplePaint(strokes);
  if (fill) parts.push(`fill=${fill}`);
  if (stroke) parts.push(`stroke=${stroke}`);

  const cornerRadius = named.cornerRadius;
  const sideRadii = new Set([
    "topLeftRadius",
    "topRightRadius",
    "bottomRightRadius",
    "bottomLeftRadius",
  ]);
  const strokeWeight = named.strokeWeight;
  const sideWeights = new Set([
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
  ]);

  for (const [key, value] of Object.entries(named)) {
    if (key === "fills") {
      if (!fill && fills !== undefined) parts.push(`fills=${scalar(fills)}`);
      continue;
    }
    if (key === "strokes") {
      if (!stroke && strokes !== undefined) parts.push(`strokes=${scalar(strokes)}`);
      continue;
    }
    if (value === null) continue;
    if (sideRadii.has(key) && value === cornerRadius) continue;
    if (sideWeights.has(key) && value === strokeWeight) continue;
    if (
      ((key === "fills" || key === "strokes" || key === "effects" || key === "dashPattern") &&
        Array.isArray(value) &&
        value.length === 0) ||
      ((key === "fillStyleId" || key === "strokeStyleId" || key === "effectStyleId") &&
        value === "") ||
      (key === "opacity" && value === 1) ||
      (key === "blendMode" && (value === "NORMAL" || value === "PASS_THROUGH")) ||
      (key === "isMask" && value === false) ||
      (key === "maskType" && value === "ALPHA") ||
      (key === "clipsContent" && value === false) ||
      (key === "strokeWeight" && value === 1 && !stroke) ||
      (key === "strokeAlign" && value === "INSIDE") ||
      (key === "strokeCap" && value === "NONE") ||
      (key === "strokeJoin" && value === "MITER") ||
      (key === "cornerRadius" && value === 0) ||
      (key === "cornerSmoothing" && value === 0) ||
      (key === "backgroundColor" && (value === "#00000000" || value === fill?.split("/")[0]))
    )
      continue;
    parts.push(`${key}=${scalar(value)}`);
  }
  return fill;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function fontValue(style: Record<string, unknown>): string | undefined {
  const family = stringValue(style.fontFamily);
  const size = numberValue(style.fontSize);
  if (!family || size === undefined) return undefined;
  return `${quote(family)}/${numberValue(style.fontWeight) ?? 400}/${size}`;
}

function lineHeightValue(style: Record<string, unknown>): JsonValue | undefined {
  const pixels = numberValue(style.lineHeightPx);
  if (pixels !== undefined) return pixels;
  const unit = stringValue(style.lineHeightUnit);
  if (unit === "AUTO") return "AUTO";
  const percent =
    numberValue(style.lineHeightPercentFontSize) ?? numberValue(style.lineHeightPercent);
  return percent === undefined ? undefined : `${percent}%`;
}

function isWeightName(style: string): boolean {
  return /^(thin|extra ?light|light|regular|medium|semi ?bold|bold|extra ?bold|black)$/i.test(
    style,
  );
}

function compactRun(
  run: Record<string, unknown>,
  baseStyle: Record<string, unknown>,
  baseFill: string | undefined,
  context: DesignContext,
): JsonObject {
  const result: JsonObject = {};
  const start = numberValue(run.start) ?? 0;
  const end = numberValue(run.end);
  if (end !== undefined) result.range = `${start}:${end}`;

  const fontName = isRecord(run.fontName) ? run.fontName : {};
  const runStyle = {
    fontFamily: fontName.family,
    fontSize: run.fontSize,
    fontWeight: run.fontWeight,
  };
  const font = fontValue(runStyle);
  if (font && font !== fontValue(baseStyle)) result.font = font;
  const fontStyle = stringValue(fontName.style);
  if (fontStyle && !isWeightName(fontStyle)) result.fontStyle = fontStyle;

  if (isRecord(run.lineHeight)) {
    const unit = stringValue(run.lineHeight.unit);
    const value = run.lineHeight.value;
    if (typeof value === "number" || typeof value === "string") {
      const lineHeight =
        unit === "PIXELS" && typeof value === "number"
          ? value
          : `${value}${unit === "PERCENT" ? "%" : ""}`;
      if (lineHeight !== lineHeightValue(baseStyle)) result.lineHeight = lineHeight;
    }
  }
  if (isRecord(run.letterSpacing) && typeof run.letterSpacing.value === "number") {
    const amount = run.letterSpacing.value;
    if (amount !== 0)
      result.letterSpacing = `${amount}${run.letterSpacing.unit === "PERCENT" ? "%" : "px"}`;
  }

  const fills = visiblePaints(namedBindings(run.fills as JsonValue, context));
  const fill = simplePaint(fills);
  if (fill && fill !== baseFill) result.fill = fill;
  else if (!fill && fills !== undefined) result.fills = fills;
  for (const key of ["textStyleId", "fillStyleId"] as const) {
    const value = run[key];
    if (typeof value === "string" && value) {
      const style = context.definitions.styles[value];
      result[key] = style ? `$${style.name}` : value;
    }
  }
  if (run.textCase !== undefined && run.textCase !== "ORIGINAL")
    result.textCase = run.textCase as JsonValue;
  if (run.textDecoration !== undefined && run.textDecoration !== "NONE")
    result.textDecoration = run.textDecoration as JsonValue;
  if (isRecord(run.listOptions) && run.listOptions.type !== "NONE")
    result.list = run.listOptions as JsonObject;
  for (const key of [
    "indentation",
    "listSpacing",
    "paragraphIndent",
    "paragraphSpacing",
  ] as const) {
    const value = run[key];
    if (typeof value === "number" && value !== 0) result[key] = value;
  }
  if (run.hyperlink !== undefined && run.hyperlink !== null)
    result.hyperlink = run.hyperlink as JsonValue;
  if (isRecord(run.boundVariables) && Object.keys(run.boundVariables).length)
    result.bindings = namedBindings(run.boundVariables as JsonValue, context);
  return result;
}

function pushText(
  parts: string[],
  text: JsonObject | undefined,
  context: DesignContext,
  baseFill: string | undefined,
): void {
  if (!text) return;
  if (typeof text.characters === "string") parts.push(`text=${quote(text.characters)}`);
  const style = isRecord(text.style) ? text.style : {};
  const font = fontValue(style);
  if (font) parts.push(`font=${font}`);
  const fontStyle = stringValue(style.fontStyle);
  if (fontStyle && !isWeightName(fontStyle)) parts.push(`fontStyle=${quote(fontStyle)}`);
  const lineHeight = lineHeightValue(style);
  if (lineHeight !== undefined) parts.push(`lineHeight=${scalar(lineHeight)}`);
  if (typeof style.letterSpacing === "number" && style.letterSpacing !== 0)
    parts.push(`letterSpacing=${style.letterSpacing}`);

  const horizontal = text.textAlignHorizontal ?? style.textAlignHorizontal;
  const vertical = text.textAlignVertical ?? style.textAlignVertical;
  if (horizontal !== undefined && horizontal !== "LEFT")
    parts.push(`textAlignHorizontal=${scalar(horizontal as JsonValue)}`);
  if (vertical !== undefined && vertical !== "TOP")
    parts.push(`textAlignVertical=${scalar(vertical as JsonValue)}`);
  const resize = text.textAutoResize ?? style.textAutoResize;
  if (resize !== undefined && resize !== "NONE")
    parts.push(`textAutoResize=${scalar(resize as JsonValue)}`);

  for (const [key, value] of Object.entries(text)) {
    if (
      [
        "characters",
        "style",
        "runs",
        "characterStyleOverrides",
        "styleOverrideTable",
        "textAlignHorizontal",
        "textAlignVertical",
        "textAutoResize",
      ].includes(key) ||
      value === null ||
      (key === "textTruncation" && value === "DISABLED") ||
      (["paragraphIndent", "paragraphSpacing", "listSpacing"].includes(key) && value === 0) ||
      (["hangingPunctuation", "hangingList"].includes(key) && value === false)
    )
      continue;
    parts.push(`${key}=${scalar(value)}`);
  }

  if (Array.isArray(text.runs)) {
    const runs = text.runs
      .filter((run): run is JsonObject => isRecord(run))
      .map((run) => compactRun(run, style, baseFill, context));
    if (runs.length === 1) {
      const run = runs[0];
      if (run) {
        for (const [key, value] of Object.entries(run)) {
          if (key === "range") continue;
          const rendered = key === "font" ? `font=${value}` : `${key}=${scalar(value)}`;
          const existing = parts.findIndex((part) => part.startsWith(`${key}=`));
          if (existing === -1) parts.push(rendered);
          else parts[existing] = rendered;
        }
      }
    } else if (runs.length > 1) {
      parts.push(`runs=${scalar(runs)}`);
    }
  }
}

function simplifiedProperties(value: JsonValue | undefined): JsonObject | undefined {
  if (!isRecord(value)) return undefined;
  const result: JsonObject = {};
  for (const [key, property] of Object.entries(value)) {
    result[key] =
      isRecord(property) && "value" in property ? (property.value as JsonValue) : property;
  }
  return Object.keys(result).length ? result : undefined;
}

function pushComponent(
  parts: string[],
  component: JsonObject | undefined,
  context: DesignContext,
): void {
  if (!component) return;
  const componentId =
    stringValue(component.mainComponent) ??
    stringValue(component.componentId) ??
    stringValue(component.id);
  if (componentId) {
    const definition = context.definitions.components[componentId];
    parts.push(`component=${quote(definition?.name ?? componentId)}`);
  }

  const variants = simplifiedProperties(component.variantProperties);
  if (variants) parts.push(`variants=${scalar(variants)}`);
  const properties = simplifiedProperties(component.properties ?? component.componentProperties);
  if (properties) {
    const nonVariants = Object.fromEntries(
      Object.entries(properties).filter(([key, value]) => variants?.[key] !== value),
    );
    if (Object.keys(nonVariants).length) parts.push(`properties=${scalar(nonVariants)}`);
  }

  for (const [key, value] of Object.entries(component)) {
    if (
      [
        "id",
        "componentId",
        "mainComponent",
        "componentProperties",
        "properties",
        "variantProperties",
        "overrides",
        "isExposedInstance",
        "exposedInstances",
      ].includes(key) ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      value === false
    )
      continue;
    parts.push(`${key}=${scalar(value)}`);
  }
}

type ClipState = "partial" | "full";

function childClipState(parent: DesignNode, child: DesignNode): ClipState | undefined {
  if (parent.appearance?.clipsContent !== true) return undefined;
  if (
    (typeof child.geometry.rotation === "number" && child.geometry.rotation !== 0) ||
    (child.geometry.relativeTransform !== undefined &&
      !isTranslationTransform(child.geometry.relativeTransform, child.geometry.x, child.geometry.y))
  )
    return undefined;
  const parentWidth = parent.geometry.width;
  const parentHeight = parent.geometry.height;
  const x = child.geometry.x ?? 0;
  const y = child.geometry.y ?? 0;
  const width = child.geometry.width;
  const height = child.geometry.height;
  if (
    typeof parentWidth !== "number" ||
    typeof parentHeight !== "number" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  )
    return undefined;
  if (x + width <= 0 || y + height <= 0 || x >= parentWidth || y >= parentHeight) return "full";
  if (x < 0 || y < 0 || x + width > parentWidth || y + height > parentHeight) return "partial";
  return undefined;
}

function nodeLine(
  node: DesignNode,
  depth: number,
  context: DesignContext,
  retainedAssets: Set<string>,
  fixed = false,
  clipped?: ClipState,
): string[] {
  const geometry = node.geometry;
  const parts = [node.type, quote(node.name), `id=${quote(node.id)}`];
  const width = geometry.width;
  const height = geometry.height;
  if (typeof width === "number" && typeof height === "number")
    parts.push(`size=${width}x${height}`);
  const x = geometry.x;
  const y = geometry.y;
  if ((typeof x === "number" && x !== 0) || (typeof y === "number" && y !== 0)) {
    parts.push(`position=${typeof x === "number" ? x : 0},${typeof y === "number" ? y : 0}`);
  }
  if (node.visible === false) parts.push("visible=false");
  if (fixed) parts.push("fixed=true");
  if (clipped) parts.push(`clipped=${clipped}`);

  pushGeometry(parts, geometry);
  pushLayout(parts, node.layout);
  const fill = pushAppearance(parts, node.appearance, context);
  pushText(parts, node.text, context, fill);
  pushComponent(parts, node.component, context);
  if (node.bindings) parts.push(`bindings=${scalar(namedBindings(node.bindings, context))}`);
  if (node.interactions?.length) parts.push(`interactions=${scalar(node.interactions)}`);
  if (node.annotations?.length) parts.push(`annotations=${scalar(node.annotations)}`);
  if (node.devStatus !== undefined) parts.push(`devStatus=${scalar(node.devStatus)}`);
  if (node.devResources?.length) parts.push(`devResources=${scalar(node.devResources)}`);
  const assetRefs = node.assetRefs?.filter((id) => retainedAssets.has(id));
  if (assetRefs?.length) parts.push(`assets=${assetRefs.map(quote).join(",")}`);

  const lines = [`${"  ".repeat(depth)}${parts.join(" ")}`];
  if (
    assetRefs?.some((id) =>
      context.assets.some(
        (asset) => asset.id === id && asset.kind === "vector" && asset.status === "available",
      ),
    )
  ) {
    return lines;
  }
  const children = node.children ?? [];
  const fixedCount =
    typeof node.layout?.numberOfFixedChildren === "number"
      ? Math.max(0, Math.min(children.length, node.layout.numberOfFixedChildren))
      : 0;
  const fixedStart = children.length - fixedCount;
  for (const [index, child] of children.entries()) {
    lines.push(
      ...nodeLine(
        child,
        depth + 1,
        context,
        retainedAssets,
        index >= fixedStart,
        childClipState(node, child),
      ),
    );
  }
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

function warningLines(context: DesignContext): string[] {
  const groups = groupWarnings(context.warnings);
  if (!groups.length) return [];
  const lines = ["warnings:"];
  for (const group of groups) {
    const count = group.count > 1 ? ` count=${group.count}` : "";
    const nodes =
      group.nodeIds.length > 1
        ? ` nodes=${scalar(group.nodeIds)}`
        : group.nodeIds.length === 1
          ? ` node=${quote(group.nodeIds[0] ?? "")}`
          : "";
    lines.push(`  ${group.code} ${quote(group.message)}${count}${nodes}`);
  }
  return lines;
}

export function serializeFigm(context: DesignContext): string {
  const lines = [
    "FIGM/1 units=px",
    `source document=${quote(context.source.document)} page=${quote(context.source.page)}`,
  ];
  const retainedAssets = retainedAssetIds(context);
  for (const root of context.roots) lines.push(...nodeLine(root, 0, context, retainedAssets));
  lines.push(...definitionLines(context));
  if (context.assets.length) {
    lines.push("assets:");
    for (const asset of context.assets.filter((item) => retainedAssets.has(item.id))) {
      const size =
        asset.width !== undefined && asset.height !== undefined
          ? ` size=${asset.width}x${asset.height}`
          : "";
      const status = asset.status === "available" ? "" : ` status=${asset.status}`;
      lines.push(
        `  ${quote(asset.id)} ${asset.kind} node=${quote(asset.nodeId)}${size} file=${quote(assetPath(asset))}${status}`,
      );
    }
  }
  lines.push(...warningLines(context));
  return lines.join("\n");
}

export function serializeJson(context: DesignContext): string {
  return stableStringify(context);
}

export function serializeForAi(context: DesignContext): string {
  return AI_PREAMBLE + serializeFigm(context);
}
