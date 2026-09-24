// @vitest-environment jsdom
import { writeDocJSON } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import type { TestAppContext } from '@tessera/core/testing';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackupExporter } from '../exporters';
import { importWorkspace } from '../test/helpers';
import PrintView from './PrintView';
import SettingsPanel from './SettingsPanel';
import { getImportExportState, resetImportExport } from './store';

let test: TestAppContext;
/** Rendering loads the HTML renderer and the page's docs: a moment on a busy machine. */
const SLOW = { timeout: 15_000 };

beforeEach(async () => {
  test = await importWorkspace();
});

afterEach(async () => {
  act(() => resetImportExport());
  vi.restoreAllMocks();
  await test.dispose();
});

describe('print view', () => {
  it('renders the page as a document whose links open other pages', async () => {
    const { ctx } = test;
    const trip = ctx.workspace.createPage({ title: 'Lisbon trip', icon: '🧳' });
    const food = ctx.workspace.createPage({ title: 'Where to eat' });
    const handle = await ctx.loadPageDoc(trip.id);
    writeDocJSON(handle.doc, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Book a table from ' },
            { type: 'pageLink', attrs: { pageId: food.id } },
            { type: 'text', text: ' <script>alert(1)</script>' },
          ],
        },
      ],
    });
    handle.release();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={[`/print/${trip.id}?print=1`]}>
        <AppContextProvider value={ctx}>
          <PrintView />
        </AppContextProvider>
      </MemoryRouter>,
    );
    const host = await screen.findByTestId('print-page', {}, SLOW);
    await waitFor(() => expect(host.shadowRoot?.querySelector('h1')).not.toBeNull(), SLOW);
    const root = host.shadowRoot;
    expect(root?.querySelector('h1')?.textContent).toBe('Lisbon trip');
    expect(root?.querySelector('.page-icon')?.textContent).toBe('🧳');
    // Headings sit one level under the page title.
    expect(root?.querySelector('h3')?.textContent).toBe('Plan');
    // Text stays text: nothing from the page runs.
    expect(root?.querySelector('script')).toBeNull();
    expect(root?.textContent).toContain('<script>alert(1)</script>');
    expect(document.title).toBe('Lisbon trip');
    // `?print=1` opens the print dialog once.
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1), SLOW);

    const link = root?.querySelector('a.page-link');
    expect(link?.textContent).toBe('Where to eat');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(test.shell.navigations.at(-1)).toEqual({ path: `/print/${food.id}` });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to page' }));
    expect(test.shell.navigations.at(-1)).toEqual({ pageId: trip.id });
  });

  it('says when the page does not exist', async () => {
    render(
      <MemoryRouter initialEntries={['/print/nope']}>
        <AppContextProvider value={test.ctx}>
          <PrintView />
        </AppContextProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This page does not exist', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled();
  });
});

describe('settings panel', () => {
  it('starts imports and downloads a backup', async () => {
    const user = userEvent.setup();
    const { ctx } = test;
    ctx.exporters.register(createBackupExporter());
    ctx.workspace.createPage({ title: 'Keep me safe' });
    let saved: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved = blob as Blob;
      return 'blob:backup';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <AppContextProvider value={ctx}>
        <SettingsPanel />
      </AppContextProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Import from Notion' }));
    expect(getImportExportState()).toMatchObject({ importOpen: true, importerId: 'notion' });
    await user.click(screen.getByRole('button', { name: 'Restore a backup…' }));
    expect(getImportExportState()).toMatchObject({ importerId: 'tessera-backup' });
    await user.click(screen.getByRole('button', { name: 'Export workspace as markdown' }));
    expect(getImportExportState()).toMatchObject({ exportOpen: true, exportPageId: null });

    await user.click(screen.getByRole('button', { name: 'Download backup' }));
    await waitFor(() => expect(saved).not.toBeNull(), SLOW);
    const backup = JSON.parse(await (saved as unknown as Blob).text()) as {
      format: string;
      workspace: { name: string };
    };
    expect(backup.format).toBe('tessera-backup');
    expect(backup.workspace.name).toBe(ctx.workspace.info.name);
  });
});
