import { readDocJSON } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDesktop, desktopTestContext } from '../testing/context';
import { appendToInbox, captureBlocks, INBOX_SETTING } from './inbox';
import QuickCapture from './QuickCapture';

afterEach(cleanupDesktop);

describe('captureBlocks', () => {
  it('makes paragraphs and task lists', () => {
    expect(captureBlocks('Call Ada\n\n[ ] buy film\n- [x] book lab\nThanks')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Call Ada' }] },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'buy film' }] }],
          },
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'book lab' }] }],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Thanks' }] },
    ]);
    expect(captureBlocks('  \n\r\n')).toEqual([]);
  });
});

describe('the Inbox', () => {
  it('is created once, then appended to', async () => {
    const { ctx, flush } = await desktopTestContext();
    const inbox = await appendToInbox(ctx, 'First idea');
    expect(inbox).toMatchObject({ title: 'Inbox', icon: '📥', parentId: null });
    expect(ctx.settings.workspace.get(INBOX_SETTING)).toBe(inbox.id);
    const again = await appendToInbox(ctx, 'Second idea');
    expect(again.id).toBe(inbox.id);
    await flush();
    const handle = await ctx.loadPageDoc(inbox.id);
    const text = JSON.stringify(readDocJSON(handle.doc));
    handle.release();
    expect(text.indexOf('First idea')).toBeLessThan(text.indexOf('Second idea'));
  });

  it('is recreated when the saved one was trashed', async () => {
    const { ctx } = await desktopTestContext();
    const first = await appendToInbox(ctx, 'One');
    ctx.workspace.trashPage(first.id);
    const second = await appendToInbox(ctx, 'Two');
    expect(second.id).not.toBe(first.id);
  });
});

describe('the quick-capture window', () => {
  it('follows the workspace the main window opens', async () => {
    const { ctx, shell, fake } = await desktopTestContext({ windowLabel: 'capture' });
    const other = await ctx.services.workspaceRegistry.create({ name: 'Personal' });
    // The main window opens "Personal" (Rust announces the registry change to every window).
    const entry = fake.state.registry.find((item) => item.id === other.id);
    if (entry) entry.lastOpenedAt = Date.now() + 1000;
    fake.emit('desktop://registry-changed', { origin: 'main' });
    await waitFor(() => expect(shell.workspaceSwitches).toEqual([other.id]));
  });

  it('stays on /capture', async () => {
    const { shell } = await desktopTestContext({ windowLabel: 'capture' });
    expect(shell.navigations).toContainEqual({ path: '/capture', options: { replace: true } });
  });
});

describe('<QuickCapture>', () => {
  it('appends on Enter and puts the window away', async () => {
    const { ctx, fake } = await desktopTestContext({ windowLabel: 'capture' });
    render(
      <AppContextProvider value={ctx}>
        <QuickCapture />
      </AppContextProvider>,
    );
    const field = screen.getByRole('textbox', { name: 'Quick capture' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(fake.state.capture.ready).toBe(true);
    await userEvent.type(field, 'Ask about the heat shield{Shift>}{Enter}{/Shift}[[ ] order tiles');
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Added to Inbox');
    await waitFor(() => expect(fake.state.capture.visible).toBe(false));
    expect(field).toHaveValue('');
    const inboxId = String(ctx.settings.workspace.get(INBOX_SETTING));
    const handle = await ctx.loadPageDoc(inboxId);
    const doc = readDocJSON(handle.doc);
    handle.release();
    expect(doc.content.map((block) => block.type)).toEqual(['paragraph', 'taskList']);
  });

  it('keeps the draft when closed with Escape', async () => {
    const { ctx, fake } = await desktopTestContext({ windowLabel: 'capture' });
    render(
      <AppContextProvider value={ctx}>
        <QuickCapture />
      </AppContextProvider>,
    );
    const field = screen.getByRole('textbox', { name: 'Quick capture' });
    await userEvent.type(field, 'half a thought');
    fake.state.capture.visible = true;
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(fake.state.capture.visible).toBe(false));
    expect(field).toHaveValue('half a thought');
    expect(screen.getByRole('button', { name: 'Add to Inbox' })).toBeEnabled();
  });
});
