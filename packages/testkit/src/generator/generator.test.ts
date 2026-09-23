import {
  docJSONEqual,
  extractLinks,
  extractTags,
  extractTasks,
  getPage,
  getPageProps,
  indexPages,
  isValidTagName,
  listProperties,
  listRows,
  listViews,
  PROPERTY_TYPES,
  readDocJSON,
  validateDocJSON,
  validatePropertyValue,
  VIEW_TYPES,
  walkDocJSON,
  type StoredPropertyType,
} from '@tessera/core';
import { COVER_PRESETS } from '@tessera/ui';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { COVER_PRESET_NAMES } from './covers';
import { GENERATED_PROPERTY_TYPES, generateWorkspace, type GeneratedWorkspace } from './index';

const bytes = (doc: Y.Doc | null) =>
  doc ? Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') : null;

/** Everything a workspace consists of, serialized, for byte-level comparisons. */
function snapshot(workspace: GeneratedWorkspace) {
  return {
    plan: JSON.stringify({ pages: workspace.pages, databases: workspace.databases }),
    workspace: bytes(workspace.workspaceDoc()),
    pages: workspace.pages.map((page) => bytes(workspace.pageDoc(page.id))),
    databases: workspace.databases.map((database) => bytes(workspace.databaseDoc(database.id))),
    markdown: JSON.stringify(workspace.markdownFiles()),
  };
}

describe('generateWorkspace determinism', () => {
  const options = {
    seed: 'determinism',
    pages: 60,
    databases: 3,
    rowsPerDatabase: 8,
    trashed: 2,
    largePages: [40],
  };

  it('produces byte-identical docs and files for the same seed', () => {
    expect(snapshot(generateWorkspace(options))).toEqual(snapshot(generateWorkspace(options)));
  });

  it('produces a different workspace for a different seed', () => {
    const a = snapshot(generateWorkspace(options));
    const b = snapshot(generateWorkspace({ ...options, seed: 'other' }));
    expect(a.plan).not.toBe(b.plan);
    expect(a.workspace).not.toBe(b.workspace);
    expect(a.markdown).not.toBe(b.markdown);
  });

  it('builds each page the same no matter which pages were built before', () => {
    const first = generateWorkspace(options);
    const second = generateWorkspace(options);
    const page = first.pages.filter((candidate) => candidate.role === 'page').at(-1);
    if (!page) throw new Error('no page');
    const direct = bytes(first.pageDoc(page.id));
    for (const other of second.pages) second.content(other.id);
    expect(bytes(second.pageDoc(page.id))).toBe(direct);
  });
});

describe('the workspace doc', () => {
  const workspace = generateWorkspace({ seed: 7, pages: 150, trashed: 3 });
  const ws = workspace.workspaceDoc();
  const index = indexPages(ws);

  it('holds every planned page with its metadata, written through the core helpers', () => {
    expect(index.size).toBe(workspace.pages.length);
    for (const page of workspace.pages) {
      const meta = getPage(ws, page.id);
      expect(meta, page.title).toMatchObject({
        id: page.id,
        kind: page.kind,
        title: page.title,
        parentId: page.parentId,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      });
      expect(meta?.icon).toBe(page.icon);
      expect(Boolean(meta?.favorite)).toBe(page.favorite);
      expect(meta?.createdBy).toMatch(/^user-/);
    }
  });

  it('keeps siblings in planned order and nests within maxDepth', () => {
    const planned = (parentId: string | null) =>
      workspace.pages.filter((page) => page.parentId === parentId).map((page) => page.id);
    expect(index.children(null, { includeTrashed: true }).map((page) => page.id)).toEqual(
      planned(null),
    );
    for (const page of workspace.pages) {
      expect(
        index
          .children(page.id, { includeTrashed: true, includeRows: true })
          .map((child) => child.id),
      ).toEqual(planned(page.id));
    }
    const depths = workspace.pages.filter((page) => page.role === 'page').map((page) => page.depth);
    expect(Math.max(...depths)).toBeLessThanOrEqual(5);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
  });

  it('puts trashed pages in the trash and makes rows children of their database', () => {
    expect(
      index
        .trash()
        .map((page) => page.id)
        .sort(),
    ).toEqual(
      workspace.pages
        .filter((page) => page.trashed)
        .map((page) => page.id)
        .sort(),
    );
    for (const page of workspace.pages.filter((candidate) => candidate.role === 'row')) {
      expect(index.isRow(page.id)).toBe(true);
    }
  });

  it('uses valid cover presets and favorites', () => {
    expect(COVER_PRESET_NAMES).toEqual(Object.keys(COVER_PRESETS));
    expect(index.favorites().length).toBeGreaterThanOrEqual(2);
  });
});

