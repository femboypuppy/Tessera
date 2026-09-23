import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isValidBlockId, isValidId, newBlockId, newId } from '../ids';
import { cloneJson, isJsonObject, isJsonValue, jsonEqual } from '../json';
import { jsonValueSchema } from '../json-schema';
import {
  compareOrdered,
  isValidOrderKey,
  orderAfterAll,
  orderBetween,
  orderForIndex,
  ordersBetween,
  positionToIndex,
  sortOrdered,
} from '../order';
import { databaseDocName, pageDocName, parseDocName, workspaceDocName } from './doc-names';
import { createPageIndex, flattenPageTree } from './page-index';
import { isValidIcon, normalizeTitle, parsePageCover, type PageMeta } from './page-meta';
import { pageCoverSchema, pageMetaSchema } from './page-meta-schema';
import {
  getPageContent,
  getPageProp,
  getPageProps,
  observePageProps,
  setPageProp,
  setPageProps,
} from './page-doc';
import {
  getWorkspaceSchemaVersion,
  getWorkspaceSetting,
  initWorkspaceDoc,
  listWorkspaceSettingKeys,
  observeWorkspaceSettings,
  setWorkspaceSetting,
} from './workspace-doc';

function page(id: string, patch: Partial<PageMeta> = {}): PageMeta {
  return {
    id,
    kind: 'page',
    title: id.toUpperCase(),
    parentId: null,
    order: 'a0',
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe('ids', () => {
  it('generates valid, unique IDs and block IDs', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isValidId(id)).toBe(true);
    expect(isValidId('has space')).toBe(false);
    expect(isValidId('')).toBe(false);
    const existing = new Set(['aaaaaaaa']);
    const blockId = newBlockId(existing);
    expect(isValidBlockId(blockId)).toBe(true);
    expect(blockId).toMatch(/^[0-9a-z]{8}$/);
    expect(isValidBlockId('my-block')).toBe(true);
    expect(isValidBlockId('no_underscore')).toBe(false);
  });
});

describe('json', () => {
  it('recognizes JSON values', () => {
    expect(isJsonValue({ a: [1, 'b', null, true, { c: 2 }] })).toBe(true);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue({ f: () => 1 })).toBe(false);
    expect(isJsonValue(undefined)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isJsonValue(cyclic)).toBe(false);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([1])).toBe(false);
    expect(jsonValueSchema.safeParse({ n: Number.NaN }).success).toBe(false);
  });

  it('compares and clones deeply', () => {
    expect(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined as unknown as null })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
    const value = { a: [1, 2] };
    const copy = cloneJson(value);
    copy.a.push(3);
    expect(value.a).toEqual([1, 2]);
  });
});

