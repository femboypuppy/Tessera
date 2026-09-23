import { createAppRuntime, MemorySettingsStore, type AppRuntime } from '@tessera/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { SIDEBAR_DEFAULT_WIDTH, useUiStore } from './ui-store';

let runtime: AppRuntime;

beforeEach(async () => {
  window.history.replaceState(null, '', '/');
  useUiStore.setState({
    sidebarOpen: true,
    drawerOpen: false,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    sidePanel: null,
    shortcutsOpen: false,
    currentPageId: null,
  });
  // No features: the shell alone, on the in-memory services.
  runtime = await createAppRuntime({
    features: [],
    deviceSettings: new MemorySettingsStore(),
    defaultUserName: 'You',
  });
});

afterEach(async () => {
  cleanup();
  await runtime.dispose();
});

async function createWorkspace(user: UserEvent, name: string): Promise<HTMLElement> {
  render(<App runtime={runtime} />);
  const input = await screen.findByLabelText('Workspace name');
  await user.clear(input);
  await user.type(input, name);
  await user.click(screen.getByRole('button', { name: 'Create an empty workspace' }));
  await screen.findByText('Your workspace is empty');
  return screen.getByRole('navigation', { name: 'Sidebar' });
}

async function createPage(user: UserEvent, sidebar: HTMLElement, title: string): Promise<void> {
  const [newPage] = within(sidebar).getAllByRole('button', { name: 'New page' });
  if (!newPage) throw new Error('No "New page" button');
  await user.click(newPage);
  const titleBox = await screen.findByRole('textbox', { name: 'Page title' });
  await waitFor(() => expect(titleBox).toHaveFocus());
  await user.type(titleBox, title);
  await within(sidebar).findByRole('treeitem', { name: title });
}

function treeTitles(sidebar: HTMLElement): Array<[string | null, string | null]> {
  return within(sidebar)
    .getAllByRole('treeitem')
    .map((item) => [item.getAttribute('aria-label'), item.getAttribute('aria-level')]);
}

describe('the app shell', () => {
  it('onboards, then creates, renames, trashes and restores a page', async () => {
    const user = userEvent.setup();
    const sidebar = await createWorkspace(user, 'Apollo research');
    expect(within(sidebar).getByText('Apollo research')).toBeInTheDocument();

    await createPage(user, sidebar, 'Launch plan');
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByText('Launch plan'),
    ).toBeInTheDocument();

    // Rename through the title.
    const titleBox = screen.getByRole('textbox', { name: 'Page title' });
    await user.clear(titleBox);
    await user.type(titleBox, 'Launch checklist');
    await within(sidebar).findByRole('treeitem', { name: 'Launch checklist' });
    expect(
      within(sidebar).queryByRole('treeitem', { name: 'Launch plan' }),
    ).not.toBeInTheDocument();

    // Trash it from the page menu.
    await user.click(screen.getByRole('button', { name: 'Page actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(
        within(sidebar).queryByRole('treeitem', { name: 'Launch checklist' }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Moved “Launch checklist” to the trash')).toBeInTheDocument();
    expect(screen.getByText('This page is in the trash.')).toBeInTheDocument();

    // Restore it from the Trash view.
    await user.click(within(sidebar).getByRole('button', { name: 'Trash' }));
    await screen.findByRole('heading', { name: 'Trash', level: 1 });
    const row = screen.getByText('Launch checklist').closest('li');
    if (!row) throw new Error('No trash row');
    await user.click(within(row).getByRole('button', { name: 'Restore' }));
    await within(sidebar).findByRole('treeitem', { name: 'Launch checklist' });
    expect(await screen.findByText('The trash is empty')).toBeInTheDocument();
  });

  it('nests, un-nests and reorders pages from the keyboard', async () => {
    const user = userEvent.setup();
    const sidebar = await createWorkspace(user, 'Garden');
    await createPage(user, sidebar, 'Alpha');
    await createPage(user, sidebar, 'Beta');
    await createPage(user, sidebar, 'Gamma');
    expect(treeTitles(sidebar)).toEqual([
      ['Alpha', '1'],
      ['Beta', '1'],
      ['Gamma', '1'],
    ]);

    within(sidebar).getByRole('treeitem', { name: 'Beta' }).focus();
    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    await waitFor(() =>
      expect(treeTitles(sidebar)).toEqual([
        ['Alpha', '1'],
        ['Beta', '2'],
        ['Gamma', '1'],
      ]),
    );
    expect(within(sidebar).getByRole('treeitem', { name: 'Alpha' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(sidebar).getByRole('treeitem', { name: 'Beta' })).toHaveFocus();

    await user.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    await waitFor(() =>
      expect(treeTitles(sidebar)).toEqual([
        ['Alpha', '1'],
        ['Beta', '1'],
        ['Gamma', '1'],
      ]),
    );

    await user.keyboard('{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}');
    await waitFor(() =>
      expect(treeTitles(sidebar)).toEqual([
        ['Beta', '1'],
        ['Alpha', '1'],
        ['Gamma', '1'],
      ]),
    );
    expect(within(sidebar).getByRole('treeitem', { name: 'Beta' })).toHaveFocus();

    // Plain arrows move focus without moving pages.
    await user.keyboard('{ArrowDown}');
    expect(within(sidebar).getByRole('treeitem', { name: 'Alpha' })).toHaveFocus();
  });

  it('shows each shortcut group once in the shortcuts dialog', async () => {
    const user = userEvent.setup();
    await createWorkspace(user, 'Shortcuts');
    await user.keyboard('{Control>}/{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const groups = within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(groups).toEqual(['Navigation', 'Page', 'View', 'Help']);
    expect(within(dialog).getByText('Toggle dark mode')).toBeInTheDocument();
  });
});
