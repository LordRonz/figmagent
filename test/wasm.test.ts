import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { crc32, createWasmCrc32, createWasmKernels } from "../src/crc32";
import { snapshotId } from "../src/delta";
import { serializeJson } from "../src/serialize";
import { snapshotIdFromJson } from "../src/snapshot-hash";
import { handoffChecksum, snapshotFromJson } from "../src/wasm";
import { createZip } from "../src/zip";
import { fixtureContext } from "./fixture";

test("Rust/Wasm checksums match standard vectors, tails, and buffer boundaries", async () => {
  const checksum = await createWasmCrc32(
    readFileSync("wasm/target/wasm32-unknown-unknown/release/figmagent_core.wasm"),
  );
  assert.equal(checksum(new Uint8Array()), 0);
  assert.equal(checksum(new TextEncoder().encode("123456789")), 0xcbf43926);
  for (const size of [1, 7, 8, 9, 65_535, 65_536, 65_537, 1024 * 1024]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + (i >>> 8)) & 255);
    assert.equal(checksum(data), crc32(data), `CRC mismatch for ${size} bytes`);
  }
  const entries = [
    { name: "design.figm", data: 'FIGM/1 units=px\nTEXT text="🚀"' },
    { name: "assets/圖.svg", data: "<svg />" },
    { name: "assets/large.png", data: new Uint8Array(100_001).fill(251) },
    { name: "assets/empty", data: new Uint8Array() },
  ];
  assert.deepEqual(createZip(entries, checksum), createZip(entries));
  assert.throws(() => createZip([{ name: "../secret", data: "x" }], checksum));
});

test("Rust snapshot IDs match existing IDs across Unicode, escaping, and streaming boundaries", async () => {
  const kernels = await createWasmKernels(
    readFileSync("wasm/target/wasm32-unknown-unknown/release/figmagent_core.wasm"),
  );
  for (const text of [
    "",
    "x y\t\r\n",
    '\\"quoted\\\\text',
    "圖 🚀 \u2028 \u2029 \ud800",
    ...[32_765, 32_766, 32_767, 32_768, 65_536].map((length) => `${"x".repeat(length)}\\" 🚀`),
    `${'\\"🚀 \n'.repeat(20_000)}`,
  ]) {
    const context = fixtureContext();
    const title = context.roots[0]?.children?.[0];
    assert.ok(title?.text);
    title.text.characters = text;
    const json = serializeJson(context);
    assert.equal(snapshotIdFromJson(json), snapshotId(context));
    assert.equal(snapshotIdFromJson(json, kernels.hashJson), snapshotId(context));
    // The shared scratch buffer must support alternating checksum and snapshot operations.
    assert.equal(
      kernels.crc32(new TextEncoder().encode(text)),
      crc32(new TextEncoder().encode(text)),
    );
    assert.equal(snapshotIdFromJson(json, kernels.hashJson), snapshotId(context));
  }
  const compact = '{"a":"x y","b":"\\\\\\" 🚀"}';
  for (const prefix of [32_766, 32_767, 32_768]) {
    const padded = " ".repeat(prefix) + compact;
    assert.equal(kernels.hashJson(padded), kernels.hashJson(compact));
  }
  for (let offset = -3; offset <= 3; offset += 1) {
    const json = JSON.stringify({ a: `${"x".repeat(32_761 + offset)}"\\🚀 tail` });
    assert.equal(snapshotIdFromJson(json, kernels.hashJson), snapshotIdFromJson(json));
  }
});

test("handoff falls back to JavaScript when embedded Wasm is unavailable", async () => {
  assert.equal(await handoffChecksum(), crc32);
  assert.equal(await handoffChecksum(), crc32);
  const context = fixtureContext();
  assert.equal(snapshotFromJson(serializeJson(context)), snapshotId(context));
});

test("embedded runtime prewarms one Wasm instance for snapshots and ZIP checksums", async () => {
  const { build } = createRequire(`${process.cwd()}/package.json`)(
    "esbuild",
  ) as typeof import("esbuild");
  const binary = readFileSync("wasm/target/wasm32-unknown-unknown/release/figmagent_core.wasm");
  const bundled = await build({
    entryPoints: ["src/wasm.ts"],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    define: { __CRC_WASM_BASE64__: JSON.stringify(binary.toString("base64")) },
  });
  const module = { exports: {} as typeof import("../src/wasm") };
  let instances = 0;
  runInNewContext(bundled.outputFiles[0]?.text ?? "", {
    module,
    atob,
    Uint8Array,
    Uint16Array,
    WebAssembly: {
      instantiate: async (bytes: Uint8Array) => {
        instances += 1;
        return WebAssembly.instantiate(bytes as Uint8Array<ArrayBuffer>);
      },
    },
  });
  const json = serializeJson(fixtureContext());
  assert.equal(module.exports.snapshotFromJson(json), snapshotId(fixtureContext()));
  await Promise.all([module.exports.prewarmWasm(), module.exports.prewarmWasm()]);
  assert.equal(instances, 1);
  assert.equal(module.exports.snapshotFromJson(json), snapshotId(fixtureContext()));
  const checksum = await module.exports.handoffChecksum();
  assert.notEqual(checksum, crc32, "successful initialization must select the Wasm path");
  assert.equal(checksum(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(instances, 1);
});
