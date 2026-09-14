import { retainedAssets } from "./assets";
import { compareContexts, serializeDelta, snapshotId } from "./delta";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import { groupWarnings, sanitizeFilename } from "./plain";
import type { AssetDescriptor, DesignContext, ExportOptions, GeneratedOutput } from "./types";
import { createZip } from "./zip";

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
};

const copyAi = element<HTMLButtonElement>("copy-ai");
const copyAiLabel = element<HTMLElement>("copy-ai-label");
const copyJson = element<HTMLButtonElement>("copy-json");
const copyChangesButton = element<HTMLButtonElement>("copy-changes");
const downloadHandoffButton = element<HTMLButtonElement>("download-handoff");
const prepare = element<HTMLButtonElement>("prepare");
const includeHidden = element<HTMLInputElement>("include-hidden");
const includeAll = element<HTMLInputElement>("include-all");
const omitNames = element<HTMLInputElement>("omit-layer-names");
const status = element<HTMLElement>("status");
const statusBar = element<HTMLDivElement>("status-bar");
const baselineStatus = element<HTMLElement>("baseline-status");
const companionNotice = element<HTMLElement>("companion-notice");
const downloadFromNotice = element<HTMLButtonElement>("download-from-notice");
const selectionCard = element<HTMLElement>("selection-card");
const selectionName = element<HTMLElement>("selection-name");
const selectionMeta = element<HTMLElement>("selection-meta");
const outputPanel = element<HTMLElement>("output-panel");
const outputMeta = element<HTMLElement>("output-meta");
const preview = element<HTMLElement>("preview");
const warningsPanel = element<HTMLElement>("warnings-panel");
const warningsList = element<HTMLUListElement>("warnings");
const assetsPanel = element<HTMLElement>("assets-panel");
const assetsList = element<HTMLUListElement>("assets");

type ActionKind = "ai" | "json" | "preview" | "changes";
type PendingAction =
  | { kind: ActionKind; scopeKey: string; revision: number; viewRevision: number }
  | {
      kind: "asset";
      asset: AssetDescriptor;
      scopeKey: string;
      revision: number;
      viewRevision: number;
    }
  | { kind: "handoff"; scopeKey: string; revision: number; viewRevision: number };

interface Baseline {
  context: DesignContext;
  scopeKey: string;
  snapshot: string;
}

interface BundleAsset {
  filename: string;
  mime: string;
  data: Uint8Array | string;
}

let requestId = 0;
let viewRevision = 0;
let pluginRevision = 0;
const pending = new Map<number, PendingAction>();
const bundleAssets = new Map<number, Map<string, BundleAsset>>();
let hasSelection = false;
let pageId = "";
let selectedIds: string[] = [];
let cachedOutput: GeneratedOutput | undefined;
let cachedScopeKey = "";
let baseline: Baseline | undefined;

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function options(): ExportOptions {
  return {
    includeHidden: includeHidden.checked,
    includeAllVariantsAndModes: includeAll.checked,
    omitLayerNames: omitNames.checked,
  };
}

function currentScopeKey(): string {
  const current = options();
  return JSON.stringify([
    pageId,
    [...selectedIds].sort(),
    current.includeHidden,
    current.includeAllVariantsAndModes,
    current.omitLayerNames === true,
  ]);
}

function currentAction(action: PendingAction, scopeKey: string, revision: number): boolean {
  return (
    action.scopeKey === scopeKey &&
    action.revision === revision &&
    action.viewRevision === viewRevision &&
    action.scopeKey === currentScopeKey() &&
    action.revision === pluginRevision
  );
}

function canCopyChanges(): boolean {
  return hasSelection && baseline !== undefined && baseline.scopeKey === currentScopeKey();
}

function updateBaselineStatus(): void {
  if (!baseline) {
    baselineStatus.textContent = "No baseline yet · create a full handoff first.";
    return;
  }
  baselineStatus.textContent =
    baseline.scopeKey === currentScopeKey()
      ? `Baseline ${baseline.snapshot.slice(-8)} · compares against the last successful handoff`
      : "Baseline scope changed · create a new full handoff before copying changes.";
}

function setActionState(disabled: boolean): void {
  if (!disabled) {
    copyAi.removeAttribute("aria-busy");
    copyAiLabel.textContent = "Copy for AI";
  }
  copyAi.disabled = disabled || !hasSelection;
  copyJson.disabled = disabled || !hasSelection;
  copyChangesButton.disabled = disabled || !canCopyChanges();
  downloadHandoffButton.disabled = disabled || !hasSelection;
  prepare.disabled = disabled || !hasSelection;
  downloadFromNotice.disabled = disabled || !hasSelection;
}

