import {
  ASSET_ID_PATTERN,
  ValidationError,
  type AssetInfo,
  type AssetStore,
  type WorkspaceInfo,
} from '@tessera/core';
import type { DesktopBackend } from '../backend/backend';
import type { AssetRow } from '../backend/protocol';

function toInfo(row: AssetRow): AssetInfo {
  return {
    assetId: row.assetId,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
  };
}

/**
 * {@link AssetStore} on the workspace folder: files in `assets/` named by their SHA-256 (the same
 * file attached twice is stored once), metadata in `tessera.db`. URLs use the app's
 * `tessera-asset:` scheme, served by Rust from the folder, so nothing is copied into memory.
 */
export class TauriAssetStore implements AssetStore {
  private disposed = false;

  private constructor(
    private readonly backend: DesktopBackend,
    private readonly workspaceId: string,
  ) {}

  static async open(backend: DesktopBackend, workspace: WorkspaceInfo): Promise<TauriAssetStore> {
    if (!workspace.path) throw new ValidationError(`Workspace "${workspace.name}" has no folder`);
    await backend.attachWorkspace(workspace.id, workspace.path, workspace.name);
    return new TauriAssetStore(backend, workspace.id);
  }

  async put(
    file: Blob,
    options: { name?: string; mimeType?: string } = {},
  ): Promise<{ assetId: string; url: string }> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name =
      options.name ?? (typeof File !== 'undefined' && file instanceof File ? file.name : null);
    const row = await this.backend.putAsset(this.workspaceId, bytes, {
      name,
      mimeType: options.mimeType ?? (file.type || null),
    });
    return { assetId: row.assetId, url: this.backend.assetUrl(this.workspaceId, row.assetId) };
  }

  async get(assetId: string): Promise<Blob | null> {
    if (!ASSET_ID_PATTERN.test(assetId)) return null;
    const [info, bytes] = await Promise.all([
      this.backend.assetInfo(this.workspaceId, assetId),
      this.backend.getAsset(this.workspaceId, assetId),
    ]);
    if (!info || !bytes) return null;
    return new Blob([bytes], { type: info.mimeType });
  }

  async getUrl(assetId: string): Promise<string | null> {
    if (!ASSET_ID_PATTERN.test(assetId)) return null;
    const info = await this.backend.assetInfo(this.workspaceId, assetId);
    return info ? this.backend.assetUrl(this.workspaceId, assetId) : null;
  }

  async getInfo(assetId: string): Promise<AssetInfo | null> {
    if (!ASSET_ID_PATTERN.test(assetId)) return null;
    const info = await this.backend.assetInfo(this.workspaceId, assetId);
    return info ? toInfo(info) : null;
  }

  async delete(assetId: string): Promise<void> {
    if (!ASSET_ID_PATTERN.test(assetId)) return;
    await this.backend.deleteAsset(this.workspaceId, assetId);
  }

  async list(): Promise<AssetInfo[]> {
    return (await this.backend.listAssets(this.workspaceId)).map(toInfo);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.backend.detachWorkspace(this.workspaceId);
  }
}
