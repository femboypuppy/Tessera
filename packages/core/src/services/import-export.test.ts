import { describe, expect, it, vi } from 'vitest';
import { build as b } from '../schema/builders';
import { extractPlainText } from '../schema/extract';
import { readDocJSON, writeDocJSON } from '../schema/ydoc';
import { createTestAppContext } from '../testing/index';
import {
  createBasicMarkdownExporter,
  createBasicMarkdownImporter,
  createExporterRegistry,
  createImporterRegistry,
  importFileFromBlob,
  importFileFromText,
  MemoryExportSink,
  normalizeImportPath,
  sanitizeFileName,
  uniqueName,
  type Importer,
} from './import-export';
import { BasicMarkdownCodec } from './markdown-codec';

describe('BasicMarkdownCodec (no DOM)', () => {
  const codec = new BasicMarkdownCodec();

  it('parses frontmatter, headings and paragraphs', () => {
    const { doc, frontmatter, warnings } = codec.parse(
      '---\ntitle: Launch\ntags: [space, history]\ndraft: true\ncount: 3\n  - weird\n---\n# Launch plan\n\nFirst line\ncontinues here.\n\n#### Deep heading\n\n- a list stays text',
    );
    expect(frontmatter).toEqual({
      title: 'Launch',
      tags: ['space', 'history'],
      draft: true,
      count: 3,
    });
    expect(warnings).toEqual(['Unsupported frontmatter line: - weird']);
    expect(doc.content.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ]);
    expect(extractPlainText(doc)).toBe(
      'Launch plan\nFirst line continues here.\nDeep heading\n- a list stays text',
    );
    expect(codec.parse('').doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { blockId: null, color: null } }],
    });
  });

  it('serializes headings, paragraphs and frontmatter without losing text', () => {
    const doc = b.doc(
      b.heading(2, 'Plan'),
      b.paragraph('See ', b.pageLink('page-1'), b.hardBreak(), 'next line'),
      b.bulletList('kept as text'),
    );
    const markdown = codec.serialize(doc, {
      resolvePage: () => ({ title: 'Spec' }),
      frontmatter: { tags: ['a'] },
    });
    expect(markdown).toBe(
      '---\ntags: ["a"]\n---\n\n## Plan\n\nSee Spec  \nnext line\n\nkept as text\n',
    );
    expect(codec.serialize(b.doc())).toBe('');
  });

  it('extracts text from HTML without a DOM, dropping scripts', () => {
    const doc = codec.parseHTML(
      '<h1>Title</h1><p>Hello <b>world</b></p><script>alert(1)</script><div>Last</div>',
    );
    expect(extractPlainText(doc)).toBe('Title\nHello world\nLast');
  });
});

describe('import paths and file names', () => {
  it.each([
    ['Vault/Notes/a.md', 'Vault/Notes/a.md'],
    ['Vault\\Notes\\a.md', 'Vault/Notes/a.md'],
    ['./Vault//a.md', 'Vault/a.md'],
    ['../evil.md', null],
    ['Vault/../../evil.md', null],
    ['/etc/passwd', null],
    ['C:/Windows/win.ini', null],
    ['c:\\boot.ini', null],
    ['nul\0byte', null],
    ['', null],
  ])('normalizeImportPath(%j) is %j', (input, expected) => {
    expect(normalizeImportPath(input)).toBe(expected);
  });

  it('sanitizes file names for every OS and makes them unique', () => {
    expect(sanitizeFileName('Q3: plan / notes?')).toBe('Q3- plan - notes-');
    expect(sanitizeFileName('  trailing dots... ')).toBe('trailing dots');
    expect(sanitizeFileName('CON')).toBe('CON_');
    expect(sanitizeFileName('')).toBe('Untitled');
    expect(sanitizeFileName('日本語 🚀')).toBe('日本語 🚀');
    expect(sanitizeFileName('x'.repeat(300))).toHaveLength(120);
    const taken = new Set<string>();
    expect([
      uniqueName('Notes', taken, '.md'),
      uniqueName('notes', taken, '.md'),
      uniqueName('Notes', taken, '.md'),
    ]).toEqual(['Notes.md', 'notes (2).md', 'Notes (3).md']);
  });

  it('wraps blobs and text as import files, refusing unsafe paths', async () => {
    const file = importFileFromBlob('a\\b.md', new Blob(['# Hi'], { type: 'text/markdown' }), 5);
    expect(file).toMatchObject({
      path: 'a/b.md',
      size: 4,
      mimeType: 'text/markdown',
      lastModified: 5,
    });
    expect(await file.text()).toBe('# Hi');
    expect(await file.bytes()).toEqual(new TextEncoder().encode('# Hi'));
    expect(() => importFileFromText('../x.md', 'x')).toThrow(TypeError);
  });
});