function setBusy(message: string, aiLabel?: string): void {
  copyAi.setAttribute("aria-busy", String(aiLabel !== undefined));
  copyAiLabel.textContent = aiLabel ?? "Copy for AI";
  statusBar.dataset.tone = "busy";
  statusBar.setAttribute("aria-busy", "true");
  status.textContent = message;
  setActionState(true);
}

function setReady(message = "Ready", tone: "neutral" | "success" = "neutral"): void {
  statusBar.dataset.tone = tone;
  statusBar.removeAttribute("aria-busy");
  status.textContent = message;
  updateBaselineStatus();
  setActionState(false);
}

function setError(message: string): void {
  statusBar.dataset.tone = "error";
  statusBar.removeAttribute("aria-busy");
  status.textContent = message;
  updateBaselineStatus();
  setActionState(false);
}

function clearOutput(): void {
  cachedOutput = undefined;
  cachedScopeKey = "";
  outputPanel.classList.add("hidden");
  warningsPanel.classList.add("hidden");
  assetsPanel.classList.add("hidden");
}

function invalidateView(): void {
  viewRevision += 1;
  pending.clear();
  bundleAssets.clear();
  clearOutput();
  companionNotice.classList.add("hidden");
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Figma could not access the clipboard");
  }
}

function requestGenerate(kind: ActionKind): void {
  const id = ++requestId;
  const scopeKey = currentScopeKey();
  pending.set(id, { kind, scopeKey, revision: pluginRevision, viewRevision });
  setBusy(
    kind === "preview" ? "Preparing assets…" : "Generating design context…",
    kind === "ai" ? "Preparing context…" : undefined,
  );
  post({ type: "GENERATE", requestId: id, revision: pluginRevision, scopeKey, options: options() });
}

function requestHandoff(): void {
  const id = ++requestId;
  const scopeKey = currentScopeKey();
  pending.set(id, { kind: "handoff", scopeKey, revision: pluginRevision, viewRevision });
  bundleAssets.set(id, new Map());
  setBusy("Preparing handoff…");
  post({
    type: "DOWNLOAD_HANDOFF",
    requestId: id,
    revision: pluginRevision,
    scopeKey,
    options: options(),
  });
}

async function copyOutput(
  kind: "ai" | "json",
  output: GeneratedOutput,
  scopeKey: string,
  actionRevision: number,
  actionViewRevision: number,
): Promise<void> {
  setBusy("Copying design context…", kind === "ai" ? "Copying…" : undefined);
  try {
    await copyText(kind === "ai" ? output.ai : output.json);
    if (
      scopeKey !== currentScopeKey() ||
      actionRevision !== pluginRevision ||
      actionViewRevision !== viewRevision
    ) {
      setReady("The design changed; generate again to refresh output");
      return;
    }
    if (kind === "ai") establishBaseline(output, scopeKey);
    setReady(
      kind === "ai" ? "Copied FIGM/1 context · baseline updated" : "Copied JSON context",
      "success",
    );
  } catch (error) {
    setError(error instanceof Error ? error.message : "Copy failed");
  }
}

function establishBaseline(output: GeneratedOutput, scopeKey: string): void {
  const context = JSON.parse(output.json) as DesignContext;
  baseline = { context, scopeKey, snapshot: snapshotId(context) };
  companionNotice.classList.add("hidden");
  updateBaselineStatus();
}

async function copyChanges(
  output: GeneratedOutput,
  scopeKey: string,
  actionRevision: number,
  actionViewRevision: number,
): Promise<void> {
  if (!baseline || baseline.scopeKey !== scopeKey) {
    setReady("Selection or options changed; create a full handoff first");
    return;
  }
  const delta = compareContexts(baseline.context, output.context);
  if (!delta.changed) {
    companionNotice.classList.add("hidden");
    setReady("No changes to copy");
    return;
  }
  if (delta.assetChanges.length) {
    companionNotice.classList.remove("hidden");
    setReady("Companion assets changed; download a new handoff");
    return;
  }
  const deltaText = serializeDelta(delta);
  const useFullExport = deltaText.length > output.ai.length;
  try {
    await copyText(useFullExport ? output.ai : deltaText);
    if (
      scopeKey !== currentScopeKey() ||
      actionRevision !== pluginRevision ||
      actionViewRevision !== viewRevision
    ) {
      setReady("The design changed; generate again to refresh output");
      return;
    }
    establishBaseline(output, scopeKey);
    setReady(
      useFullExport
        ? "Changes exceeded the delta size; copied full FIGM/1 context · baseline updated"
        : "Copied changes · baseline updated",
      "success",
    );
  } catch (error) {
    setError(error instanceof Error ? error.message : "Copy changes failed");
  }
}

