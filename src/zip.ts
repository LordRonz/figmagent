export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

const encoder = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function bytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ (crcTable[(value ^ byte) & 0xff] ?? 0);
  return (value ^ 0xffffffff) >>> 0;
}

function word(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function dword(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function safeName(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe ZIP entry name: ${name}`);
  }
  return normalized;
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const names = new Set<string>();

  for (const entry of entries) {
    const name = safeName(entry.name);
    if (names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    names.add(name);
    const nameBytes = encoder.encode(name);
    const data = bytes(entry.data);
    const checksum = crc32(data);
    if (nameBytes.length > 0xffff || data.length > 0xffffffff || offset > 0xffffffff)
      throw new Error("ZIP entry is too large");

    const header = concat([
      dword(0x04034b50),
      word(20),
      word(0x800),
      word(0),
      word(0),
      word(0),
      dword(checksum),
      dword(data.length),
      dword(data.length),
      word(nameBytes.length),
      word(0),
      nameBytes,
      data,
    ]);
    local.push(header);

    central.push(
      concat([
        dword(0x02014b50),
        word(20),
        word(20),
        word(0x800),
        word(0),
        word(0),
        word(0),
        dword(checksum),
        dword(data.length),
        dword(data.length),
        word(nameBytes.length),
        word(0),
        word(0),
        word(0),
        word(0),
        dword(0),
        dword(offset),
        nameBytes,
      ]),
    );
    offset += header.length;
  }

  const centralDirectory = concat(central);
  if (entries.length > 0xffff || centralDirectory.length > 0xffffffff || offset > 0xffffffff)
    throw new Error("ZIP archive is too large");
  return concat([
    ...local,
    centralDirectory,
    dword(0x06054b50),
    word(0),
    word(0),
    word(entries.length),
    word(entries.length),
    dword(centralDirectory.length),
    dword(offset),
    word(0),
  ]);
}
