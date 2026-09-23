import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bootstrap,
  cleanupServers,
  connectClient,
  startTestServer,
  type TestServer,
} from '../testing/harness';
import { createBackup, restoreBackup } from './backup';
import { createOwner } from './create-owner';
import { extractTarGz, safeEntryPath } from './tar';

const servers: TestServer[] = [];
const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera-backup-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await cleanupServers(servers);
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);

describe('backup and restore', () => {
  it('round-trips docs, accounts and assets, keeping the replaced data aside', async () => {
    const t = await startTestServer();
    servers.push(t);
    const { ownerToken, workspaceId } = await bootstrap(t);
    const c = connectClient(t.wsUrl, `${workspaceId}/page:plan`, ownerToken);
    await c.synced();
    c.doc.getText('t').insert(0, 'Backed up');
    await c.settled();
    c.destroy();
    const assetId = createHash('sha256').update(PNG).digest('hex');
    await t.api('PUT', `/api/assets/${workspaceId}/${assetId}`, { token: ownerToken, raw: PNG });

    // Online backup while the server runs.
    const file = path.join(tempDir(), 'tessera-backup.tar.gz');
    const result = await createBackup(t.dataDir, file);
    expect(result.assets).toBe(1);
    await expect(createBackup(t.dataDir, file)).rejects.toThrow(/already exists/);

    // Restoring needs the server stopped.
    await expect(restoreBackup(t.dataDir, file)).rejects.toThrow(/Stop it first/);
    await t.stop();

    const target = tempDir();
    writeFileSync(path.join(target, 'tessera.db'), 'old data that must not be deleted');
    const restored = await restoreBackup(target, file);
    expect(restored.assets).toBe(1);
    expect(restored.previous).not.toBeNull();
    expect(readFileSync(path.join(restored.previous ?? '', 'tessera.db'), 'utf8')).toBe(
      'old data that must not be deleted',
    );
    expect(readdirSync(target).some((name) => name.startsWith('.restore-'))).toBe(false);

    const again = await startTestServer({}, {}, target);
    servers.push(again);
    const reader = connectClient(again.wsUrl, `${workspaceId}/page:plan`, ownerToken);
    await reader.synced();
    expect(reader.doc.getText('t').toString()).toBe('Backed up');
    reader.destroy();
    const asset = await fetch(`${again.url}/api/assets/${workspaceId}/${assetId}`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(Buffer.from(await asset.arrayBuffer())).toEqual(PNG);
  });

  it('refuses archives with paths that escape the target', async () => {
    const dir = tempDir();
    const header = (name: string, size: number) => {
      const block = Buffer.alloc(512);
      block.write(name, 0);
      block.write('0000644\0', 100);
      block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
      block.write('00000000000\0', 136);
      block.fill(' ', 148, 156);
      block.write('0', 156);
      block.write('ustar\0', 257);
      let sum = 0;
      for (const byte of block) sum += byte;
      block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
      return block;
    };
    for (const evil of [
      '../escaped.txt',
      '/etc/escaped.txt',
      'assets/../../escaped.txt',
      'C:/escaped.txt',
    ]) {
      const body = Buffer.from('gotcha');
      const tar = Buffer.concat([
        header(evil, body.length),
        body,
        Buffer.alloc(512 - body.length),
        Buffer.alloc(1024),
      ]);
      const file = path.join(dir, `evil-${evil.length}.tar.gz`);
      await new Promise<void>((resolve, reject) => {
        const gzip = createGzip();
        const chunks: Buffer[] = [];
        gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
        gzip.on('end', () => {
          writeFileSync(file, Buffer.concat(chunks));
          resolve();
        });
        gzip.on('error', reject);
        gzip.end(tar);
      });
      await expect(extractTarGz(file, path.join(dir, 'out'))).rejects.toThrow(/unsafe path/);
    }
    expect(existsSync(path.join(dir, 'escaped.txt'))).toBe(false);
    expect(existsSync(path.join(os.tmpdir(), 'escaped.txt'))).toBe(false);
    expect(safeEntryPath('assets/ws/abc')).toBe('assets/ws/abc');
    expect(safeEntryPath('a\\..\\b')).toBeNull();
  });

  it('refuses files that are not backups', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'not-a-backup.tar.gz');
    writeFileSync(file, 'plain text');
    await expect(restoreBackup(path.join(dir, 'data'), file)).rejects.toThrow();
  });
});

describe('create-owner', () => {
  it('creates the owner once, then refuses', async () => {
    const dataDir = tempDir();
    const config = { dataDir, sessionDays: 30 };
    const owner = await createOwner(config, {
      email: 'Ada@Example.com',
      name: 'Ada',
      password: 'a long password',
    });
    expect(owner.email).toBe('ada@example.com');
    await expect(
      createOwner(config, { email: 'b@example.com', name: 'B', password: 'a long password' }),
    ).rejects.toThrow(/already has accounts/);
    await expect(
      createOwner(
        { dataDir: tempDir(), sessionDays: 30 },
        { email: 'x', name: 'X', password: 'short' },
      ),
    ).rejects.toThrow(/email address is not valid/);
    // The owner can sign in to a server started on that folder.
    const t = await startTestServer({}, {}, dataDir);
    servers.push(t);
    const login = await t.api('POST', '/api/auth/login', {
      body: { email: 'ada@example.com', password: 'a long password' },
    });
    expect(login.status).toBe(201);
    const doc = new Y.Doc();
    expect(doc).toBeDefined();
  });
});