describe('order', () => {
  it('generates keys between neighbours', () => {
    const a = orderBetween(null, null);
    const b = orderBetween(a, null);
    const mid = orderBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    expect(orderBetween(null, a) < a).toBe(true);
    expect(() => orderBetween(b, a)).toThrow(RangeError);
    expect(() => orderBetween(a, a)).toThrow(RangeError);
    const many = ordersBetween(a, b, 5);
    expect([...many].sort()).toEqual(many);
    expect(many.every((key) => key > a && key < b)).toBe(true);
    expect(ordersBetween(null, null, 0)).toEqual([]);
    expect(isValidOrderKey(a)).toBe(true);
    expect(isValidOrderKey('')).toBe(false);
    expect(isValidOrderKey('zzz~')).toBe(false);
  });

  it('sorts by order then id', () => {
    const items = [
      { id: 'b', order: 'a1' },
      { id: 'c', order: 'a0' },
      { id: 'a', order: 'a1' },
    ];
    expect(sortOrdered(items).map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(compareOrdered({ id: 'x', order: 'a0' }, { id: 'x', order: 'a0' })).toBe(0);
  });

  it('places items at an index and re-keys ties', () => {
    const siblings = [
      { id: 'a', order: 'a0' },
      { id: 'b', order: 'a1' },
    ];
    expect(orderForIndex(siblings, 1)).toEqual({ order: orderBetween('a0', 'a1'), rekeyed: [] });
    expect(orderForIndex(siblings, 99).order > 'a1').toBe(true);
    const tied = [
      { id: 'a', order: 'a0' },
      { id: 'b', order: 'a0' },
      { id: 'c', order: 'a0' },
    ];
    const { order, rekeyed } = orderForIndex(tied, 1);
    const all = [...rekeyed.map((entry) => ({ ...entry })), { id: 'new', order }].sort(
      compareOrdered,
    );
    expect(all.map((entry) => entry.id)).toEqual(['a', 'new', 'b', 'c']);
    expect(new Set(all.map((entry) => entry.order)).size).toBe(4);
    expect(orderAfterAll(tied) > 'a0').toBe(true);
    expect(orderAfterAll([])).toBe('a0');
    expect(orderAfterAll([{ id: 'bad', order: '!!' }])).toBe('a0');
  });

  it('converts list positions to indexes', () => {
    const siblings = [
      { id: 'a', order: 'a0' },
      { id: 'b', order: 'a1' },
    ];
    expect(positionToIndex(siblings, 'start')).toBe(0);
    expect(positionToIndex(siblings, 'end')).toBe(2);
    expect(positionToIndex(siblings, { index: 1 })).toBe(1);
    expect(positionToIndex(siblings, { before: 'b' })).toBe(1);
    expect(positionToIndex(siblings, { after: 'b' })).toBe(2);
    expect(() => positionToIndex(siblings, { after: 'zzz' })).toThrow();
  });
});

describe('doc names', () => {
  it('builds and parses doc names', () => {
    expect(workspaceDocName('w1')).toBe('ws:w1');
    expect(pageDocName('p1')).toBe('page:p1');
    expect(databaseDocName('d1')).toBe('db:d1');
    expect(parseDocName('page:p1')).toEqual({ kind: 'page', id: 'p1' });
    expect(parseDocName('db:d1')).toEqual({ kind: 'database', id: 'd1' });
    expect(parseDocName('ws:w1')).toEqual({ kind: 'workspace', id: 'w1' });
    expect(parseDocName('page:')).toBeNull();
    expect(parseDocName('other:x')).toBeNull();
  });
});

describe('page meta', () => {
  it('normalizes titles and validates icons and metadata', () => {
    expect(normalizeTitle('a\r\nb\u0007c')).toBe('a bc');
    expect(normalizeTitle('x'.repeat(3000))).toHaveLength(2000);
    expect(isValidIcon('🚀')).toBe(true);
    expect(isValidIcon('👩‍👩‍👧')).toBe(true);
    expect(isValidIcon('🇨🇦')).toBe(true);
    expect(isValidIcon('ab')).toBe(false);
    expect(isValidIcon('')).toBe(false);
    expect(pageMetaSchema.safeParse(page('valid-id')).success).toBe(true);
    expect(pageMetaSchema.safeParse({ ...page('x'), kind: 'folder' }).success).toBe(false);
  });

  it('parses covers exactly like pageCoverSchema, without zod', () => {
    const samples: unknown[] = [
      { kind: 'preset', value: 'aurora' },
      { kind: 'asset', value: 'asset-1', positionY: 0 },
      { kind: 'url', value: 'https://example.com/cover.png', positionY: 100 },
      { kind: 'preset', value: 'aurora', positionY: 37.5, extra: 'dropped' },
      { kind: 'video', value: 'x' },
      { kind: 'preset', value: '' },
      { kind: 'preset', value: 'x'.repeat(2048) },
      { kind: 'preset', value: 'x'.repeat(2049) },
      { kind: 'preset', value: 'aurora', positionY: -1 },
      { kind: 'preset', value: 'aurora', positionY: 101 },
      { kind: 'preset', value: 'aurora', positionY: Number.NaN },
      { kind: 'preset', value: 'aurora', positionY: Number.POSITIVE_INFINITY },
      { kind: 'preset', value: 'aurora', positionY: '50' },
      { kind: 'preset', value: 42 },
      { value: 'aurora' },
      ['preset', 'aurora'],
      'aurora',
      null,
      undefined,
    ];
    for (const sample of samples) {
      const zod = pageCoverSchema.safeParse(sample);
      expect(parsePageCover(sample), JSON.stringify(sample)).toEqual(zod.success ? zod.data : null);
    }
  });
});

describe('createPageIndex', () => {
  const pages = [
    page('root-a', { order: 'a0', favorite: true, title: 'Beta' }),
    page('root-b', { order: 'a1' }),
    page('child', { parentId: 'root-a' }),
    page('grandchild', { parentId: 'child' }),
    page('orphan', { parentId: 'missing-parent', order: 'a2' }),
    page('db', { kind: 'database', order: 'a3' }),
    page('row-1', { parentId: 'db' }),
    page('trashed', { parentId: 'root-b', trashedAt: 10 }),
    page('under-trashed', { parentId: 'trashed', favorite: true }),
    page('fav', { favorite: true, title: 'alpha', order: 'a4' }),
  ];
  const index = createPageIndex(pages);

  it('builds the tree without trash and rows, keeping orphans at the top level', () => {
    const tree = index.tree();
    expect(tree.map((node) => node.page.id)).toEqual(['root-a', 'root-b', 'orphan', 'db', 'fav']);
    expect(tree[0]?.children[0]?.children[0]?.page.id).toBe('grandchild');
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
    expect(flattenPageTree(tree).map((node) => node.page.id)).toEqual([
      'root-a',
      'child',
      'grandchild',
      'root-b',
      'orphan',
      'db',
      'fav',
    ]);
    expect(index.tree({ includeRows: true, includeTrashed: true }).length).toBe(5);
  });

  it('answers trash, row, favorite and ancestry questions', () => {
    expect(index.isTrashed('under-trashed')).toBe(true);
    expect(index.isTrashed('grandchild')).toBe(false);
    expect(index.isRow('row-1')).toBe(true);
    expect(index.isRow('child')).toBe(false);
    expect(index.children('db')).toEqual([]);
    expect(index.children('db', { includeRows: true }).map((p) => p.id)).toEqual(['row-1']);
    expect(index.children('trashed')).toEqual([]);
    expect(index.trash().map((p) => p.id)).toEqual(['trashed']);
    expect(index.favorites().map((p) => p.id)).toEqual(['fav', 'root-a']);
    expect(index.ancestors('grandchild').map((p) => p.id)).toEqual(['root-a', 'child']);
    expect(index.ancestors('orphan')).toEqual([]);
    expect(index.effectiveParentId('orphan')).toBeNull();
    expect(index.descendants('root-b').map((p) => p.id)).toEqual(['trashed', 'under-trashed']);
    expect(index.get('nope')).toBeUndefined();
    expect(index.size).toBe(pages.length);
  });

  it('breaks long cycles deterministically', () => {
    const cyclic = createPageIndex([
      page('c', { parentId: 'a' }),
      page('a', { parentId: 'b' }),
      page('b', { parentId: 'c' }),
      page('d', { parentId: 'b' }),
    ]);
    expect(cyclic.effectiveParentId('a')).toBeNull();
    expect(cyclic.ancestors('d').map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(flattenPageTree(cyclic.tree()).map((node) => node.page.id)).toEqual([
      'a',
      'c',
      'b',
      'd',
    ]);
  });
});

describe('page doc props', () => {
  it('reads, writes and observes props', () => {
    const doc = new Y.Doc();
    const seen: string[][] = [];
    const stop = observePageProps(doc, (keys) => seen.push(keys));
    setPageProp(doc, 'tags', ['space', 'history']);
    setPageProps(doc, { aliases: ['Apollo'], fullWidth: true, custom: { nested: 1 } });
    expect(getPageProps(doc)).toEqual({
      tags: ['space', 'history'],
      aliases: ['Apollo'],
      fullWidth: true,
      custom: { nested: 1 },
    });
    expect(getPageProp(doc, 'custom')).toEqual({ nested: 1 });
    setPageProp(doc, 'custom', undefined);
    expect(getPageProp(doc, 'custom')).toBeUndefined();
    expect(seen).toEqual([['tags'], ['aliases', 'fullWidth', 'custom'], ['custom']]);
    stop();
    expect(() => setPageProp(doc, 'bad', (() => 1) as unknown as string)).toThrow(TypeError);
    expect(getPageContent(doc)).toBeInstanceOf(Y.XmlFragment);
  });

  it('drops malformed well-known props', () => {
    const doc = new Y.Doc();
    doc.getMap('props').set('tags', 'not-a-list');
    doc.getMap('props').set('fullWidth', 'yes');
    doc.getMap('props').set('aliases', ['ok', 3, '']);
    expect(getPageProps(doc)).toEqual({ aliases: ['ok'] });
  });
});

describe('workspace doc', () => {
  it('stamps the schema version once and stores settings', () => {
    const ws = new Y.Doc();
    expect(getWorkspaceSchemaVersion(ws)).toBeNull();
    initWorkspaceDoc(ws, { now: 5 });
    initWorkspaceDoc(ws, { now: 6 });
    expect(getWorkspaceSchemaVersion(ws)).toBe(1);
    expect(ws.getMap('meta').get('createdAt')).toBe(5);
    const changes: string[][] = [];
    const stop = observeWorkspaceSettings(ws, (keys) => changes.push(keys));
    setWorkspaceSetting(ws, 'backlinks.showFooter', true);
    setWorkspaceSetting(ws, 'plugins.registryUrl', 'https://example.com/registry.json');
    expect(getWorkspaceSetting(ws, 'backlinks.showFooter')).toBe(true);
    expect(listWorkspaceSettingKeys(ws, 'plugins.')).toEqual(['plugins.registryUrl']);
    setWorkspaceSetting(ws, 'backlinks.showFooter', undefined);
    expect(getWorkspaceSetting(ws, 'backlinks.showFooter')).toBeUndefined();
    expect(changes).toEqual([
      ['backlinks.showFooter'],
      ['plugins.registryUrl'],
      ['backlinks.showFooter'],
    ]);
    stop();
    expect(() => setWorkspaceSetting(ws, 'x', new Date() as unknown as string)).toThrow(TypeError);
  });
});
