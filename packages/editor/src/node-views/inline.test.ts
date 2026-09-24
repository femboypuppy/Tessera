import { build as b, COMMANDS } from '@tessera/core';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditorController, type EditorController } from '../react/controller';
import { createTestEditor } from '../test-utils';
import { createNodeViews } from './index';
import { pageLinkDisplay } from './inline';

let app: TestAppContext;
let controller: EditorController;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
  app = await createTestAppContext();
  controller = createEditorController(app.ctx, 'host');
});

afterEach(async () => {
  while (cleanups.length) cleanups.pop()?.();
  await app.dispose();
});

function render(content: ReturnType<typeof b.doc>) {
  const result = createTestEditor({ content, nodeViews: createNodeViews(controller) });
  controller.editor = result.editor;
  cleanups.push(result.destroy);
  return result;
}

describe('pageLinkDisplay', () => {
  const page = { id: 'p1', title: 'Apollo', icon: '🚀' } as never;
  it('shows the current title, the label, or title › heading', () => {
    expect(pageLinkDisplay({}, page, false)).toEqual({ text: 'Apollo', icon: '🚀', state: 'ok' });
    expect(pageLinkDisplay({ label: 'the mission' }, page, false).text).toBe('the mission');
    expect(pageLinkDisplay({ heading: 'Crew' }, page, false).text).toBe('Apollo › Crew');
  });
  it('flags missing and trashed targets', () => {
    expect(pageLinkDisplay({}, undefined, false)).toMatchObject({
      text: 'Missing page',
      state: 'missing',
    });
    expect(pageLinkDisplay({}, page, true).state).toBe('trashed');
  });
});

describe('page link node view', () => {
  it('renders the live title and follows renames, trash and deletion', async () => {
    const target = app.ctx.workspace.createPage({ title: 'Mission control' });
    const { element } = render(b.doc(b.paragraph('See ', b.pageLink(target.id))));
    const link = element.querySelector<HTMLElement>('.tess-page-link');
    expect(link?.textContent).toBe('Mission control');
    expect(link?.getAttribute('href')).toBe(`/p/${target.id}`);

    app.ctx.workspace.renamePage(target.id, 'Mission control center');
    expect(link?.textContent).toBe('Mission control center');

    app.ctx.workspace.trashPage(target.id);
    expect(link?.dataset.broken).toBe('trashed');
    expect(link?.getAttribute('aria-label')).toBe('Mission control center (in trash)');

    await app.ctx.workspace.deletePagePermanently(target.id);
    expect(link?.dataset.broken).toBe('missing');
    expect(link?.textContent).toBe('Missing page');
  });

  it('navigates on click, with heading and block targets', () => {
    const target = app.ctx.workspace.createPage({ title: 'Plan' });
    const { element } = render(
      b.doc(b.paragraph(b.pageLink(target.id, { heading: 'Crew', blockRef: 'step-1' }))),
    );
    element
      .querySelector<HTMLElement>('.tess-page-link')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(app.shell.navigations.at(-1)).toEqual({
      pageId: target.id,
      options: { heading: 'Crew', blockId: 'step-1' },
    });
  });
});

describe('tag node view', () => {
  it('runs a search for the tag, or says search is unavailable', async () => {
    const { element } = render(b.doc(b.paragraph(b.tag('apollo'))));
    const tag = element.querySelector<HTMLElement>('.tess-tag');
    expect(tag?.textContent).toBe('#apollo');
    tag?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.shell.toasts.at(-1)?.title).toBe('Search isn’t available in this build yet');

    const queries: unknown[] = [];
    app.ctx.commands.register({
      id: COMMANDS.search,
      title: 'Search',
      run: ({ args }) => {
        queries.push(args);
      },
    });
    tag?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queries).toEqual([{ query: '#apollo' }]);
  });
});

describe('callout, toggle and code block views', () => {
  it('render their controls around editable content', () => {
    const { element, editor } = render(
      b.doc(
        b.callout({ emoji: '⚠️', tone: 'warning' }, b.paragraph('Careful')),
        b.toggle(['Summary'], [b.paragraph('Hidden')], { open: false }),
        b.codeBlock('const x = 1;', 'typescript'),
      ),
    );
    const callout = element.querySelector<HTMLElement>('.tess-callout');
    expect(callout?.dataset.tone).toBe('warning');
    expect(callout?.querySelector('.tess-callout-emoji')?.textContent).toBe('⚠️');

    const toggle = element.querySelector<HTMLElement>('.tess-toggle');
    const button = toggle?.querySelector<HTMLButtonElement>('.tess-toggle-button');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    button?.click();
    expect(editor.state.doc.child(1).attrs.open).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    const code = element.querySelector<HTMLElement>('.tess-code-block');
    expect(code?.querySelector('.tess-code-language')?.textContent).toBe('TypeScript');
  });

  it('keeps toggling local on read-only pages', () => {
    const { element, editor } = render(b.doc(b.toggle(['Summary'], [b.paragraph('Hidden')])));
    editor.setEditable(false);
    element.querySelector<HTMLButtonElement>('.tess-toggle-button')?.click();
    expect(editor.state.doc.firstChild?.attrs.open).toBe(false);
    expect(element.querySelector<HTMLElement>('.tess-toggle')?.dataset.open).toBe('true');
  });
});
