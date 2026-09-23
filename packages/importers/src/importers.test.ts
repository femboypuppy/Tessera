import {
  importFileFromBytes,
  importFileFromText,
  type ImportFile,
  type ImportReport,
  type PageMeta,
} from '@tessera/core';
import type { TestAppContext } from '@tessera/core/testing';
import { strToU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMarkdownImporter, createNotionImporter, createObsidianImporter } from './importers';
import {
  databaseOf,
  docOf,
  fixtureEntries,
  fixtureFiles,
  importWorkspace,
  linksOf,
  nodesOf,
  outline,
  pageAt,
  propsOf,
  runImporter,
  zipEntries,
} from './test/helpers';

interface Imported {
  test: TestAppContext;
  report: ImportReport;
  root: string;
  page(path: string): PageMeta;
}

async function importWith(
  importer: ReturnType<typeof createObsidianImporter>,
  files: ImportFile[],
  rootTitle: string,
): Promise<Imported> {
  const test = await importWorkspace();
  const report = await runImporter(test.ctx, importer, files, rootTitle);
  const root = report.rootPageId ?? '';
  return { test, report, root, page: (path) => pageAt(test.ctx, root, path) };
}

describe('Obsidian importer', () => {
  let vault: Imported;
  beforeAll(async () => {
    vault = await importWith(
      createObsidianImporter(),
      fixtureFiles('obsidian-vault', 'Apollo vault'),
      'Obsidian import',
    );
  }, 60_000);
  afterAll(() => vault.test.dispose());

  it('rebuilds the page tree: folders, folder notes, deep nesting; no settings or trash', () => {
    expect(vault.test.ctx.workspace.getPage(vault.root)?.title).toBe('Obsidian import');
    expect(outline(vault.test.ctx, vault.root)).toEqual([
      'Archive',
      '  Ideas',
      'attachments',
      'Café crème ☕',
      'Daily',
      '  2026-09-23',
      '  2026-09-24',
      'Notes',
      '  Brainstorm',
      '  Ideas',
      'Projects',
      '  Apollo 11 🚀',
      '  Archive',
      '    2019',
      '      Mission logs',
      '        Deep dive',
      '          Deepest note',
      '  Launch plan',
      'Reading list [database]',
      '  · Dune',
      '  · Kindred',
      '  · The Left Hand of Darkness',
      '  · Project Hail Mary',
      'Welcome',
    ]);
  });

  it('resolves wikilinks: aliases, headings, block refs, paths, tables and relative links', async () => {
    const links = linksOf(vault.test.ctx, await docOf(vault.test.ctx, vault.page('Welcome').id));
    expect(links).toEqual([
      { title: 'Apollo 11 🚀', label: 'Apollo 11', heading: null, blockRef: null },
      { title: 'Launch plan', label: 'countdown', heading: 'Countdown', blockRef: null },
      { title: 'Café crème ☕', label: null, heading: null, blockRef: null },
      { title: 'Launch plan', label: null, heading: null, blockRef: null },
      { title: 'Deepest note', label: 'the deepest note', heading: null, blockRef: null },
      { title: 'Apollo 11 🚀', label: 'landing', heading: null, blockRef: null },
      { title: 'Launch plan', label: 'relative link', heading: null, blockRef: null },
      { title: 'Ideas', label: null, heading: null, blockRef: null },
      { title: 'Ideas', label: null, heading: null, blockRef: null },
      { title: 'Launch plan', label: null, heading: null, blockRef: 'step-2' },
    ]);
    const welcome = await docOf(vault.test.ctx, vault.page('Welcome').id);
    const ideaIds = nodesOf(welcome)
      .filter(
        (node) =>
          node.type === 'pageLink' &&
          vault.test.ctx.workspace.getPage(String(node.attrs?.pageId))?.title === 'Ideas',
      )
      .map((node) => node.attrs?.pageId);
    expect(ideaIds).toEqual([vault.page('Notes/Ideas').id, vault.page('Archive/Ideas').id]);
  });

  it('resolves by alias, prefers the same folder, and follows heading embeds', async () => {
    const { ctx } = vault.test;
    expect(linksOf(ctx, await docOf(ctx, vault.page('Projects/Apollo 11 🚀').id))).toEqual([
      { title: 'Welcome', label: null, heading: null, blockRef: null },
      { title: 'Welcome', label: 'home page', heading: null, blockRef: null },
    ]);
    const brainstorm = await docOf(ctx, vault.page('Notes/Brainstorm').id);
    expect(nodesOf(brainstorm).find((node) => node.type === 'pageLink')?.attrs?.pageId).toBe(
      vault.page('Notes/Ideas').id,
    );
    expect(linksOf(ctx, await docOf(ctx, vault.page('Projects').id))).toEqual([
      { title: 'Apollo 11 🚀', label: null, heading: null, blockRef: null },
      { title: 'Launch plan', label: null, heading: null, blockRef: null },
    ]);
    expect(linksOf(ctx, await docOf(ctx, vault.page('Daily/2026-09-24').id))).toEqual([
      { title: '2026-09-23', label: null, heading: null, blockRef: null },
      { title: 'Launch plan', label: null, heading: 'Countdown', blockRef: null },
    ]);
  });

  it('keeps broken links as text and reports them on their page', async () => {
    const welcome = vault.page('Welcome');
    const text = nodesOf(await docOf(vault.test.ctx, welcome.id))
      .map((node) => node.text ?? '')
      .join('');
    expect(text).toContain('[[Missing mission]]');
    expect(text).toContain('[[Does not exist]]');
    const broken = vault.report.issues.filter((issue) => issue.code === 'unresolved-link');
    expect(broken.map((issue) => [issue.message, issue.pageId, issue.file])).toEqual([
      ['Unresolved link: [[Missing mission]]', welcome.id, 'Apollo vault/Welcome.md'],
      ['Unresolved link: [[Does not exist]]', welcome.id, 'Apollo vault/Welcome.md'],
    ]);
  });

  it('imports frontmatter as page properties, and dates as timestamps', async () => {
    const { ctx } = vault.test;
    expect(await propsOf(ctx, vault.page('Welcome').id)).toEqual({
      tags: ['home', 'space/history'],
      aliases: ['Start here', 'Home'],
      cssclasses: 'wide',
    });
    expect(await propsOf(ctx, vault.page('Projects/Launch plan').id)).toEqual({
      aliases: ['Countdown plan'],
      status: 'draft',
    });
    const apollo = vault.page('Projects/Apollo 11 🚀');
    expect(await propsOf(ctx, apollo.id)).toEqual({
      tags: ['apollo', 'mission'],
      created: '1969-07-16',
    });
    expect(apollo.createdAt).toBe(Date.UTC(1969, 6, 16));
    expect(vault.page('Daily/2026-09-23').createdAt).toBe(Date.UTC(2026, 8, 23));
  });

  it('converts callouts, foldable callouts, toggles, tasks, tables, highlights and block IDs', async () => {
    const { ctx } = vault.test;
    const welcome = await docOf(ctx, vault.page('Welcome').id);
    const types = welcome.content.map((block) => block.type);
    expect(types).toEqual([
      'heading',
      'paragraph',
      'callout',
      'taskList',
      'table',
      'image',
      'paragraph',
      'paragraph',
      'paragraph',
      'embed',
      'paragraph',
    ]);
    expect(welcome.content[2]).toMatchObject({
      type: 'callout',
      attrs: { tone: 'success', emoji: '🔥' },
    });
    expect(
      nodesOf(welcome).some((node) => node.marks?.some((mark) => mark.type === 'highlight')),
    ).toBe(true);
    expect(
      nodesOf(welcome)
        .filter((node) => node.type === 'tag')
        .map((node) => node.attrs?.name),
    ).toEqual(['productivity', 'todo']);
    const plan = await docOf(ctx, vault.page('Projects/Launch plan').id);
    expect(plan.content[1]).toMatchObject({
      type: 'orderedList',
      content: [
        { attrs: { blockId: 'step-1' } },
        { attrs: { blockId: 'step-2' } },
        { attrs: { blockId: null } },
      ],
    });
    expect(plan.content[2]).toMatchObject({
      type: 'callout',
      attrs: { tone: 'warning' },
      content: [
        {
          type: 'toggle',
          attrs: { open: false },
          content: [
            { type: 'toggleSummary', content: [{ text: 'Abort criteria' }] },
            { type: 'paragraph' },
          ],
        },
      ],
    });
    const apollo = await docOf(ctx, vault.page('Projects/Apollo 11 🚀').id);
    expect(apollo.content[1]).toMatchObject({
      type: 'toggle',
      content: [
        { type: 'toggleSummary', content: [{ text: 'Transcript' }] },
        { type: 'paragraph' },
      ],
    });
  });

  it('imports attachments: images and files where linked, the rest on their folder page', async () => {
    const { ctx } = vault.test;
    const welcome = await docOf(ctx, vault.page('Welcome').id);
    const image = welcome.content.find((block) => block.type === 'image');
    const assetId = String(image?.attrs.assetId);
    expect(await ctx.services.assetStore.getInfo?.(assetId)).toMatchObject({
      name: 'diagram.png',
      mimeType: 'image/png',
    });
    const plan = await docOf(ctx, vault.page('Projects/Launch plan').id);
    expect(plan.content.slice(3)).toMatchObject([
      { type: 'image', attrs: { alt: 'Moon over the pad' } },
      {
        type: 'embed',
        attrs: {
          kind: 'file',
          data: { name: 'flight plan.pdf', mimeType: 'application/pdf', size: 142 },
        },
      },
    ]);
    const attachments = await docOf(ctx, vault.page('attachments').id);
    expect(attachments.content).toMatchObject([{ type: 'image', attrs: { alt: 'unused sketch' } }]);
    expect(welcome.content.find((block) => block.type === 'embed')).toMatchObject({
      attrs: { kind: 'database', ref: vault.page('Reading list').id, data: { viewId: null } },
    });
  });

  it('turns CSV files into databases with typed columns', async () => {
    const { ctx } = vault.test;
    const list = vault.page('Reading list');
    expect(list.kind).toBe('database');
    const { properties, rows } = await databaseOf(ctx, list.id);
    expect(properties.map((property) => `${property.name}:${property.type}`)).toEqual([
      'Title:title',
      'Author:text',
      'Status:select',
      'Tags:multiSelect',
      'Rating:number',
      'Finished:checkbox',
      'Published:date',
      'Website:url',
      'Contact:email',
    ]);
    const byName = Object.fromEntries(properties.map((property) => [property.name, property]));
    const option = (property: string, id: unknown) =>
      byName[property]?.options?.find((entry) => entry.id === id)?.name;
    const dune = rows[0]?.values ?? {};
    expect(option('Status', dune[byName.Status?.id ?? ''])).toBe('Done');
    expect((dune[byName.Tags?.id ?? ''] as string[]).map((id) => option('Tags', id))).toEqual([
      'sci-fi',
      'classic',
    ]);
    expect(dune[byName.Rating?.id ?? '']).toBe(5);
    expect(dune[byName.Finished?.id ?? '']).toBe(true);
    expect(dune[byName.Published?.id ?? '']).toEqual({ start: '1965-08-01' });
    expect(dune[byName.Website?.id ?? '']).toBe('https://example.com/dune');
    expect(rows.map((row) => ctx.workspace.getPage(row.id)?.title)).toEqual([
      'Dune',
      'Kindred',
      'The Left Hand of Darkness',
      'Project Hail Mary',
    ]);
  });

  it('reports what it did', () => {
    expect(vault.report.cancelled).toBe(false);
    expect(vault.report.counts).toEqual({
      pages: 25,
      databases: 1,
      rows: 4,
      assets: 4,
      links: 23,
      skippedFiles: 3,
    });
    expect(vault.report.issues.map((issue) => issue.code).sort()).toEqual([
      'skipped-file',
      'unresolved-link',
      'unresolved-link',
      'unsupported-syntax',
    ]);
    expect(vault.report.durationMs).toBeGreaterThan(0);
  });

  it('imports the same vault from a zip', async () => {
    const zip = importFileFromBytes(
      'Apollo vault.zip',
      zipEntries(
        fixtureEntries('obsidian-vault').map(([path, bytes]) => [`Apollo vault/${path}`, bytes]),
      ),
    );
    const zipped = await importWith(createObsidianImporter(), [zip], 'Obsidian import');
    try {
      expect(outline(zipped.test.ctx, zipped.root)).toEqual(outline(vault.test.ctx, vault.root));
      expect(zipped.report.counts).toEqual(vault.report.counts);
    } finally {
      await zipped.test.dispose();
    }
  });
});

