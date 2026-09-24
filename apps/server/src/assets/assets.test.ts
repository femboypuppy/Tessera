import { createHash } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addMember,
  bootstrap,
  signUp,
  startTestServer,
  cleanupServers,
  type TestServer,
} from '../testing/harness';
import { sniffContentType } from './sniff';

const servers: TestServer[] = [];

afterEach(async () => {
  await cleanupServers(servers);
});

async function setup(overrides: Parameters<typeof startTestServer>[0] = {}) {
  const t = await startTestServer({ maxUploadBytes: 64 * 1024, ...overrides });
  servers.push(t);
  const boot = await bootstrap(t);
  return { t, ...boot };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake image body for tests'),
]);

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

describe('sniffing', () => {
  it('detects allowed types from their bytes, whatever the declared type', () => {
    expect(sniffContentType(PNG, 'text/plain')).toBe('image/png');
    expect(sniffContentType(Buffer.from('%PDF-1.7 ...'), null)).toBe('application/pdf');
    expect(sniffContentType(Buffer.from('GIF89a....'), 'image/png')).toBe('image/gif');
    expect(sniffContentType(Buffer.from('# Notes\n\nplain text'), 'text/markdown')).toBe(
      'text/markdown',
    );
    expect(sniffContentType(Buffer.from('name,value\n1,2'), 'text/csv')).toBe('text/csv');
    expect(sniffContentType(Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>'), null)).toBe(
      'image/svg+xml',
    );
    expect(
      sniffContentType(
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('refuses HTML, executables and unknown binaries', () => {
    expect(
      sniffContentType(Buffer.from('<!DOCTYPE html><script>alert(1)</script>'), 'text/plain'),
    ).toBeNull();
    expect(sniffContentType(Buffer.from('<html><body>hi'), 'text/html')).toBeNull();
    expect(sniffContentType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'image/png')).toBeNull();
    expect(
      sniffContentType(
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
        'application/octet-stream',
      ),
    ).toBeNull();
  });
});

describe('/api/assets', () => {
  it('uploads and downloads an asset by content hash', async () => {
    const { t, ownerToken, workspaceId } = await setup();
    const id = sha(PNG);
    const upload = await t.api('PUT', `/api/assets/${workspaceId}/${id}`, {
      token: ownerToken,
      raw: PNG,
      headers: {
        'content-type': 'image/png',
        'x-tessera-asset-name': encodeURIComponent('Mond Fotó.png'),
      },
    });
    expect(upload.status).toBe(201);
    expect(upload.body).toMatchObject({
      asset: { assetId: id, mimeType: 'image/png', size: PNG.length, name: 'Mond Fotó.png' },
    });
    const again = await t.api('PUT', `/api/assets/${workspaceId}/${id}`, {
      token: ownerToken,
      raw: PNG,
    });
    expect(again.status).toBe(200);
    const download = await fetch(`${t.url}/api/assets/${workspaceId}/${id}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('content-security-policy')).toContain('sandbox');
    expect(download.headers.get('content-disposition')).toMatch(/^inline/);
    expect(decodeURIComponent(download.headers.get('x-tessera-asset-name') ?? '')).toBe(
      'Mond Fotó.png',
    );
  });

  it('downloads everything but media as an attachment', async () => {
    const { t, ownerToken, workspaceId } = await setup();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await t.api('PUT', `/api/assets/${workspaceId}/${sha(svg)}`, { token: ownerToken, raw: svg });
    const download = await fetch(`${t.url}/api/assets/${workspaceId}/${sha(svg)}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(download.headers.get('content-type')).toBe('image/svg+xml');
    expect(download.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(download.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('rejects oversized files, even without a Content-Length', async () => {
    const { t, ownerToken, workspaceId } = await setup({ maxUploadBytes: 1024 });
    const big = Buffer.alloc(4096, 'a');
    const declared = await t.api<{ error: { code: string; message: string } }>(
      'PUT',
      `/api/assets/${workspaceId}/${sha(big)}`,
      {
        token: ownerToken,
        raw: big,
      },
    );
    expect(declared.status).toBe(413);
    expect(declared.body.error.message).toMatch(/at most/);
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i += 1) controller.enqueue(new Uint8Array(512).fill(97));
        controller.close();
      },
    });
    const chunked = await t.api('PUT', `/api/assets/${workspaceId}/${'b'.repeat(64)}`, {
      token: ownerToken,
      raw: streamed,
    });
    expect(chunked.status).toBe(413);
    // Nothing half-written is left behind.
    expect(readdirSync(path.join(t.dataDir, 'tmp'))).toEqual([]);
    expect(existsSync(path.join(t.dataDir, 'assets', workspaceId))).toBe(false);
  });

  it('rejects disallowed types', async () => {
    const { t, ownerToken, workspaceId } = await setup();
    const html = Buffer.from('<!doctype html><script>fetch("/api/auth/sessions")</script>');
    const response = await t.api<{ error: { code: string } }>(
      'PUT',
      `/api/assets/${workspaceId}/${sha(html)}`,
      {
        token: ownerToken,
        raw: html,
        headers: { 'content-type': 'image/png' },
      },
    );
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('unsupported_type');
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(
      (
        await t.api('PUT', `/api/assets/${workspaceId}/${sha(exe)}`, {
          token: ownerToken,
          raw: exe,
        })
      ).status,
    ).toBe(415);
  });

  it('rejects content that doesn’t match its hash ID', async () => {
    const { t, ownerToken, workspaceId } = await setup();
    const response = await t.api('PUT', `/api/assets/${workspaceId}/${'0'.repeat(64)}`, {
      token: ownerToken,
      raw: PNG,
    });
    expect(response.status).toBe(400);
  });

  it('rejects path traversal attempts', async () => {
    const { t, ownerToken, workspaceId } = await setup();
    writeFileSync(path.join(t.dataDir, 'secret.txt'), 'top secret');
    const attempts = [
      `/api/assets/${workspaceId}/..%2F..%2Fsecret.txt`,
      `/api/assets/${workspaceId}/..%2f..%2ftessera.db`,
      `/api/assets/..%2F..%2F/${sha(PNG)}`,
      `/api/assets/${workspaceId}/..%5C..%5Csecret.txt`,
      `/api/assets/${workspaceId}/%2e%2e`,
      `/api/assets/${workspaceId}/.`,
      `/api/assets/${workspaceId}/secret.txt%00.png`,
    ];
    for (const attempt of attempts) {
      const get = await fetch(`${t.url}${attempt}`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect([400, 404]).toContain(get.status);
      expect(await get.text()).not.toContain('top secret');
      const put = await fetch(`${t.url}${attempt}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${ownerToken}` },
        body: PNG,
      });
      expect([400, 404]).toContain(put.status);
    }
    expect(readdirSync(t.dataDir).filter((name) => name.endsWith('.png'))).toEqual([]);
  });

  it('requires authentication and membership, and the editor role to upload', async () => {
    const { t, ownerToken, workspaceId } = await setup();
    const id = sha(PNG);
    expect((await t.api('PUT', `/api/assets/${workspaceId}/${id}`, { raw: PNG })).status).toBe(401);
    await t.api('PUT', `/api/assets/${workspaceId}/${id}`, { token: ownerToken, raw: PNG });
    expect((await fetch(`${t.url}/api/assets/${workspaceId}/${id}`)).status).toBe(401);
    const stranger = await signUp(t, 'stranger@example.com');
    const strangers = await fetch(`${t.url}/api/assets/${workspaceId}/${id}`, {
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(strangers.status).toBe(404);
    const viewer = await addMember(t, ownerToken, workspaceId, 'viewer@example.com', 'viewer');
    const viewerDownload = await fetch(`${t.url}/api/assets/${workspaceId}/${id}`, {
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect(viewerDownload.status).toBe(200);
    const other = Buffer.concat([PNG, Buffer.from('2')]);
    expect(
      (
        await t.api('PUT', `/api/assets/${workspaceId}/${sha(other)}`, {
          token: viewer.token,
          raw: other,
        })
      ).status,
    ).toBe(403);
  });
});
