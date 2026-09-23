import {
  listRows,
  listViews,
  type BlockRendererProps,
  type EmbedInsert,
  type JsonValue,
} from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { TooltipProvider } from '@tessera/ui';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_COMMANDS, databasesFeature } from './index';

let test: TestAppContext | null = null;

beforeEach(() => {
  // jsdom lays nothing out; give elements a size so the virtualized table renders its rows.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await test?.dispose();
  test = null;
});

async function setup(): Promise<TestAppContext> {
  test = await createTestAppContext({ features: [databasesFeature] });
  return test;
}

/**
 * Renders an embed the way the editor does: it resolves the kind's renderer, passes the node's
 * attributes and applies `updateData` to them.
 */
function EditorEmbed({ insert, pageId }: { insert: EmbedInsert; pageId: string }) {
  const { ctx } = test ?? {};
  const [data, setData] = useState<JsonValue | null>(insert.data ?? null);
  const registration = ctx?.blocks.resolve(insert.kind);
  if (!ctx || !registration) return <p>This block needs a plugin</p>;
  const Component = registration.component;
  const props: BlockRendererProps = {
    kind: insert.kind,
    ref: insert.ref ?? null,
    data,
    blockId: 'block-1',
    pageId,
    selected: false,
    readOnly: false,
    updateData: setData,
    updateAttrs: (patch) => {
      if (patch.data !== undefined) setData(patch.data);
    },
    deleteBlock: () => undefined,
  };
  return (
    <AppContextProvider value={ctx}>
      <TooltipProvider>
        <output data-testid="embed-data">{JSON.stringify(data)}</output>
        <Suspense fallback={<p>Loading</p>}>
          <Component {...props} />
        </Suspense>
      </TooltipProvider>
    </AppContextProvider>
  );
}

describe('databases feature', () => {
  it('registers its bodies, sections, the database embed and commands', async () => {
    const { ctx } = await setup();
    expect(ctx.contributions.list('pageBodies').map((body) => body.kind)).toContain('database');
    expect(ctx.contributions.list('pageTopSections').map((section) => section.id)).toEqual(
      expect.arrayContaining(['databases.rowProperties', 'databases.linkedFrom']),
    );
    expect(ctx.blocks.resolve('database')?.label).toBe('Database');
    expect(ctx.blocks.slashMenuItems().map((item) => item.title)).toEqual([
      'Database – inline',
      'Linked view of database',
    ]);
    const commands = ctx.commands.list().map((command) => command.id);
    expect(commands).toEqual(expect.arrayContaining(Object.values(DATABASE_COMMANDS)));
  });

  it(
    'inserts an inline database from the slash menu and edits it in the page',
    { timeout: 60_000 },
    async () => {
      const { ctx } = await setup();
      const page = ctx.workspace.createPage({ title: 'Team handbook' });
      const inline = ctx.blocks.slashMenuItems().find((item) => item.id === 'databases.inline');
      if (!inline) throw new Error('missing slash item');

      const insert = await inline.create({ app: ctx, pageId: page.id });
      if (!insert?.ref) throw new Error('the slash item created nothing');
      expect(insert.kind).toBe('database');
      // The new database lives under the page, like Notion's inline databases.
      const database = ctx.workspace.getPage(insert.ref);
      expect(database?.kind).toBe('database');
      expect(database?.parentId).toBe(page.id);

      const user = userEvent.setup();
      render(<EditorEmbed insert={insert} pageId={page.id} />);
      const grid = await screen.findByRole('grid', {}, { timeout: 20_000 });

      // Add a row from the embed and type its title.
      await user.click(within(grid).getByRole('button', { name: 'New' }));
      const editor = await screen.findByRole('textbox', { name: /^Edit / });
      await user.type(editor, 'Onboarding checklist{Enter}');

      const handle = await ctx.loadDatabaseDoc(insert.ref);
      await waitFor(() => expect(listRows(handle.doc)).toHaveLength(1));
      const [row] = listRows(handle.doc);
      await waitFor(() =>
        expect(ctx.workspace.getPage(row?.id ?? '')?.title).toBe('Onboarding checklist'),
      );

      // Switching views from the embed stores the choice in the block's data, not the database.
      await user.click(screen.getByRole('button', { name: 'Add a view' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Board' }));
      const board = listViews(handle.doc).find((view) => view.type === 'board');
      expect(board).toBeDefined();
      await waitFor(() =>
        expect(screen.getByTestId('embed-data').textContent).toBe(
          JSON.stringify({ viewId: board?.id }),
        ),
      );
      handle.release();
    },
  );

  it(
    'shows a helpful state for an embed whose database is missing',
    { timeout: 30_000 },
    async () => {
      await setup();
      render(<EditorEmbed insert={{ kind: 'database', ref: null, data: null }} pageId="page" />);
      expect(
        await screen.findByText('This database no longer exists', {}, { timeout: 10_000 }),
      ).toBeInTheDocument();
    },
  );

  it('cleans up relation values when a page is deleted for good', { timeout: 30_000 }, async () => {
    const { ctx, flush } = await setup();
    const { createDatabase, addDatabaseProperty, addRow, setCell } =
      await import('@tessera/db-views/operations');
    const { page: tasks } = await createDatabase(ctx, { title: 'Tasks' });
    const people = ctx.workspace.createPage({ title: 'Ada' });
    const handle = await ctx.loadDatabaseDoc(tasks.id);
    const ref = { id: tasks.id, doc: handle.doc };
    const owner = addDatabaseProperty(ref, { type: 'relation', name: 'Owner' });
    const row = await addRow(ctx, ref, { title: 'Write the brief' });
    await setCell(ctx, ref, row.id, owner, [people.id]);
    expect(listRows(handle.doc)[0]?.values[owner.id]).toEqual([people.id]);

    await act(async () => {
      await ctx.workspace.deletePagePermanently(people.id);
      await flush();
    });
    await waitFor(() => expect(listRows(handle.doc)[0]?.values[owner.id] ?? []).toEqual([]), {
      timeout: 10_000,
    });
    handle.release();
  });
});
