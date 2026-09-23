import 'fake-indexeddb/auto';
import {
  build,
  createAppRuntime,
  defineFeature,
  detectPlatform,
  extractPlainText,
  MemorySettingsStore,
  readDocJSON,
  writeDocJSON,
  type AppRuntime,
} from '@tessera/core';
import { createRecordingShell, createTestAppContext } from '@tessera/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { activateSync } from './activate';
import { syncServices } from './services';

const syncFeature = defineFeature({
  id: 'sync',
  services: syncServices,
  activate: (ctx) => activateSync(ctx),
});

const platform = detectPlatform({
  navigator: { userAgent: 'vitest' },
  tauri: false,
  matchMedia: () => ({ matches: false }),
});

function newRuntime(settings: MemorySettingsStore): Promise<AppRuntime> {
  return createAppRuntime({
    features: [syncFeature],
    platform,
    deviceSettings: settings,
    releaseDelayMs: 0,
    docChangeDebounceMs: 0,
    touchDebounceMs: 0,
  });
}

beforeEach(() => {
  // A fresh "browser profile" per test.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sync feature: browser persistence', () => {
  it('resolves the IndexedDB services over the in-memory stubs', async () => {
    const { ctx, dispose } = await createTestAppContext({ features: [syncFeature] });
    expect(ctx.serviceSources).toMatchObject({
      workspaceRegistry: 'indexeddb',
      docStore: 'indexeddb',
      assetStore: 'indexeddb',
    });
    await dispose();
  });

  it('keeps workspaces, pages, content and assets across a reload', async () => {
    const settings = new MemorySettingsStore();
    const before = await newRuntime(settings);
    const info = await before.workspaceRegistry.create({ name: 'Apollo research' });
    await before.workspaceRegistry.open(info.id);
    const session = await before.openWorkspace(info, createRecordingShell());
    const page = session.ctx.workspace.createPage({ title: 'Launch checklist' });
    const child = session.ctx.workspace.createPage({ title: 'Fuel', parentId: page.id });
    const handle = await session.ctx.loadPageDoc(page.id);
    writeDocJSON(handle.doc, build.doc(build.heading(1, 'T-minus 10'), build.p('Go for launch')));
    handle.release();
    const { assetId } = await session.ctx.services.assetStore.put(
      new Blob(['telemetry'], { type: 'text/plain' }),
      { name: 'telemetry.txt' },
    );
    await session.close();
    await before.dispose();

    // The page reloads: a new runtime over the same browser storage.
    const after = await newRuntime(settings);
    const [reopened] = await after.workspaceRegistry.list();
    expect(reopened).toMatchObject({ id: info.id, name: 'Apollo research' });
    if (!reopened) throw new Error('workspace missing');
    const next = await after.openWorkspace(reopened, createRecordingShell());
    expect(next.ctx.workspace.getPage(page.id)?.title).toBe('Launch checklist');
    expect(next.ctx.workspace.getPage(child.id)?.parentId).toBe(page.id);
    const loaded = await next.ctx.loadPageDoc(page.id);
    expect(extractPlainText(readDocJSON(loaded.doc))).toContain('Go for launch');
    loaded.release();
    expect(await (await next.ctx.services.assetStore.get(assetId))?.text()).toBe('telemetry');
    await next.close();
    await after.dispose();
  });

  it('shows one clear toast when the disk is full, and loses nothing', async () => {
    const { ctx, shell, session, dispose } = await createTestAppContext({
      features: [syncFeature],
      runtime: { onError: () => undefined },
    });
    const page = ctx.workspace.createPage({ title: 'Notes' });
    const handle = await ctx.loadPageDoc(page.id);
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    writeDocJSON(handle.doc, build.doc(build.p('first')));
    await vi.waitFor(() =>
      expect(shell.toasts.filter((toast) => toast.title === 'Storage is full')).toHaveLength(1),
    );
    writeDocJSON(handle.doc, build.doc(build.p('first'), build.p('second')));
    await session.flush();
    // Throttled: still one toast for the same problem.
    expect(shell.toasts.filter((toast) => toast.title === 'Storage is full')).toHaveLength(1);
    expect(shell.toasts[0]?.variant).toBe('error');
    add.mockRestore();
    // Space is back: the next write carries the failed ones along.
    writeDocJSON(handle.doc, build.doc(build.p('first'), build.p('second'), build.p('third')));
    await session.flush();
    handle.release();
    const state = await ctx.services.docStore.load(`page:${page.id}`);
    const stored = new Y.Doc();
    if (state) Y.applyUpdate(stored, state);
    expect(extractPlainText(readDocJSON(stored))).toBe('first\nsecond\nthird');
    await dispose();
  });
});
