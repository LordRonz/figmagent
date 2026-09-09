import { assetPath, assignAssetFilenames, retainedAssets } from "./assets";
import { countNodes, isRecord, normalizeObject, normalizeValue, sanitizeFilename } from "./plain";
import { serializeFigm, serializeForAi, serializeJson } from "./serialize";
import type {
  AssetDescriptor,
  ComponentDefinition,
  DefinitionTable,
  DesignContext,
  DesignNode,
  ExportOptions,
  ExportWarning,
  GeneratedOutput,
  JsonObject,
  JsonValue,
  PreparedAsset,
  StyleDefinition,
  VariableDefinition,
} from "./types";

type RawNode = Record<string, unknown>;

const GEOMETRY_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "relativeTransform",
  "constraints",
  "layoutAlign",
  "layoutGrow",
  "layoutPositioning",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "preserveRatio",
  "targetAspectRatio",
] as const;

const LAYOUT_KEYS = [
  "layoutMode",
  "layoutWrap",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "counterAxisAlignContent",
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "strokesIncludedInLayout",
  "itemReverseZIndex",
  "gridRowCount",
  "gridColumnCount",
  "gridRowGap",
  "gridColumnGap",
  "gridColumnsSizing",
  "gridRowsSizing",
  "layoutGrids",
  "overflowDirection",
  "numberOfFixedChildren",
  "scrollBehavior",
] as const;

const APPEARANCE_KEYS = [
  "opacity",
  "blendMode",
  "isMask",
  "maskType",
  "clipsContent",
  "fills",
  "fillStyleId",
  "strokes",
  "strokeStyleId",
  "strokeWeight",
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "strokeAlign",
  "strokeCap",
  "strokeJoin",
  "dashPattern",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomRightRadius",
  "bottomLeftRadius",
  "cornerSmoothing",
  "effects",
  "effectStyleId",
  "backgroundColor",
] as const;

const TEXT_KEYS = [
  "characters",
  "style",
  "characterStyleOverrides",
  "styleOverrideTable",
  "textAutoResize",
  "textAlignHorizontal",
  "textAlignVertical",
  "textTruncation",
  "maxLines",
  "paragraphIndent",
  "paragraphSpacing",
  "listSpacing",
  "hangingPunctuation",
  "hangingList",
] as const;

const COMPONENT_KEYS = [
  "componentId",
  "componentProperties",
  "componentPropertyDefinitions",
  "variantProperties",
  "overrides",
  "isExposedInstance",
  "exposedInstances",
  "key",
  "remote",
  "description",
] as const;

interface ExtractionState {
  options: ExportOptions;
  definitions: DefinitionTable;
  assets: Map<string, AssetDescriptor>;
  warnings: ExportWarning[];
  variableTasks: Map<string, Promise<void>>;
  styleTasks: Map<string, Promise<void>>;
  componentTasks: Map<string, Promise<void>>;
}

function warn(
  state: ExtractionState,
  code: string,
  fallback: string,
  error: unknown,
  nodeId?: string,
): void {
  const warning: ExportWarning = {
    code,
    message: error instanceof Error ? error.message : fallback,
  };
  if (nodeId) warning.nodeId = nodeId;
  state.warnings.push(warning);
}