describe('Notion importer', () => {
  let notion: Imported;
  beforeAll(async () => {
    // A multi-part export: the parts are zips inside the export zip. Deep pages are added here:
    // their paths are too long for a Windows checkout, as in real Notion exports.
    const countdown =
      'Workspace Home 0e1d2c3b4a5968778695a4b3c2d1e0f1/Launch plan 1a2b3c4d5e6f708192a3b4c5d6e7f801/Countdown 2b3c4d5e6f708192a3b4c5d6e7f80112';
    const deep: Array<[string, Uint8Array]> = [];
    let folder = countdown;
    ['Stage one', 'Stage two', 'Stage three', 'Stage four'].forEach((title, level) => {
      const id = `${level + 1}`.repeat(32);
      const back = `${'../'.repeat(level + 1)}Countdown%202b3c4d5e6f708192a3b4c5d6e7f80112.md`;
      deep.push([
        `${folder}/${title} ${id}.md`,
        strToU8(`# ${title}\n\nBack to the [Countdown](${back}).\n`),
      ]);
      folder = `${folder}/${title} ${id}`;
    });
    const entries = [...fixtureEntries('notion-export'), ...deep];
    const half = Math.ceil(entries.length / 2);
    const outer = zipEntries([
      [
        'Export-4f1c2d3e-8a9b-4c5d-9e0f-1a2b3c4d5e6f-Part-1.zip',
        zipEntries(entries.slice(0, half)),
      ],
      ['Export-4f1c2d3e-8a9b-4c5d-9e0f-1a2b3c4d5e6f-Part-2.zip', zipEntries(entries.slice(half))],
    ]);
    notion = await importWith(
      createNotionImporter(),
      [importFileFromBytes('Export-4f1c2d3e.zip', outer)],
      'Notion import',
    );
  }, 60_000);
  afterAll(() => notion.test.dispose());

  it('rebuilds the tree from nested multi-part zips, without Notion IDs, with icons', () => {
    expect(outline(notion.test.ctx, notion.root)).toEqual([
      '🏠 Workspace Home',
      '  (untitled)',
      '  Café ☕',
      '  Crew [database]',
      '    · Neil Armstrong',
      '    · Buzz Aldrin',
      '  Launch plan',
      '    Countdown',
      '      Stage one',
      '        Stage two',
      '          Stage three',
      '            Stage four',
      '    Meeting notes',
      '  Meeting notes',
      '  Tasks [database]',
      '    · Book the pad',
      '    · Fuel the rocket',
      '    · Write the press kit',
    ]);
  });

  it('rewrites links (paths with %20, databases, notion.so URLs) into page links', async () => {
    const { ctx } = notion.test;
    const home = await docOf(ctx, notion.page('Workspace Home').id);
    expect(linksOf(ctx, home).map((link) => link.title)).toEqual([
      'Launch plan',
      'Tasks',
      'Café ☕',
      'Meeting notes',
    ]);
    const meeting = nodesOf(home)
      .filter((node) => node.type === 'pageLink')
      .at(-1);
    expect(meeting?.attrs?.pageId).toBe(notion.page('Workspace Home/Meeting notes').id);
    const countdown = await docOf(ctx, notion.page('Workspace Home/Launch plan/Countdown').id);
    expect(linksOf(ctx, countdown).map((link) => link.title)).toEqual(['Workspace Home']);
    const deepest = await docOf(
      ctx,
      notion.page('Workspace Home/Launch plan/Countdown/Stage one/Stage two/Stage three/Stage four')
        .id,
    );
    expect(linksOf(ctx, deepest).map((link) => link.title)).toEqual(['Countdown']);
    expect(notion.report.issues).toEqual([
      expect.objectContaining({
        code: 'unresolved-link',
        pageId: notion.page('Workspace Home').id,
        file: 'Workspace Home 0e1d2c3b4a5968778695a4b3c2d1e0f1.md',
      }),
    ]);
  });

  it('keeps content: title headings removed, images stored, asides as callouts', async () => {
    const { ctx } = notion.test;
    const home = await docOf(ctx, notion.page('Workspace Home').id);
    expect(home.content.map((block) => block.type)).toEqual([
      'paragraph',
      'image',
      'paragraph',
      'paragraph',
      'callout',
      'taskList',
    ]);
    expect(home.content[4]).toMatchObject({
      attrs: { emoji: '💡' },
      content: [
        {
          content: [
            { text: 'Launch day is ' },
            { text: 'September 30', marks: [{ type: 'bold' }] },
            { text: '.' },
          ],
        },
      ],
    });
    const image = nodesOf(home).find((node) => node.type === 'image');
    expect(await ctx.services.assetStore.getInfo?.(String(image?.attrs?.assetId))).toMatchObject({
      name: 'image.png',
    });
    // Notion's "Untitled" is an empty title, so the app shows its own (translated) placeholder.
    const blank = ctx.workspace.pages
      .getSnapshot()
      .children(notion.page('Workspace Home').id)
      .find((page) => page.title === '');
    expect((await docOf(ctx, blank?.id ?? '')).content).toMatchObject([
      { type: 'paragraph', content: [{ text: 'A page nobody named.' }] },
    ]);
  });

  it('creates databases with every property type from the full CSV', async () => {
    const { ctx } = notion.test;
    const tasks = notion.page('Workspace Home/Tasks');
    const { properties, rows } = await databaseOf(ctx, tasks.id);
    expect(properties.map((property) => `${property.name}:${property.type}`)).toEqual([
      'Name:title',
      'Status:select',
      'Tags:multiSelect',
      'Due:date',
      'Done:checkbox',
      'Estimate:number',
      'Budget:number',
      'Progress:number',
      'Link:url',
      'Owner email:email',
      'Crew:relation',
      'Created time:createdTime',
      'Notes:text',
      'Assignee:select',
    ]);
    const byName = Object.fromEntries(properties.map((property) => [property.name, property]));
    expect(byName.Budget?.number).toMatchObject({
      format: 'currency',
      currency: 'USD',
      precision: 2,
    });
    expect(byName.Progress?.number).toMatchObject({ format: 'percent' });
    expect(byName.Crew?.relation?.targetDatabaseId).toBe(notion.page('Workspace Home/Crew').id);
    const fuel = rows[1]?.values ?? {};
    expect(fuel[byName.Due?.id ?? '']).toEqual({ start: '2026-09-25', end: '2026-09-26' });
    expect(fuel[byName.Budget?.id ?? '']).toBe(40000);
    expect(fuel[byName.Progress?.id ?? '']).toBe(1);
    expect(fuel[byName.Crew?.id ?? '']).toEqual([
      notion.page('Workspace Home/Crew/Neil Armstrong').id,
      notion.page('Workspace Home/Crew/Buzz Aldrin').id,
    ]);
    expect(rows[0]?.values[byName.Progress?.id ?? '']).toBe(0.45);
    expect(rows[2]?.values[byName.Notes?.id ?? '']).toBe('Draft, review, ship');
    expect(notion.page('Workspace Home/Tasks/Book the pad').createdAt).toBe(
      Date.UTC(2026, 8, 20, 15, 30),
    );
  });

  it('keeps row pages without the property lines Notion repeats in them', async () => {
    const { ctx } = notion.test;
    const row = await docOf(ctx, notion.page('Workspace Home/Tasks/Book the pad').id);
    expect(row.content).toHaveLength(1);
    expect(
      nodesOf(row)
        .map((node) => node.text ?? '')
        .join(''),
    ).toBe('Call the Cape. The crew list is in .');
    expect(linksOf(ctx, row).map((link) => link.title)).toEqual(['Crew']);
  });

  it('counts what it imported', () => {
    expect(notion.report.counts).toEqual({
      pages: 19,
      databases: 2,
      rows: 5,
      assets: 2,
      links: 13,
      skippedFiles: 0,
    });
  });
});

