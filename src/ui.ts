import type { PluginToUiMessage, UiToPluginMessage } from "./messages";
import { groupWarnings } from "./plain";
import type { AssetDescriptor, ExportOptions, GeneratedOutput } from "./types";

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
};

const copyAi = element<HTMLButtonElement>("copy-ai");
const copyJson = element<HTMLButtonElement>("copy-json");
const prepare = element<HTMLButtonElement>("prepare");
const includeHidden = element<HTMLInputElement>("include-hidden");
const includeAll = element<HTMLInputElement>("include-all");
const status = element<HTMLElement>("status");
const statusBar = element<HTMLDivElement>("status-bar");
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

type PendingAction =
  | { kind: "ai" | "json" | "preview" }
  | { kind: "asset"; asset: AssetDescriptor };
let requestId = 0;
const pending = new Map<number, PendingAction>();
let hasSelection = false;
let cachedOutput: GeneratedOutput | undefined;
let cachedOptionsKey = "";

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function options(): ExportOptions {
  return {
    includeHidden: includeHidden.checked,
    includeAllVariantsAndModes: includeAll.checked,
  };
}

function optionsKey(): string {
  return JSON.stringify(options());
}

function setBusy(message: string): void {
  statusBar.dataset.tone = "busy";
  statusBar.setAttribute("aria-busy", "true");
  status.textContent = message;
  copyAi.disabled = true;
  copyJson.disabled = true;
  prepare.disabled = true;
}

function setReady(message = "Ready", tone: "neutral" | "success" = "neutral"): void {
  statusBar.dataset.tone = tone;
  statusBar.removeAttribute("aria-busy");
  status.textContent = message;
  copyAi.disabled = !hasSelection;
  copyJson.disabled = !hasSelection;
  prepare.disabled = !hasSelection;
}

function setError(message: string): void {
  statusBar.dataset.tone = "error";
  statusBar.removeAttribute("aria-busy");
  status.textContent = message;
  copyAi.disabled = !hasSelection;
  copyJson.disabled = !hasSelection;
  prepare.disabled = !hasSelection;
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

function requestGenerate(kind: "ai" | "json" | "preview"): void {
  const id = ++requestId;
  pending.set(id, { kind });
  setBusy(kind === "preview" ? "Preparing assets…" : "Generating design context…");
  post({ type: "GENERATE", requestId: id, options: options() });
}

async function copyOrGenerate(kind: "ai" | "json"): Promise<void> {
  if (!cachedOutput || cachedOptionsKey !== optionsKey()) {
    requestGenerate(kind);
    return;
  }
  await copyOutput(kind, cachedOutput);
}

async function copyOutput(kind: "ai" | "json", output: GeneratedOutput): Promise<void> {
  try {
    await copyText(kind === "ai" ? output.ai : output.json);
    setReady(kind === "ai" ? "Copied FIGM/1 context" : "Copied JSON context", "success");
  } catch (error) {
    setError(error instanceof Error ? error.message : "Copy failed");
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
      pending.set(id, { kind: "asset", asset });
      setBusy(`Exporting ${asset.name}…`);
      post({ type: "EXPORT_ASSET", requestId: id, asset });
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

copyAi.addEventListener("click", () => void copyOrGenerate("ai"));
copyJson.addEventListener("click", () => void copyOrGenerate("json"));
prepare.addEventListener("click", () => requestGenerate("preview"));
for (const input of [includeHidden, includeAll]) {
  input.addEventListener("change", () => {
    cachedOutput = undefined;
    outputPanel.classList.add("hidden");
    warningsPanel.classList.add("hidden");
    assetsPanel.classList.add("hidden");
    setReady("Options changed; generate again to refresh output");
  });
}

window.onmessage = async (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
  const message = event.data.pluginMessage;
  if (!message) return;

  if (message.type === "SELECTION") {
    cachedOutput = undefined;
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
    outputPanel.classList.add("hidden");
    warningsPanel.classList.add("hidden");
    assetsPanel.classList.add("hidden");
    setReady(hasSelection ? "Selection changed; ready to generate" : "Select something to begin");
    return;
  }

  if (message.type === "STALE") {
    cachedOutput = undefined;
    outputPanel.classList.add("hidden");
    warningsPanel.classList.add("hidden");
    assetsPanel.classList.add("hidden");
    setReady("The design changed; generate again to refresh output");
    return;
  }

  if (message.type === "ERROR") {
    if (message.requestId !== undefined) pending.delete(message.requestId);
    setError(message.message);
    return;
  }

  if (message.type === "ASSET") {
    pending.delete(message.requestId);
    download(message.filename, message.mime, message.data);
    setReady(`Downloaded ${message.filename}`, "success");
    return;
  }

  const action = pending.get(message.requestId);
  pending.delete(message.requestId);
  cachedOutput = message.output;
  cachedOptionsKey = optionsKey();
  renderOutput(message.output);
  if (!action || action.kind === "preview") {
    setReady("Assets are ready to download", "success");
    return;
  }
  if (action.kind === "asset") return;
  await copyOutput(action.kind, message.output);
};

post({ type: "READY" });
