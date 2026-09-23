import {
  importFileFromBytes,
  MemoryExportSink,
  type ExportContext,
  type ImportFile,
} from '@tessera/core';
import type { TestAppContext } from '@tessera/core/testing';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackupExporter, createHtmlExporter, createMarkdownExporter } from './exporters';
import { exportMarkdown } from './export/markdown';
import { SingleFileSink, ZipExportSink } from './export/zip-sink';
import { createBackupImporter, createNotionImporter, createObsidianImporter } from './importers';
import { describeTree } from './test/describe';
import {
  fixtureEntries,
  fixtureFiles,
  importWorkspace,
  linksOf,
  docOf,
  outline,
  pageAt,
  runImporter,
  zipEntries,
} from './test/helpers';

function exportContext(test: TestAppContext): ExportContext {
  const { ctx } = test;
  return {
    workspace: ctx.workspace,
    loadPageDoc: (id) => ctx.loadPageDoc(id),
    loadDatabaseDoc: (id) => ctx.loadDatabaseDoc(id),
    assets: ctx.services.assetStore,
    codec: ctx.services.markdownCodec,
  };
}

function text(sink: MemoryExportSink, path: string): string {
  const data = sink.files.get(path);
  if (data === undefined) throw new Error(`No ${path} in ${[...sink.files.keys()].join(', ')}`);
  return typeof data === 'string' ? data : strFromU8(data);
}

function sinkFiles(sink: MemoryExportSink): ImportFile[] {
  return [...sink.files].map(([path, data]) =>
    importFileFromBytes(path, typeof data === 'string' ? strToU8(data) : data),
  );
}

describe('markdown export', () => {
  let vault: TestAppContext;
  let root: string;
  let sink: MemoryExportSink;
  beforeAll(async () => {
    vault = await importWorkspace();
    const report = await runImporter(
      vault.ctx,
      createObsidianImporter(),
      fixtureFiles('obsidian-vault'),
      'Apollo vault',
    );
    root = report.rootPageId ?? '';
    sink = new MemoryExportSink();
    await createMarkdownExporter().run(
      { kind: 'subtree', pageId: root },
      exportContext(vault),
      sink,
      () => undefined,
      new AbortController().signal,
    );
  }, 60_000);
  afterAll(() => vault.dispose());

  it('writes one file per page, folders for children, CSV for databases, attachments alongside', () => {
    expect([...sink.files.keys()].sort()).toEqual([
      'Apollo vault.md',
      'Apollo vault/Archive.md',
      'Apollo vault/Archive/Ideas.md',
      'Apollo vault/Café crème ☕.md',
      'Apollo vault/Daily.md',
      'Apollo vault/Daily/2026-09-23.md',
      'Apollo vault/Daily/2026-09-24.md',
      'Apollo vault/Notes.md',
      'Apollo vault/Notes/Brainstorm.md',
      'Apollo vault/Notes/Ideas.md',
      'Apollo vault/Projects.md',
      'Apollo vault/Projects/Apollo 11 🚀.md',
      'Apollo vault/Projects/Archive.md',
      'Apollo vault/Projects/Archive/2019.md',
      'Apollo vault/Projects/Archive/2019/Mission logs.md',
      'Apollo vault/Projects/Archive/2019/Mission logs/Deep dive.md',
      'Apollo vault/Projects/Archive/2019/Mission logs/Deep dive/Deepest note.md',
      'Apollo vault/Projects/Launch plan.md',
      'Apollo vault/Reading list.csv',
      'Apollo vault/Reading list/Dune.md',
      'Apollo vault/Reading list/Kindred.md',
      'Apollo vault/Reading list/Project Hail Mary.md',
      'Apollo vault/Reading list/The Left Hand of Darkness.md',
      'Apollo vault/Welcome.md',
      'Apollo vault/attachments.md',
      'attachments/Moon photo.jpg',
      'attachments/diagram.png',
      'attachments/flight plan.pdf',
      'attachments/unused sketch.png',
    ]);
  });

  it('writes Obsidian markdown: frontmatter, shortest-path wikilinks, embeds, callouts', () => {
    const welcome = text(sink, 'Apollo vault/Welcome.md');
    expect(
      welcome.startsWith(
        '---\ntags:\n  - home\n  - space/history\naliases:\n  - Start here\n  - Home\ncssclasses: wide\n---\n\n# Welcome to the Apollo vault',
      ),
    ).toBe(true);
    expect(welcome).toContain('[[Apollo 11 🚀|Apollo 11]]');
    expect(welcome).toContain('[[Launch plan#Countdown|countdown]]');
    expect(welcome).toContain('[[Apollo vault/Notes/Ideas]] and [[Apollo vault/Archive/Ideas]]');
    expect(welcome).toContain('![](attachments/diagram.png)');
    expect(welcome).toContain('![[Reading list.csv]]');
    expect(welcome).toContain('[[Launch plan#^step-2]]');
    expect(welcome).toContain('> [!tip] Keyboard first');
    expect(welcome).toContain('\\[\\[Missing mission]]');
    const plan = text(sink, 'Apollo vault/Projects/Launch plan.md');
    expect(plan).toContain('1. Fuel the rocket ^step-1');
    expect(plan).toContain('> [!warning]- Abort criteria');
    expect(plan).toContain('![Moon over the pad](attachments/Moon%20photo.jpg)');
    expect(plan).toContain('![[attachments/flight plan.pdf]]');
  });

  it('writes databases as CSV that reads back to the same types', () => {
    const csv = text(sink, 'Apollo vault/Reading list.csv');
    expect(csv.split('\n').slice(0, 2)).toEqual([
      '﻿Title,Author,Status,Tags,Rating,Finished,Published,Website,Contact',
      'Dune,Frank Herbert,Done,"sci-fi, classic",5,Yes,1965-08-01,https://example.com/dune,frank@example.com',
    ]);
  });

  it('writes relative markdown links when asked', async () => {
    const linked = new MemoryExportSink();
    await exportMarkdown(
      { kind: 'subtree', pageId: root },
      exportContext(vault),
      linked,
      () => undefined,
      new AbortController().signal,
      'markdown',
      { linkStyle: 'markdown' },
    );
    const brainstorm = text(linked, 'Apollo vault/Notes/Brainstorm.md');
    expect(brainstorm).toBe('Brainstorm from the [Ideas](Ideas.md) next door.\n');
    const welcome = text(linked, 'Apollo vault/Welcome.md');
    expect(welcome).toContain('[countdown](Projects/Launch%20plan.md#Countdown)');
    expect(welcome).toContain('![](../attachments/diagram.png)');
  });

  it('round trips: vault → import → export → import gives the same workspace', async () => {
    const again = await importWorkspace();
    try {
      const report = await runImporter(
        again.ctx,
        createObsidianImporter(),
        sinkFiles(sink),
        'Apollo vault',
      );
      // The export's root folder is the import itself.
      const reimportedRoot = pageAt(again.ctx, report.rootPageId ?? '', 'Apollo vault').id;
      expect(outline(again.ctx, reimportedRoot)).toEqual(outline(vault.ctx, root));
      expect(await describeTree(again.ctx, reimportedRoot)).toEqual(
        await describeTree(vault.ctx, root),
      );
      expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    } finally {
      await again.dispose();
    }
  });

  it('streams into a zip', async () => {
    const zip = new ZipExportSink();
    await createMarkdownExporter().run(
      { kind: 'page', pageId: pageAt(vault.ctx, root, 'Projects/Launch plan').id },
      exportContext(vault),
      zip,
      () => undefined,
      new AbortController().signal,
    );
    const files = unzipSync(await zip.finish());
    expect(Object.keys(files).sort()).toEqual([
      'Launch plan.md',
      'attachments/Moon photo.jpg',
      'attachments/flight plan.pdf',
    ]);
    expect(strFromU8(files['Launch plan.md'] ?? new Uint8Array())).toContain('## Countdown');
  });
});

