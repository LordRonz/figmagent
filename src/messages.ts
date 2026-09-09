import type { AssetDescriptor, ExportOptions, GeneratedOutput } from "./types";

export type UiToPluginMessage =
  | { type: "READY" }
  | {
      type: "GENERATE";
      requestId: number;
      revision: number;
      scopeKey: string;
      options: ExportOptions;
    }
  | {
      type: "DOWNLOAD_HANDOFF";
      requestId: number;
      revision: number;
      scopeKey: string;
      options: ExportOptions;
    }
  | {
      type: "EXPORT_ASSET";
      requestId: number;
      revision: number;
      scopeKey: string;
      asset: AssetDescriptor;
    };

export type PluginToUiMessage =
  | {
      type: "SELECTION";
      pageId: string;
      revision: number;
      selection: Array<{ id: string; name: string; type: string }>;
    }
  | {
      type: "RESULT";
      requestId: number;
      revision: number;
      scopeKey: string;
      output: GeneratedOutput;
    }
  | { type: "STALE"; requestId?: number; revision: number; scopeKey?: string }
  | {
      type: "ASSET";
      requestId: number;
      revision: number;
      scopeKey: string;
      filename: string;
      mime: string;
      data: Uint8Array | string;
    }
  | {
      type: "BUNDLE_PROGRESS";
      requestId: number;
      revision: number;
      scopeKey: string;
      phase: "assets";
      completed: number;
      total: number;
    }
  | {
      type: "BUNDLE_ASSET";
      requestId: number;
      revision: number;
      scopeKey: string;
      assetId: string;
      filename: string;
      mime: string;
      data: Uint8Array | string;
    }
  | {
      type: "BUNDLE_RESULT";
      requestId: number;
      revision: number;
      scopeKey: string;
      output: GeneratedOutput;
    }
  | { type: "ERROR"; requestId?: number; message: string };
