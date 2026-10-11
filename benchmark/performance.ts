import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { crc32, createWasmCrc32 } from "../src/crc32";
import { createZip } from "../src/zip";

function medianMs(run: () => unknown, iterations: number): number {
  for (let i = 0; i < 5; i += 1) run();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) run();
    return (performance.now() - start) / iterations;
  });
  samples.sort((a, b) => a - b);
  return samples[4] ?? 0;
}

async function main(): Promise<void> {
  const binary = readFileSync("wasm/target/wasm32-unknown-unknown/release/figmagent_core.wasm");
  const start = performance.now();
  const wasmCrc32 = await createWasmCrc32(binary);
  console.log(
    `Wasm: ${binary.length} bytes; first initialization ${(performance.now() - start).toFixed(2)} ms`,
  );
  for (const size of [64, 1024, 65_536, 1024 * 1024, 16 * 1024 * 1024]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + (i >>> 8)) & 255);
    assert.equal(wasmCrc32(data), crc32(data));
    const iterations = Math.max(2, Math.min(1000, Math.floor((16 * 1024 * 1024) / size)));
    const js = medianMs(() => crc32(data), iterations);
    const wasm = medianMs(() => wasmCrc32(data), iterations);
    console.log(
      `CRC ${size} bytes: JS ${js.toFixed(3)} ms; Rust/Wasm including copies ${wasm.toFixed(3)} ms; ${(js / wasm).toFixed(2)}x`,
    );
    if (size < 65_536) continue;
    const entries = [{ name: "assets/image.png", data }];
    assert.deepEqual(createZip(entries, wasmCrc32), createZip(entries));
    const jsZip = medianMs(() => createZip(entries), iterations);
    const wasmZip = medianMs(() => createZip(entries, wasmCrc32), iterations);
    console.log(
      `ZIP ${size} bytes: JS ${jsZip.toFixed(3)} ms; Rust/Wasm ${wasmZip.toFixed(3)} ms; ${(jsZip / wasmZip).toFixed(2)}x`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
