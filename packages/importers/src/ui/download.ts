/** A `BlobPart` for bytes (copied only when they do not sit on a plain `ArrayBuffer`). */
export function blobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes);
}

/** Saves a file through the browser's download. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the URL after `click` returns, so it is revoked a little later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
