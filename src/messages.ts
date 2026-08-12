import type { AssetDescriptor, ExportOptions, GeneratedOutput } from "./types";

export type UiToPluginMessage =
  | { type: "READY" }
  | { type: "GENERATE"; requestId: number; options: ExportOptions }
  | { type: "EXPORT_ASSET"; requestId: number; asset: AssetDescriptor };

export type PluginToUiMessage =
  | {
      type: "SELECTION";
      selection: Array<{ id: string; name: string; type: string }>;
    }
  | { type: "RESULT"; requestId: number; output: GeneratedOutput }
  | { type: "STALE" }
  | {
      type: "ASSET";
      requestId: number;
      filename: string;
      mime: string;
      data: Uint8Array | string;
    }
  | { type: "ERROR"; requestId?: number; message: string };
