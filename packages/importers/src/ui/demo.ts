import {
  addView,
  importFileFromBytes,
  importFileFromText,
  isDocEmpty,
  listProperties,
  readDocJSON,
  toError,
  type AppContext,
  type ImportFile,
} from '@tessera/core';
import { IMPORT_ORIGIN } from '../apply';
import { t } from '../i18n';
import { createMarkdownImporter, IMPORTER_IDS } from '../importers';
import { mimeTypeOf } from '../paths';
import { importContextFor } from './jobs';

/**
 * The demo workspace: `examples/demo-workspace`, a plain markdown folder with CSV databases and
 * attachments, loaded on demand (the globs are lazy, so none of it is in the startup bundle).
 */
const ROOT = '../../../../examples/demo-workspace/';
const TEXT = import.meta.glob<string>('../../../../examples/demo-workspace/**/*.{md,csv}', {
  query: '?raw',
  import: 'default',
});
const BINARY = import.meta.glob<string>(
  '../../../../examples/demo-workspace/**/*.{png,jpg,jpeg,gif,webp,svg,pdf}',
  { query: '?url', import: 'default' },
);

/** The demo workspace's files, relative to its folder. */
export async function loadDemoFiles(): Promise<ImportFile[]> {
  const files: ImportFile[] = [];
  for (const [path, load] of Object.entries(TEXT)) {
    files.push(importFileFromText(path.slice(ROOT.length), await load()));
  }
  for (const [path, load] of Object.entries(BINARY)) {
    const response = await fetch(await load());
    if (!response.ok) continue;
    const relative = path.slice(ROOT.length);
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

const WELCOME = /^(start here|welcome|readme)\b/i;

/** Board columns of the demo's Projects database, in the order work moves through them. */
const STATUS_ORDER = ['Not started', 'In progress', 'In review', 'Blocked', 'Done'];

/**
 * CSV files hold rows, not views, so the demo's Projects database gets the views its content is
 * made for: a board by status first (cards show priority, owner and due date), then the imported
 * table, then a calendar by due date.
 */
async function addDemoViews(ctx: AppContext): Promise<void> {
  const snapshot = ctx.workspace.pages.getSnapshot();
  const projects = snapshot
    .all()
    .find((page) => page.kind === 'database' && page.title === 'Projects');
  if (!projects) return;
  const handle = await ctx.loadDatabaseDoc(projects.id);
  try {
    const properties = listProperties(handle.doc);
    const named = (name: string) => properties.find((property) => property.name === name);
    const status = named('Status');
    const due = named('Due');
    if (status?.type !== 'select') return;
    const optionIds = STATUS_ORDER.flatMap(
      (name) => status.options?.find((option) => option.name === name)?.id ?? [],
    );
    handle.doc.transact(() => {
      addView(handle.doc, {
        name: t('demoBoardView'),
        type: 'board',
        position: 'start',
        group: {
          propertyId: status.id,
          order: optionIds,
          hidden: [],
          collapsed: [],
          hideEmptyGroups: true,
          dateBucket: 'month',
        },
        properties: ['Priority', 'Owner', 'Due'].flatMap((name) => {
          const property = named(name);
          return property ? [{ propertyId: property.id, visible: true }] : [];
        }),
      });
      if (due?.type === 'date') {
        addView(handle.doc, {
          name: t('demoCalendarView'),
          type: 'calendar',
          calendar: { datePropertyId: due.id },
        });
      }
    }, IMPORT_ORIGIN);
  } finally {
    handle.release();
  }
}

/**
 * The demo is the whole workspace, so its pages sit at the top level rather than under an import
 * page named like the workspace, with the welcome page first. The import page goes away when
 * nothing else is on it. Returns the page to open.
 */
async function flattenDemo(ctx: AppContext, rootPageId: string): Promise<string> {
  const children = ctx.workspace.pages.getSnapshot().children(rootPageId);
  const welcome = children.find((page) => WELCOME.test(page.title));
  if (!welcome) return rootPageId;
  const root = await ctx.loadPageDoc(rootPageId);
  let rootIsEmpty: boolean;
  try {
    rootIsEmpty = isDocEmpty(readDocJSON(root.doc));
  } finally {
    root.release();
  }
  if (!rootIsEmpty) return welcome.id;
  for (const page of [welcome, ...children.filter((child) => child !== welcome)]) {
    ctx.workspace.movePage(page.id, { parentId: null });
  }
  await ctx.workspace.deletePagePermanently(rootPageId);
  return welcome.id;
}

/** Imports the demo workspace into the (new) workspace and opens its welcome page. */
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
    await addDemoViews(ctx);
    ctx.navigate(await flattenDemo(ctx, rootPageId));
  } catch (error) {
    ctx.toast({ title: t('demoFailed'), description: toError(error).message, variant: 'error' });
  }
}
