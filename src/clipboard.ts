export interface ClipboardAsset {
  mime: string;
  data: Uint8Array | string;
}

export function supportsImageClipboard(): boolean {
  return typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
}

async function assetBlob(asset: ClipboardAsset, vector: boolean): Promise<Blob> {
  const part = typeof asset.data === "string" ? asset.data : new Uint8Array(asset.data).buffer;
  if (vector) return new Blob([part], { type: "text/plain" });
  const blob = new Blob([part], { type: asset.mime });
  if (asset.mime === "image/png") return blob;

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This image format cannot be copied; use Download."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable; use Download.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("Could not convert this image to PNG; use Download."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function writeAssetToClipboard(
  asset: Promise<ClipboardAsset>,
  vector: boolean,
): Promise<void> {
  // Start the clipboard write during the click; Figma exports the bytes asynchronously.
  const mime = vector ? "text/plain" : "image/png";
  const data = asset.then((result) => assetBlob(result, vector));
  // An early clipboard rejection must still consume a later export failure.
  void data.catch(() => {});
  return navigator.clipboard.write([new ClipboardItem({ [mime]: data })]);
}
