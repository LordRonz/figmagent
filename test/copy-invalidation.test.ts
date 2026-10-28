import assert from "node:assert/strict";
import test from "node:test";
import type { PluginToUiMessage, UiToPluginMessage } from "../src/messages";

test("an unrelated page edit does not discard an in-flight Copy for AI result", async (t) => {
  let finishExport!: (value: unknown) => void;
  const exportResult = new Promise<unknown>((resolve) => {
    finishExport = resolve;
  });
  const handlers = new Map<string, (event?: unknown) => void>();
  const pageHandlers = new Map<string, (event?: unknown) => void>();
  const sent: PluginToUiMessage[] = [];
  const page = {
    id: "page:1",
    type: "PAGE",
    name: "Page",
    on: (name: string, handler: (event?: unknown) => void) => pageHandlers.set(name, handler),
    off: (name: string) => pageHandlers.delete(name),
    selection: [] as unknown[],
  };
  const selected = {
    id: "frame:1",
    type: "FRAME",
    name: "Selected frame",
    parent: page,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    exportSettings: [],
    isAsset: false,
    findAll: () => [],
    getDevResourcesAsync: async () => [],
    exportAsync: () => exportResult,
  };
  page.selection = [selected];
  const figmaMock = {
    showUI: () => undefined,
    currentPage: page,
    root: { name: "Document" },
    on: (name: string, handler: (event?: unknown) => void) => handlers.set(name, handler),
    ui: {
      postMessage: (message: PluginToUiMessage) => sent.push(message),
      onmessage: null as null | ((message: UiToPluginMessage) => Promise<void>),
    },
  };
  const originalFigma = Object.getOwnPropertyDescriptor(globalThis, "figma");
  const originalHtml = Object.getOwnPropertyDescriptor(globalThis, "__html__");
  Object.defineProperty(globalThis, "figma", { configurable: true, value: figmaMock });
  Object.defineProperty(globalThis, "__html__", { configurable: true, value: "" });
  t.after(() => {
    if (originalFigma) Object.defineProperty(globalThis, "figma", originalFigma);
    else Reflect.deleteProperty(globalThis, "figma");
    if (originalHtml) Object.defineProperty(globalThis, "__html__", originalHtml);
    else Reflect.deleteProperty(globalThis, "__html__");
  });
  await import("../src/code");
  assert.ok(figmaMock.ui.onmessage);
  const generate = figmaMock.ui.onmessage({
    type: "GENERATE",
    requestId: 1,
    revision: 0,
    scopeKey: JSON.stringify(["page:1", ["frame:1"], false, false, false]),
    options: { includeHidden: false, includeAllVariantsAndModes: false },
  });
  pageHandlers.get("nodechange")?.({
    nodeChanges: [
      {
        type: "PROPERTY_CHANGE",
        id: "other:1",
        node: { id: "other:1", parent: page },
        properties: ["name"],
      },
    ],
  });
  finishExport({ document: { id: "frame:1", type: "FRAME", name: "Selected frame" } });
  await generate;
  assert.ok(sent.some((message) => message.type === "RESULT" && message.requestId === 1));
  assert.equal(sent.filter((message) => message.type === "STALE").length, 0);

  pageHandlers.get("nodechange")?.({
    nodeChanges: [
      {
        type: "PROPERTY_CHANGE",
        id: "child:1",
        node: { id: "child:1", parent: selected },
        properties: ["name"],
      },
    ],
  });
  assert.ok(sent.some((message) => message.type === "STALE" && message.revision === 1));

  selected.type = "INSTANCE";
  handlers.get("selectionchange")?.();
  const component = { id: "component:1", type: "COMPONENT", parent: page };
  pageHandlers.get("nodechange")?.({
    nodeChanges: [
      {
        type: "PROPERTY_CHANGE",
        id: "component-child:1",
        node: { id: "component-child:1", parent: component },
        properties: ["name"],
      },
    ],
  });
  assert.ok(sent.some((message) => message.type === "STALE" && message.revision === 3));
});