function actualValue(node: SceneNode | undefined, key: string): unknown {
  if (!node) return undefined;
  try {
    return (node as unknown as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function section(raw: RawNode, actual: SceneNode | undefined, keys: readonly string[]): JsonObject {
  const result: JsonObject = {};
  for (const key of keys) {
    const value = raw[key] ?? actualValue(actual, key);
    const normalized = normalizeValue(value);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function nonEmpty(value: JsonObject): JsonObject | undefined {
  return Object.keys(value).length ? value : undefined;
}

function descendants(root: SceneNode): SceneNode[] {
  if (!("findAll" in root)) return [root];
  return [root, ...root.findAll()];
}

function selectedRoots(): SceneNode[] {
  return [...figma.currentPage.selection].sort((a, b) => {
    const ay = a.absoluteBoundingBox?.y ?? 0;
    const by = b.absoluteBoundingBox?.y ?? 0;
    const ax = a.absoluteBoundingBox?.x ?? 0;
    const bx = b.absoluteBoundingBox?.x ?? 0;
    return ay - by || ax - bx || a.id.localeCompare(b.id);
  });
}

function collectAliases(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectAliases(item, result);
  } else if (isRecord(value)) {
    if (value.type === "VARIABLE_ALIAS" && typeof value.id === "string") result.add(value.id);
    for (const child of Object.values(value)) collectAliases(child, result);
  }
  return result;
}

function collectStyleIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectStyleIds(item, result);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (/StyleId$/.test(key) && typeof child === "string" && child) result.add(child);
      else collectStyleIds(child, result);
    }
  }
  return result;
}

async function resolveVariable(
  id: string,
  consumer: SceneNode,
  state: ExtractionState,
): Promise<void> {
  const existing = state.variableTasks.get(id);
  if (existing) return existing;
  const task = (async () => {
    try {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable) throw new Error("Variable is unavailable");
      const collection = await figma.variables.getVariableCollectionByIdAsync(
        variable.variableCollectionId,
      );
      const resolvedModes = actualValue(consumer, "resolvedVariableModes");
      const modeId = isRecord(resolvedModes)
        ? resolvedModes[variable.variableCollectionId]
        : undefined;
      const mode = collection?.modes.find((item) => item.modeId === modeId) ?? collection?.modes[0];
      const definition: VariableDefinition = {
        id,
        name: variable.name,
      };
      if (collection) definition.collection = collection.name;
      definition.type = variable.resolvedType;
      definition.remote = variable.remote;
      if (mode) definition.mode = mode.name;
      if (state.options.includeAllVariantsAndModes && collection) {
        const values: Record<string, JsonValue> = {};
        for (const candidate of collection.modes) {
          const value = normalizeValue(variable.valuesByMode[candidate.modeId]);
          if (value !== undefined) {
            values[candidate.name] = value;
            for (const alias of collectAliases(value)) void resolveVariable(alias, consumer, state);
          }
        }
        definition.valuesByMode = values;
      } else {
        const resolved = normalizeValue(variable.resolveForConsumer(consumer).value);
        if (resolved !== undefined) {
          definition.value = resolved;
          for (const alias of collectAliases(resolved))
            void resolveVariable(alias, consumer, state);
        }
      }
      state.definitions.variables[id] = definition;
    } catch (error) {
      warn(
        state,
        "VARIABLE_UNAVAILABLE",
        "A bound variable could not be resolved",
        error,
        consumer.id,
      );
    }
  })();
  state.variableTasks.set(id, task);
  return task;
}

async function resolveStyle(id: string, nodeId: string, state: ExtractionState): Promise<void> {
  const existing = state.styleTasks.get(id);
  if (existing) return existing;
  const task = (async () => {
    try {
      const style = await figma.getStyleByIdAsync(id);
      if (!style) throw new Error("Style is unavailable");
      const definition: StyleDefinition = { id, name: style.name, type: style.type };
      if (style.description) definition.description = style.description;
      definition.remote = style.remote;
      state.definitions.styles[id] = definition;
    } catch (error) {
      warn(state, "STYLE_UNAVAILABLE", "A referenced style could not be resolved", error, nodeId);
    }
  })();
  state.styleTasks.set(id, task);
  return task;
}

async function resolveComponent(
  node: InstanceNode,
  state: ExtractionState,
): Promise<ComponentNode | null> {
  try {
    const component = await node.getMainComponentAsync();
    if (!component) throw new Error("Main component is unavailable");
    const existing = state.componentTasks.get(component.id);
    if (!existing) {
      const task = (async () => {
        const definition: ComponentDefinition = {
          id: component.id,
          name: component.name,
          key: component.key,
          remote: component.remote,
        };
        if (component.description) definition.description = component.description;
        if (
          state.options.includeAllVariantsAndModes &&
          component.parent?.type === "COMPONENT_SET"
        ) {
          definition.variants = component.parent.children
            .filter((child): child is ComponentNode => child.type === "COMPONENT")
            .map((child) => {
              const variant: { id: string; name: string; properties?: JsonObject } = {
                id: child.id,
                name: child.name,
              };
              const properties = normalizeObject(child.variantProperties);
              if (Object.keys(properties).length) variant.properties = properties;
              return variant;
            });
        }
        state.definitions.components[component.id] = definition;
      })();
      state.componentTasks.set(component.id, task);
      await task;
    } else {
      await existing;
    }
    return component;
  } catch (error) {
    warn(
      state,
      "COMPONENT_UNAVAILABLE",
      "The main component could not be resolved",
      error,
      node.id,
    );
    return null;
  }
}

