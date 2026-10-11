import { crc32, createWasmKernels } from "./crc32";
import { hashCanonicalJson, snapshotIdFromJson } from "./snapshot-hash";

declare const __CRC_WASM_BASE64__: string;

let kernels = { crc32, hashJson: hashCanonicalJson };
let initialized: Promise<void> | undefined;

export function prewarmWasm(): Promise<void> {
  initialized ??= Promise.resolve()
    .then(() => {
      const binary = Uint8Array.from(atob(__CRC_WASM_BASE64__), (byte) => byte.charCodeAt(0));
      return createWasmKernels(binary);
    })
    .then((loaded) => {
      kernels = loaded;
    })
    .catch(() => {});
  return initialized;
}

export async function handoffChecksum(): Promise<typeof crc32> {
  await prewarmWasm();
  return kernels.crc32;
}

export function snapshotFromJson(json: string): string {
  return snapshotIdFromJson(json, kernels.hashJson);
}
