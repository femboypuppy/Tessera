import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { InvalidOperationError, NotFoundError, ValidationError } from '../errors';
import { createPageIndex } from './page-index';
import {
  createPage,
  deletePagePermanently,
  emptyTrash,
  getAncestors,
  getChildren,
  getDescendants,
  getPage,
  isDatabaseRow,
  isPageTrashed,
  listPages,
  listTrash,
  movePage,
  renamePage,
  requirePage,
  restorePage,
  setCover,
  setFavorite,
  setIcon,
  touchPage,
  trashPage,
} from './pages';
import { observePages, type PagesChange } from './observe-pages';
import { pagesMapOf } from './workspace-doc';

function titles(pages: readonly { title: string }[]): string[] {
  return pages.map((page) => page.title);
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('createPage', () => {
  it('creates a top-level page with defaults', () => {
    const ws = new Y.Doc();
    const page = createPage(ws, { title: 'Welcome' }, { now: 1000, userId: 'u1' });
    expect(page).toMatchObject({
      kind: 'page',
      title: 'Welcome',
      parentId: null,
      createdAt: 1000,
      updatedAt: 1000,
      createdBy: 'u1',
      updatedBy: 'u1',
    });
    expect(page.id).toHaveLength(21);
    expect(getPage(ws, page.id)).toEqual(page);
  });

  it('appends by default and honours start, index, before and after', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const c = createPage(ws, { title: 'C' });
    createPage(ws, { title: 'Start' }, {});
    createPage(ws, { title: 'First', position: 'start' });
    createPage(ws, { title: 'B', position: { after: a.id } });
    createPage(ws, { title: 'Before C', position: { before: c.id } });
    createPage(ws, { title: 'Second', position: { index: 1 } });
    expect(titles(getChildren(ws, null))).toEqual([
      'First',
      'Second',
      'A',
      'B',
      'Before C',
      'C',
      'Start',
    ]);
  });

  it('nests pages and rejects invalid input', () => {
    const ws = new Y.Doc();
    const parent = createPage(ws, { title: 'Parent' });
    const child = createPage(ws, { title: 'Child', parentId: parent.id });
    expect(getChildren(ws, parent.id).map((p) => p.id)).toEqual([child.id]);
    expect(() => createPage(ws, { parentId: 'missing' })).toThrow(NotFoundError);
    expect(() => createPage(ws, { id: 'bad id!' })).toThrow(ValidationError);
    expect(() => createPage(ws, { id: parent.id })).toThrow(InvalidOperationError);
    expect(() => createPage(ws, { icon: 'not an emoji' })).toThrow(ValidationError);
    expect(() => createPage(ws, { title: 'x', position: { after: 'nope' } })).toThrow(
      NotFoundError,
    );
  });

  it('normalizes titles and keeps unicode intact', () => {
    const ws = new Y.Doc();
    const page = createPage(ws, { title: 'Line one\nline two\t🎉 Überraschung 日本語' });
    expect(page.title).toBe('Line one line two 🎉 Überraschung 日本語');
  });

  it('stores icon, cover and favorite', () => {
    const ws = new Y.Doc();
    const page = createPage(ws, {
      title: 'Cover',
      icon: '🚀',
      cover: { kind: 'preset', value: 'aurora' },
      favorite: true,
    });
    expect(page).toMatchObject({
      icon: '🚀',
      cover: { kind: 'preset', value: 'aurora' },
      favorite: true,
    });
  });
});

describe('renamePage, setIcon, setCover, setFavorite, touchPage', () => {
  it('updates fields and timestamps', () => {
    const ws = new Y.Doc();
    const page = createPage(ws, { title: 'Draft' }, { now: 1 });
    renamePage(ws, page.id, 'Final', { now: 2, userId: 'u2' });
    expect(requirePage(ws, page.id)).toMatchObject({
      title: 'Final',
      updatedAt: 2,
      updatedBy: 'u2',
    });
    setIcon(ws, page.id, '📚', { now: 3 });
    expect(getPage(ws, page.id)?.icon).toBe('📚');
    setIcon(ws, page.id, null);
    expect(getPage(ws, page.id)?.icon).toBeUndefined();
    setCover(ws, page.id, { kind: 'url', value: 'https://example.com/a.png', positionY: 30 });
    expect(getPage(ws, page.id)?.cover).toEqual({
      kind: 'url',
      value: 'https://example.com/a.png',
      positionY: 30,
    });
    setCover(ws, page.id, null);
    expect(getPage(ws, page.id)?.cover).toBeUndefined();
    setFavorite(ws, page.id, true);
    expect(getPage(ws, page.id)?.favorite).toBe(true);
    setFavorite(ws, page.id, false);
    expect(getPage(ws, page.id)?.favorite).toBeUndefined();
    touchPage(ws, page.id, { now: 99, userId: 'u3' });
    expect(getPage(ws, page.id)).toMatchObject({ updatedAt: 99, updatedBy: 'u3' });
  });

  it('throws for unknown pages and invalid values', () => {
    const ws = new Y.Doc();
    expect(() => renamePage(ws, 'missing', 'x')).toThrow(NotFoundError);
    const page = createPage(ws);
    expect(() => setIcon(ws, page.id, 'two words')).toThrow(ValidationError);
    expect(() => setCover(ws, page.id, { kind: 'preset', value: '' })).toThrow(ValidationError);
  });
});

