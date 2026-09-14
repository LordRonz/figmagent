import { retainedAssets } from "./assets";
import {
  exportAsset,
  extractSelection,
  prepareAssetFilenames,
  prepareHandoffAssets,
} from "./extract";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import type { ExportOptions, GeneratedOutput } from "./types";

declare const __html__: string;

figma.showUI(__html__, {
  width: 400,
  height: 680,
  title: "Figmagent",
  themeColors: true,
});

interface CachedOutput {
  key: string;
  revision: number;
  output: GeneratedOutput;
}

class StaleRequest extends Error {
  constructor() {
    super("The selection or design changed while the export was running");
  }
}

let cache: CachedOutput | undefined;
let revision = 0;

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function selectionKey(options: ExportOptions): string {
  const ids = figma.currentPage.selection.map((node) => node.id).sort();
  return JSON.stringify([
    figma.currentPage.id,
    ids,
    options.includeHidden,
    options.includeAllVariantsAndModes,
    options.omitLayerNames === true,
  ]);
}

function sendSelection(): void {
  post({
    type: "SELECTION",
    pageId: figma.currentPage.id,
    revision,
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

function sendStale(requestId: number): void {
  post({ type: "STALE", requestId, revision });
}

function isCurrent(requestRevision: number, scopeKey: string, options: ExportOptions): boolean {
  return requestRevision === revision && scopeKey === selectionKey(options);
}

async function generatedOutput(
  options: ExportOptions,
  requestRevision: number,
  scopeKey: string,
): Promise<GeneratedOutput> {
  if (!isCurrent(requestRevision, scopeKey, options)) throw new StaleRequest();
  if (cache?.key === scopeKey && cache.revision === requestRevision) return cache.output;
  const output = await extractSelection(options);
  if (!isCurrent(requestRevision, scopeKey, options)) throw new StaleRequest();
  await prepareAssetFilenames(output);
  if (!isCurrent(requestRevision, scopeKey, options)) throw new StaleRequest();
  cache = { key: scopeKey, revision: requestRevision, output };
  return output;
}

function invalidate(): void {
  revision += 1;
  cache = undefined;
  post({ type: "STALE", revision });
}

figma.on("selectionchange", () => {
  invalidate();
  sendSelection();
});

let watchedPage = figma.currentPage;
const invalidateForDocumentChange = () => invalidate();
watchedPage.on("nodechange", invalidateForDocumentChange);
figma.on("currentpagechange", () => {
  watchedPage.off("nodechange", invalidateForDocumentChange);
  watchedPage = figma.currentPage;
  watchedPage.on("nodechange", invalidateForDocumentChange);
  invalidate();
  sendSelection();
});

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  if (message.type === "READY") {
    sendSelection();
    return;
  }

  if (message.type === "GENERATE") {
    try {
      const output = await generatedOutput(message.options, message.revision, message.scopeKey);
      if (!isCurrent(message.revision, message.scopeKey, message.options)) throw new StaleRequest();
      post({
        type: "RESULT",
        requestId: message.requestId,
        revision: message.revision,
        scopeKey: message.scopeKey,
        output,
      });
    } catch (error) {
      if (
        error instanceof StaleRequest ||
        !isCurrent(message.revision, message.scopeKey, message.options)
      )
        sendStale(message.requestId);
      else sendError(error, message.requestId);
    }
    return;
  }

  if (message.type === "DOWNLOAD_HANDOFF") {
    try {
      const output = await generatedOutput(message.options, message.revision, message.scopeKey);
      if (!isCurrent(message.revision, message.scopeKey, message.options)) throw new StaleRequest();
      const total = retainedAssets(output.context).length;
      post({
        type: "BUNDLE_PROGRESS",
        requestId: message.requestId,
        revision: message.revision,
        scopeKey: message.scopeKey,
        phase: "assets",
        completed: 0,
        total,
      });
      const assets = await prepareHandoffAssets(output, (progress) => {
        if (!isCurrent(message.revision, message.scopeKey, message.options))
          throw new StaleRequest();
        post({
          type: "BUNDLE_PROGRESS",
          requestId: message.requestId,
          revision: message.revision,
          scopeKey: message.scopeKey,
          phase: "assets",
          completed: progress.completed,
          total: progress.total,
        });
      });
      if (!isCurrent(message.revision, message.scopeKey, message.options)) throw new StaleRequest();
      cache = { key: message.scopeKey, revision: message.revision, output };
      for (const asset of assets) {
        if (!isCurrent(message.revision, message.scopeKey, message.options))
          throw new StaleRequest();
        post({
          type: "BUNDLE_ASSET",
          requestId: message.requestId,
          revision: message.revision,
          scopeKey: message.scopeKey,
          assetId: asset.id,
          filename: asset.filename,
          mime: asset.mime,
          data: asset.data,
        });
      }
      post({
        type: "BUNDLE_RESULT",
        requestId: message.requestId,
        revision: message.revision,
        scopeKey: message.scopeKey,
        output,
      });
    } catch (error) {
      if (
        error instanceof StaleRequest ||
        !isCurrent(message.revision, message.scopeKey, message.options)
      )
        sendStale(message.requestId);
      else sendError(error, message.requestId);
    }
    return;
  }

  if (message.type === "EXPORT_ASSET") {
    try {
      if (!cache || cache.revision !== message.revision || cache.key !== message.scopeKey)
        throw new Error("Generate the selection again before downloading this asset");
      const knownAsset = cache.output.context.assets.find((asset) => asset.id === message.asset.id);
      if (!knownAsset)
        throw new Error("Generate the selection again before downloading this asset");
      const result = await exportAsset(knownAsset);
      if (!cache || cache.revision !== message.revision || cache.key !== message.scopeKey) {
        sendStale(message.requestId);
        return;
      }
      post({
        type: "ASSET",
        requestId: message.requestId,
        revision: message.revision,
        scopeKey: message.scopeKey,
        filename: result.filename,
        mime: result.mime,
        data: result.data,
      });
    } catch (error) {
      if (!cache || cache.revision !== message.revision || cache.key !== message.scopeKey)
        sendStale(message.requestId);
      else sendError(error, message.requestId);
    }
  }
};
