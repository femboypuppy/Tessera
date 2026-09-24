import { afterEach, describe, expect, it } from 'vitest';
import { getBackend } from '../runtime';
import { cleanupDesktop, desktopTestContext } from '../testing/context';
import { desktopRegistry, openFolderFromOnboarding, pickAndOpenFolder } from './flows';

afterEach(cleanupDesktop);

const TEAM = {
  workspace: { id: 'ws_team', name: 'Team notes', createdAt: 1, formatVersion: 1 },
};

describe('folder flows', () => {
  it('asks before using a folder that already has files', async () => {
    const { ctx, shell, fake } = await desktopTestContext({
      folders: { 'D:/Projects/Rocket': { entries: 4 } },
      pickFolder: ['D:/Projects/Rocket', 'D:/Projects/Rocket'],
    });
    const registry = desktopRegistry(ctx.services.workspaceRegistry);
    if (!registry) throw new Error('no desktop registry');
    shell.confirmAnswer = false;
    expect(await pickAndOpenFolder(getBackend(), registry, ctx)).toBeNull();
    expect(shell.confirms.at(-1)?.title).toBe('Use “Rocket” as a workspace?');
    shell.confirmAnswer = true;
    const id = await pickAndOpenFolder(getBackend(), registry, ctx);
    expect(fake.state.registry.find((entry) => entry.id === id)).toMatchObject({
      name: 'Rocket',
      path: 'D:/Projects/Rocket',
    });
  });

  it('does nothing when the dialog is cancelled', async () => {
    const { ctx } = await desktopTestContext({ pickFolder: [null] });
    const registry = desktopRegistry(ctx.services.workspaceRegistry);
    if (!registry) throw new Error('no desktop registry');
    expect(await pickAndOpenFolder(getBackend(), registry, ctx)).toBeNull();
  });

  it('reports a folder it cannot open', async () => {
    const { ctx, shell, fake } = await desktopTestContext({ pickFolder: ['D:/Other'] });
    fake.addFolder('D:/Other', {
      workspace: { id: 'bad id!', name: 'x', createdAt: 1, formatVersion: 1 },
    });
    const registry = desktopRegistry(ctx.services.workspaceRegistry);
    if (!registry) throw new Error('no desktop registry');
    expect(await pickAndOpenFolder(getBackend(), registry, ctx)).toBeNull();
    expect(shell.toasts.at(-1)).toMatchObject({
      variant: 'error',
      title: 'Couldn’t open the folder',
    });
  });
});

describe('onboarding: open a workspace folder', () => {
  it('replaces the empty workspace the shell created with the folder’s workspace', async () => {
    const { ctx, shell, fake } = await desktopTestContext({
      folders: { 'D:/Shared/Team notes': TEAM },
      pickFolder: ['D:/Shared/Team notes'],
    });
    const placeholder = ctx.workspace.info.id;
    await openFolderFromOnboarding(getBackend(), ctx);
    expect(shell.workspaceSwitches).toEqual(['ws_team']);
    // The empty workspace never touched the disk, so it's simply forgotten.
    expect(fake.state.registry.map((entry) => entry.id)).toEqual(['ws_team']);
    expect(fake.state.registry.some((entry) => entry.id === placeholder)).toBe(false);
  });

  it('keeps the new workspace when the user cancels', async () => {
    const { ctx, shell, fake } = await desktopTestContext({ pickFolder: [null] });
    await openFolderFromOnboarding(getBackend(), ctx);
    expect(shell.workspaceSwitches).toEqual([]);
    expect(fake.state.registry.map((entry) => entry.id)).toEqual([ctx.workspace.info.id]);
  });

  it('keeps the new workspace if something was already written to it', async () => {
    const { ctx, shell, fake, flush } = await desktopTestContext({
      folders: { 'D:/Shared/Team notes': TEAM },
      pickFolder: ['D:/Shared/Team notes'],
    });
    ctx.workspace.createPage({ title: 'Already here' });
    await flush();
    await openFolderFromOnboarding(getBackend(), ctx);
    expect(shell.workspaceSwitches).toEqual(['ws_team']);
    expect(fake.state.registry).toHaveLength(2);
  });
});
