import { exportAsset, extractSelection } from "./extract";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type { ExportOptions, GeneratedOutput } from "./types";

declare const __html__: string;

figma.showUI(__html__, {
  width: 400,
  height: 680,
  title: "Figmagent",
  themeColors: true,
});

let cache: { key: string; output: GeneratedOutput } | undefined;

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function selectionKey(options: ExportOptions): string {
  const ids = figma.currentPage.selection.map((node) => node.id).sort();
  return JSON.stringify([ids, options.includeHidden, options.includeAllVariantsAndModes]);
}

function sendSelection(): void {
  post({
    type: "SELECTION",
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
  });
}

function sendError(error: unknown, requestId?: number): void {
  const message = error instanceof Error ? error.message : "Unexpected plugin error";
  post(
    requestId === undefined ? { type: "ERROR", message } : { type: "ERROR", requestId, message },
  );
}

figma.on("selectionchange", () => {
  cache = undefined;
  sendSelection();
});

let watchedPage = figma.currentPage;
const invalidateForDocumentChange = () => {
  if (!cache) return;
  cache = undefined;
  post({ type: "STALE" });
};
watchedPage.on("nodechange", invalidateForDocumentChange);
figma.on("currentpagechange", () => {
  watchedPage.off("nodechange", invalidateForDocumentChange);
  watchedPage = figma.currentPage;
  watchedPage.on("nodechange", invalidateForDocumentChange);
});

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  if (message.type === "READY") {
    sendSelection();
    return;
  }

  if (message.type === "GENERATE") {
    try {
      const key = selectionKey(message.options);
      if (!cache || cache.key !== key)
        cache = { key, output: await extractSelection(message.options) };
      post({ type: "RESULT", requestId: message.requestId, output: cache.output });
    } catch (error) {
      sendError(error, message.requestId);
    }
    return;
  }

  if (message.type === "EXPORT_ASSET") {
    try {
      const knownAsset = cache?.output.context.assets.find(
        (asset) => asset.id === message.asset.id,
      );
      if (!knownAsset)
        throw new Error("Generate the selection again before downloading this asset");
      const result = await exportAsset(knownAsset);
      post({ type: "ASSET", requestId: message.requestId, ...result });
    } catch (error) {
      sendError(error, message.requestId);
    }
  }
};