function imageHashes(node: SceneNode): string[] {
  const hashes = new Set<string>();
  for (const field of ["fills", "strokes"] as const) {
    const value = actualValue(node, field);
    if (!Array.isArray(value)) continue;
    for (const paint of value) {
      if (isRecord(paint) && paint.type === "IMAGE" && typeof paint.imageHash === "string") {
        hashes.add(paint.imageHash);
      }
    }
  }
  return [...hashes];
}

function addAssets(node: SceneNode, state: ExtractionState): string[] {
  const refs: string[] = [];
  for (const hash of imageHashes(node)) {
    const id = `image:${hash}`;
    if (!state.assets.has(id)) {
      state.assets.set(id, {
        id,
        kind: "raster",
        nodeId: node.id,
        name: node.name,
        filename: `${sanitizeFilename(node.name)}.image`,
        status: "available",
        width: node.width,
        height: node.height,
        imageHash: hash,
      });
    }
    refs.push(id);
  }
  const hasSvgExport = node.exportSettings.some((setting) => setting.format === "SVG");
  if (hasSvgExport || (!refs.length && node.isAsset)) {
    const id = `vector:${node.id}`;
    state.assets.set(id, {
      id,
      kind: "vector",
      nodeId: node.id,
      name: node.name,
      filename: `${sanitizeFilename(node.name)}.svg`,
      status: "available",
      width: node.width,
      height: node.height,
    });
    refs.push(id);
  }
  return refs;
}

async function styledText(node: TextNode): Promise<JsonValue[] | undefined> {
  const segments = node.getStyledTextSegments([
    "fontName",
    "fontSize",
    "fontWeight",
    "textDecoration",
    "textCase",
    "lineHeight",
    "letterSpacing",
    "fills",
    "textStyleId",
    "fillStyleId",
    "listOptions",
    "listSpacing",
    "indentation",
    "paragraphIndent",
    "paragraphSpacing",
    "hyperlink",
    "boundVariables",
  ]);
  const normalized = normalizeValue(segments);
  return Array.isArray(normalized) ? normalized : undefined;
}

async function extractPluginMetadata(
  raw: RawNode,
  actual: SceneNode | undefined,
  text: JsonObject | undefined,
  component: JsonObject | undefined,
  state: ExtractionState,
  root: boolean,
): Promise<{
  text?: JsonObject;
  component?: JsonObject;
  bindings?: JsonObject;
  interactions?: JsonValue[];
  annotations?: JsonValue[];
  devStatus?: JsonValue;
  devResources?: JsonValue[];
  assetRefs?: string[];
}> {
  if (!actual) return {};
  const result: {
    text?: JsonObject;
    component?: JsonObject;
    bindings?: JsonObject;
    interactions?: JsonValue[];
    annotations?: JsonValue[];
    devStatus?: JsonValue;
    devResources?: JsonValue[];
    assetRefs?: string[];
  } = {};

  if (actual.type === "TEXT") {
    try {
      const runs = await styledText(actual);
      if (runs?.length) result.text = { ...(text ?? {}), runs };
    } catch (error) {
      warn(
        state,
        "TEXT_RUNS_UNAVAILABLE",
        "Styled text ranges could not be read",
        error,
        actual.id,
      );
    }
  }

  if (actual.type === "INSTANCE") {
    const main = await resolveComponent(actual, state);
    const next = { ...(component ?? {}) };
    if (main) next.mainComponent = main.id;
    const properties = normalizeValue(actual.componentProperties);
    if (properties !== undefined) next.properties = properties;
    const overrides = normalizeValue(actual.overrides);
    if (overrides !== undefined) next.overrides = overrides;
    result.component = next;
  } else if (actual.type === "COMPONENT" || actual.type === "COMPONENT_SET") {
    const definition: ComponentDefinition = {
      id: actual.id,
      name: actual.name,
      key: actual.key,
      remote: actual.remote,
    };
    if (actual.description) definition.description = actual.description;
    state.definitions.components[actual.id] = definition;
  }

  const reactions = normalizeValue(actualValue(actual, "reactions"));
  const rawInteractions = normalizeValue(raw.interactions);
  const interactionValue = reactions ?? rawInteractions;
  if (Array.isArray(interactionValue) && interactionValue.length)
    result.interactions = interactionValue;

  const annotations = normalizeValue(actualValue(actual, "annotations"));
  if (Array.isArray(annotations) && annotations.length) result.annotations = annotations;
  const devStatus = normalizeValue(actualValue(actual, "devStatus"));
  if (devStatus !== undefined && devStatus !== null) result.devStatus = devStatus;

  const bindings = normalizeValue(actualValue(actual, "boundVariables") ?? raw.boundVariables);
  if (isRecord(bindings) && Object.keys(bindings).length) result.bindings = bindings as JsonObject;

  if (root || actual.type === "INSTANCE" || actual.type === "COMPONENT") {
    try {
      const resources = normalizeValue(
        await actual.getDevResourcesAsync({ includeChildren: false }),
      );
      if (Array.isArray(resources) && resources.length) result.devResources = resources;
    } catch (error) {
      warn(
        state,
        "DEV_RESOURCES_UNAVAILABLE",
        "Developer resources could not be read",
        error,
        actual.id,
      );
    }
  }

  const refs = addAssets(actual, state);
  if (refs.length) result.assetRefs = refs;

  const variableSource = [raw.boundVariables, actualValue(actual, "boundVariables"), result.text];
  const variableIds = collectAliases(variableSource);
  const styleIds = collectStyleIds([
    raw,
    ...["fillStyleId", "strokeStyleId", "effectStyleId", "textStyleId"].map((key) => ({
      [key]: actualValue(actual, key),
    })),
  ]);
  await Promise.all([
    ...[...variableIds].map((id) => resolveVariable(id, actual, state)),
    ...[...styleIds].map((id) => resolveStyle(id, actual.id, state)),
  ]);
  return result;
}

