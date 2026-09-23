// @vitest-environment jsdom
import '../testing/setup-dom';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { defineFeature } from '../runtime/feature';
import { createTestAppContext } from '../testing/index';
import {
  AppContextProvider,
  useAncestors,
  useAppContext,
  useCommands,
  useContributions,
  useCurrentUser,
  useDatabaseDoc,
  useEvent,
  useOptionalAppContext,
  usePage,
  usePageDoc,
  usePageTree,
  useSetting,
  useSyncStatus,
} from './index';

async function setup(
  features = [defineFeature({ id: 'demo', topBarItems: [{ id: 'item', component: () => null }] })],
) {
  const test = await createTestAppContext({ features });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppContextProvider value={test.ctx}>{children}</AppContextProvider>
  );
  return { ...test, wrapper };
}

describe('React bindings', () => {
  it('requires a provider', () => {
    expect(() => renderHook(() => useAppContext())).toThrow('useAppContext');
    expect(renderHook(() => useOptionalAppContext()).result.current).toBeNull();
  });

  it('re-renders page consumers on changes', async () => {
    const { ctx, wrapper, dispose } = await setup();
    const parent = ctx.workspace.createPage({ title: 'Parent' });
    const child = ctx.workspace.createPage({ title: 'Child', parentId: parent.id });
    function Tree() {
      const tree = usePageTree();
      const page = usePage(child.id);
      const ancestors = useAncestors(child.id);
      return (
        <div>
          <span data-testid="roots">{tree.map((node) => node.page.title).join(',')}</span>
          <span data-testid="title">{page?.title}</span>
          <span data-testid="crumbs">{ancestors.map((p) => p.title).join('/')}</span>
        </div>
      );
    }
    render(<Tree />, { wrapper });
    expect(screen.getByTestId('roots')).toHaveTextContent('Parent');
    expect(screen.getByTestId('crumbs')).toHaveTextContent('Parent');
    act(() => {
      ctx.workspace.renamePage(child.id, 'Renamed');
      ctx.workspace.createPage({ title: 'Second' });
    });
    expect(screen.getByTestId('title')).toHaveTextContent('Renamed');
    expect(screen.getByTestId('roots')).toHaveTextContent('Parent,Second');
    await dispose();
  });

  it('holds doc leases while mounted', async () => {
    const { ctx, wrapper, dispose } = await setup();
    const page = ctx.workspace.createPage({ title: 'Doc' });
    const { page: database } = await ctx.workspace.createDatabase({
      title: 'DB',
      titlePropertyName: 'Name',
      viewName: 'Table',
    });
    const { result, unmount } = renderHook(
      () => ({
        page: usePageDoc(page.id),
        db: useDatabaseDoc(database.id),
        none: usePageDoc(null),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.page.loaded).toBe(true));
    await waitFor(() => expect(result.current.db.loaded).toBe(true));
    expect(result.current.page.handle?.docName).toBe(`page:${page.id}`);
    expect(result.current.none).toEqual({ handle: null, loaded: false, error: null });
    const status = renderHook(() => useSyncStatus(result.current.page.handle?.sync), { wrapper });
    expect(status.result.current).toEqual({ status: 'local' });
    unmount();
    await dispose();
  });

  it('reads and writes settings, commands, contributions, events and the user', async () => {
    const { ctx, runtime, wrapper, dispose } = await setup();
    const seen: string[] = [];
    const { result } = renderHook(
      () => {
        useEvent('page.created', ({ page }) => seen.push(page.title));
        return {
          setting: useSetting(ctx.settings.device, 'editor.fullWidth', false),
          commands: useCommands(),
          items: useContributions('topBarItems'),
          user: useCurrentUser(),
        };
      },
      { wrapper },
    );
    expect(result.current.setting[0]).toBe(false);
    act(() => result.current.setting[1](true));
    expect(result.current.setting[0]).toBe(true);
    expect(ctx.settings.device.get('editor.fullWidth')).toBe(true);
    expect(result.current.items.map((item) => [item.id, item.featureId])).toEqual([
      ['item', 'demo'],
    ]);
    act(() => {
      ctx.commands.register({ id: 'x.y', title: 'XY', run: () => undefined });
    });
    expect(result.current.commands.map((c) => c.id)).toEqual(['x.y']);
    act(() => {
      ctx.workspace.createPage({ title: 'Evented' });
      runtime.updateCurrentUser({ name: 'Katherine' });
    });
    expect(seen).toEqual(['Evented']);
    expect(result.current.user.name).toBe('Katherine');
    await dispose();
  });
});
