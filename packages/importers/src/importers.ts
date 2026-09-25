import type {
  ImportContext,
  ImportFile,
  ImportProgress,
  Importer,
  ImportReport,
} from '@tessera/core';
import { t } from './i18n/registration';
import type { SourceFormat } from './plan/types';

/** IDs of the importers this package registers. */
export const IMPORTER_IDS = {
  notion: 'notion',
  obsidian: 'obsidian',
  markdown: 'markdown',
  backup: 'tessera-backup',
} as const;

/** The core stub's ID: registering the markdown importer under it too replaces the stub. */
export const CORE_MARKDOWN_ID = 'markdown-basic';

const TEXT = /\.(md|markdown|mdown|mkd|txt|csv)$/i;
const NOTION_NAME = /[ _-]?[0-9a-f]{32}(\.(md|csv)|_all\.csv)?$/i;

/**
 * Loads the import's code (reading, planning, writing) while the dialog shows what it detected.
 * Loaded when the import starts, compiling it blocked the page for 200 to 400 ms.
 */
function preloadImport(): void {
  import('./run').catch(() => undefined);
}

async function paths(files: readonly ImportFile[]): Promise<string[]> {
  preloadImport();
  const { peekPaths } = await import('./files');
  return peekPaths(files);
}

function run(format: SourceFormat) {
  return async (
    files: readonly ImportFile[],
    context: ImportContext,
    onProgress: (progress: ImportProgress) => void,
    signal: AbortSignal,
    importerId: string,
  ): Promise<ImportReport> =>
    (await import('./run')).runImport(format, importerId, files, context, onProgress, signal);
}

/** Share of note and CSV files whose names carry Notion's 32-digit IDs. */
function notionShare(list: readonly string[]): number {
  const names = list.filter((path) => TEXT.test(path) || path.endsWith('/'));
  if (!names.length) return 0;
  const tagged = names.filter(
    (path) =>
      NOTION_NAME.test(path.replace(/\/$/, '').replace(/\.(md|csv)$/i, '')) ||
      NOTION_NAME.test(path),
  );
  return tagged.length / names.length;
}

/** Notion's "Markdown & CSV" export (a zip, zips of zips, or the unpacked folder). */
export function createNotionImporter(): Importer {
  const format: SourceFormat = 'notion';
  const runFormat = run(format);
  return {
    id: IMPORTER_IDS.notion,
    label: t('notionLabel'),
    description: t('notionDescription'),
    accept: ['.zip', '.md', '.csv'],
    acceptsDirectories: true,
    async detect(files) {
      const list = await paths(files);
      const share = notionShare(list);
      if (share >= 0.5) return 0.95;
      if (share > 0) return 0.5;
      if (list.some((path) => /(^|\/)Export-[0-9a-f-]{36}/i.test(path))) return 0.6;
      return 0;
    },
    run: (files, context, onProgress, signal) =>
      runFormat(files, context, onProgress, signal, IMPORTER_IDS.notion),
  };
}

/** An Obsidian vault: a folder or a zip. */
export function createObsidianImporter(): Importer {
  const runFormat = run('obsidian');
  return {
    id: IMPORTER_IDS.obsidian,
    label: t('obsidianLabel'),
    description: t('obsidianDescription'),
    accept: ['.zip', '.md'],
    acceptsDirectories: true,
    async detect(files) {
      const list = await paths(files);
      if (list.some((path) => path.split('/').includes('.obsidian'))) return 1;
      const notes = files.filter((file) => /\.md$/i.test(file.path));
      if (!notes.length) return list.some((path) => /\.md$/i.test(path)) ? 0.3 : 0;
      for (const note of notes.slice(0, 25)) {
        if (note.size > 2_000_000) continue;
        const text = await note.text();
        if (/!?\[\[[^\]\n]+\]\]|^> \[!\w+\]/m.test(text)) return 0.7;
      }
      return 0.3;
    },
    run: (files, context, onProgress, signal) =>
      runFormat(files, context, onProgress, signal, IMPORTER_IDS.obsidian),
  };
}

/** A JSON backup made by Tessera, restored into a new workspace. */
export function createBackupImporter(): Importer {
  return {
    id: IMPORTER_IDS.backup,
    label: t('backupLabel'),
    description: t('backupDescription'),
    accept: ['.json'],
    async detect(files) {
      const [file] = files;
      if (files.length !== 1 || !file || !/\.json$/i.test(file.path)) return 0;
      const head = new TextDecoder().decode((await file.bytes()).subarray(0, 512));
      return /"format"\s*:\s*"tessera-backup"/.test(head) ? 1 : 0;
    },
    async run(files, context, onProgress) {
      const { runRestoreImport } = await import('./export/backup');
      return runRestoreImport(files, context, onProgress, IMPORTER_IDS.backup);
    },
  };
}

/** Markdown files and folders (relative links and wikilinks); CSV files become databases. */
export function createMarkdownImporter(id: string = IMPORTER_IDS.markdown): Importer {
  const runFormat = run('markdown');
  return {
    id,
    label: t('markdownLabel'),
    description: t('markdownDescription'),
    accept: ['.md', '.markdown', '.txt', '.csv', '.zip'],
    acceptsDirectories: true,
    async detect(files) {
      // The copy registered under the core stub's ID never competes with the real one.
      if (id !== IMPORTER_IDS.markdown) return 0;
      const list = (await paths(files)).filter(
        (path) => !path.split('/').some((segment) => segment.startsWith('.')),
      );
      if (!list.length) return 0;
      const text = list.filter((path) => TEXT.test(path)).length;
      return text ? Math.max(0.2, (text / list.length) * 0.6) : 0;
    },
    run: (files, context, onProgress, signal) => runFormat(files, context, onProgress, signal, id),
  };
}
