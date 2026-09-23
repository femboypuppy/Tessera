import {
  AbortError,
  extractAssetIds,
  parseDocName,
  readDocJSON,
  throwIfAborted,
  toError,
  updateDocJSON,
  type AppContext,
  type DocJSON,
  type ExportContext,
  type ExportProgress,
  type ExportResult,
  type ExportSink,
  type ImportContext,
  type ImportFile,
  type ImportProgress,
  type ImportReport,
  type TransferIssue,
} from '@tessera/core';
import * as Y from 'yjs';
import { z } from 'zod';
import { fileNameFor } from './names';

/** Identifies Tessera backups. */
export const BACKUP_FORMAT = 'tessera-backup';
/** Version of the backup file format. Readers accept this version and older ones. */
export const BACKUP_VERSION = 1;

/** Largest backup restored (the JSON holds every document and attachment). */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;

const DOC_NAME = /^(ws|page|db):[A-Za-z0-9_-]{1,64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The backup file, validated at the trust boundary. */
export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1).max(BACKUP_VERSION),
  createdAt: z.string().max(64),
  workspace: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string().max(200) }),
  docs: z.record(z.string().regex(DOC_NAME), z.string().regex(BASE64)),
  assets: z
    .array(
      z.object({
        assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        name: z.string().max(1000).nullable(),
        mimeType: z.string().max(200),
        size: z.number().int().min(0),
        data: z.string().regex(BASE64),
      }),
    )
    .max(1_000_000),
});

export type Backup = z.infer<typeof backupSchema>;

/** Base64 without blowing the stack on large arrays. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hasContent(doc: Y.Doc): boolean {
  return Y.encodeStateVector(doc).length > 1;
}

/**
 * Writes a JSON backup of the whole workspace: the state of every Y.Doc (the workspace doc, every
 * page and database, trashed ones included) and every attachment, in a versioned format that
 * `restoreBackup` reads into a new workspace.
 */
export async function exportBackup(
  context: ExportContext,
  sink: ExportSink,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal,
  exporterId: string,
): Promise<ExportResult> {
  const started = Date.now();
  const issues: TransferIssue[] = [];
  const { workspace } = context;
  const docs: Record<string, string> = {};
  docs[`ws:${workspace.info.id}`] = toBase64(Y.encodeStateAsUpdate(workspace.doc));
  const pages = workspace.pages.getSnapshot().all();
  const referenced = new Set<string>();
  const total = pages.length;
  try {
    for (const [index, page] of pages.entries()) {
      throwIfAborted(signal);
      onProgress({ done: index, total, currentPage: page.title });
      const handle = await context.loadPageDoc(page.id);
      try {
        if (hasContent(handle.doc)) {
          docs[`page:${page.id}`] = toBase64(Y.encodeStateAsUpdate(handle.doc));
          for (const id of extractAssetIds(readDocJSON(handle.doc))) referenced.add(id);
        }
      } finally {
        handle.release();
      }
      if (page.cover?.kind === 'asset') referenced.add(page.cover.value);
      if (page.kind === 'database') {
        const database = await context.loadDatabaseDoc(page.id);
        try {
          if (hasContent(database.doc))
            docs[`db:${page.id}`] = toBase64(Y.encodeStateAsUpdate(database.doc));
        } finally {
          database.release();
        }
      }
    }
    const listed = (await context.assets.list?.()) ?? [];
    const assetIds = new Set([...listed.map((asset) => asset.assetId), ...referenced]);
    const assets: Backup['assets'] = [];
    for (const assetId of assetIds) {
      throwIfAborted(signal);
      const blob = await context.assets.get(assetId);
      if (!blob) {
        if (referenced.has(assetId))
          issues.push({
            severity: 'warning',
            code: 'missing-attachment',
            message: `Attachment ${assetId} is missing`,
          });
        continue;
      }
      const info = await context.assets.getInfo?.(assetId);
      assets.push({
        assetId,
        name: info?.name ?? null,
        mimeType: info?.mimeType ?? (blob.type || 'application/octet-stream'),
        size: blob.size,
        data: toBase64(new Uint8Array(await blob.arrayBuffer())),
      });
    }
    const backup: Backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      workspace: { id: workspace.info.id, name: workspace.info.name },
      docs,
      assets,
    };
    const date = new Date().toISOString().slice(0, 10);
    await sink.writeFile(
      `${fileNameFor(workspace.info.name, 'Workspace')} backup ${date}.json`,
      JSON.stringify(backup),
    );
    onProgress({ done: total, total });
    return { exporterId, files: 1, issues, durationMs: Date.now() - started };
  } catch (error) {
    if (!(error instanceof AbortError)) throw error;
    issues.push({ severity: 'warning', code: 'cancelled', message: 'The backup was cancelled' });
    return { exporterId, files: 0, issues, durationMs: Date.now() - started };
  }
}

