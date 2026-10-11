// Input comes from serializeJson: keys are already sorted; only formatting whitespace is skipped.
export function hashCanonicalJson(json: string): number {
  let hash = 0x811c9dc5;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) inString = false;
    } else if (code === 34) inString = true;
    else if (code === 32 || code === 9 || code === 10 || code === 13) continue;
    hash = Math.imul(hash ^ code, 0x01000193);
  }
  return hash >>> 0;
}

export function snapshotIdFromJson(json: string, hash = hashCanonicalJson): string {
  return `snapshot:${hash(json).toString(16).padStart(8, "0")}`;
}