describe('Markdown importer', () => {
  let folder: Imported;
  beforeAll(async () => {
    folder = await importWith(
      createMarkdownImporter(),
      fixtureFiles('markdown-folder'),
      'Field notes',
    );
  }, 60_000);
  afterAll(() => folder.test.dispose());

  it('imports folders, relative links, images and CSV databases with row pages', async () => {
    const { ctx } = folder.test;
    expect(outline(ctx, folder.root)).toEqual([
      'Books [database]',
      '  · Dune',
      '  · Circe',
      '  · The Martian',
      'Guides',
      '  Getting started',
      'README',
      'Reference',
      '  Glossary',
    ]);
    const guide = await docOf(ctx, folder.page('Guides/Getting started').id);
    expect(guide.content.map((block) => block.type)).toEqual(['paragraph', 'image']);
    expect(linksOf(ctx, guide)).toEqual([
      { title: 'Glossary', label: 'glossary', heading: 'Terms', blockRef: null },
      { title: 'Glossary', label: null, heading: null, blockRef: null },
    ]);
    const readme = await docOf(ctx, folder.page('README').id);
    expect(readme.content[0]).toMatchObject({
      type: 'heading',
      content: [{ text: 'Field notes' }],
    });
    expect(linksOf(ctx, readme).map((link) => link.title)).toEqual(['Getting started', 'Books']);
    const { properties } = await databaseOf(ctx, folder.page('Books').id);
    expect(properties.map((property) => `${property.name}:${property.type}`)).toEqual([
      'Title:title',
      'Author:text',
      'Genre:select',
      'Pages:number',
      'Read:checkbox',
      'Started:date',
    ]);
    expect((await docOf(ctx, folder.page('Books/Dune').id)).content).toMatchObject([
      { content: [{ text: 'Notes on Dune: spice, sand, and politics.' }] },
    ]);
    expect(folder.report.issues).toEqual([]);
  });
});

