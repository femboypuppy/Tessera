import { build as b, getPageProp, writeDocJSON } from '@tessera/core';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyPageMarkdown, countText, showWordCount, togglePageDisplay } from './commands';

let app: TestAppContext;

beforeEach(async () => {
  app = await createTestAppContext();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.dispose();
});

async function pageWith(content: ReturnType<typeof b.doc>): Promise<string> {
  const page = app.ctx.workspace.createPage({ title: 'Notes' });
  const handle = await app.ctx.loadPageDoc(page.id);
  writeDocJSON(handle.doc, content);
  handle.release();
  return page.id;
}

describe('countText', () => {
  it('counts words and characters (graphemes, without line breaks)', () => {
    expect(countText('')).toEqual({ words: 0, characters: 0 });
    expect(countText('Hello, world!')).toEqual({ words: 2, characters: 13 });
    expect(countText('One\ntwo')).toEqual({ words: 2, characters: 6 });
    expect(countText('👩‍🚀 launch')).toEqual({ words: 1, characters: 8 });
  });
});

describe('editor commands', () => {
  it('shows the word and character count of the page', async () => {
    const pageId = await pageWith(b.doc(b.heading(1, 'Apollo'), b.paragraph('To the moon')));
    await showWordCount(app.ctx, pageId);
    expect(app.shell.toasts.at(-1)?.title).toBe('4 words, 17 characters');
  });

  it('copies the page as markdown through the codec', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const pageId = await pageWith(b.doc(b.heading(1, 'Apollo'), b.paragraph('To the moon')));
    await copyPageMarkdown(app.ctx, pageId);
    expect(writeText).toHaveBeenCalledWith('# Apollo\n\nTo the moon\n');
    expect(app.shell.toasts.at(-1)?.title).toBe('Copied the page as markdown');
    vi.unstubAllGlobals();
  });

  it('reports a clipboard failure', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    const pageId = await pageWith(b.doc(b.paragraph('x')));
    await copyPageMarkdown(app.ctx, pageId);
    expect(app.shell.toasts.at(-1)).toMatchObject({ variant: 'error' });
    vi.unstubAllGlobals();
  });

  it('toggles full width and small text as page props', async () => {
    const pageId = await pageWith(b.doc(b.paragraph('x')));
    await togglePageDisplay(app.ctx, pageId, 'fullWidth');
    await togglePageDisplay(app.ctx, pageId, 'smallText');
    const handle = await app.ctx.loadPageDoc(pageId);
    expect(getPageProp(handle.doc, 'fullWidth')).toBe(true);
    expect(getPageProp(handle.doc, 'smallText')).toBe(true);
    handle.release();
    await togglePageDisplay(app.ctx, pageId, 'fullWidth');
    const again = await app.ctx.loadPageDoc(pageId);
    expect(getPageProp(again.doc, 'fullWidth')).toBe(false);
    again.release();
    expect(app.shell.toasts.map((toast) => toast.title)).toEqual([
      'Full width on',
      'Small text on',
      'Full width off',
    ]);
  });
});
