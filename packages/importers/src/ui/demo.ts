import {
  importFileFromBytes,
  importFileFromText,
  toError,
  type AppContext,
  type ImportFile,
} from '@tessera/core';
import { t } from '../i18n';
import { createMarkdownImporter, IMPORTER_IDS } from '../importers';
import { mimeTypeOf } from '../paths';
import { importContextFor } from './jobs';

/**
 * The demo workspace: `examples/demo-workspace` (the docs agent's) when it exists, otherwise the
 * small one bundled in `packages/importers/demo`. Both are plain markdown folders with CSV
 * databases, loaded on demand (the globs are lazy, so none of it is in the startup bundle).
 */
const EXAMPLE_ROOT = '../../../../examples/demo-workspace/';
const EXAMPLE_TEXT = import.meta.glob<string>('../../../../examples/demo-workspace/**/*.{md,csv}', {
  query: '?raw',
  import: 'default',
});
const EXAMPLE_BINARY = import.meta.glob<string>(
  '../../../../examples/demo-workspace/**/*.{png,jpg,jpeg,gif,webp,svg,pdf}',
  { query: '?url', import: 'default' },
);
const BUNDLED_ROOT = '../../demo/';
const BUNDLED_TEXT = import.meta.glob<string>('../../demo/**/*.{md,csv}', {
  query: '?raw',
  import: 'default',
});
const BUNDLED_BINARY = import.meta.glob<string>('../../demo/**/*.{png,jpg,jpeg,gif,webp,svg,pdf}', {
  query: '?url',
  import: 'default',
});

/** The demo workspace's files, relative to its folder. */
export async function loadDemoFiles(): Promise<ImportFile[]> {
  const useExample = Object.keys(EXAMPLE_TEXT).length > 0;
  const root = useExample ? EXAMPLE_ROOT : BUNDLED_ROOT;
  const text = useExample ? EXAMPLE_TEXT : BUNDLED_TEXT;
  const binary = useExample ? EXAMPLE_BINARY : BUNDLED_BINARY;
  const files: ImportFile[] = [];
  for (const [path, load] of Object.entries(text)) {
    files.push(importFileFromText(path.slice(root.length), await load()));
  }
  for (const [path, load] of Object.entries(binary)) {
    const response = await fetch(await load());
    if (!response.ok) continue;
    const relative = path.slice(root.length);
    files.push(
      importFileFromBytes(
        relative,
        new Uint8Array(await response.arrayBuffer()),
        mimeTypeOf(relative),
      ),
    );
  }
  return files;
}

/** Imports the demo workspace into the (new) workspace and opens its first page. */
export async function openDemo(ctx: AppContext): Promise<void> {
  try {
    const files = await loadDemoFiles();
    const importer = ctx.importers.get(IMPORTER_IDS.markdown) ?? createMarkdownImporter();
    const report = await importer.run(
      files,
      importContextFor(ctx, t('demoRootTitle')),
      () => undefined,
      new AbortController().signal,
    );
    const rootPageId = report.rootPageId;
    if (!rootPageId) throw new Error(t('demoFailed'));
    const snapshot = ctx.workspace.pages.getSnapshot();
    // Open the welcome page ("Start here" in the bundled demo), else the demo's root.
    const start =
      snapshot
        .children(rootPageId)
        .find((page) => /^(start here|welcome|readme)\b/i.test(page.title)) ?? null;
    ctx.navigate(start?.id ?? rootPageId);
  } catch (error) {
    ctx.toast({ title: t('demoFailed'), description: toError(error).message, variant: 'error' });
  }
}
