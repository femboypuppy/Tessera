import { AppContextProvider } from '@tessera/core/react';
import { ConfirmHost } from '@tessera/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDesktop, desktopTestContext } from '../testing/context';
import PickerHost from './PickerHost';
import { openPicker, pickerStore } from './store';

afterEach(async () => {
  pickerStore.set({ open: false });
  await cleanupDesktop();
});

const HOME = 'C:/Users/ada';

async function renderPicker(options: Parameters<typeof desktopTestContext>[0] = {}) {
  const test = await desktopTestContext({ home: HOME, ...options });
  render(
    <AppContextProvider value={test.ctx}>
      <PickerHost />
      <ConfirmHost />
    </AppContextProvider>,
  );
  return test;
}

describe('<WorkspacePicker>', () => {
  it('renders nothing until opened, then lists workspaces with their folders', async () => {
    const { ctx } = await renderPicker({
      registry: [
        {
          id: 'ws_team',
          name: 'Team notes',
          path: `${HOME}/Dropbox/Team notes`,
          createdAt: 1,
          lastOpenedAt: 1,
          initializedAt: 1,
        },
        {
          id: 'ws_old',
          name: 'Old laptop',
          path: 'E:/Backup/Old laptop',
          createdAt: 1,
          initializedAt: 1,
        },
      ],
      folders: {
        [`${HOME}/Dropbox/Team notes`]: {
          workspace: { id: 'ws_team', name: 'Team notes', createdAt: 1, formatVersion: 1 },
          conflicts: ['tessera 2.db'],
        },
      },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    openPicker();
    const dialog = await screen.findByRole('dialog', { name: 'Workspaces' });
    const current = await within(dialog).findByRole('button', { current: true });
    expect(current).toHaveTextContent('Apollo research');
    expect(current).toHaveTextContent('~/Tessera/Apollo research');
    expect(current).toHaveTextContent('Created on first edit');
    expect(within(dialog).getByText('Synced by Dropbox')).toBeInTheDocument();
    expect(within(dialog).getByText('1 conflicting copy')).toBeInTheDocument();
    const missing = within(dialog).getByText('Old laptop').closest('button');
    expect(missing).toBeDisabled();
    expect(within(dialog).getByText('Folder not found')).toBeInTheDocument();
    expect(ctx.workspace.info.name).toBe('Apollo research');
  });

  it('switches to another workspace', async () => {
    const { shell } = await renderPicker({
      registry: [
        { id: 'ws_team', name: 'Team notes', path: 'D:/Team notes', createdAt: 1, lastOpenedAt: 1 },
      ],
    });
    openPicker();
    const row = (await screen.findByText('Team notes')).closest('button');
    if (!row) throw new Error('no row button');
    await userEvent.click(row);
    expect(shell.workspaceSwitches).toEqual(['ws_team']);
    expect(pickerStore.get()).toEqual({ open: false });
  });

  it('creates a workspace in a folder of its own', async () => {
    const { shell, fake } = await renderPicker({ pickFolder: ['D:/Notes'] });
    openPicker('list');
    await userEvent.click(await screen.findByRole('button', { name: 'New workspace…' }));
    const form = await screen.findByRole('dialog', { name: 'New workspace' });
    const create = within(form).getByRole('button', { name: 'Create workspace' });
    expect(create).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Name'), 'Moon base');
    expect(within(form).getByText('Creates ~/Tessera/Moon base')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Browse…' }));
    await waitFor(() =>
      expect(within(form).getByText('Creates D:/Notes/Moon base')).toBeInTheDocument(),
    );
    await userEvent.click(create);
    await waitFor(() => expect(shell.workspaceSwitches).toHaveLength(1));
    const entry = fake.state.registry.find((item) => item.name === 'Moon base');
    expect(entry).toMatchObject({ path: 'D:/Notes/Moon base' });
    expect(shell.workspaceSwitches[0]).toBe(entry?.id);
  });

  it('removes a workspace from the list after confirming', async () => {
    const { fake, shell } = await renderPicker({
      registry: [
        { id: 'ws_team', name: 'Team notes', path: 'D:/Team notes', createdAt: 1, lastOpenedAt: 1 },
      ],
    });
    openPicker();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Team notes' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from list' }));
    await waitFor(() => expect(screen.queryByText('Team notes')).toBeNull());
    // The shell's confirmation (recorded here) says the folder stays.
    expect(shell.confirms.at(-1)).toMatchObject({
      title: 'Remove “Team notes” from the list?',
      destructive: true,
    });
    expect(shell.confirms.at(-1)?.description).toContain('stay on your computer');
    expect(fake.state.registry.map((entry) => entry.id)).not.toContain('ws_team');
    expect(shell.toasts.at(-1)?.title).toBe('Removed “Team notes” from the list');
  });

  it('keeps a workspace when the confirmation is declined', async () => {
    const { fake, shell } = await renderPicker({
      registry: [
        { id: 'ws_team', name: 'Team notes', path: 'D:/Team notes', createdAt: 1, lastOpenedAt: 1 },
      ],
    });
    shell.confirmAnswer = false;
    openPicker();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Team notes' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from list' }));
    await waitFor(() => expect(shell.confirms).toHaveLength(1));
    expect(fake.state.registry.map((entry) => entry.id)).toContain('ws_team');
    expect(screen.getByText('Team notes')).toBeInTheDocument();
  });
});