describe('importer registry', () => {
  it('detects importers by confidence and ignores failing detectors', async () => {
    const registry = createImporterRegistry();
    const make = (id: string, confidence: number | (() => number)): Importer => ({
      id,
      label: id,
      detect: typeof confidence === 'function' ? confidence : () => confidence,
      run: vi.fn(),
    });
    registry.register(make('low', 0.2));
    registry.register(make('high', 0.9));
    registry.register(make('never', 0));
    registry.register(
      make('broken', () => {
        throw new Error('bad zip');
      }),
    );
    expect(
      (await registry.detect([])).map((entry) => [entry.importer.id, entry.confidence]),
    ).toEqual([
      ['high', 0.9],
      ['low', 0.2],
    ]);
  });
});

describe('list registries', () => {
  it('replaces replaceable items quietly and brings them back when the replacement goes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = createExporterRegistry();
    const stub = { id: 'markdown-basic', label: 'Stub', scopes: ['page' as const], run: vi.fn() };
    const real = { id: 'markdown-basic', label: 'Real', scopes: ['page' as const], run: vi.fn() };
    registry.register(stub, { replaceable: true });
    const off = registry.register(real);
    expect(warn).not.toHaveBeenCalled();
    expect(registry.get('markdown-basic')?.label).toBe('Real');
    off();
    expect(registry.get('markdown-basic')?.label).toBe('Stub');
    const again = registry.register({ ...real, label: 'Again' });
    registry.register({ ...real, label: 'Twice' });
    expect(warn).toHaveBeenCalledTimes(1);
    again();
    expect(registry.get('markdown-basic')?.label).toBe('Twice');
    warn.mockRestore();
  });
});