describe('movePage', () => {
  it('reorders siblings', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const b = createPage(ws, { title: 'B' });
    const c = createPage(ws, { title: 'C' });
    movePage(ws, c.id, { parentId: null, position: 'start' });
    expect(titles(getChildren(ws, null))).toEqual(['C', 'A', 'B']);
    movePage(ws, c.id, { parentId: null, position: { after: a.id } });
    expect(titles(getChildren(ws, null))).toEqual(['A', 'C', 'B']);
    movePage(ws, a.id, { parentId: null });
    expect(titles(getChildren(ws, null))).toEqual(['C', 'B', 'A']);
    movePage(ws, b.id, { parentId: null, position: { index: 0 } });
    expect(titles(getChildren(ws, null))).toEqual(['B', 'C', 'A']);
  });

  it('nests and un-nests with the subtree', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const b = createPage(ws, { title: 'B' });
    const b1 = createPage(ws, { title: 'B1', parentId: b.id });
    movePage(ws, b.id, { parentId: a.id });
    expect(titles(getChildren(ws, null))).toEqual(['A']);
    expect(titles(getAncestors(ws, b1.id))).toEqual(['A', 'B']);
    movePage(ws, b.id, { parentId: null, position: 'start' });
    expect(titles(getChildren(ws, null))).toEqual(['B', 'A']);
  });

  it('rejects cycles, trashed targets and database rows', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const child = createPage(ws, { title: 'Child', parentId: a.id });
    expect(() => movePage(ws, a.id, { parentId: a.id })).toThrow(InvalidOperationError);
    expect(() => movePage(ws, a.id, { parentId: child.id })).toThrow(InvalidOperationError);
    const trashed = createPage(ws, { title: 'Trashed' });
    trashPage(ws, trashed.id);
    expect(() => movePage(ws, a.id, { parentId: trashed.id })).toThrow(InvalidOperationError);
    const db = createPage(ws, { kind: 'database', title: 'Tasks' });
    const row = createPage(ws, { title: 'Row', parentId: db.id });
    expect(isDatabaseRow(ws, row.id)).toBe(true);
    expect(() => movePage(ws, row.id, { parentId: null })).toThrow(InvalidOperationError);
    expect(() => movePage(ws, a.id, { parentId: db.id })).toThrow(InvalidOperationError);
  });

  it('re-keys siblings when concurrent inserts produced equal order keys', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const b = createPage(ws, { title: 'B' });
    const c = createPage(ws, { title: 'C' });
    const pages = pagesMapOf(ws);
    for (const page of [a, b]) (pages.get(page.id) as Y.Map<unknown>).set('order', 'a0');
    movePage(ws, c.id, { parentId: null, position: { index: 1 } });
    const sorted = getChildren(ws, null);
    expect(sorted[1]?.id).toBe(c.id);
    expect(new Set(sorted.map((page) => page.order)).size).toBe(3);
  });
});

describe('trash', () => {
  it('trashes and restores a subtree', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const a1 = createPage(ws, { title: 'A1', parentId: a.id });
    const a11 = createPage(ws, { title: 'A11', parentId: a1.id });
    const { affectedIds } = trashPage(ws, a.id, { now: 5, userId: 'u1' });
    expect(new Set(affectedIds)).toEqual(new Set([a.id, a1.id, a11.id]));
    expect(isPageTrashed(ws, a11.id)).toBe(true);
    expect(getChildren(ws, null)).toEqual([]);
    expect(listTrash(ws).map((page) => page.id)).toEqual([a.id]);
    expect(getPage(ws, a.id)).toMatchObject({ trashedAt: 5, trashedBy: 'u1' });
    expect(trashPage(ws, a1.id).affectedIds).toEqual([]);

    const restored = restorePage(ws, a.id);
    expect(new Set(restored.affectedIds)).toEqual(new Set([a.id, a1.id, a11.id]));
    expect(isPageTrashed(ws, a11.id)).toBe(false);
    expect(getPage(ws, a.id)?.trashedAt).toBeUndefined();
  });

  it('keeps separately trashed descendants in the trash', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const a1 = createPage(ws, { title: 'A1', parentId: a.id });
    trashPage(ws, a1.id, { now: 1 });
    trashPage(ws, a.id, { now: 2 });
    expect(listTrash(ws).map((page) => page.title)).toEqual(['A', 'A1']);
    restorePage(ws, a.id);
    expect(isPageTrashed(ws, a1.id)).toBe(true);
    expect(isPageTrashed(ws, a.id)).toBe(false);
  });

  it('restores to the top level when the parent is gone or trashed', () => {
    const ws = new Y.Doc();
    const parent = createPage(ws, { title: 'Parent' });
    const child = createPage(ws, { title: 'Child', parentId: parent.id });
    trashPage(ws, child.id);
    trashPage(ws, parent.id);
    restorePage(ws, child.id);
    expect(getPage(ws, child.id)?.parentId).toBeNull();
    expect(titles(getChildren(ws, null))).toEqual(['Child']);
  });

  it('deletes permanently with descendants and empties the trash', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const a1 = createPage(ws, { title: 'A1', parentId: a.id });
    const b = createPage(ws, { title: 'B' });
    const b1 = createPage(ws, { title: 'B1', parentId: b.id });
    const keep = createPage(ws, { title: 'Keep' });
    const removed = deletePagePermanently(ws, a.id);
    expect(removed.map((page) => page.id)).toEqual([a.id, a1.id]);
    expect(getPage(ws, a1.id)).toBeUndefined();
    trashPage(ws, b.id);
    trashPage(ws, b1.id);
    expect(
      emptyTrash(ws)
        .map((page) => page.id)
        .sort(),
    ).toEqual([b.id, b1.id].sort());
    expect(listPages(ws).map((page) => page.id)).toEqual([keep.id]);
    expect(() => deletePagePermanently(ws, 'missing')).toThrow(NotFoundError);
  });
});

