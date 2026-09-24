import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SearchPage from '../search-page/search-page';
import { b, createIndexedContext, type IndexedTestContext } from '../test-utils';
import CommandPalette from './command-palette';
import { paletteStore } from './store';

const open: IndexedTestContext[] = [];
async function setup() {
  const test = await createIndexedContext();
  open.push(test);
  return test;
}
afterEach(async () => {
  act(() => paletteStore.close());
  for (const test of open.splice(0)) await test.dispose();
});

describe('CommandPalette', () => {
  it('finds pages by title and text, and opens one with the keyboard', async () => {
    const test = await setup();
    const launch = test.ctx.workspace.createPage({ title: 'Launch checklist' });
    test.ctx.workspace.createPage({ title: 'Booster tests' });
    await test.write(launch.id, b.doc(b.paragraph('Fuel the booster before the window opens.')));
    test.renderInApp(<CommandPalette />);
    act(() => paletteStore.open());
    const input = await screen.findByRole('combobox', { name: 'Command palette' });
    fireEvent.change(input, { target: { value: 'booster' } });
    const pages = await screen.findByRole('group', { name: 'Pages' });
    expect(within(pages).getByRole('option', { name: /Booster tests/ })).toBeTruthy();
    const content = screen.getByRole('group', { name: 'In pages' });
    const hit = within(content).getByRole('option', { name: /Launch checklist/ });
    expect(hit.textContent).toContain('Fuel the booster before the window opens.');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(hit.getAttribute('aria-selected')).toBe('true'));
    expect(input.getAttribute('aria-activedescendant')).toBe(hit.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(test.shell.navigations.at(-1)).toMatchObject({ pageId: launch.id });
    expect(paletteStore.getState().open).toBe(false);
  });

  it("waits for the typed text's results when Enter comes first", async () => {
    const test = await setup();
    const europa = test.ctx.workspace.createPage({ title: 'Europa' });
    await test.search.whenIdle();
    test.renderInApp(<CommandPalette />);
    act(() => paletteStore.open());
    const input = await screen.findByRole('combobox', { name: 'Command palette' });
    fireEvent.change(input, { target: { value: 'europa' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(test.shell.navigations.at(-1)).toMatchObject({ pageId: europa.id }));
    expect(test.ctx.workspace.pages.getSnapshot().size).toBe(1);
  });

  it('runs commands in > mode and shows recent pages when empty', async () => {
    const test = await setup();
    let ran = 0;
    test.ctx.commands.register({
      id: 'test.hello',
      title: 'Say hello',
      shortcut: 'Mod+Shift+H',
      run: () => {
        ran += 1;
      },
    });
    const page = test.ctx.workspace.createPage({ title: 'Visited page' });
    test.ctx.settings.device.set(`search.recent.${test.workspace.id}`, [page.id]);
    test.renderInApp(<CommandPalette />);
    act(() => paletteStore.open());
    const input = await screen.findByRole('combobox', { name: 'Command palette' });
    expect(
      within(screen.getByRole('group', { name: 'Recent' })).getByRole('option', {
        name: /Visited page/,
      }),
    ).toBeTruthy();
    fireEvent.change(input, { target: { value: '>hello' } });
    const option = await screen.findByRole('option', { name: /Say hello/ });
    expect(option.querySelectorAll('kbd').length).toBeGreaterThan(0);
    fireEvent.click(option);
    await waitFor(() => expect(ran).toBe(1));
  });

  it('offers to create a page, and says when nothing matches', async () => {
    const test = await setup();
    test.renderInApp(<CommandPalette />);
    act(() => paletteStore.open());
    const input = await screen.findByRole('combobox', { name: 'Command palette' });
    fireEvent.change(input, { target: { value: 'Quarterly planning' } });
    expect(await screen.findByText('No results for “Quarterly planning”')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Create page “Quarterly planning”' }));
    const created = test.ctx.workspace.pages
      .getSnapshot()
      .all()
      .find((page) => page.title === 'Quarterly planning');
    expect(created).toBeTruthy();
    expect(test.shell.navigations.at(-1)).toMatchObject({ pageId: created?.id });
  });
});

describe('SearchPage', () => {
  it('shows counts, snippets, filters and pagination from the URL', async () => {
    const test = await setup();
    const space = test.ctx.workspace.createPage({ title: 'Space' });
    for (let i = 1; i <= 23; i += 1) {
      const page = test.ctx.workspace.createPage({ title: `Mission ${i}`, parentId: space.id });
      await test.write(
        page.id,
        b.doc(b.paragraph(`Orbit number ${i} `, b.tag(i % 2 ? 'odd' : 'even'))),
      );
    }
    window.history.replaceState(null, '', '/search?q=orbit');
    test.renderInApp(<SearchPage />);
    expect(await screen.findByText('23 results')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Search' });
    expect(within(list).getAllByRole('link')).toHaveLength(20);
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Search' })).getAllByRole('link'),
      ).toHaveLength(3),
    );
    expect(test.shell.navigations.at(-1)).toMatchObject({ path: '/search?q=orbit&page=2' });
    // A typed filter narrows the results.
    const input = screen.getByRole('searchbox', { name: 'Search the workspace' });
    fireEvent.change(input, { target: { value: 'orbit tag:odd' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('12 results')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /^Mission 1(?!\d)/ }));
    expect(test.shell.navigations.at(-1)?.pageId).toBeTruthy();
  });

  it('explains the syntax when empty and offers to create a page when nothing matches', async () => {
    const test = await setup();
    window.history.replaceState(null, '', '/search');
    test.renderInApp(<SearchPage />);
    expect(screen.getByText('Search your workspace')).toBeTruthy();
    expect(screen.getByText('tag:space')).toBeTruthy();
    const input = screen.getByRole('searchbox', { name: 'Search the workspace' });
    fireEvent.change(input, { target: { value: 'nothing here' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('No matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create page “nothing here”' }));
    expect(
      test.ctx.workspace.pages
        .getSnapshot()
        .all()
        .some((page) => page.title === 'nothing here'),
    ).toBe(true);
  });
});
