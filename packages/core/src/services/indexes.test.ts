import { describe, expect, it } from 'vitest';
import { setPageProp } from '../model/page-doc';
import { build as b } from '../schema/builders';
import { replaceTextWithPageLink } from '../schema/mentions';
import type { DocJSON } from '../schema/types';
import { updateDocJSON, writeDocJSON } from '../schema/ydoc';
import { createTestAppContext, type TestAppContext } from '../testing/index';

async function write(test: TestAppContext, pageId: string, doc: DocJSON, aliases?: string[]) {
  const handle = await test.ctx.loadPageDoc(pageId);
  writeDocJSON(handle.doc, doc);
  if (aliases) setPageProp(handle.doc, 'aliases', aliases);
  handle.release();
  await test.flush();
}

async function setup() {
  const test = await createTestAppContext();
  const { workspace } = test.ctx;
  const apollo = workspace.createPage({ title: 'Apollo program' });
  const gemini = workspace.createPage({ title: 'Gemini' });
  const notes = workspace.createPage({ title: 'Mission notes', parentId: gemini.id });
  const trashed = workspace.createPage({ title: 'Old Apollo draft' });
  await write(
    test,
    apollo.id,
    b.doc(b.heading(1, 'Overview'), b.paragraph('The moon landing program. ', b.tag('space'))),
    ['Project Apollo'],
  );
  await write(
    test,
    notes.id,
    b.doc(
      {
        ...b.paragraph('We followed the ', b.pageLink(apollo.id), ' closely.'),
        attrs: { blockId: 'followed' },
      },
      b.paragraph('The Apollo program changed everything; so did Project Apollo.'),
      b.taskList(b.taskItem(false, 'Review the landing footage')),
    ),
  );
  await write(
    test,
    gemini.id,
    b.doc(
      b.paragraph('Links to ', b.pageLink(apollo.id), ' and to itself ', b.pageLink(gemini.id)),
    ),
  );
  await write(test, trashed.id, b.doc(b.paragraph('Apollo program ', b.pageLink(apollo.id))));
  workspace.trashPage(trashed.id);
  await test.flush();
  return { test, apollo, gemini, notes, trashed };
}

describe('NaiveSearchIndex', () => {
  it('finds titles and body text with highlights and snippets, excluding the trash', async () => {
    const { test, apollo, notes } = await setup();
    const search = test.ctx.services.searchIndex;
    const { hits, total } = await search.query('apollo');
    expect(total).toBe(2);
    expect(hits.map((hit) => hit.pageId)).toEqual([apollo.id, notes.id]);
    expect(hits[0]).toMatchObject({ matchedIn: 'title', titleHighlights: [{ start: 0, end: 6 }] });
    expect(hits[1]?.matchedIn).toBe('body');
    expect(hits[1]?.snippet?.text).toContain('Apollo program changed everything');
    const snippet = hits[1]?.snippet;
    const highlighted = snippet?.highlights.map((range) =>
      snippet.text.slice(range.start, range.end),
    );
    expect(highlighted?.every((text) => text.toLowerCase() === 'apollo')).toBe(true);
    expect((await search.query('moon landing')).hits.map((hit) => hit.pageId)).toEqual([apollo.id]);
    expect((await search.query('nothing matches this')).total).toBe(0);
    await test.dispose();
  });

  it('filters by kind, tag, subtree and tasks, and paginates', async () => {
    const { test, apollo, gemini, notes } = await setup();
    const search = test.ctx.services.searchIndex;
    expect((await search.query('', { tags: ['SPACE'] })).hits.map((h) => h.pageId)).toEqual([
      apollo.id,
    ]);
    expect((await search.query('', { withinPageId: gemini.id })).hits.map((h) => h.pageId)).toEqual(
      [notes.id],
    );
    expect((await search.query('', { hasTasks: true })).hits.map((h) => h.pageId)).toEqual([
      notes.id,
    ]);
    expect((await search.query('', { kinds: ['database'] })).total).toBe(0);
    const page = await search.query('', { limit: 1, offset: 1 });
    expect(page.hits).toHaveLength(1);
    expect(page.total).toBe(3);
    await test.dispose();
  });

  it('updates on edits, renames and deletions', async () => {
    const { test, gemini } = await setup();
    const search = test.ctx.services.searchIndex;
    await search.query('warmup');
    await write(test, gemini.id, b.doc('Now about orbital rendezvous'));
    expect((await search.query('rendezvous')).hits.map((h) => h.pageId)).toEqual([gemini.id]);
    test.ctx.workspace.renamePage(gemini.id, 'Gemini 4');
    expect((await search.query('gemini 4')).hits[0]?.title).toBe('Gemini 4');
    await test.ctx.workspace.deletePagePermanently(gemini.id);
    expect((await search.query('rendezvous')).total).toBe(0);
    await test.dispose();
  });
});

describe('NaiveLinkIndex', () => {
  it('lists backlinks with context, excluding self-links and trashed sources', async () => {
    const { test, apollo, gemini, notes } = await setup();
    const links = test.ctx.services.linkIndex;
    const backlinks = await links.backlinks(apollo.id);
    expect(backlinks.map((link) => [link.sourcePageId, link.blockText, link.blockId])).toEqual([
      [gemini.id, 'Links to  and to itself ', null],
      [notes.id, 'We followed the  closely.', 'followed'],
    ]);
    expect(await links.backlinks(gemini.id)).toEqual([]);
    expect((await links.outgoing(gemini.id)).map((link) => link.targetPageId)).toEqual([
      apollo.id,
      gemini.id,
    ]);
    const edges = await links.edges();
    expect(edges).toEqual(
      expect.arrayContaining([
        { source: notes.id, target: apollo.id, count: 1 },
        { source: gemini.id, target: apollo.id, count: 1 },
      ]),
    );
    expect(edges).toHaveLength(2);
    await test.dispose();
  });

  it('finds unlinked mentions by title and alias, and they can be linked', async () => {
    const { test, apollo, notes } = await setup();
    const links = test.ctx.services.linkIndex;
    const changes: number[] = [];
    links.subscribe(() => changes.push(1));
    const mentions = await links.unlinkedMentions(apollo.id);
    expect(mentions.map((mention) => [mention.sourcePageId, mention.text])).toEqual([
      [notes.id, 'Apollo program'],
      [notes.id, 'Project Apollo'],
    ]);
    const [first] = mentions;
    if (!first) throw new Error('expected a mention');
    const handle = await test.ctx.loadPageDoc(notes.id);
    updateDocJSON(handle.doc, (doc) =>
      replaceTextWithPageLink(doc, first, { pageId: apollo.id }, { expectedText: first.text }),
    );
    handle.release();
    await test.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await links.unlinkedMentions(apollo.id)).map((m) => m.text)).toEqual([
      'Project Apollo',
    ]);
    expect(
      (await links.backlinks(apollo.id)).filter((l) => l.sourcePageId === notes.id),
    ).toHaveLength(2);
    expect(changes.length).toBeGreaterThan(0);
    await test.dispose();
  });
});
