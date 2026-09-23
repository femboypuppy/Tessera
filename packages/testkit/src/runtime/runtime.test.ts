import {
  databaseDocName,
  listRows,
  pageDocName,
  readDocJSON,
  build,
  writeDocJSON,
  docJSONEqual,
  workspaceDocName,
} from '@tessera/core';
import { createRecordingShell } from '@tessera/core/testing';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { generateWorkspace } from '../generator';
import { GeneratedDocStore } from './generated-doc-store';
import { createSeededAppContext, createTestRuntime } from './runtime';
import { SEED_FEATURE_ID } from './seed';

describe('createSeededAppContext', () => {
  it('opens the generated workspace through the seeded services', async () => {
    const { ctx, generated, dispose } = await createSeededAppContext({ seed: 3, pages: 60 });
    try {
      expect(ctx.serviceSources.docStore).toBe(SEED_FEATURE_ID);
      expect(ctx.serviceSources.workspaceRegistry).toBe(SEED_FEATURE_ID);
      const snapshot = ctx.workspace.pages.getSnapshot();
      expect(snapshot.size).toBe(generated.pages.length);
      const page = generated.pages.find((candidate) => candidate.role === 'page');
      if (!page) throw new Error('no page');
      expect(snapshot.get(page.id)?.title).toBe(page.title);

      const handle = await ctx.loadPageDoc(page.id);
      expect(docJSONEqual(readDocJSON(handle.doc), generated.content(page.id))).toBe(true);
      handle.release();

      const [database] = generated.databases;
      if (!database) throw new Error('no database');
      const db = await ctx.loadDatabaseDoc(database.id);
      expect(listRows(db.doc).map((row) => row.id)).toEqual(database.rows.map((row) => row.id));
      db.release();
    } finally {
      await dispose();
    }
  });

  it('finds generated content with the resolved search index', async () => {
    const { ctx, generated, dispose } = await createSeededAppContext({ seed: 4, pages: 30 });
    try {
      const page = generated.pages.find(
        (candidate) => candidate.role === 'page' && candidate.parentId,
      );
      if (!page) throw new Error('no page');
      const { hits } = await ctx.services.searchIndex.query(page.title, { limit: 50 });
      expect(hits.map((hit) => hit.pageId)).toContain(page.id);
    } finally {
      await dispose();
    }
  });

  it('keeps edits when the workspace is reopened, like stored data', async () => {
    const { ctx, runtime, workspace, generated, session } = await createSeededAppContext({
      seed: 5,
      pages: 20,
    });
    const page = generated.pages.find((candidate) => candidate.role === 'page');
    if (!page) throw new Error('no page');
    const edited = build.doc(build.paragraph('Edited in a test'));
    const handle = await ctx.loadPageDoc(page.id);
    writeDocJSON(handle.doc, edited);
    handle.release();
    ctx.workspace.renamePage(page.id, 'Renamed in a test');
    await session.close();

    const reopened = await runtime.openWorkspace(workspace, createRecordingShell());
    try {
      expect(reopened.ctx.workspace.getPage(page.id)?.title).toBe('Renamed in a test');
      const again = await reopened.ctx.loadPageDoc(page.id);
      expect(docJSONEqual(readDocJSON(again.doc), edited)).toBe(true);
      again.release();
    } finally {
      await reopened.close();
      await runtime.dispose();
    }
  });

  it('accepts a workspace generated beforehand and extra features', async () => {
    const generated = generateWorkspace({ seed: 6, pages: 5 });
    let activated = false;
    const { ctx, dispose } = await createSeededAppContext({
      generated,
      features: [{ id: 'probe', activate: () => void (activated = true) }],
    });
    try {
      expect(activated).toBe(true);
      expect(ctx.workspace.pages.getSnapshot().size).toBe(generated.pages.length);
    } finally {
      await dispose();
    }
  });
});

describe('GeneratedDocStore', () => {
  const generated = generateWorkspace({ seed: 8, pages: 10, databases: 1, rowsPerDatabase: 3 });

  it('serves generated docs, lists them, and forgets deleted ones', async () => {
    const store = new GeneratedDocStore(generated, 'w1');
    const names = await store.list();
    expect(names).toContain(workspaceDocName('w1'));
    expect(names).toContain(databaseDocName(generated.databases[0]?.id ?? ''));
    expect(await store.list('page:')).toEqual(names.filter((name) => name.startsWith('page:')));

    const ws = await store.load(workspaceDocName('w1'));
    expect(ws).not.toBeNull();
    const pageName = names.find((name) => name.startsWith('page:')) ?? '';
    await store.delete(pageName);
    expect(await store.load(pageName)).toBeNull();
    expect(await store.list()).not.toContain(pageName);
    expect(await store.load(pageDocName('unknown'))).toBeNull();
  });

  it('stores edits on top of the generated state', async () => {
    const store = new GeneratedDocStore(generated, 'w2');
    const page = generated.pages.find((candidate) => candidate.role === 'page');
    const name = pageDocName(page?.id ?? '');
    const doc = new Y.Doc();
    const base = await store.load(name);
    if (base) Y.applyUpdate(doc, base);
    doc.on('update', (update: Uint8Array) => void store.storeUpdate(name, update));
    writeDocJSON(doc, build.doc(build.paragraph('changed')));
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, (await store.load(name)) ?? new Uint8Array());
    expect(docJSONEqual(readDocJSON(fresh), build.doc(build.paragraph('changed')))).toBe(true);
  });
});

describe('createTestRuntime', () => {
  it('creates an in-memory runtime with test defaults', async () => {
    const runtime = await createTestRuntime();
    try {
      expect(runtime.appServiceSources.workspaceRegistry).toBe('memory');
      expect(runtime.getCurrentUser().name).toBe('Test user');
      const info = await runtime.workspaceRegistry.create({ name: 'Scratch' });
      const session = await runtime.openWorkspace(info, createRecordingShell());
      session.ctx.workspace.createPage({ title: 'Hello' });
      expect(session.ctx.workspace.pages.getSnapshot().size).toBe(1);
      await session.close();
    } finally {
      await runtime.dispose();
    }
  });
});