describe('archives', () => {
  it('rejects zip-slip paths and reports them', async () => {
    const zip = zipEntries([
      ['notes/ok.md', strToU8('Safe')],
      ['../escape.md', strToU8('Nope')],
      ['notes/../../up.md', strToU8('Nope')],
      ['/absolute.md', strToU8('Nope')],
      ['C:/drive.md', strToU8('Nope')],
    ]);
    const test = await importWorkspace();
    try {
      const report = await runImporter(test.ctx, createMarkdownImporter(), [
        importFileFromBytes('evil.zip', zip),
      ]);
      // Only `notes/ok.md` is left, and a folder shared by every file is the import itself.
      expect(outline(test.ctx, report.rootPageId ?? '')).toEqual(['ok']);
      expect(report.issues.filter((issue) => issue.code === 'unsafe-path')).toHaveLength(4);
      expect(report.counts.skippedFiles).toBe(4);
    } finally {
      await test.dispose();
    }
  });

  it('reports a broken archive instead of failing', async () => {
    const test = await importWorkspace();
    try {
      const report = await runImporter(test.ctx, createMarkdownImporter(), [
        importFileFromBytes('broken.zip', strToU8('not a zip')),
        importFileFromText('note.md', 'Still imported'),
      ]);
      expect(report.issues.map((issue) => issue.code)).toContain('read-failed');
      expect(outline(test.ctx, report.rootPageId ?? '')).toEqual(['note']);
    } finally {
      await test.dispose();
    }
  });
});