async function normalizeNode(
  raw: RawNode,
  actualById: Map<string, SceneNode>,
  state: ExtractionState,
  root = false,
): Promise<DesignNode | null> {
  const id = typeof raw.id === "string" ? raw.id : "unknown";
  const actual = actualById.get(id);
  const visible = raw.visible !== false && actualValue(actual, "visible") !== false;
  if (!root && !state.options.includeHidden && !visible) return null;

  const geometry = section(raw, actual, GEOMETRY_KEYS);
  const layout = nonEmpty(section(raw, actual, LAYOUT_KEYS));
  const appearance = nonEmpty(section(raw, actual, APPEARANCE_KEYS));
  const text = nonEmpty(section(raw, actual, TEXT_KEYS));
  const component = nonEmpty(section(raw, actual, COMPONENT_KEYS));
  const metadata = await extractPluginMetadata(raw, actual, text, component, state, root);

  const result: DesignNode = {
    id,
    type: typeof raw.type === "string" ? raw.type : (actual?.type ?? "UNKNOWN"),
    name: typeof raw.name === "string" ? raw.name : (actual?.name ?? "Unnamed"),
    geometry,
  };
  if (!visible) result.visible = false;
  if (layout) result.layout = layout;
  if (appearance) result.appearance = appearance;
  const finalText = metadata.text ?? text;
  const finalComponent = metadata.component ?? component;
  if (finalText) result.text = finalText;
  if (finalComponent) result.component = finalComponent;
  Object.assign(result, metadata);

  const rawChildren = Array.isArray(raw.children) ? raw.children.filter(isRecord) : [];
  const children = (
    await Promise.all(rawChildren.map((child) => normalizeNode(child, actualById, state)))
  ).filter((child): child is DesignNode => child !== null);
  if (children.length) result.children = children;
  return result;
}

async function exportedRoot(node: SceneNode): Promise<RawNode> {
  const exported = (await node.exportAsync({ format: "JSON_REST_V1" })) as unknown;
  if (!isRecord(exported) || !isRecord(exported.document)) {
    throw new Error(`Figma returned invalid REST JSON for ${node.name}`);
  }
  return exported.document;
}

function initialState(options: ExportOptions): ExtractionState {
  return {
    options,
    definitions: { variables: {}, styles: {}, components: {} },
    assets: new Map(),
    warnings: [],
    variableTasks: new Map(),
    styleTasks: new Map(),
    componentTasks: new Map(),
  };
}