function renderOutput(output: GeneratedOutput): void {
  outputPanel.classList.remove("hidden");
  outputMeta.replaceChildren();
  const metrics: Array<readonly [string, string]> = [
    [output.nodeCount.toLocaleString(), "nodes"],
    [output.figm.length.toLocaleString(), "FIGM chars"],
    [output.json.length.toLocaleString(), "JSON chars"],
  ];
  for (const [value, label] of metrics) {
    const metric = document.createElement("div");
    metric.className = "metric";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const caption = document.createElement("span");
    caption.textContent = label;
    metric.append(strong, caption);
    outputMeta.append(metric);
  }
  preview.textContent =
    output.figm.length > 4_000
      ? `${output.figm.slice(0, 4_000)}\n… preview shortened`
      : output.figm;

  warningsList.replaceChildren();
  warningsPanel.classList.toggle("hidden", output.context.warnings.length === 0);
  for (const warning of groupWarnings(output.context.warnings)) {
    const item = document.createElement("li");
    item.className = "warning";
    const code = document.createElement("span");
    code.className = "warning-code";
    code.textContent = warning.code.replace(/_/g, " ");
    const message = document.createElement("span");
    message.className = "warning-message";
    message.textContent =
      warning.count === 1 ? warning.message : `${warning.message} · ${warning.count} occurrences`;
    item.append(code, message);
    warningsList.append(item);
  }

  assetsList.replaceChildren();
  assetsPanel.classList.toggle("hidden", output.context.assets.length === 0);
  for (const asset of output.context.assets) {
    const item = document.createElement("li");
    item.className = "asset";
    const kind = document.createElement("span");
    kind.className = "asset-kind";
    kind.textContent = asset.kind;
    const copy = document.createElement("div");
    copy.className = "asset-copy";
    const name = document.createElement("span");
    name.className = "asset-name";
    name.textContent = asset.name;
    const filename = document.createElement("span");
    filename.className = "asset-file";
    filename.textContent = asset.filename;
    copy.append(name, filename);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Download";
    button.addEventListener("click", () => {
      const id = ++requestId;
      const scopeKey = currentScopeKey();
      pending.set(id, { kind: "asset", asset, scopeKey, revision: pluginRevision, viewRevision });
      setBusy(`Exporting ${asset.name}…`);
      post({ type: "EXPORT_ASSET", requestId: id, revision: pluginRevision, scopeKey, asset });
    });
    item.append(kind, copy, button);
    assetsList.append(item);
  }
}

function download(filename: string, mime: string, data: Uint8Array | string): void {
  const part = typeof data === "string" ? data : (new Uint8Array(data).buffer as ArrayBuffer);
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function finishHandoff(
  id: number,
  output: GeneratedOutput,
  action: Extract<PendingAction, { kind: "handoff" }>,
): Promise<void> {
  const files = bundleAssets.get(id);
  if (!files || !currentAction(action, action.scopeKey, action.revision)) return;
  const required = retainedAssets(output.context);
  if (files.size !== required.length || required.some((asset) => !files.has(asset.id))) {
    setError("The handoff was incomplete; retry the download");
    return;
  }
  setBusy("Packaging handoff…");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (!currentAction(action, action.scopeKey, action.revision)) return;
  try {
    const entries = [
      { name: "design.figm", data: output.figm },
      ...[...files.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, file]) => ({ name: file.filename, data: file.data })),
    ];
    const archive = createZip(entries);
    const root = output.context.roots[0];
    const name = options().omitLayerNames
      ? "handoff"
      : root && root.type !== "SELECTION"
        ? (root.name ?? root.id)
        : output.context.source.document;
    const filename = `${sanitizeFilename(name)}.zip`;
    download(filename, "application/zip", archive);
    if (!currentAction(action, action.scopeKey, action.revision)) return;
    cachedOutput = output;
    cachedScopeKey = action.scopeKey;
    establishBaseline(output, action.scopeKey);
    setReady(`Downloaded ${filename} · baseline updated`, "success");
  } catch (error) {
    setError(
      error instanceof Error ? error.message : "Handoff packaging failed; retry the download",
    );
  }
}

