import 'fake-indexeddb/auto';
import {
  build,
  extractPlainText,
  getPageProps,
  readDocJSON,
  setPageProp,
  writeDocJSON,
} from '@tessera/core';
import { createTestAppContext } from '@tessera/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryService } from './history-service';
import { LocalVersionStore, MAX_LOCAL_AUTO_VERSIONS } from './version-store';

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup(options: { autoDelayMs?: number; now?: () => number } = {}) {
  const app = await createTestAppContext();
  const store = await LocalVersionStore.open(app.workspace.id, { indexedDB: factory });
  const history = new HistoryService(app.ctx, store, {
    autoDelayMs: options.autoDelayMs ?? 50,
    ...(options.now ? { now: options.now } : {}),
  });
  history.start();
  const page = app.ctx.workspace.createPage({ title: 'Mission plan' });
  const write = async (...paragraphs: string[]) => {
    const handle = await app.ctx.loadPageDoc(page.id);
    writeDocJSON(handle.doc, build.doc(...paragraphs.map((text) => build.p(text))));
    handle.release();
    await app.flush();
  };
  const read = async () => {
    const handle = await app.ctx.loadPageDoc(page.id);
    try {
      return extractPlainText(readDocJSON(handle.doc));
    } finally {
      handle.release();
    }
  };
  return {
    ...app,
    store,
    history,
    page,
    write,
    read,
    close: async () => {
      history.dispose();
      store.dispose();
      await app.dispose();
    },
  };
}

describe('HistoryService', () => {
  it('saves a version automatically a few minutes after editing, once per change', async () => {
    const t = await setup({ autoDelayMs: 30 });
    await t.write('Liftoff at 09:32');
    await vi.waitFor(async () =>
      expect((await t.history.list(t.page.id)).versions).toHaveLength(1),
    );
    // No change since: no new automatic version.
    await t.history.saveVersion(t.page.id, { kind: 'auto' });
    expect((await t.history.list(t.page.id)).versions).toHaveLength(1);
    await t.write('Liftoff at 09:32', 'Orbit at 09:44');
    await vi.waitFor(async () =>
      expect((await t.history.list(t.page.id)).versions).toHaveLength(2),
    );
    const [latest] = (await t.history.list(t.page.id)).versions;
    expect(latest).toMatchObject({ kind: 'auto', onDevice: true, authorName: 'Test user' });
    await t.close();
  });

  it('saves named versions on request, even without changes', async () => {
    const t = await setup({ autoDelayMs: 60_000 });
    await t.write('Draft');
    await t.history.saveVersion(t.page.id, { kind: 'manual', label: '  Before review  ' });
    await t.history.saveVersion(t.page.id, { kind: 'manual' });
    const { versions } = await t.history.list(t.page.id);
    expect(versions.map((version) => version.label)).toEqual([null, 'Before review']);
    await t.close();
  });

  it('keeps versions saved in the same millisecond in save order', async () => {
    const t = await setup({ autoDelayMs: 60_000, now: () => Date.UTC(2026, 8, 1, 9, 30) });
    await t.write('Draft');
    for (const label of ['First', 'Second', 'Third'])
      await t.history.saveVersion(t.page.id, { kind: 'manual', label });
    const { versions } = await t.history.list(t.page.id);
    expect(versions.map((version) => version.label)).toEqual(['Third', 'Second', 'First']);
    // The same order on every read.
    expect((await t.history.list(t.page.id)).versions).toEqual(versions);
    await t.close();
  });

  it('restores a version as a new edit that can be undone', async () => {
    const t = await setup({ autoDelayMs: 60_000 });
    await t.write('Version one');
    const handle = await t.ctx.loadPageDoc(t.page.id);
    setPageProp(handle.doc, 'tags', ['draft']);
    handle.release();
    const saved = await t.history.saveVersion(t.page.id, { kind: 'manual', label: 'v1' });
    if (!saved) throw new Error('no version');
    await t.write('Version two, much better');
    const live = await t.ctx.loadPageDoc(t.page.id);
    setPageProp(live.doc, 'tags', undefined);
    setPageProp(live.doc, 'fullWidth', true);

    const restored = await t.history.restore(t.page.id, { id: saved.id, onDevice: true });
    expect(extractPlainText(readDocJSON(live.doc))).toBe('Version one');
    expect(getPageProps(live.doc)).toEqual({ tags: ['draft'] });
    // The content before the restore was kept as a version.
    const { versions } = await t.history.list(t.page.id);
    expect(versions[0]).toMatchObject({ kind: 'restore' });

    expect(restored.undo()).toBe(true);
    expect(extractPlainText(readDocJSON(live.doc))).toBe('Version two, much better');
    expect(getPageProps(live.doc)).toEqual({ fullWidth: true });
    restored.dispose();
    live.release();
    await t.close();
  });

  it('keeps others’ concurrent edits when undoing a restore', async () => {
    const t = await setup({ autoDelayMs: 60_000 });
    await t.write('Original');
    const saved = await t.history.saveVersion(t.page.id, { kind: 'manual' });
    if (!saved) throw new Error('no version');
    await t.write('Changed');
    const live = await t.ctx.loadPageDoc(t.page.id);
    const restored = await t.history.restore(t.page.id, { id: saved.id, onDevice: true });
    // Someone else's edit after the restore (a different origin).
    live.doc.getMap('props').set('smallText', true);
    restored.undo();
    expect(extractPlainText(readDocJSON(live.doc))).toBe('Changed');
    expect(getPageProps(live.doc)).toEqual({ smallText: true });
    restored.dispose();
    live.release();
    await t.close();
  });

  it('deletes a page’s history when the page is deleted permanently', async () => {
    const t = await setup({ autoDelayMs: 60_000 });
    await t.write('Short-lived');
    await t.history.saveVersion(t.page.id, { kind: 'manual' });
    t.ctx.workspace.trashPage(t.page.id);
    await t.ctx.workspace.deletePagePermanently(t.page.id);
    await t.flush();
    await vi.waitFor(async () => expect(await t.store.list(`page:${t.page.id}`)).toEqual([]));
    await t.close();
  });

  it('keeps only the newest automatic versions of a page', async () => {
    const store = await LocalVersionStore.open('ws-prune', { indexedDB: factory });
    for (let i = 0; i < MAX_LOCAL_AUTO_VERSIONS + 5; i += 1) {
      await store.add({
        id: `auto-${i}`,
        docName: 'page:p',
        createdAt: i,
        createdBy: null,
        authorName: null,
        label: null,
        kind: 'auto',
        size: 1,
        state: new Uint8Array([0, 0]),
        uploaded: true,
      });
    }
    await store.add({
      id: 'manual',
      docName: 'page:p',
      createdAt: -1,
      createdBy: null,
      authorName: null,
      label: 'kept',
      kind: 'manual',
      size: 1,
      state: new Uint8Array([0, 0]),
      uploaded: true,
    });
    const versions = await store.list('page:p');
    expect(versions.filter((version) => version.kind === 'auto')).toHaveLength(
      MAX_LOCAL_AUTO_VERSIONS,
    );
    expect(versions.some((version) => version.id === 'manual')).toBe(true);
    expect(versions.some((version) => version.id === 'auto-0')).toBe(false);
    store.dispose();
  });
});