describe('detection', () => {
  it('recognizes Notion exports, Obsidian vaults and markdown folders', async () => {
    const notionZip = importFileFromBytes(
      'Export.zip',
      zipEntries(fixtureEntries('notion-export')),
    );
    const vault = fixtureFiles('obsidian-vault', 'Vault');
    const plain = [
      importFileFromText('Notes/One.md', '# One\n\nPlain [link](Two.md)'),
      importFileFromText('Notes/Two.md', 'Two'),
    ];
    const importers = [createNotionImporter(), createObsidianImporter(), createMarkdownImporter()];
    const best = async (files: ImportFile[]) => {
      const scores = await Promise.all(
        importers.map(async (importer) => [importer.id, await importer.detect(files)] as const),
      );
      return scores.sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    expect(await best([notionZip])).toBe('notion');
    expect(await best(vault)).toBe('obsidian');
    expect(await best(plain)).toBe('markdown');
    expect(await createMarkdownImporter('markdown-basic').detect(plain)).toBe(0);
  });
});

describe('cancellation', () => {
  it('stops between steps and keeps what was created under the root page', async () => {
    const test = await importWorkspace();
    try {
      const controller = new AbortController();
      const files = Array.from({ length: 120 }, (_, index) =>
        importFileFromText(
          `Notes/Note ${index}.md`,
          `Note ${index} links to [[Note ${index + 1}]]`,
        ),
      );
      const importer = createMarkdownImporter();
      const report = await importer.run(
        files,
        {
          workspace: test.ctx.workspace,
          loadPageDoc: (id) => test.ctx.loadPageDoc(id),
          loadDatabaseDoc: (id) => test.ctx.loadDatabaseDoc(id),
          assets: test.ctx.services.assetStore,
          codec: test.ctx.services.markdownCodec,
          parentId: null,
          rootTitle: 'Cancelled import',
          currentUser: test.ctx.currentUser,
        },
        (progress) => {
          if (progress.phase === 'pages' && progress.done > 0) controller.abort();
        },
        controller.signal,
      );
      expect(report.cancelled).toBe(true);
      expect(report.rootPageId).not.toBeNull();
      const created = test.ctx.workspace.pages.getSnapshot().descendants(report.rootPageId ?? '');
      expect(created.length).toBeGreaterThan(0);
      expect(created.length).toBeLessThan(121);
    } finally {
      await test.dispose();
    }
  });
});
