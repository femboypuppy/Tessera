import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepLinkFor, openDeepLink, openPendingLink } from './commands';
import { pickerStore } from './picker/store';
import { cleanupDesktop, desktopTestContext } from './testing/context';

afterEach(async () => {
  await cleanupDesktop();
  pickerStore.set({ open: false });
});

describe('deep links', () => {
  it('formats links that the Rust side parses', () => {
    expect(deepLinkFor('V1StGXR8_Z5jdHi6B-myT', 'ws_1')).toBe(
      'tessera://open/V1StGXR8_Z5jdHi6B-myT?workspace=ws_1',
    );
  });

  it('opens a page of the current workspace', async () => {
    const { ctx, shell } = await desktopTestContext();
    const page = ctx.workspace.createPage({ title: 'Mission control' });
    await openDeepLink(ctx, {
      pageId: page.id,
      workspaceId: null,
      heading: 'Launch',
      blockId: null,
    });
    expect(shell.navigations.at(-1)).toEqual({ pageId: page.id, options: { heading: 'Launch' } });
    await openDeepLink(ctx, {
      pageId: 'nope',
      workspaceId: ctx.workspace.info.id,
      heading: null,
      blockId: null,
    });
    expect(shell.toasts.at(-1)?.title).toBe('That page isn’t in this workspace.');
  });

  it('switches workspace first, then opens the page there', async () => {
    const { ctx, shell } = await desktopTestContext();
    const other = await ctx.services.workspaceRegistry.create({ name: 'Personal' });
    await openDeepLink(ctx, { pageId: 'p1', workspaceId: other.id, heading: null, blockId: null });
    expect(shell.workspaceSwitches).toEqual([other.id]);
    await openDeepLink(ctx, { pageId: 'p1', workspaceId: 'unknown', heading: null, blockId: null });
    expect(shell.toasts.at(-1)?.title).toBe('The workspace of that link isn’t on this computer.');
    // The link waits for the other workspace's session.
    await openPendingLink(ctx);
    expect(shell.navigations).toHaveLength(0);
  });

  it('takes links queued by Rust when the workspace opens and when they arrive', async () => {
    const { ctx, fake, shell } = await desktopTestContext();
    const page = ctx.workspace.createPage({ title: 'Checklist' });
    fake.queueLink({ pageId: page.id });
    await vi.waitFor(() =>
      expect(shell.navigations.at(-1)).toEqual({ pageId: page.id, options: {} }),
    );
  });
});

describe('desktop commands', () => {
  it('open the picker, reveal the folder, zoom and open links', async () => {
    const { ctx, fake, shell } = await desktopTestContext();
    await ctx.commands.execute('desktop.openWorkspaces');
    expect(pickerStore.get()).toEqual({ open: true, view: 'list' });
    await ctx.commands.execute('desktop.newWorkspace');
    expect(pickerStore.get()).toEqual({ open: true, view: 'new' });
    await ctx.commands.execute('desktop.revealWorkspace');
    expect(fake.state.revealed).toEqual([ctx.workspace.info.path]);
    await ctx.commands.execute('desktop.zoomIn');
    expect(fake.state.zoom).toBe(1.1);
    expect(shell.toasts.at(-1)?.title).toBe('Zoom 110%');
    await ctx.commands.execute('desktop.reportIssue');
    expect(fake.state.opened.at(-1)).toContain('/issues/new');
  });

  it('are hidden in the quick-capture window', async () => {
    const { ctx } = await desktopTestContext({ windowLabel: 'capture' });
    expect(ctx.commands.available().map((command) => command.id)).not.toContain(
      'desktop.openWorkspaces',
    );
  });

  it('opens a folder picked in the native dialog', async () => {
    const { ctx, shell, fake } = await desktopTestContext({
      folders: {
        'C:/Users/ada/Dropbox/Team': {
          workspace: { id: 'ws_team', name: 'Team', createdAt: 1, formatVersion: 1 },
        },
      },
      pickFolder: ['C:/Users/ada/Dropbox/Team'],
    });
    await ctx.commands.execute('desktop.openFolder');
    // Synced by Dropbox: the user was warned before it was added.
    expect(shell.confirms.at(-1)?.title).toBe('This folder is synced by Dropbox');
    expect(shell.workspaceSwitches).toEqual(['ws_team']);
    expect(fake.state.registry.some((entry) => entry.id === 'ws_team')).toBe(true);
  });
});
