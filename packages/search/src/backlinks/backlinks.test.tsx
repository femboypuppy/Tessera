import { readDocJSON, type UnlinkedMention } from '@tessera/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { b, createIndexedContext, type IndexedTestContext } from '../test-utils';
import BacklinksPanel from './panel';
import { groupBySource, linkMention, mentionRange } from './shared';

const open: IndexedTestContext[] = [];
async function setup() {
  const test = await createIndexedContext();
  open.push(test);
  return test;
}
afterEach(async () => {
  for (const test of open.splice(0)) await test.dispose();
});

function mention(text: string, blockText: string, from: number): UnlinkedMention {
  return {
    sourcePageId: 's',
    targetPageId: 't',
    path: [0],
    from,
    to: from + text.length,
    text,
    blockText,
  };
}

describe('backlinks helpers', () => {
  it('finds the n-th whole-word occurrence of a mention in its block', () => {
    const blockText = 'Europa, then europa again, not Europan.';
    const first = mention('Europa', blockText, 0);
    const second = mention('europa', blockText, 13);
    expect(mentionRange(first, [first, second])).toEqual({ start: 0, end: 6 });
    expect(mentionRange(second, [first, second])).toEqual({ start: 13, end: 19 });
  });

  it('groups by source page in order', () => {
    const groups = groupBySource([
      { sourcePageId: 'a', n: 1 },
      { sourcePageId: 'b', n: 2 },
      { sourcePageId: 'a', n: 3 },
    ]);
    expect(groups.map((group) => [group.sourcePageId, group.items.map((item) => item.n)])).toEqual([
      ['a', [1, 3]],
      ['b', [2]],
    ]);
  });

  it('links a mention, offers undo, and refuses stale mentions', async () => {
    const test = await setup();
    const target = test.ctx.workspace.createPage({ title: 'Europa' });
    const source = test.ctx.workspace.createPage({ title: 'Moons' });
    await test.write(source.id, b.doc(b.paragraph('The ocean under Europa is warm.')));
    const [found] = await test.links.unlinkedMentions(target.id);
    if (!found) throw new Error('expected a mention');
    expect(await linkMention(test.ctx, found, { id: target.id, title: 'Europa' })).toBe(true);
    const handle = await test.ctx.loadPageDoc(source.id);
    expect(JSON.stringify(readDocJSON(handle.doc))).toContain(target.id);
    const toast = test.shell.toasts.at(-1);
    expect(toast?.title).toBe('Linked “Europa” in Moons');
    toast?.action?.onClick();
    expect(JSON.stringify(readDocJSON(handle.doc))).not.toContain(target.id);
    expect(JSON.stringify(readDocJSON(handle.doc))).toContain('The ocean under Europa is warm.');
    handle.release();
    // The same (now stale) mention against edited text is refused with a message.
    await test.write(source.id, b.doc(b.paragraph('Rewritten entirely.')));
    expect(await linkMention(test.ctx, found, { id: target.id, title: 'Europa' })).toBe(false);
    expect(test.shell.toasts.at(-1)?.variant).toBe('warning');
  });
});

describe('BacklinksPanel', () => {
  it('shows linked references with context and links unlinked mentions', async () => {
    const test = await setup();
    const target = test.ctx.workspace.createPage({ title: 'Apollo' });
    const linker = test.ctx.workspace.createPage({ title: 'Notes' });
    const mentioner = test.ctx.workspace.createPage({ title: 'Journal' });
    await test.write(
      linker.id,
      b.doc(b.paragraph('We followed ', b.pageLink(target.id), ' closely.')),
    );
    await test.write(mentioner.id, b.doc(b.paragraph('Apollo landed on the moon.')));
    test.renderInApp(<BacklinksPanel pageId={target.id} page={target} close={() => undefined} />);
    const references = await screen.findByRole('region', { name: /Linked references/ });
    expect(
      await within(references).findByRole('button', { name: /We followed Apollo closely/ }),
    ).toBeTruthy();
    const mentions = screen.getByRole('region', { name: /Unlinked mentions/ });
    const link = await within(mentions).findByRole('button', {
      name: 'Link this mention of Apollo in Journal',
    });
    fireEvent.click(link);
    await waitFor(() =>
      expect(within(mentions).queryByRole('button', { name: /Link this mention/ })).toBeNull(),
    );
    await test.flush();
    await test.links.whenIdle();
    await waitFor(async () =>
      expect(
        (await test.links.backlinks(target.id)).map((link) => link.sourcePageId).sort(),
      ).toEqual([linker.id, mentioner.id].sort()),
    );
  });

  it('asks for a page when none is open', async () => {
    const test = await setup();
    test.renderInApp(<BacklinksPanel pageId={null} page={null} close={() => undefined} />);
    expect(screen.getByText('Open a page to see what links to it.')).toBeTruthy();
  });
});
