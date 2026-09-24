import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ASSET_ID_PATTERN, isValidId, newId } from '@tessera/core';
import type { Db } from '../db/database';
import { HttpError, invalid, notFound } from '../errors';
import { SNIFF_BYTES, sniffContentType } from './sniff';

export interface AssetMeta {
  workspaceId: string;
  assetId: string;
  mimeType: string;
  size: number;
  name: string | null;
  createdBy: string | null;
  createdAt: number;
}

interface AssetRow {
  workspace_id: string;
  asset_id: string;
  mime_type: string;
  size: number;
  name: string | null;
  created_by: string | null;
  created_at: number;
}

const toMeta = (row: AssetRow): AssetMeta => ({
  workspaceId: row.workspace_id,
  assetId: row.asset_id,
  mimeType: row.mime_type,
  size: row.size,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Asset files on disk: `DATA_DIR/assets/<workspaceId>/<assetId>`. IDs are validated against
 * strict patterns and the final path is checked to stay inside the assets folder, so no request
 * can read or write anywhere else. Uploads stream to a temporary file with a byte limit, are
 * sniffed against an allowlist and (for SHA-256 IDs) checked against their content.
 */
export class AssetService {
  readonly root: string;
  private readonly tmp: string;
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    private readonly options: { dataDir: string; maxUploadBytes: number; now?: () => number },
  ) {
    this.root = path.resolve(options.dataDir, 'assets');
    this.tmp = path.resolve(options.dataDir, 'tmp');
    this.now = options.now ?? Date.now;
    mkdirSync(this.root, { recursive: true });
    mkdirSync(this.tmp, { recursive: true });
  }

  get maxUploadBytes(): number {
    return this.options.maxUploadBytes;
  }

  /** The file path of an asset. Throws for IDs that could escape the assets folder. */
  pathFor(workspaceId: string, assetId: string): string {
    if (!isValidId(workspaceId) || !ASSET_ID_PATTERN.test(assetId))
      throw invalid('Invalid asset path.');
    const file = path.resolve(this.root, workspaceId, assetId);
    const relative = path.relative(this.root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw invalid('Invalid asset path.');
    return file;
  }

  get(workspaceId: string, assetId: string): AssetMeta | null {
    if (!isValidId(workspaceId) || !ASSET_ID_PATTERN.test(assetId)) return null;
    const row = this.db
      .prepare('SELECT * FROM assets WHERE workspace_id = ? AND asset_id = ?')
      .get(workspaceId, assetId) as AssetRow | undefined;
    return row ? toMeta(row) : null;
  }

  /**
   * Stores an upload. Returns `{ created: false }` without reading the body when the asset
   * exists (content-addressed IDs make re-uploads free).
   */
  async store(input: {
    workspaceId: string;
    assetId: string;
    body: ReadableStream<Uint8Array> | null;
    declaredType: string | null;
    declaredLength: number | null;
    name: string | null;
    userId: string;
  }): Promise<{ meta: AssetMeta; created: boolean }> {
    const target = this.pathFor(input.workspaceId, input.assetId);
    const existing = this.get(input.workspaceId, input.assetId);
    if (existing) return { meta: existing, created: false };
    const limit = this.options.maxUploadBytes;
    if (input.declaredLength !== null && input.declaredLength > limit) throw tooLarge(limit);
    if (!input.body) throw invalid('The upload is empty.');

    const temp = path.join(this.tmp, `${newId()}.upload`);
    const handle = await open(temp, 'wx');
    const hash = createHash('sha256');
    const head: number[] = [];
    let size = 0;
    let finished = false;
    try {
      const reader = input.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => undefined);
          throw tooLarge(limit);
        }
        if (head.length < SNIFF_BYTES) head.push(...value.subarray(0, SNIFF_BYTES - head.length));
        hash.update(value);
        await handle.write(value);
      }
      await handle.sync();
      await handle.close();
      finished = true;
      if (size === 0) throw invalid('The upload is empty.');
      const mimeType = sniffContentType(Uint8Array.from(head), input.declaredType);
      if (!mimeType)
        throw new HttpError(
          415,
          'unsupported_type',
          'This kind of file can’t be uploaded (allowed: images, PDF, audio, video, text and office documents).',
        );
      const digest = hash.digest('hex');
      if (SHA256_HEX.test(input.assetId) && digest !== input.assetId)
        throw invalid('The file doesn’t match its ID (it was changed or cut off in transit).');
      mkdirSync(path.dirname(target), { recursive: true });
      await rename(temp, target);
      const meta: AssetMeta = {
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        mimeType,
        size,
        name: input.name?.slice(0, 255) ?? null,
        createdBy: input.userId,
        createdAt: this.now(),
      };
      this.db
        .prepare(
          `INSERT INTO assets (workspace_id, asset_id, mime_type, size, name, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .run(
          meta.workspaceId,
          meta.assetId,
          meta.mimeType,
          meta.size,
          meta.name,
          meta.createdBy,
          meta.createdAt,
        );
      return { meta, created: true };
    } finally {
      if (!finished) await handle.close().catch(() => undefined);
      await rm(temp, { force: true });
    }
  }

  /** The stored file of an asset (for streaming), or null. */
  async open(
    workspaceId: string,
    assetId: string,
  ): Promise<{ meta: AssetMeta; file: string; size: number } | null> {
    const meta = this.get(workspaceId, assetId);
    if (!meta) return null;
    const file = this.pathFor(workspaceId, assetId);
    try {
      const info = await stat(file);
      return { meta, file, size: info.size };
    } catch {
      throw notFound('The asset file is missing on the server.');
    }
  }

  /** Removes a deleted workspace's files. */
  async deleteWorkspaceFiles(workspaceId: string): Promise<void> {
    if (!isValidId(workspaceId)) return;
    await rm(path.join(this.root, workspaceId), { recursive: true, force: true });
  }
}

function tooLarge(limit: number): HttpError {
  const mb = Math.round((limit / 1024 / 1024) * 10) / 10;
  return new HttpError(413, 'too_large', `Files can be at most ${mb} MB on this server.`);
}
