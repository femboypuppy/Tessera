import { COMMANDS, type AppContext } from '@tessera/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../backend/protocol';
import { cleanupDesktop, desktopTestContext } from '../testing/context';
import { buildAppMenu, DESKTOP_COMMANDS, MENU_ONLY, toAccelerator } from './app-menu';
import { editHistory, MenuDispatcher } from './dispatch';

afterEach(cleanupDesktop);

function ids(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'item'
      ? [node.id]
      : node.type === 'submenu'
        ? ids(node.items)
        : node.type === 'predefined'
          ? [`predefined:${node.item}`]
          : [],
  );
}

describe('accelerators', () => {
  it('converts web shortcuts and skips bare keys', () => {
    expect(toAccelerator('Mod+Shift+L')).toBe('CmdOrCtrl+Shift+L');
    expect(toAccelerator('Mod+\\')).toBe('CmdOrCtrl+Backslash');
    expect(toAccelerator('Mod+,')).toBe('CmdOrCtrl+Comma');
    expect(toAccelerator('Mod+=')).toBe('CmdOrCtrl+Equal');
    expect(toAccelerator('Mod+Alt+N')).toBe('CmdOrCtrl+Alt+N');
    expect(toAccelerator('?')).toBeNull();
    expect(toAccelerator('F11')).toBeNull();
    expect(toAccelerator('Bogus+X')).toBeNull();
  });
});

describe('native menus', () => {
  it('builds platform menus from the commands that exist', async () => {
    const { ctx } = await desktopTestContext();
    // The shell registers its commands in the app; stand in for "New page".
    ctx.commands.register({
      id: COMMANDS.newPage,
      title: 'New page',
      shortcut: 'Mod+N',
      run: () => undefined,
    });
    const windows = buildAppMenu(ctx, { isMac: false });
    const labels = windows.spec.menu.map((node) => (node.type === 'submenu' ? node.label : ''));
    expect(labels).toEqual(['File', 'Edit', 'View', 'Window', 'Help']);
    const all = ids(windows.spec.menu);
    expect(all).toContain(COMMANDS.newPage);
    expect(all).toContain(DESKTOP_COMMANDS.openWorkspaces);
    expect(all).toContain('app.quit');
    // The command palette isn't registered in this test: its item is left out.
    expect(all).not.toContain(COMMANDS.openPalette);
    expect(windows.shortcuts.get(DESKTOP_COMMANDS.openWorkspaces)).toBe('Mod+O');
    expect(windows.shortcuts.get(MENU_ONLY.undo)).toBe('Mod+Z');
    expect(ids(windows.spec.tray)).toEqual([
      'tray.show',
      'tray.capture',
      'tray.newPage',
      'app.quit',
    ]);

    const mac = buildAppMenu(ctx, { isMac: true });
    expect(mac.spec.menu[0]).toMatchObject({ type: 'submenu', label: 'Tessera' });
    expect(ids(mac.spec.menu)).toContain('predefined:hideOthers');
  });

  it('never starts, ends or doubles separators', async () => {
    const { ctx } = await desktopTestContext();
    const check = (nodes: MenuNode[]) => {
      nodes.forEach((node, index) => {
        if (node.type === 'separator') {
          expect(index).toBeGreaterThan(0);
          expect(index).toBeLessThan(nodes.length - 1);
          expect(nodes[index - 1]?.type).not.toBe('separator');
        }
        if (node.type === 'submenu') check(node.items);
      });
    };
    check(buildAppMenu(ctx, { isMac: false }).spec.menu);
    check(buildAppMenu(ctx, { isMac: true }).spec.menu);
  });

  it('sets the menus and the window title when the workspace opens', async () => {
    const { fake } = await desktopTestContext({ workspaceName: 'Apollo research' });
    await vi.waitFor(() => expect(fake.state.menu).not.toBeNull());
    expect(fake.state.title).toBe('Apollo research — Tessera');
  });
});

describe('menu dispatch', () => {
  const setup = () => {
    const execute = vi.fn(async () => true);
    const ctx = { commands: { has: () => true, execute } } as unknown as AppContext;
    let now = 1000;
    const target = new EventTarget() as unknown as Window;
    const fallback = vi.fn(async () => true);
    const dispatcher = new MenuDispatcher(
      () => ctx,
      { isApple: false, now: () => now, fallback },
      target,
    );
    dispatcher.setShortcuts(new Map([['shell.newPage', 'Mod+N']]));
    const press = (init: KeyboardEventInit) =>
      (target as unknown as EventTarget).dispatchEvent(new KeyboardEvent('keydown', init));
    return { dispatcher, execute, fallback, press, tick: (ms: number) => (now += ms) };
  };

  it('runs the command for a menu click', async () => {
    const { dispatcher, execute } = setup();
    await dispatcher.dispatch('shell.newPage');
    expect(execute).toHaveBeenCalledWith('shell.newPage', { source: 'menu' });
    await dispatcher.dispatch('tray.newPage');
    expect(execute).toHaveBeenLastCalledWith(COMMANDS.newPage, { source: 'menu' });
  });

  it('skips an accelerator the page already handled', async () => {
    const { dispatcher, execute, press, tick } = setup();
    press({ key: 'n', code: 'KeyN', ctrlKey: true });
    await dispatcher.dispatch('shell.newPage');
    expect(execute).not.toHaveBeenCalled();
    tick(1000);
    await dispatcher.dispatch('shell.newPage');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('falls back when no workspace is open', async () => {
    const execute = vi.fn();
    const fallback = vi.fn(async () => true);
    const dispatcher = new MenuDispatcher(
      () => null,
      { isApple: true, fallback },
      new EventTarget() as unknown as Window,
    );
    await dispatcher.dispatch('desktop.openFolder');
    expect(fallback).toHaveBeenCalledWith('desktop.openFolder');
    expect(execute).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it('sends undo to the editor as a key and to fields as native undo', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.tabIndex = 0;
    document.body.append(editor);
    editor.focus();
    const keys: KeyboardEvent[] = [];
    editor.addEventListener('keydown', (event) => keys.push(event));
    editHistory('redo', true);
    expect(keys[0]).toMatchObject({ key: 'z', metaKey: true, shiftKey: true });

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    editHistory('undo', false);
    expect(execCommand).toHaveBeenCalledWith('undo');
    editor.remove();
    input.remove();
  });
});