async function settleDefinitionTasks(state: ExtractionState): Promise<void> {
  let taskCount = -1;
  while (
    taskCount !==
    state.variableTasks.size + state.styleTasks.size + state.componentTasks.size
  ) {
    taskCount = state.variableTasks.size + state.styleTasks.size + state.componentTasks.size;
    await Promise.all([
      ...state.variableTasks.values(),
      ...state.styleTasks.values(),
      ...state.componentTasks.values(),
    ]);
  }
}

function replaceVariableAliases(value: JsonValue, definitions: DefinitionTable): JsonValue {
  if (Array.isArray(value)) return value.map((item) => replaceVariableAliases(item, definitions));
  if (!isRecord(value)) return value;
  if (value.type === "VARIABLE_ALIAS" && typeof value.id === "string") {
    const variable = definitions.variables[value.id];
    return variable
      ? `$${variable.collection ? `${variable.collection}/` : ""}${variable.name}`
      : `$${value.id}`;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      replaceVariableAliases(child as JsonValue, definitions),
    ]),
  );
}

interface RootBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createVirtualRoot(roots: DesignNode[], bounds: RootBounds[]): DesignNode {
  const minX = Math.min(...bounds.map((box) => box.x));
  const minY = Math.min(...bounds.map((box) => box.y));
  const maxX = Math.max(...bounds.map((box) => box.x + box.width));
  const maxY = Math.max(...bounds.map((box) => box.y + box.height));
  const children = roots.map((root, index) => {
    const box = bounds[index];
    if (!box) return root;
    return { ...root, geometry: { ...root.geometry, x: box.x - minX, y: box.y - minY } };
  });
  return {
    id: "virtual:selection",
    type: "SELECTION",
    name: "Selected nodes",
    geometry: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    children,
  };
}

export async function extractSelection(options: ExportOptions): Promise<GeneratedOutput> {
  const selected = selectedRoots();
  if (!selected.length) throw new Error("Select at least one Figma layer or frame");
  const state = initialState(options);
  const roots: DesignNode[] = [];

  for (const selectedNode of selected) {
    const actualById = new Map(descendants(selectedNode).map((node) => [node.id, node]));
    try {
      const raw = await exportedRoot(selectedNode);
      const root = await normalizeNode(raw, actualById, state, true);
      if (root) roots.push(root);
    } catch (error) {
      state.warnings.push({
        code: "ROOT_EXPORT_FAILED",
        message: error instanceof Error ? error.message : "The selected root could not be exported",
        nodeId: selectedNode.id,
      });
    }
    const screenshotId = `screenshot:${selectedNode.id}`;
    state.assets.set(screenshotId, {
      id: screenshotId,
      kind: "screenshot",
      nodeId: selectedNode.id,
      name: selectedNode.name,
      filename: `${sanitizeFilename(selectedNode.name)}-reference.png`,
      status: "available",
      width: selectedNode.width,
      height: selectedNode.height,
    });
  }

  await settleDefinitionTasks(state);
  for (const variable of Object.values(state.definitions.variables)) {
    if (variable.value !== undefined)
      variable.value = replaceVariableAliases(variable.value, state.definitions);
    if (variable.valuesByMode) {
      for (const [mode, value] of Object.entries(variable.valuesByMode)) {
        variable.valuesByMode[mode] = replaceVariableAliases(value, state.definitions);
      }
    }
  }
  if (!roots.length)
    throw new Error(state.warnings[0]?.message ?? "No selection could be exported");

  const contextRoots =
    roots.length > 1
      ? [
          createVirtualRoot(
            roots,
            selected.map((node) => ({
              x: node.absoluteBoundingBox?.x ?? node.x,
              y: node.absoluteBoundingBox?.y ?? node.y,
              width: node.width,
              height: node.height,
            })),
          ),
        ]
      : roots;
  const context: DesignContext = {
    schema: "figmagent.design-context/v1",
    source: {
      document: figma.root.name,
      page: figma.currentPage.name,
      units: "px",
      selection: selected.map((node) => node.id),
    },
    roots: contextRoots,
    definitions: state.definitions,
    assets: [...state.assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
    warnings: state.warnings,
  };
  const nodeCount = countNodes(contextRoots);
  if (nodeCount > 2_000) {
    context.warnings.push({
      code: "LARGE_SELECTION",
      message: `This selection contains ${nodeCount} nodes; select a smaller subtree if the LLM context is too large.`,
    });
  }
  let figm = serializeFigm(context);
  let json = serializeJson(context);
  if (figm.length > 250_000 || json.length > 250_000) {
    context.warnings.push({
      code: "LARGE_OUTPUT",
      message: `Output size is ${figm.length.toLocaleString()} compact / ${json.length.toLocaleString()} JSON characters; select a smaller subtree if needed.`,
    });
    figm = serializeFigm(context);
    json = serializeJson(context);
  }
  return {
    context,
    figm,
    ai: serializeForAi(context),
    json,
    nodeCount,
  };
}

export function sniffImage(bytes: Uint8Array): { mime: string; extension: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", extension: "png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { mime: "image/gif", extension: "gif" };
  }
  return { mime: "application/octet-stream", extension: "bin" };
}

