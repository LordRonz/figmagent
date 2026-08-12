export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ExportOptions {
  includeHidden: boolean;
  includeAllVariantsAndModes: boolean;
}

export interface ExportWarning {
  code: string;
  message: string;
  nodeId?: string;
}

export interface AssetDescriptor {
  id: string;
  kind: "screenshot" | "vector" | "raster";
  nodeId: string;
  name: string;
  filename: string;
  status: "available" | "unavailable";
  width?: number;
  height?: number;
  imageHash?: string;
}

export interface VariableDefinition {
  id: string;
  name: string;
  collection?: string;
  type?: string;
  mode?: string;
  value?: JsonValue;
  valuesByMode?: Record<string, JsonValue>;
  remote?: boolean;
}

export interface StyleDefinition {
  id: string;
  name: string;
  type: string;
  description?: string;
  remote?: boolean;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  key?: string;
  description?: string;
  remote?: boolean;
  variants?: Array<{ id: string; name: string; properties?: JsonObject }>;
}

export interface DefinitionTable {
  variables: Record<string, VariableDefinition>;
  styles: Record<string, StyleDefinition>;
  components: Record<string, ComponentDefinition>;
}

export interface DesignNode {
  id: string;
  type: string;
  name: string;
  visible?: boolean;
  geometry: JsonObject;
  layout?: JsonObject;
  appearance?: JsonObject;
  text?: JsonObject;
  component?: JsonObject;
  bindings?: JsonObject;
  interactions?: JsonValue[];
  annotations?: JsonValue[];
  devStatus?: JsonValue;
  devResources?: JsonValue[];
  assetRefs?: string[];
  children?: DesignNode[];
}

export interface DesignContext {
  schema: "figmagent.design-context/v1";
  source: {
    document: string;
    page: string;
    units: "px";
    selection: string[];
  };
  roots: DesignNode[];
  definitions: DefinitionTable;
  assets: AssetDescriptor[];
  warnings: ExportWarning[];
}

export interface GeneratedOutput {
  context: DesignContext;
  figm: string;
  ai: string;
  json: string;
  nodeCount: number;
}