copyAi.addEventListener("click", () => {
  if (!cachedOutput || cachedScopeKey !== currentScopeKey()) requestGenerate("ai");
  else void copyOutput("ai", cachedOutput, cachedScopeKey, pluginRevision, viewRevision);
});
copyJson.addEventListener("click", () => {
  if (!cachedOutput || cachedScopeKey !== currentScopeKey()) requestGenerate("json");
  else void copyOutput("json", cachedOutput, cachedScopeKey, pluginRevision, viewRevision);
});
copyChangesButton.addEventListener("click", () => {
  if (!baseline || baseline.scopeKey !== currentScopeKey()) {
    setReady("Selection or options changed; create a full handoff first");
    return;
  }
  if (!cachedOutput || cachedScopeKey !== currentScopeKey()) requestGenerate("changes");
  else void copyChanges(cachedOutput, cachedScopeKey, pluginRevision, viewRevision);
});
downloadHandoffButton.addEventListener("click", requestHandoff);
downloadFromNotice.addEventListener("click", requestHandoff);
prepare.addEventListener("click", () => requestGenerate("preview"));
for (const input of [includeHidden, includeAll, omitNames]) {
  input.addEventListener("change", () => {
    invalidateView();
    setReady("Options changed; create a new full handoff for this scope");
  });
}

window.onmessage = async (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
  const message = event.data.pluginMessage;
  if (!message) return;

  if (message.type === "SELECTION") {
    pluginRevision = message.revision;
    pageId = message.pageId;
    selectedIds = message.selection.map((item) => item.id);
    invalidateView();
    hasSelection = message.selection.length > 0;
    selectionCard.classList.toggle("has-selection", hasSelection);
    if (!hasSelection) {
      selectionName.textContent = "Nothing selected";
      selectionMeta.textContent = "Select a layer, component, or frame in Figma.";
    } else if (message.selection.length === 1) {
      const selected = message.selection[0];
      selectionName.textContent = selected?.name ?? "Selected layer";
      selectionMeta.textContent = `${selected?.type ?? "NODE"} · ${selected?.id ?? ""}`;
    } else {
      selectionName.textContent = `${message.selection.length} layers selected`;
      selectionMeta.textContent = message.selection.map((item) => item.name).join(", ");
    }
    updateBaselineStatus();
    setReady(hasSelection ? "Selection changed; ready to generate" : "Select something to begin");
    return;
  }

  if (message.type === "STALE") {
    pluginRevision = message.revision;
    invalidateView();
    setReady(
      baseline && baseline.scopeKey === currentScopeKey()
        ? "The design changed; generate again to compare changes"
        : "The design changed; create a new full handoff",
    );
    return;
  }

  if (message.type === "ERROR") {
    const action = message.requestId === undefined ? undefined : pending.get(message.requestId);
    if (message.requestId !== undefined && !action) return;
    if (message.requestId !== undefined) {
      pending.delete(message.requestId);
      bundleAssets.delete(message.requestId);
    }
    setError(
      action?.kind === "handoff"
        ? `Handoff failed: ${message.message}. Retry the download.`
        : message.message,
    );
    return;
  }

  if (message.type === "BUNDLE_PROGRESS") {
    const action = pending.get(message.requestId);
    if (action?.kind !== "handoff") return;
    if (!currentAction(action, message.scopeKey, message.revision)) return;
    setBusy(
      message.total
        ? `Exporting assets… ${message.completed}/${message.total}`
        : "Preparing handoff…",
    );
    return;
  }

  if (message.type === "BUNDLE_ASSET") {
    const action = pending.get(message.requestId);
    if (action?.kind !== "handoff") return;
    if (!currentAction(action, message.scopeKey, message.revision)) return;
    bundleAssets.get(message.requestId)?.set(message.assetId, {
      filename: message.filename,
      mime: message.mime,
      data: message.data,
    });
    return;
  }

  if (message.type === "BUNDLE_RESULT") {
    const action = pending.get(message.requestId);
    if (action?.kind !== "handoff") return;
    if (!currentAction(action, message.scopeKey, message.revision)) return;
    pending.delete(message.requestId);
    await finishHandoff(message.requestId, message.output, action);
    bundleAssets.delete(message.requestId);
    return;
  }

  if (message.type === "ASSET") {
    const action = pending.get(message.requestId);
    if (action?.kind !== "asset") return;
    if (!currentAction(action, message.scopeKey, message.revision)) return;
    pending.delete(message.requestId);
    download(message.filename, message.mime, message.data);
    setReady(`Downloaded ${message.filename}`, "success");
    return;
  }

  if (message.type === "RESULT") {
    const action = pending.get(message.requestId);
    if (!action || action.kind === "asset" || action.kind === "handoff") return;
    if (!currentAction(action, message.scopeKey, message.revision)) return;
    pending.delete(message.requestId);
    cachedOutput = message.output;
    cachedScopeKey = message.scopeKey;
    renderOutput(message.output);
    if (action.kind === "preview") {
      setReady("Assets are ready to download", "success");
      return;
    }
    if (action.kind === "changes") {
      await copyChanges(message.output, action.scopeKey, action.revision, action.viewRevision);
      return;
    }
    await copyOutput(
      action.kind,
      message.output,
      action.scopeKey,
      action.revision,
      action.viewRevision,
    );
  }
};

post({ type: "READY" });