describe('Notion round trip', () => {
  it('exports databases with relations and imports them back', async () => {
    const first = await importWorkspace();
    const second = await importWorkspace();
    try {
      const zip = importFileFromBytes('Export.zip', zipEntries(fixtureEntries('notion-export')));
      const report = await runImporter(first.ctx, createNotionImporter(), [zip], 'Notion');
      const home = pageAt(first.ctx, report.rootPageId ?? '', 'Workspace Home').id;
      const sink = new MemoryExportSink();
      await createMarkdownExporter().run(
        { kind: 'subtree', pageId: home },
        exportContext(first),
        sink,
        () => undefined,
        new AbortController().signal,
      );
      const tasks = text(sink, 'Workspace Home/Tasks.csv');
      expect(tasks).toContain(
        '"Neil Armstrong (Crew/Neil%20Armstrong.md), Buzz Aldrin (Crew/Buzz%20Aldrin.md)"',
      );
      expect(tasks).toContain('"$1,200.00",45%');
      const again = await runImporter(
        second.ctx,
        createObsidianImporter(),
        sinkFiles(sink),
        'Notion',
      );
      const homeAgain = pageAt(second.ctx, again.rootPageId ?? '', 'Workspace Home').id;
      expect(await describeTree(second.ctx, homeAgain)).toEqual(
        await describeTree(first.ctx, home),
      );
    } finally {
      await first.dispose();
      await second.dispose();
    }
  }, 60_000);
});