describe('page content', () => {
  const workspace = generateWorkspace({ seed: 11, pages: 300, largePages: [120] });
  const bodies = workspace.pages
    .map((page) => ({ page, json: workspace.content(page.id) }))
    .filter(
      (
        entry,
      ): entry is { page: (typeof entry)['page']; json: NonNullable<(typeof entry)['json']> } =>
        entry.json !== null,
    );

  it('is valid DocJSON that round-trips through a page doc with its props', () => {
    for (const { page, json } of bodies.slice(0, 80)) {
      expect(validateDocJSON(json).ok, page.title).toBe(true);
      const doc = workspace.pageDoc(page.id);
      if (!doc) throw new Error('missing doc');
      expect(docJSONEqual(readDocJSON(doc), json)).toBe(true);
      const props = getPageProps(doc);
      expect(props.tags ?? []).toEqual(page.tags);
      expect(props.aliases ?? []).toEqual(page.aliases);
    }
  });

  it('uses every kind of block across the workspace', () => {
    const seen = new Set<string>();
    for (const { json } of bodies) walkDocJSON(json, (node) => void seen.add(node.type));
    for (const type of [
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'taskList',
      'table',
      'callout',
      'toggle',
      'codeBlock',
      'blockquote',
      'horizontalRule',
      'embed',
      'pageLink',
      'tag',
    ]) {
      expect(seen, type).toContain(type);
    }
  });

  it('links to existing pages with a power-law in-degree, and uses valid tags', () => {
    const inDegree = new Map<string, number>();
    for (const { page, json } of bodies) {
      for (const link of extractLinks(json)) {
        const target = workspace.page(link.targetPageId);
        expect(target, `${page.title} → ${link.targetPageId}`).toBeDefined();
        expect(target?.role).not.toBe('row');
        expect(link.targetPageId).not.toBe(page.id);
        inDegree.set(link.targetPageId, (inDegree.get(link.targetPageId) ?? 0) + 1);
      }
      for (const tag of extractTags(json)) expect(isValidTagName(tag.name)).toBe(true);
    }
    const degrees = [...inDegree.values()].sort((a, b) => b - a);
    const median = degrees[Math.floor(degrees.length / 2)] ?? 0;
    // Hubs: the most-linked page gets many times the typical page's links.
    expect(degrees[0] ?? 0).toBeGreaterThanOrEqual(8 * Math.max(1, median));
    expect(workspace.stats().links).toBeGreaterThan(workspace.stats().pages);
  });

  it('writes tasks, some done and some not', () => {
    const tasks = bodies.flatMap(({ json }) => extractTasks(json));
    expect(tasks.some((task) => task.checked)).toBe(true);
    expect(tasks.some((task) => !task.checked)).toBe(true);
  });

  it('gives large pages exactly the requested number of blocks, ending with a marker', () => {
    const large = workspace.pages.find((page) => page.role === 'large');
    if (!large) throw new Error('no large page');
    const json = workspace.content(large.id);
    expect(json?.content).toHaveLength(120);
    const last = json?.content?.at(-1);
    expect(
      last?.type === 'paragraph' && last.content?.[0]?.type === 'text' ? last.content[0].text : '',
    ).toBe(workspace.largePageMarker(large.id));
  });
});

describe('databases', () => {
  const workspace = generateWorkspace({
    seed: 5,
    pages: 40,
    databases: 3,
    rowsPerDatabase: [10, 20],
  });
  const docs = new Map(
    workspace.databases.map((database) => [database.id, workspace.databaseDoc(database.id)]),
  );

  it('covers every property type (formula is reserved) and every view type', () => {
    expect([...GENERATED_PROPERTY_TYPES].sort()).toEqual(
      PROPERTY_TYPES.filter((type) => type !== 'formula').sort(),
    );
    const types = new Set<string>();
    for (const [id, db] of docs) {
      listProperties(db).forEach((property) => types.add(property.type));
      expect(
        listViews(db).map((view) => view.type),
        id,
      ).toEqual([...VIEW_TYPES]);
    }
    expect([...types].sort()).toEqual([...GENERATED_PROPERTY_TYPES].sort());
  });

  it('stores every row with values that validate against their property', () => {
    for (const database of workspace.databases) {
      const db = docs.get(database.id);
      if (!db) throw new Error('missing db');
      const rows = listRows(db);
      expect(rows.map((row) => row.id)).toEqual(database.rows.map((row) => row.id));
      expect(rows.length).toBeGreaterThanOrEqual(10);
      const properties = new Map(listProperties(db).map((property) => [property.id, property]));
      for (const row of rows) {
        for (const [propertyId, value] of Object.entries(row.values)) {
          const property = properties.get(propertyId);
          expect(property, propertyId).toBeDefined();
          if (!property) continue;
          expect(
            validatePropertyValue(property.type as StoredPropertyType, value).success,
            `${property.name}: ${JSON.stringify(value)}`,
          ).toBe(true);
          if (property.type === 'select')
            expect(property.options?.map((option) => option.id)).toContain(value);
        }
      }
    }
  });

  it('keeps the meetings ↔ projects relation consistent in both directions', () => {
    const projects = workspace.databases.find((database) => database.template === 'projects');
    const meetings = workspace.databases.find((database) => database.template === 'meetings');
    if (!projects || !meetings) throw new Error('templates missing');
    const forward = meetings.properties.find(
      (property) => property.relation?.targetDatabaseId === projects.id,
    );
    const back = projects.properties.find(
      (property) => property.relation?.targetDatabaseId === meetings.id,
    );
    expect(forward?.relation?.backPropertyId).toBe(back?.id);
    expect(back?.relation?.backPropertyId).toBe(forward?.id);
    const pairs = new Set<string>();
    for (const row of meetings.rows) {
      for (const project of (row.values[forward?.id ?? ''] as string[] | undefined) ?? [])
        pairs.add(`${row.id}>${project}`);
    }
    const backPairs = new Set<string>();
    for (const row of projects.rows) {
      for (const meeting of (row.values[back?.id ?? ''] as string[] | undefined) ?? [])
        backPairs.add(`${meeting}>${row.id}`);
    }
    expect(pairs.size).toBeGreaterThan(0);
    expect(backPairs).toEqual(pairs);
  });

  it('splits very large databases into chunks and still stores every row', () => {
    const big = generateWorkspace({ seed: 3, pages: 5, databases: 1, rowsPerDatabase: 900 });
    const [database] = big.databases;
    if (!database) throw new Error('no database');
    expect(new Set(listRows(big.databaseDoc(database.id)).map((row) => row.id))).toEqual(
      new Set(database.rows.map((row) => row.id)),
    );
  }, 60_000);
});

