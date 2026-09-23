import { AppContextProvider } from '@tessera/core/react';
import { ConfirmHost } from '@tessera/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDesktop, desktopTestContext } from '../testing/context';
import { updateStore } from '../updates/updates';
import { folderStatusStore } from '../workspace/status';
import DesktopSettings from './DesktopSettings';
import FolderStatus from '../sidebar/FolderStatus';

afterEach(async () => {
  updateStore.set({ phase: 'idle' });
  folderStatusStore.set(null);
  await cleanupDesktop();
});

async function renderSettings(options: Parameters<typeof desktopTestContext>[0] = {}) {
  const test = await desktopTestContext({ home: 'C:/Users/ada', ...options });
  render(
    <AppContextProvider value={test.ctx}>
      <DesktopSettings />
      <FolderStatus />
      <ConfirmHost />
    </AppContextProvider>,
  );
  return test;
}

describe('Settings → Desktop', () => {
  it('shows the folder and reveals it', async () => {
    const { ctx, fake } = await renderSettings();
    const path = ctx.workspace.info.path ?? '';
    expect(await screen.findByText(path)).toBeInTheDocument();
    expect(
      await screen.findByText('The folder is created when you first edit something.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show in Explorer' }));
    await waitFor(() => expect(fake.state.revealed).toEqual([path]));
  });

  it('warns about a synced folder, in the panel and the sidebar', async () => {
    const { ctx, shell } = await renderSettings({ home: 'C:/Users/ada/Dropbox' });
    expect(ctx.workspace.info.path).toContain('/Dropbox/');
    expect(await screen.findAllByText('Synced by Dropbox')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /Synced by Dropbox\s*Review/ }));
    expect(shell.navigations.at(-1)).toEqual({ path: '/settings/desktop' });
  });

  it('merges a conflicted copy and reopens the workspace', async () => {
    const { ctx, shell, fake, flush } = await desktopTestContext({ home: 'C:/Users/ada' });
    ctx.workspace.createPage({ title: 'Exists on disk' });
    await flush();
    const folder = fake.state.folders[ctx.workspace.info.path ?? ''];
    if (folder) folder.conflicts = ['tessera 2.db'];
    render(
      <AppContextProvider value={ctx}>
        <DesktopSettings />
      </AppContextProvider>,
    );
    const callout = await screen.findByRole('alert');
    expect(callout).toHaveTextContent('Conflicting copies found');
    await userEvent.click(within(callout).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(shell.workspaceSwitches).toEqual([ctx.workspace.info.id]));
    expect(shell.toasts.at(-1)).toMatchObject({ variant: 'success', title: 'Merged tessera 2.db' });
  });

  it('changes the tray behavior and records a new capture shortcut', async () => {
    const { fake } = await renderSettings();
    const tray = await screen.findByRole('switch', {
      name: 'Keep running in the background when the window is closed',
    });
    expect(tray).toBeChecked();
    await userEvent.click(tray);
    await waitFor(() => expect(fake.state.prefs).toMatchObject({ closeToTray: false }));

    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByText('Press the new shortcut…')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK' });
    expect(
      await screen.findByText('Use at least one of Ctrl, Alt, Shift or ⌘ with a key.'),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
    await waitFor(() =>
      expect(fake.state.prefs).toMatchObject({ captureShortcut: 'CommandOrControl+Alt+K' }),
    );
    expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('says when updates are not configured in this build', async () => {
    await renderSettings();
    expect(await screen.findByText(/Automatic updates are off in this build/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  });

  it('finds an update at startup and installs it', async () => {
    const { shell } = await renderSettings({
      update: { configured: true, version: '0.2.0', notes: 'Faster sync' },
    });
    // The daily check ran when the workspace opened and announced the update.
    expect(await screen.findByText('Tessera 0.2.0 is available.')).toBeInTheDocument();
    expect(shell.toasts.some((toast) => toast.title === 'Tessera 0.2.0 is available')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(updateStore.get().phase).toBe('installing'));
  });

  it('checks on request when there is nothing new', async () => {
    const { fake } = await renderSettings({ update: { configured: true } });
    expect(await screen.findByText('Tessera is up to date.')).toBeInTheDocument();
    const before = fake.calls.filter((call) => call.cmd === 'updater_check').length;
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() =>
      expect(fake.calls.filter((call) => call.cmd === 'updater_check')).toHaveLength(before + 1),
    );
    expect(await screen.findByText('Tessera is up to date.')).toBeInTheDocument();
  });

  it('says when the device is signed in to no server', async () => {
    await renderSettings();
    expect(
      await screen.findByText('This device isn’t signed in to any Tessera server.'),
    ).toBeInTheDocument();
  });

  it('lists servers with a token in the keychain and signs out', async () => {
    const { ctx, fake, shell } = await desktopTestContext({ home: 'C:/Users/ada' });
    fake.state.secrets['https://notes.example.com'] = 'token';
    (fake.state as unknown as { servers: unknown[] }).servers = [
      { server: 'https://notes.example.com', savedAt: Date.UTC(2026, 8, 1) },
    ];
    render(
      <AppContextProvider value={ctx}>
        <DesktopSettings />
      </AppContextProvider>,
    );
    expect(await screen.findByText('https://notes.example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(fake.state.secrets).toEqual({}));
    expect(shell.confirms.at(-1)?.title).toBe('Sign out of https://notes.example.com?');
    expect(
      await screen.findByText('This device isn’t signed in to any Tessera server.'),
    ).toBeInTheDocument();
  });
});