function refreshOutput(output: GeneratedOutput): void {
  output.figm = serializeFigm(output.context);
  output.ai = serializeForAi(output.context);
  output.json = serializeJson(output.context);
}

function filenameExtension(filename: string): string | undefined {
  return /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
}

export async function prepareAssetFilenames(output: GeneratedOutput): Promise<void> {
  const extensions = new Map<string, string>();
  for (const asset of retainedAssets(output.context).filter((item) => item.kind === "raster")) {
    try {
      const exported = await exportAsset(asset);
      asset.status = "available";
      const extension = filenameExtension(exported.filename);
      if (extension) extensions.set(asset.id, extension);
    } catch (error) {
      asset.status = "unavailable";
      output.context.warnings.push({
        code: "ASSET_UNAVAILABLE",
        message: error instanceof Error ? error.message : "A raster asset could not be read",
        nodeId: asset.nodeId,
      });
    }
  }
  assignAssetFilenames(output.context, extensions);
  refreshOutput(output);
}

export interface AssetExportProgress {
  completed: number;
  total: number;
  asset: AssetDescriptor;
}

export async function prepareHandoffAssets(
  output: GeneratedOutput,
  onProgress?: (progress: AssetExportProgress) => void,
): Promise<PreparedAsset[]> {
  const required = retainedAssets(output.context);
  const extensions = new Map<string, string>();
  const exported: PreparedAsset[] = [];
  for (const [index, asset] of required.entries()) {
    let result: Awaited<ReturnType<typeof exportAsset>>;
    try {
      result = await exportAsset(asset);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The asset could not be exported";
      throw new Error(`Required asset "${asset.name}" failed: ${detail}`);
    }
    asset.status = "available";
    const extension = filenameExtension(result.filename);
    if (extension) extensions.set(asset.id, extension);
    exported.push({
      id: asset.id,
      filename: asset.filename,
      mime: result.mime,
      data: result.data,
    });
    onProgress?.({ completed: index + 1, total: required.length, asset });
  }
  assignAssetFilenames(output.context, extensions);
  refreshOutput(output);
  return exported.map(({ id, mime, data }) => {
    const asset = output.context.assets.find((item) => item.id === id);
    if (!asset) throw new Error(`Prepared asset ${id} disappeared from the handoff`);
    return { id, filename: assetPath(asset), mime, data };
  });
}

export async function exportAsset(
  descriptor: AssetDescriptor,
): Promise<{ filename: string; mime: string; data: Uint8Array | string }> {
  if (descriptor.kind === "raster") {
    if (!descriptor.imageHash) throw new Error("This raster asset has no image hash");
    const image = figma.getImageByHash(descriptor.imageHash);
    if (!image) throw new Error("The original raster image is unavailable");
    const data = await image.getBytesAsync();
    const detected = sniffImage(data);
    return {
      filename: descriptor.filename.endsWith(`.${detected.extension}`)
        ? descriptor.filename
        : `${sanitizeFilename(descriptor.name)}.${detected.extension}`,
      mime: detected.mime,
      data,
    };
  }

  const node = await figma.getNodeByIdAsync(descriptor.nodeId);
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error("The source node no longer exists");
  }
  if (descriptor.kind === "vector") {
    const data = await node.exportAsync({ format: "SVG_STRING" });
    return { filename: descriptor.filename, mime: "image/svg+xml", data };
  }
  const longest = Math.max(node.width, node.height);
  const scale = longest > 4_096 ? 4_096 / longest : 1;
  const data = await node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale },
  });
  return { filename: descriptor.filename, mime: "image/png", data };
}
