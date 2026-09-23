import { newId } from '../ids';

/** Metadata of a stored asset. */
export interface AssetInfo {
  assetId: string;
  /** Original file name, if known (used by exports). */
  name: string | null;
  mimeType: string;
  size: number;
  createdAt: number;
}

/**
 * Stores binary attachments (images, files) outside the Yjs docs; documents reference them by
 * `assetId` (image `assetId`, `file` embeds, page covers). Implementations: in-memory (core, 0),
 * IndexedDB (`@tessera/sync`, 50), files on disk (`@tessera/desktop`, 100), and the server's
 * `/api/assets` when connected.
 *
 * Asset IDs are opaque, URL- and file-name-safe strings (`[A-Za-z0-9_-]{1,128}`). Content-addressed
 * stores use the SHA-256 hex digest, so the same file stored twice has one ID.
 *
 * `getUrl` returns a URL usable in `<img src>` for the lifetime of the workspace session (an object
 * URL, a `tauri://` URL, or an authenticated HTTP URL); stores revoke object URLs on `delete` and
 * `dispose`.
 *
 * @example
 * const { assetId, url } = await ctx.services.assetStore.put(file);
 * editor.insertImage({ assetId });
 */
export interface AssetStore {
  put(
    file: Blob,
    options?: { name?: string; mimeType?: string },
  ): Promise<{ assetId: string; url: string }>;
  get(assetId: string): Promise<Blob | null>;
  getUrl(assetId: string): Promise<string | null>;
  getInfo?(assetId: string): Promise<AssetInfo | null>;
  delete(assetId: string): Promise<void>;
  list?(): Promise<AssetInfo[]>;
  dispose?(): void | Promise<void>;
}

/** Pattern of valid asset IDs. */
export const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** SHA-256 hex digest of a blob, or null when Web Crypto is unavailable. */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Shared storage behind {@link MemoryAssetStore}s (kept per workspace across sessions). */
export class MemoryAssetBackend {
  readonly assets = new Map<string, { blob: Blob; info: AssetInfo }>();
}

/**
 * In-memory {@link AssetStore}: content-addressed (SHA-256) blobs with object URLs (or
 * `tessera-asset:` placeholder URLs where object URLs are unavailable, such as Node).
 */
export class MemoryAssetStore implements AssetStore {
  readonly backend: MemoryAssetBackend;
  private readonly urls = new Map<string, string>();

  constructor(backend: MemoryAssetBackend = new MemoryAssetBackend()) {
    this.backend = backend;
  }

  async put(
    file: Blob,
    options: { name?: string; mimeType?: string } = {},
  ): Promise<{ assetId: string; url: string }> {
    const assetId = (await sha256Hex(file)) ?? newId();
    if (!this.backend.assets.has(assetId)) {
      const name =
        options.name ?? (typeof File !== 'undefined' && file instanceof File ? file.name : null);
      this.backend.assets.set(assetId, {
        blob: file,
        info: {
          assetId,
          name,
          mimeType: options.mimeType ?? (file.type || 'application/octet-stream'),
          size: file.size,
          createdAt: Date.now(),
        },
      });
    }
    return { assetId, url: this.urlFor(assetId) };
  }

  async get(assetId: string): Promise<Blob | null> {
    return this.backend.assets.get(assetId)?.blob ?? null;
  }

  async getUrl(assetId: string): Promise<string | null> {
    return this.backend.assets.has(assetId) ? this.urlFor(assetId) : null;
  }

  async getInfo(assetId: string): Promise<AssetInfo | null> {
    return this.backend.assets.get(assetId)?.info ?? null;
  }

  async delete(assetId: string): Promise<void> {
    this.backend.assets.delete(assetId);
    this.revoke(assetId);
  }

  async list(): Promise<AssetInfo[]> {
    return [...this.backend.assets.values()].map((entry) => entry.info);
  }

  dispose(): void {
    for (const assetId of [...this.urls.keys()]) this.revoke(assetId);
  }

  private urlFor(assetId: string): string {
    let url = this.urls.get(assetId);
    if (!url) {
      const entry = this.backend.assets.get(assetId);
      url =
        entry && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(entry.blob)
          : `tessera-asset:${assetId}`;
      this.urls.set(assetId, url);
    }
    return url;
  }

  private revoke(assetId: string): void {
    const url = this.urls.get(assetId);
    if (url?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function')
      URL.revokeObjectURL(url);
    this.urls.delete(assetId);
  }
}
