import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractPlainText, listProperties, listViews } from '@tessera/core';
import type { TestAppContext } from '@tessera/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownImporter } from '../importers';
import { databaseOf, docOf, importWorkspace, nodesOf, pageAt, runImporter } from '../test/helpers';
import { loadDemoFiles, openDemo } from './demo';

const REPO = new URL('../../../../', import.meta.url);

/**
 * The file behind a dev-server URL of the checkout: `/@fs/<absolute path>` (outside the project
 * root) or a path from the repository root. URL APIs do the decoding and the platform's path rules.
 */
function checkoutFile(url: string): string {
  const { pathname } = new URL(url, 'http://localhost');
  return pathname.startsWith('/@fs/')
    ? fileURLToPath(`file://${pathname.slice('/@fs'.length)}`)
    : fileURLToPath(new URL(`.${pathname}`, REPO));
}

describe('demo workspace (examples/demo-workspace)', () => {
  let test: TestAppContext | null = null;
  beforeEach(() => {
    // Attachments load through their built URL in the app; here they are read from the checkout.
    vi.stubGlobal(
      'fetch',
      async (url: string) => new Response(readFileSync(checkoutFile(String(url)))),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await test?.dispose();
    test = null;
  });

  it('loads the pages, the CSV databases and the attachments', async () => {
    const files = await loadDemoFiles();
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'Welcome to Tessera.md',
        'Every block type.md',
        'Projects.csv',
        'Reading list.csv',
        'attachments/hohmann-transfer.png',
      ]),
    );
    expect(paths.every((path) => !path.startsWith('.') && !path.includes('../'))).toBe(true);
    const image = files.find((file) => file.path === 'attachments/hohmann-transfer.png');
    expect((await image?.bytes())?.byteLength).toBeGreaterThan(1000);
  });

  it('imports cleanly: every link resolves, images go to the asset store, databases are typed', async () => {
    test = await importWorkspace();
    const { ctx } = test;
    const report = await runImporter(
      ctx,
      createMarkdownImporter(),
      await loadDemoFiles(),
      'Tessera demo',
    );
    expect(report.issues).toEqual([]);
    const rootId = report.rootPageId ?? '';
    const snapshot = ctx.workspace.pages.getSnapshot();
    const pages = snapshot.all().filter((page) => page.id !== rootId && !snapshot.isRow(page.id));
    expect(pages.length).toBeGreaterThanOrEqual(35);

    let links = 0;
    for (const page of pages.filter((entry) => entry.kind === 'page')) {
      const doc = await docOf(ctx, page.id);
      const nodes = nodesOf(doc);
      for (const node of nodes.filter((entry) => entry.type === 'pageLink')) {
        links += 1;
        expect(ctx.workspace.getPage(String(node.attrs?.pageId)), page.title).toBeTruthy();
      }
      // No wikilink was left behind as literal text.
      expect(JSON.stringify(doc), page.title).not.toMatch(/\[\[[^\]]+\]\]/);
    }
    expect(links).toBeGreaterThan(200);

    for (const title of ['Every block type', 'Knowledge garden/Hohmann transfer orbit']) {
      const images = nodesOf(await docOf(ctx, pageAt(ctx, rootId, title).id)).filter(
        (node) => node.type === 'image',
      );
      expect(images.length, title).toBeGreaterThan(0);
      for (const image of images) {
        const assetId = String(image.attrs?.assetId ?? '');
        expect(assetId, title).not.toBe('');
        expect(await ctx.services.assetStore.get(assetId)).not.toBeNull();
      }
    }

    // "Every block type" embeds the reading list as an inline database.
    const blocks = nodesOf(await docOf(ctx, pageAt(ctx, rootId, 'Every block type').id));
    expect(blocks).toContainEqual(
      expect.objectContaining({
        type: 'embed',
        attrs: expect.objectContaining({
          kind: 'database',
          ref: pageAt(ctx, rootId, 'Reading list').id,
        }),
      }),
    );

    for (const name of ['Projects', 'Reading list']) {
      const { properties, rows } = await databaseOf(ctx, pageAt(ctx, rootId, name).id);
      expect(rows.length, name).toBeGreaterThan(3);
      expect(new Set(properties.map((property) => property.type)).size, name).toBeGreaterThan(3);
    }
  }, 120_000);

  it('puts the pages at the top level, welcome first, and opens it', async () => {
    test = await importWorkspace();
    const { ctx, shell } = test;
    await openDemo(ctx);
    const snapshot = ctx.workspace.pages.getSnapshot();
    const top = snapshot.children(null).map((page) => page.title);
    expect(top[0]).toBe('Welcome to Tessera');
    expect(top).toEqual(
      expect.arrayContaining(['Knowledge garden', 'Meeting notes', 'Projects', 'Reading list']),
    );
    // No import page named like the workspace is left, in the tree or in the trash.
    expect(snapshot.all().map((page) => page.title)).not.toContain('Tessera demo');
    const welcome = snapshot.children(null)[0];
    expect(welcome?.icon).toBe('👋');
    expect(shell.navigations.at(-1)).toEqual({ pageId: welcome?.id });
    expect(shell.toasts).toEqual([]);

    // Projects opens on a board by status, its columns in the order work moves, with meaningful
    // colors; the imported table and a calendar follow.
    const projects = snapshot.children(null).find((page) => page.title === 'Projects');
    const handle = await ctx.loadDatabaseDoc(projects?.id ?? '');
    try {
      const views = listViews(handle.doc);
      expect(views.map((view) => view.type)).toEqual(['board', 'table', 'calendar']);
      const status = listProperties(handle.doc).find((property) => property.name === 'Status');
      expect(views[0]?.group?.propertyId).toBe(status?.id);
      const names = (views[0]?.group?.order ?? []).map(
        (id) => status?.options?.find((option) => option.id === id)?.name,
      );
      expect(names).toEqual(['Not started', 'In progress', 'In review', 'Blocked', 'Done']);
      const colors = Object.fromEntries(
        (status?.options ?? []).map((option) => [option.name, option.color]),
      );
      expect(colors).toMatchObject({ Done: 'green', Blocked: 'red', 'In progress': 'blue' });
    } finally {
      handle.release();
    }
  }, 120_000);

  it('never repeats a page title as its first heading', async () => {
    test = await importWorkspace();
    const { ctx } = test;
    await openDemo(ctx);
    const snapshot = ctx.workspace.pages.getSnapshot();
    for (const page of snapshot.all().filter((entry) => entry.kind === 'page')) {
      if (snapshot.isRow(page.id)) continue;
      const [first] = (await docOf(ctx, page.id)).content ?? [];
      if (first?.type !== 'heading') continue;
      const text = extractPlainText({ type: 'doc', content: [first] });
      expect(text, page.title).not.toBe(page.title);
    }
  }, 120_000);
});
