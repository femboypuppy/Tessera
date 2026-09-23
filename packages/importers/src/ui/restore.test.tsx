// @vitest-environment jsdom
import { createRecordingShell, type TestAppContext } from '@tessera/core/testing';
import { writeDocJSON } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupExporter } from '../exporters';
import { SingleFileSink } from '../export/zip-sink';
import { createBackupImporter, createMarkdownImporter } from '../importers';
import { docOf, importWorkspace, outline } from '../test/helpers';
import { activateImportExport, ImportExportOverlay } from './entry';
import { exportContextFor } from './jobs';
import { getImportExportState, openImportDialog, resetImportExport } from './store';

let test: TestAppContext;

beforeEach(async () => {
  test = await importWorkspace();
  test.ctx.importers.register(createMarkdownImporter());
  test.ctx.importers.register(createBackupImporter());
});

afterEach(async () => {
  act(() => resetImportExport());
  await test.dispose();
});

describe('restoring a backup', () => {
  it('creates a new workspace from the dialog and restores the backup when it opens', async () => {
    const user = userEvent.setup();
    const { ctx, runtime, shell } = test;
    const journal = ctx.workspace.createPage({ title: 'Journal', icon: '📓' });
    ctx.workspace.createPage({ title: 'Monday', parentId: journal.id });
    const handle = await ctx.loadPageDoc(journal.id);
    writeDocJSON(handle.doc, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dear diary' }] }],
    });
    handle.release();
    const sink = new SingleFileSink();
    await createBackupExporter().run(
      { kind: 'workspace' },
      exportContextFor(ctx),
      sink,
      () => undefined,
      new AbortController().signal,
    );
    const json = typeof sink.data === 'string' ? sink.data : '';
    expect(json).toContain('"format":"tessera-backup"');

    // The dialog: the backup is recognized and restored into a new workspace.
    render(
      <MemoryRouter>
        <AppContextProvider value={ctx}>
          <ImportExportOverlay />
        </AppContextProvider>
      </MemoryRouter>,
    );
    act(() => openImportDialog());
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    fireEvent.change(within(dialog).getByTestId('import-files-input'), {
      target: {
        files: [new File([json], sink.name ?? 'backup.json', { type: 'application/json' })],
      },
    });
    const restore = await within(dialog).findByRole('button', {
      name: 'Restore into a new workspace',
    });
    expect(within(dialog).getByText('Detected')).toBeInTheDocument();
    const name = within(dialog).getByLabelText('New workspace name');
    expect(name).toHaveValue('Test workspace (restored)');
    await user.click(restore);
    await waitFor(() => expect(shell.workspaceSwitches).toHaveLength(1));
    const [workspaceId = ''] = shell.workspaceSwitches;
    const info = await runtime.workspaceRegistry.get(workspaceId);
    expect(info?.name).toBe('Test workspace (restored)');
    // Nothing changed in the workspace the backup came from.
    expect(outline(ctx, journal.id)).toEqual(['Monday']);

    // The shell opens the new workspace; activation restores the backup there.
    const opened = await runtime.openWorkspace(
      await runtime.workspaceRegistry.open(workspaceId),
      createRecordingShell(),
    );
    try {
      act(() => resetImportExport());
      const cleanup = activateImportExport(opened.ctx);
      expect(getImportExportState()).toMatchObject({
        importOpen: true,
        importerId: 'tessera-backup',
      });
      await waitFor(() => expect(getImportExportState().job?.status).toBe('done'));
      const job = getImportExportState().job;
      expect(job?.status === 'done' && job.report.issues).toEqual([]);
      const [restored] = opened.ctx.workspace.pages.getSnapshot().children(null);
      expect(restored).toMatchObject({ title: 'Journal', icon: '📓' });
      expect(outline(opened.ctx, restored?.id ?? '')).toEqual(['Monday']);
      expect(await docOf(opened.ctx, restored?.id ?? '')).toMatchObject({
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dear diary' }] }],
      });
      // A second activation finds nothing left to restore.
      cleanup();
      activateImportExport(opened.ctx)();
      expect(getImportExportState().job).toBeNull();
    } finally {
      await opened.close();
    }
  });
});