/** Parses and validates a backup file. Throws a readable error for anything else. */
export function parseBackup(text: string): Backup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Tessera backup (it is not JSON)');
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) {
    const version = (json as { version?: unknown } | null)?.version;
    if (typeof version === 'number' && version > BACKUP_VERSION)
      throw new Error('This backup was made by a newer version of Tessera');
    throw new Error('This file is not a valid Tessera backup');
  }
  return result.data;
}

/** What {@link restoreBackup} restored. */
export interface RestoreResult {
  pages: number;
  databases: number;
  assets: number;
  issues: TransferIssue[];
}

/**
 * Restores a backup into the open workspace, which should be new and empty: the workspace doc is
 * merged into it (pages, trash, favorites, settings), then every page and database doc and every
 * attachment. Attachments that the asset store gives a different ID are relinked.
 */
export async function restoreBackup(
  ctx: Pick<AppContext, 'workspace' | 'loadPageDoc' | 'loadDatabaseDoc' | 'services'>,
  backup: Backup,
  onProgress: (progress: { done: number; total: number }) => void = () => undefined,
): Promise<RestoreResult> {
  const result: RestoreResult = { pages: 0, databases: 0, assets: 0, issues: [] };
  const assetIds = new Map<string, string>();
  const entries = Object.entries(backup.docs);
  const total = entries.length + backup.assets.length;
  let done = 0;
  for (const asset of backup.assets) {
    try {
      const bytes = fromBase64(asset.data);
      const stored = await ctx.services.assetStore.put(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType }),
        {
          mimeType: asset.mimeType,
          ...(asset.name ? { name: asset.name } : {}),
        },
      );
      if (stored.assetId !== asset.assetId) assetIds.set(asset.assetId, stored.assetId);
      result.assets += 1;
    } catch (error) {
      result.issues.push({
        severity: 'error',
        code: 'restore-failed',
        message: `An attachment could not be restored: ${toError(error).message}`,
      });
    }
    onProgress({ done: (done += 1), total });
  }
  const workspaceEntry = entries.find(([name]) => name.startsWith('ws:'));
  if (workspaceEntry) Y.applyUpdate(ctx.workspace.doc, fromBase64(workspaceEntry[1]), 'restore');
  onProgress({ done: (done += 1), total });
  for (const [name, data] of entries) {
    const parsed = parseDocName(name);
    if (!parsed || parsed.kind === 'workspace') continue;
    try {
      const handle =
        parsed.kind === 'page'
          ? await ctx.loadPageDoc(parsed.id)
          : await ctx.loadDatabaseDoc(parsed.id);
      try {
        Y.applyUpdate(handle.doc, fromBase64(data), 'restore');
        if (parsed.kind === 'page' && assetIds.size) {
          updateDocJSON(handle.doc, (doc) => relinkAssets(doc, assetIds), { origin: 'restore' });
        }
      } finally {
        handle.release();
      }
      if (parsed.kind === 'page') result.pages += 1;
      else result.databases += 1;
    } catch (error) {
      result.issues.push({
        severity: 'error',
        code: 'restore-failed',
        message: `${name} could not be restored: ${toError(error).message}`,
      });
    }
    onProgress({ done: (done += 1), total });
  }
  for (const page of ctx.workspace.pages.getSnapshot().all()) {
    const replacement = page.cover?.kind === 'asset' ? assetIds.get(page.cover.value) : undefined;
    if (replacement && page.cover)
      ctx.workspace.setCover(page.id, { ...page.cover, value: replacement });
  }
  return result;
}

