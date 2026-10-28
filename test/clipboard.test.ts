import assert from "node:assert/strict";
import test from "node:test";
import {
  type ClipboardAsset,
  supportsImageClipboard,
  writeAssetToClipboard,
} from "../src/clipboard";

test("detects Figma environments without the image clipboard API", (t) => {
  mockClipboard(t);
  assert.equal(supportsImageClipboard(), true);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  assert.equal(supportsImageClipboard(), false);
});

function mockClipboard(t: test.TestContext, failure?: Error) {
  const writes: Array<Record<string, Promise<Blob>>> = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        write: async (items: Array<{ data: Record<string, Promise<Blob>> }>) => {
          for (const item of items) writes.push(item.data);
          if (failure) throw failure;
          await Promise.all(items.flatMap((item) => Object.values(item.data)));
        },
      },
    },
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: class {
      constructor(public data: Record<string, Promise<Blob>>) {}
    },
  });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (original) Object.defineProperty(globalThis, "ClipboardItem", original);
    else Reflect.deleteProperty(globalThis, "ClipboardItem");
  });
  return writes;
}

test("starts writing during the click before PNG export finishes, preserving bytes", async (t) => {
  const writes = mockClipboard(t);
  let finish!: (asset: ClipboardAsset) => void;
  const asset = new Promise<ClipboardAsset>((resolve) => {
    finish = resolve;
  });
  const copied = writeAssetToClipboard(asset, false);
  assert.equal(writes.length, 1);
  const bytes = new Uint8Array([137, 80, 78, 71]);
  finish({ mime: "image/png", data: bytes });
  await copied;
  const blob = await writes[0]?.["image/png"];
  assert.ok(blob);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test("copies SVG source as plain text", async (t) => {
  const writes = mockClipboard(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
  await writeAssetToClipboard(Promise.resolve({ mime: "image/svg+xml", data: svg }), true);
  const blob = await writes[0]?.["text/plain"];
  assert.ok(blob);
  assert.equal(await blob.text(), svg);
});

test("propagates export failures to the clipboard operation", async (t) => {
  mockClipboard(t);
  await assert.rejects(
    writeAssetToClipboard(Promise.reject(new Error("Export failed")), false),
    /Export failed/,
  );
});

test("handles a late export failure after clipboard permission was denied", async (t) => {
  mockClipboard(t, new Error("Permission denied"));
  let fail!: (error: Error) => void;
  const asset = new Promise<ClipboardAsset>((_resolve, reject) => {
    fail = reject;
  });
  await assert.rejects(writeAssetToClipboard(asset, false), /Permission denied/);
  fail(new Error("Selection changed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