describe('queries', () => {
  it('returns descendants depth-first and ancestors root-first', () => {
    const ws = new Y.Doc();
    const a = createPage(ws, { title: 'A' });
    const b = createPage(ws, { title: 'B', parentId: a.id });
    const c = createPage(ws, { title: 'C', parentId: b.id });
    const d = createPage(ws, { title: 'D', parentId: a.id });
    expect(titles(getDescendants(ws, a.id))).toEqual(['B', 'C', 'D']);
    expect(titles(getAncestors(ws, c.id))).toEqual(['A', 'B']);
    expect(getAncestors(ws, d.id).map((page) => page.id)).toEqual([a.id]);
  });

  it('tolerates malformed entries without losing pages', () => {
    const ws = new Y.Doc();
    const pages = pagesMapOf(ws);
    const broken = new Y.Map<unknown>();
    broken.set('title', 42);
    broken.set('order', 7);
    broken.set('parentId', 'ghost');
    pages.set('broken', broken);
    pages.set('not-a-map', 'garbage');
    const [page] = listPages(ws);
    expect(listPages(ws)).toHaveLength(1);
    expect(page).toMatchObject({
      id: 'broken',
      title: '',
      order: 'a0',
      parentId: 'ghost',
      kind: 'page',
    });
    expect(getChildren(ws, null).map((p) => p.id)).toEqual(['broken']);
  });
});

describe('concurrent edits', () => {
  it('merges concurrent field edits on the same page', () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    const a = createPage(one, { title: 'A' });
    const b = createPage(one, { title: 'B' });
    sync(one, two);
    renamePage(one, a.id, 'Renamed');
    movePage(two, a.id, { parentId: b.id });
    sync(one, two);
    for (const doc of [one, two]) {
      expect(getPage(doc, a.id)).toMatchObject({ title: 'Renamed', parentId: b.id });
    }
  });

  it('resolves cycles from concurrent moves identically on every client', () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    const x = createPage(one, { id: 'x-page', title: 'X' });
    const y = createPage(one, { id: 'y-page', title: 'Y' });
    sync(one, two);
    movePage(one, x.id, { parentId: y.id });
    movePage(two, y.id, { parentId: x.id });
    sync(one, two);
    const trees = [one, two].map((doc) => createPageIndex(listPages(doc)).tree());
    expect(trees[0]).toEqual(trees[1]);
    expect(trees[0]?.map((node) => node.page.id)).toEqual(['x-page']);
    expect(trees[0]?.[0]?.children.map((node) => node.page.id)).toEqual(['y-page']);
  });
});

describe('observePages', () => {
  it('reports added, updated and removed pages with local and remote origin', () => {
    const ws = new Y.Doc();
    const changes: PagesChange[] = [];
    const stop = observePages(ws, (change) => changes.push(change));
    const page = createPage(ws, { title: 'One' }, { now: 1 });
    renamePage(ws, page.id, 'Two', { now: 2 });
    trashPage(ws, page.id);
    deletePagePermanently(ws, page.id);

    expect(changes).toHaveLength(4);
    expect(changes[0]?.added.map((p) => p.title)).toEqual(['One']);
    expect(changes[0]?.local).toBe(true);
    expect(changes[1]?.updated[0]).toMatchObject({
      previous: { title: 'One' },
      page: { title: 'Two' },
    });
    expect(changes[1]?.updated[0]?.fields).toEqual(expect.arrayContaining(['title', 'updatedAt']));
    expect(changes[2]?.updated[0]?.fields).toContain('trashedAt');
    expect(changes[3]?.removed.map((p) => p.title)).toEqual(['Two']);

    const remote = new Y.Doc();
    createPage(remote, { title: 'From afar' });
    Y.applyUpdate(ws, Y.encodeStateAsUpdate(remote), 'sync');
    expect(changes[4]).toMatchObject({ local: false, origin: 'sync' });
    expect(changes[4]?.added.map((p) => p.title)).toEqual(['From afar']);

    stop();
    createPage(ws, { title: 'Unobserved' });
    expect(changes).toHaveLength(5);
  });
});