describe('basic markdown importer and exporter', () => {
  it('imports folders of markdown under a new root page and reports skipped files', async () => {
    const { ctx, dispose } = await createTestAppContext();
    const files = [
      importFileFromText('Vault/Projects.md', '# Projects\n\nAll projects.'),
      importFileFromText('Vault/Projects/Apollo.md', 'Moon missions'),
      importFileFromText('Vault/Daily/2026-09-23.md', 'Today'),
      importFileFromText('Vault/image.png', 'not text'),
    ];
    const importer = createBasicMarkdownImporter();
    expect(await importer.detect(files)).toBeCloseTo(0.375);
    const progress: number[] = [];
    const report = await importer.run(
      files,
      {
        workspace: ctx.workspace,
        loadPageDoc: ctx.loadPageDoc,
        loadDatabaseDoc: ctx.loadDatabaseDoc,
        assets: ctx.services.assetStore,
        codec: ctx.services.markdownCodec,
        parentId: null,
        rootTitle: 'Markdown import',
        currentUser: ctx.currentUser,
      },
      (p) => progress.push(p.done),
      new AbortController().signal,
    );
    expect(report).toMatchObject({
      importerId: 'markdown-basic',
      cancelled: false,
      counts: { pages: 6, skippedFiles: 1 },
    });
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'skipped-file', file: 'Vault/image.png' }),
    ]);
    const snapshot = ctx.workspace.pages.getSnapshot();
    const root = snapshot.get(report.rootPageId ?? '');
    expect(root?.title).toBe('Markdown import');
    const titles = (id: string) => snapshot.children(id).map((page) => page.title);
    const vault = snapshot.children(root?.id ?? '')[0];
    expect(vault?.title).toBe('Vault');
    expect(titles(vault?.id ?? '')).toEqual(['Daily', 'Projects']);
    const projects = snapshot.children(vault?.id ?? '').find((page) => page.title === 'Projects');
    expect(titles(projects?.id ?? '')).toEqual(['Apollo']);
    const handle = await ctx.loadPageDoc(projects?.id ?? '');
    expect(extractPlainText(readDocJSON(handle.doc))).toBe('Projects\nAll projects.');
    handle.release();
    expect(progress.length).toBeGreaterThan(0);
    await dispose();
  });

  it('stops when cancelled', async () => {
    const { ctx, dispose } = await createTestAppContext();
    const controller = new AbortController();
    controller.abort();
    const report = await createBasicMarkdownImporter().run(
      [importFileFromText('a.md', 'x')],
      {
        workspace: ctx.workspace,
        loadPageDoc: ctx.loadPageDoc,
        loadDatabaseDoc: ctx.loadDatabaseDoc,
        assets: ctx.services.assetStore,
        codec: ctx.services.markdownCodec,
        parentId: null,
        rootTitle: 'Import',
        currentUser: ctx.currentUser,
      },
      () => undefined,
      controller.signal,
    );
    expect(report.cancelled).toBe(true);
    expect(report.counts.pages).toBe(1);
    await dispose();
  });

  it('exports pages as nested markdown files', async () => {
    const { ctx, dispose } = await createTestAppContext();
    const { workspace } = ctx;
    const parent = workspace.createPage({ title: 'Launch: plan' });
    const child = workspace.createPage({ title: 'Checklist', parentId: parent.id });
    workspace.createPage({ title: 'Launch: plan' });
    await workspace.createDatabase({
      title: 'Tasks',
      titlePropertyName: 'Name',
      viewName: 'Table',
    });
    for (const [id, doc] of [
      [parent.id, b.doc(b.heading(1, 'Plan'), b.paragraph('See ', b.pageLink(child.id)))],
      [child.id, b.doc('Pack the suits')],
    ] as const) {
      const handle = await ctx.loadPageDoc(id);
      writeDocJSON(handle.doc, doc);
      handle.release();
    }
    const context = {
      workspace,
      loadPageDoc: ctx.loadPageDoc,
      loadDatabaseDoc: ctx.loadDatabaseDoc,
      assets: ctx.services.assetStore,
      codec: ctx.services.markdownCodec,
    };
    const sink = new MemoryExportSink();
    const result = await createBasicMarkdownExporter().run(
      { kind: 'workspace' },
      context,
      sink,
      () => undefined,
      new AbortController().signal,
    );
    expect(result.files).toBe(4);
    expect([...sink.files.keys()].sort()).toEqual([
      'Launch- plan (2).md',
      'Launch- plan.md',
      'Launch- plan/Checklist.md',
      'Tasks.md',
    ]);
    expect(sink.files.get('Launch- plan.md')).toBe('# Plan\n\nSee Checklist\n');
    expect(result.issues.map((issue) => issue.code)).toEqual(['database-as-title']);
    const single = new MemoryExportSink();
    await createBasicMarkdownExporter().run(
      { kind: 'page', pageId: child.id },
      context,
      single,
      () => undefined,
      new AbortController().signal,
    );
    expect([...single.files.keys()]).toEqual(['Checklist.md']);
    await expect(sink.writeFile('../escape.md', 'x')).rejects.toThrow(TypeError);
    await dispose();
  });
});
