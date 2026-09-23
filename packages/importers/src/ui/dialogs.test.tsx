// @vitest-environment jsdom
import { COMMANDS, writeDocJSON, type AppContext } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import type { TestAppContext } from '@tessera/core/testing';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { unzipSync, strFromU8 } from 'fflate';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHtmlExporter, createMarkdownExporter } from '../exporters';
import { createMarkdownImporter, createObsidianImporter } from '../importers';
import { importWorkspace, outline } from '../test/helpers';
import { importExportCommands, importExportRoutes, ImportExportOverlay } from './entry';
import {
  getImportExportState,
  openExportDialog,
  openImportDialog,
  resetImportExport,
} from './store';

let test: TestAppContext;
/** Reading files, loading the importer and the codec take a moment on a busy machine. */
const SLOW = { timeout: 15_000 };

beforeEach(async () => {
  test = await importWorkspace();
  const { ctx } = test;
  ctx.importers.register(createObsidianImporter());
  ctx.importers.register(createMarkdownImporter());
  ctx.exporters.register(createMarkdownExporter());
  ctx.exporters.register(createHtmlExporter());
});

afterEach(async () => {
  act(() => resetImportExport());
  vi.restoreAllMocks();
  await test.dispose();
});

function renderOverlay(ctx: AppContext) {
  return render(
    <MemoryRouter>
      <AppContextProvider value={ctx}>
        <ImportExportOverlay />
      </AppContextProvider>
    </MemoryRouter>,
  );
}

