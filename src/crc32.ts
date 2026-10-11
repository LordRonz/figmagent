const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

export function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ (table[(value ^ byte) & 0xff] ?? 0);
  return (value ^ 0xffffffff) >>> 0;
}

interface CrcExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  crc_buffer: () => number;
  crc32: (length: number, previous: number) => number;
  json_hash: (length: number, previous: number, state: number) => number;
  json_hash_state: () => number;
}

export async function createWasmKernels(binary: Uint8Array): Promise<{
  crc32: typeof crc32;
  hashJson: (json: string) => number;
}> {
  const { instance } = await WebAssembly.instantiate(binary as Uint8Array<ArrayBuffer>);
  const exports = instance.exports as CrcExports;
  const buffer = new Uint8Array(exports.memory.buffer, exports.crc_buffer(), 65_536);
  const checksumFor = (data: Uint8Array) => {
    let checksum = 0;
    for (let offset = 0; offset < data.length; offset += buffer.length) {
      const chunk = data.subarray(offset, offset + buffer.length);
      buffer.set(chunk);
      checksum = exports.crc32(chunk.length, checksum) >>> 0;
    }
    return checksum;
  };
  const codes = new Uint16Array(exports.memory.buffer, exports.crc_buffer(), 32_768);
  const hashJson = (json: string): number => {
    let hash = 0x811c9dc5;
    let state = 0;
    for (let offset = 0; offset < json.length; offset += codes.length) {
      const length = Math.min(codes.length, json.length - offset);
      for (let index = 0; index < length; index += 1)
        codes[index] = json.charCodeAt(offset + index);
      hash = exports.json_hash(length, hash, state) >>> 0;
      state = exports.json_hash_state();
    }
    return hash;
  };
  return { crc32: checksumFor, hashJson };
}

export async function createWasmCrc32(binary: Uint8Array): Promise<typeof crc32> {
  return (await createWasmKernels(binary)).crc32;
}