function relinkAssets(doc: DocJSON, assetIds: ReadonlyMap<string, string>): DocJSON {
  const visit = (node: Record<string, unknown>): Record<string, unknown> => {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    let next = node;
    if (
      node.type === 'image' &&
      typeof attrs?.assetId === 'string' &&
      assetIds.has(attrs.assetId)
    ) {
      next = { ...node, attrs: { ...attrs, assetId: assetIds.get(attrs.assetId) } };
    }
    if (
      node.type === 'embed' &&
      attrs?.kind === 'file' &&
      typeof attrs.ref === 'string' &&
      assetIds.has(attrs.ref)
    ) {
      next = { ...node, attrs: { ...attrs, ref: assetIds.get(attrs.ref) } };
    }
    const content = next.content as Array<Record<string, unknown>> | undefined;
    return content ? { ...next, content: content.map(visit) } : next;
  };
  return visit(doc as unknown as Record<string, unknown>) as unknown as DocJSON;
}

/**
 * The backup "importer": restores a backup into the open workspace when it is empty (a workspace
 * just created for it); otherwise it reports that a new workspace is needed, which the import
 * dialog creates first.
 */
export async function runRestoreImport(
  files: readonly ImportFile[],
  context: ImportContext,
  onProgress: (progress: ImportProgress) => void,
  importerId: string,
): Promise<ImportReport> {
  const started = Date.now();
  const report: ImportReport = {
    importerId,
    rootPageId: null,
    counts: {
      pages: 0,
      databases: 0,
      rows: 0,
      assets: 0,
      links: 0,
      skippedFiles: Math.max(0, files.length - 1),
    },
    issues: [],
    durationMs: 0,
    cancelled: false,
  };
  const file = files[0];
  try {
    if (!file) throw new Error('Choose a backup file');
    if (context.workspace.pages.getSnapshot().size > 0) {
      report.issues.push({
        severity: 'error',
        code: 'restore-needs-new-workspace',
        message: 'A backup is restored into a new, empty workspace',
      });
      return report;
    }
    if (file.size > MAX_BACKUP_BYTES) throw new Error('This backup is too large to restore');
    onProgress({ phase: 'reading', done: 0, total: 1, currentFile: file.path });
    const backup = parseBackup(await file.text());
    const restored = await restoreBackup(
      {
        workspace: context.workspace,
        loadPageDoc: (id) => context.loadPageDoc(id),
        loadDatabaseDoc: (id) => context.loadDatabaseDoc(id),
        services: { assetStore: context.assets } as AppContext['services'],
      },
      backup,
      ({ done, total }) => onProgress({ phase: 'pages', done, total }),
    );
    const snapshot = context.workspace.pages.getSnapshot();
    report.counts.pages = snapshot.size;
    report.counts.databases = snapshot.all().filter((page) => page.kind === 'database').length;
    report.counts.rows = snapshot.all().filter((page) => snapshot.isRow(page.id)).length;
    report.counts.assets = restored.assets;
    report.issues.push(...restored.issues);
    report.rootPageId = snapshot.children(null)[0]?.id ?? null;
  } catch (error) {
    report.issues.push({
      severity: 'error',
      code: 'restore-failed',
      message: toError(error).message,
      ...(file ? { file: file.path } : {}),
    });
  }
  report.durationMs = Date.now() - started;
  return report;
}