describe('markdown export', () => {
  const workspace = generateWorkspace({ seed: 9, pages: 80, trashed: 2, folder: 'Vault' });
  const files = workspace.markdownFiles();
  const names = new Set(
    files.map((file) =>
      file.path
        .split('/')
        .at(-1)
        ?.replace(/\.(md|csv)$/, ''),
    ),
  );

  it('writes one file per visible page and one CSV per database, under the folder', () => {
    const visible = workspace.pages.filter(
      (page) => page.role !== 'row' && !isTrashed(workspace, page.id),
    );
    expect(files).toHaveLength(visible.length);
    expect(files.every((file) => file.path.startsWith('Vault/'))).toBe(true);
    expect(files.filter((file) => file.path.endsWith('.csv'))).toHaveLength(
      workspace.databases.length,
    );
    expect(files.every((file) => !/[\\:*?"<>|#^[\]]/.test(file.path))).toBe(true);
  });

  it('writes frontmatter, tasks and wikilinks that resolve to other files', () => {
    const withTags = workspace.pages.find(
      (page) => page.role === 'page' && page.tags.length && !isTrashed(workspace, page.id),
    );
    const file = files.find((candidate) => candidate.path.endsWith(`/${withTags?.title}.md`));
    expect(file?.content.startsWith(`---\ntags: [`)).toBe(true);
    const links = files.flatMap((candidate) =>
      [...candidate.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(
        (match) => match[1] ?? '',
      ),
    );
    expect(links.length).toBeGreaterThan(50);
    for (const link of links) expect(names.has(link.replace(/\.csv$/, '')), link).toBe(true);
    expect(files.some((candidate) => candidate.content.includes('- [x] '))).toBe(true);
  });

  it('writes databases as CSV with a header of property names and a line per row', () => {
    for (const database of workspace.databases) {
      const csv = files.find((file) => file.path.endsWith(`/${database.title}.csv`));
      const [header, ...rows] = (csv?.content.trim() ?? '').split('\n');
      expect(header).toBe(
        database.properties
          .map((property) => (property.name.includes(',') ? `"${property.name}"` : property.name))
          .join(','),
      );
      expect(rows.length).toBeGreaterThanOrEqual(database.rows.length);
    }
  });
});

describe('options', () => {
  it('rejects invalid sizes and handles an empty workspace', () => {
    expect(() => generateWorkspace({ pages: -1 })).toThrow(RangeError);
    expect(() => generateWorkspace({ pages: 1.5 })).toThrow(RangeError);
    const empty = generateWorkspace({ pages: 0, databases: 1, rowsPerDatabase: 2 });
    expect(empty.pages.map((page) => page.role)).toEqual(['database', 'row', 'row']);
    expect(indexPages(empty.workspaceDoc()).size).toBe(3);
  });

  it('builds a 5,000-page workspace doc in seconds', () => {
    const started = performance.now();
    const workspace = generateWorkspace({ seed: 42, pages: 5000 });
    const ws = workspace.workspaceDoc();
    expect(indexPages(ws).size).toBe(workspace.pages.length);
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 60_000);
});

function isTrashed(workspace: GeneratedWorkspace, id: string): boolean {
  for (
    let page = workspace.page(id);
    page;
    page = page.parentId ? workspace.page(page.parentId) : undefined
  ) {
    if (page.trashed) return true;
  }
  return false;
}

describe('the trash', () => {
  it('never trashes a page inside another trashed page', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const workspace = generateWorkspace({ seed, pages: 60, trashed: 6 });
      const trashed = workspace.pages.filter((page) => page.trashed);
      expect(trashed).toHaveLength(6);
      const index = indexPages(workspace.workspaceDoc());
      expect(
        index
          .trash()
          .map((page) => page.id)
          .sort(),
      ).toEqual(trashed.map((page) => page.id).sort());
    }
  });
});