/** A file as a folder picker gives it: with its path inside the picked folder. */
function folderFile(path: string, text: string): File {
  const file = new File([text], path.split('/').at(-1) ?? path, { type: 'text/markdown' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('import dialog', () => {
  it('previews picked files, imports them and shows the report', async () => {
    const user = userEvent.setup();
    renderOverlay(test.ctx);
    act(() => openImportDialog('obsidian'));
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    expect(within(dialog).getByRole('radio', { name: 'Obsidian' })).toBeChecked();
    expect(within(dialog).getByText(/Drop your vault folder/)).toBeInTheDocument();

    const input = within(dialog).getByTestId('import-folder-input');
    expect(input).toHaveAttribute('webkitdirectory');
    fireEvent.change(input, {
      target: {
        files: [
          folderFile('Garden/Welcome.md', '# Welcome\n\nSee [[Roses]] and [[Missing page]].'),
          folderFile('Garden/Plants/Roses.md', 'Roses need **sun**. Back to [[Welcome]].'),
          folderFile('Garden/.obsidian/app.json', '{}'),
        ],
      },
    });

    // Preview: source detected, contents counted, the root page named after the folder.
    const start = await within(dialog).findByRole('button', { name: 'Import 2 files' }, SLOW);
    expect(within(dialog).getByText('Detected')).toBeInTheDocument();
    const preview = within(dialog).getByRole('region', { name: 'Files to import' });
    expect(preview).toHaveTextContent('Garden');
    expect(preview).toHaveTextContent('2 notes');
    expect(preview).toHaveTextContent('1 folder');
    expect(
      within(dialog).getByText('1 file is skipped (app settings and trash).'),
    ).toBeInTheDocument();
    const rootTitle = within(dialog).getByLabelText('New page for the import');
    expect(rootTitle).toHaveValue('Garden');
    await user.clear(rootTitle);
    await user.type(rootTitle, 'My garden');
    await user.click(start);

    const report = await screen.findByRole('dialog', { name: 'Import complete' }, SLOW);
    expect(within(report).getByTestId('count-Pages')).toHaveTextContent('Pages4');
    expect(within(report).getByTestId('count-Links')).toHaveTextContent('Links2');
    await user.click(within(report).getByText('Links to pages that were not in the import'));
    expect(within(report).getByText(/Missing page/)).toBeVisible();

    const [root] = test.ctx.workspace.pages.getSnapshot().children(null);
    expect(root?.title).toBe('My garden');
    expect(outline(test.ctx, root?.id ?? '')).toEqual(['Plants', '  Roses', 'Welcome']);
    await user.click(within(report).getByRole('button', { name: 'Open imported pages' }));
    expect(test.shell.navigations.at(-1)).toEqual({ pageId: root?.id });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }, 30_000);

  it('moves an import to the trash, with undo', async () => {
    const user = userEvent.setup();
    renderOverlay(test.ctx);
    act(() => openImportDialog());
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    fireEvent.change(within(dialog).getByTestId('import-files-input'), {
      target: { files: [new File(['Just one note.'], 'Note.md', { type: 'text/markdown' })] },
    });
    await user.click(await within(dialog).findByRole('button', { name: 'Import 1 file' }, SLOW));
    const report = await screen.findByRole('dialog', { name: 'Import complete' }, SLOW);
    const [root] = test.ctx.workspace.pages.getSnapshot().children(null);
    await user.click(within(report).getByRole('button', { name: 'Move import to trash' }));
    expect(test.ctx.workspace.pages.getSnapshot().isTrashed(root?.id ?? '')).toBe(true);
    const toast = test.shell.toasts.at(-1);
    expect(toast?.title).toBe('The import was moved to the trash');
    act(() => toast?.action?.onClick());
    expect(test.ctx.workspace.pages.getSnapshot().isTrashed(root?.id ?? '')).toBe(false);
  }, 30_000);

  it('says so when the files hold nothing to import', async () => {
    renderOverlay(test.ctx);
    act(() => openImportDialog());
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    fireEvent.change(within(dialog).getByTestId('import-folder-input'), {
      target: { files: [folderFile('Vault/.obsidian/app.json', '{}')] },
    });
    expect(await within(dialog).findByText('Nothing to import', {}, SLOW)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose other files' }));
    expect(within(dialog).getByText('Drop a zip, a folder or files here')).toBeInTheDocument();
  });
});

describe('export dialog', () => {
  it('exports a page and its subpages as a markdown zip', async () => {
    const user = userEvent.setup();
    const { ctx } = test;
    const parent = ctx.workspace.createPage({ title: 'Recipes' });
    const child = ctx.workspace.createPage({ title: 'Pancakes', parentId: parent.id });
    const handle = await ctx.loadPageDoc(parent.id);
    writeDocJSON(handle.doc, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Start with ' },
            { type: 'pageLink', attrs: { pageId: child.id } },
          ],
        },
      ],
    });
    handle.release();
    let saved: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved = blob as Blob;
      return 'blob:export';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderOverlay(ctx);
    act(() => openExportDialog(parent.id));
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    expect(within(dialog).getByRole('radio', { name: /^Markdown \(zip\)/ })).toBeChecked();
    expect(
      within(dialog).getByRole('radio', { name: /^This page and its subpages/ }),
    ).toBeChecked();
    // HTML and PDF export one page: choosing them narrows the scope.
    await user.click(within(dialog).getByRole('radio', { name: /^HTML/ }));
    expect(within(dialog).getByRole('radio', { name: /^This page/ })).toBeChecked();
    expect(within(dialog).queryByRole('radio', { name: /^The whole workspace/ })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: /^Markdown \(zip\)/ }));
    await user.click(within(dialog).getByRole('radio', { name: /^This page and its subpages/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));

    const done = await screen.findByRole('dialog', { name: 'Export ready' }, SLOW);
    expect(within(done).getByText(/Recipes\.zip/)).toBeInTheDocument();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(saved).not.toBeNull();
    const files = unzipSync(new Uint8Array(await (saved as unknown as Blob).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['Recipes.md', 'Recipes/Pancakes.md']);
    expect(strFromU8(files['Recipes.md'] ?? new Uint8Array())).toBe('Start with [[Pancakes]]\n');
  });

  it('opens the print view for a PDF', async () => {
    const user = userEvent.setup();
    const page = test.ctx.workspace.createPage({ title: 'Trip notes' });
    renderOverlay(test.ctx);
    act(() => openExportDialog(page.id));
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('radio', { name: /^PDF/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Open print view' }));
    expect(test.shell.navigations.at(-1)).toEqual({ path: `/print/${page.id}?print=1` });
    expect(getImportExportState().exportOpen).toBe(false);
  });
});

describe('commands and routes', () => {
  it('opens the dialogs with their arguments', async () => {
    const { ctx } = test;
    for (const command of importExportCommands()) ctx.commands.register(command);
    await ctx.commands.execute(COMMANDS.openImport, { args: { importerId: 'notion' } });
    expect(getImportExportState()).toMatchObject({ importOpen: true, importerId: 'notion' });
    await ctx.commands.execute(COMMANDS.openExport, { args: { pageId: 'abc' } });
    expect(getImportExportState()).toMatchObject({
      importOpen: false,
      exportOpen: true,
      exportPageId: 'abc',
    });
    await ctx.commands.execute(COMMANDS.openImport, { args: 'nonsense' });
    expect(getImportExportState()).toMatchObject({ importOpen: true, importerId: null });
    expect(importExportRoutes()).toEqual([
      expect.objectContaining({ path: '/print/:pageId', layout: 'bare' }),
    ]);
  });
});
