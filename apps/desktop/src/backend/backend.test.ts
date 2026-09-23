import { NotFoundError, TesseraError, ValidationError } from '@tessera/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDesktopRuntime } from '../runtime';
import { fakeTauri, installFakeTauri, uninstallFakeTauri } from '../testing/fake-tauri';
import { isNotFound, toDesktopError } from './errors';
import { decodeUpdateFrame, encodeUpdateFrame, fromBase64, toBase64 } from './protocol';
import { TauriBackend } from './tauri-backend';

describe('update frames', () => {
  it('round-trips updates and the last sequence number', () => {
    const updates = [new Uint8Array([1, 2, 3]), new Uint8Array([]), new Uint8Array([255])];
    const decoded = decodeUpdateFrame(encodeUpdateFrame(42, updates));
    expect(decoded.maxSeq).toBe(42);
    expect(decoded.updates.map((u) => [...u])).toEqual([[1, 2, 3], [], [255]]);
  });

  it('rejects truncated frames', () => {
    const frame = encodeUpdateFrame(1, [new Uint8Array([1, 2, 3])]);
    expect(() => decodeUpdateFrame(frame.slice(0, 10))).toThrow(/Truncated/);
    expect(() => decodeUpdateFrame(frame.slice(0, frame.length - 1))).toThrow(/Truncated/);
  });

  it('encodes base64 for large buffers', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

describe('error mapping', () => {
  it('maps Rust error codes to TesseraErrors', () => {
    const missing = toDesktopError(
      { code: 'not_found', message: 'asset x not found' },
      'asset_get',
    );
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(missing.message).toBe('asset x not found');
    expect(isNotFound(missing)).toBe(true);
    expect(toDesktopError({ code: 'invalid', message: 'bad' }, 'x')).toBeInstanceOf(
      ValidationError,
    );
    const conflict = toDesktopError({ code: 'conflict', message: 'other workspace' }, 'x');
    expect(conflict.code).toBe('conflict');
    expect(toDesktopError({ code: 'weird', message: 'huh' }, 'x').code).toBe('internal');
  });

  it('maps Tauri string errors, including permission failures', () => {
    const denied = toDesktopError('menu_set not allowed on window capture', 'menu_set');
    expect(denied).toBeInstanceOf(TesseraError);
    expect(denied.code).toBe('permission_denied');
    expect(toDesktopError(new Error('boom'), 'x').message).toBe('x: boom');
  });
});

describe('TauriBackend over IPC', () => {
  beforeEach(() => installFakeTauri({ windowLabel: 'main', home: '/home/ada', os: 'linux' }));
  afterEach(() => {
    resetDesktopRuntime();
    uninstallFakeTauri();
  });

  it('sends binary bodies with percent-encoded headers', async () => {
    const backend = new TauriBackend();
    await backend.attachWorkspace('ws1', '/home/ada/Tessera/Apollo', 'Apollo');
    await backend.storeUpdate('ws1', 'page:abc', new Uint8Array([1, 2]));
    const asset = await backend.putAsset('ws1', new Uint8Array([9, 9]), {
      name: 'Mond & Sterne.png',
      mimeType: 'image/png',
    });
    expect(asset.name).toBe('Mond & Sterne.png');
    const loaded = await backend.loadDoc('ws1', 'page:abc');
    expect(loaded.updates.map((u) => [...u])).toEqual([[1, 2]]);
    expect(loaded.maxSeq).toBeGreaterThan(0);
    expect([...((await backend.getAsset('ws1', asset.assetId)) ?? [])]).toEqual([9, 9]);
    expect(await backend.getAsset('ws1', 'missing')).toBeNull();
  });

  it('validates replies and turns failures into typed errors', async () => {
    const backend = new TauriBackend();
    await expect(backend.workspaceStatus('nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(backend.attachWorkspace('ws1', 'relative', 'x')).rejects.toMatchObject({
      code: 'invalid',
    });
    const info = await backend.appInfo();
    expect(info).toMatchObject({ windowLabel: 'main', defaultRoot: '/home/ada/Tessera' });
  });

  it('delivers events and stops after unsubscribing', async () => {
    const backend = new TauriBackend();
    const ids: string[] = [];
    const off = backend.onMenu((id) => ids.push(id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeTauri().emit('desktop://menu', 'shell.newPage');
    fakeTauri().emit('desktop://menu', 42);
    off();
    fakeTauri().emit('desktop://menu', 'shell.toggleSidebar');
    expect(ids).toEqual(['shell.newPage']);
  });

  it('builds asset URLs on the tessera-asset scheme', () => {
    const backend = new TauriBackend();
    expect(backend.assetUrl('ws1', 'abc')).toBe('tessera-asset://localhost/ws1%2Fabc');
  });
});