describe('JSON backup', () => {
  it('backs up every document and attachment and restores them into a new workspace', async () => {
    const source = await importWorkspace();
    const target = await importWorkspace();
    try {
      const report = await runImporter(
        source.ctx,
        createObsidianImporter(),
        fixtureFiles('obsidian-vault'),
        'Apollo vault',
      );
      const root = report.rootPageId ?? '';
      source.ctx.workspace.setFavorite(pageAt(source.ctx, root, 'Welcome').id, true);
      source.ctx.workspace.trashPage(pageAt(source.ctx, root, 'Archive').id);
      const sink = new SingleFileSink();
      await createBackupExporter().run(
        { kind: 'workspace' },
        exportContext(source),
        sink,
        () => undefined,
        new AbortController().signal,
      );
      expect(sink.name).toMatch(/^Test workspace backup \d{4}-\d{2}-\d{2}\.json$/);
      const file = importFileFromBytes(sink.name ?? 'backup.json', strToU8(String(sink.data)));
      const importer = createBackupImporter();
      expect(await importer.detect([file])).toBe(1);
      const restored = await runImporter(target.ctx, importer, [file]);
      expect(restored.issues).toEqual([]);
      expect(restored.counts).toMatchObject({
        pages: source.ctx.workspace.pages.getSnapshot().size,
        databases: 1,
        rows: 4,
        assets: 4,
      });
      expect(await describeTree(target.ctx, root)).toEqual(await describeTree(source.ctx, root));
      const snapshot = target.ctx.workspace.pages.getSnapshot();
      expect(snapshot.favorites().map((page) => page.title)).toEqual(['Welcome']);
      expect(snapshot.trash().map((page) => page.title)).toEqual(['Archive']);
      const welcome = await docOf(target.ctx, pageAt(target.ctx, root, 'Welcome').id);
      expect(linksOf(target.ctx, welcome)[0]?.title).toBe('Apollo 11 🚀');
    } finally {
      await source.dispose();
      await target.dispose();
    }
  }, 60_000);

  it('refuses to restore into a workspace that has pages, and rejects invalid files', async () => {
    const test = await importWorkspace();
    try {
      test.ctx.workspace.createPage({ title: 'Existing' });
      const backup = importFileFromBytes(
        'b.json',
        strToU8(
          JSON.stringify({
            format: 'tessera-backup',
            version: 1,
            createdAt: '',
            workspace: { id: 'w', name: 'W' },
            docs: {},
            assets: [],
          }),
        ),
      );
      const refused = await runImporter(test.ctx, createBackupImporter(), [backup]);
      expect(refused.issues.map((issue) => issue.code)).toEqual(['restore-needs-new-workspace']);
      const empty = await importWorkspace();
      try {
        const newer = importFileFromBytes(
          'b.json',
          strToU8('{"format":"tessera-backup","version":99}'),
        );
        const report = await runImporter(empty.ctx, createBackupImporter(), [newer]);
        expect(report.issues[0]?.message).toBe(
          'This backup was made by a newer version of Tessera',
        );
        const evil = importFileFromBytes(
          'b.json',
          strToU8(
            JSON.stringify({
              format: 'tessera-backup',
              version: 1,
              createdAt: '',
              workspace: { id: '../x', name: 'W' },
              docs: {},
              assets: [],
            }),
          ),
        );
        expect(
          (await runImporter(empty.ctx, createBackupImporter(), [evil])).issues[0]?.message,
        ).toBe('This file is not a valid Tessera backup');
      } finally {
        await empty.dispose();
      }
    } finally {
      await test.dispose();
    }
  });
});

describe('HTML export', () => {
  it('writes a standalone, escaped page with images inline and databases as tables', async () => {
    const test = await importWorkspace();
    try {
      const report = await runImporter(
        test.ctx,
        createObsidianImporter(),
        fixtureFiles('obsidian-vault'),
        'Vault',
      );
      const welcome = pageAt(test.ctx, report.rootPageId ?? '', 'Welcome');
      test.ctx.workspace.renamePage(welcome.id, 'Welcome <script>alert(1)</script>');
      const sink = new SingleFileSink();
      await createHtmlExporter().run(
        { kind: 'page', pageId: welcome.id },
        exportContext(test),
        sink,
        () => undefined,
        new AbortController().signal,
      );
      const html = String(sink.data);
      expect(sink.name).toBe('Welcome -script-alert(1)--script-.html');
      expect(html).toMatch(/^<!doctype html>/);
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain(
        '<h1 class="page-title">Welcome &lt;script&gt;alert(1)&lt;/script&gt;</h1>',
      );
      expect(html).toContain('<img src="data:image/png;base64,');
      expect(html).toContain('<aside class="callout tone-success">');
      expect(html).toContain('<th>Status</th>');
      expect(html).toContain('<td>Frank Herbert</td>');
      expect(html).toContain('<span class="page-link">Apollo 11</span>');
      expect(html).toContain('<mark>Ctrl+O</mark>');
    } finally {
      await test.dispose();
    }
  }, 60_000);
});
