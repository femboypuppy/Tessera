import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { INLINE_TYPES } from '../../assets/sniff';
import { invalid, notFound } from '../../errors';
import { requireAuth, type AppEnv, type AppServices } from '../context';

function contentDisposition(type: 'inline' | 'attachment', name: string | null): string {
  if (!name) return type;
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * `/api/assets/:workspaceId/:assetId`: upload (`PUT`, editors) and download (`GET`, members).
 * Downloads carry `nosniff`, a sandboxing CSP and, for anything that isn't media, an attachment
 * disposition, so a stored file can never run as a page on the server's origin.
 */
export function assetRoutes(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { workspaces, assets } = services;

  app.put('/:workspaceId/:assetId', async (c) => {
    const auth = requireAuth(c);
    const workspaceId = c.req.param('workspaceId');
    const assetId = c.req.param('assetId');
    // Validates the IDs before anything touches the disk.
    assets.pathFor(workspaceId, assetId);
    workspaces.requireRole(workspaceId, auth.user.id, 'editor');
    const lengthHeader = c.req.header('content-length');
    const declaredLength = lengthHeader ? Number(lengthHeader) : null;
    if (declaredLength !== null && !Number.isFinite(declaredLength))
      throw invalid('Invalid Content-Length.');
    let name: string | null = null;
    const rawName = c.req.header('x-tessera-asset-name');
    if (rawName) {
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = null;
      }
    }
    const { meta, created } = await assets.store({
      workspaceId,
      assetId,
      body: c.req.raw.body,
      declaredType: c.req.header('content-type') ?? null,
      declaredLength,
      name,
      userId: auth.user.id,
    });
    return c.json(
      {
        asset: {
          assetId: meta.assetId,
          mimeType: meta.mimeType,
          size: meta.size,
          name: meta.name,
          createdAt: meta.createdAt,
        },
      },
      created ? 201 : 200,
    );
  });

  app.get('/:workspaceId/:assetId', async (c) => {
    const auth = requireAuth(c);
    const workspaceId = c.req.param('workspaceId');
    const assetId = c.req.param('assetId');
    assets.pathFor(workspaceId, assetId);
    workspaces.requireRole(workspaceId, auth.user.id, 'viewer');
    const found = await assets.open(workspaceId, assetId);
    if (!found) throw notFound('Asset not found.');
    const { meta } = found;
    const headers = new Headers({
      'Content-Type': meta.mimeType.startsWith('text/')
        ? `${meta.mimeType}; charset=utf-8`
        : meta.mimeType,
      'Content-Length': String(found.size),
      // Content-addressed: the bytes behind an ID never change.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Content-Disposition': contentDisposition(
        INLINE_TYPES.has(meta.mimeType) ? 'inline' : 'attachment',
        meta.name,
      ),
      'X-Tessera-Created-At': String(meta.createdAt),
    });
    if (meta.name) headers.set('X-Tessera-Asset-Name', encodeURIComponent(meta.name));
    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
    const stream = Readable.toWeb(createReadStream(found.file)) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers });
  });

  return app;
}
