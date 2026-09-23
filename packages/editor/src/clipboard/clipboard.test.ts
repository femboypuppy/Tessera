import { build as b, type AppContext, type DocJSON } from '@tessera/core';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import type { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditorController, type EditorController } from '../react/controller';
import { blockTexts, createTestEditor } from '../test-utils';
import { clipboard, isEditorHTML, sanitizeHTML } from './clipboard';
import { FakeRichCodec } from './fake-codec';

let app: TestAppContext;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
  app = await createTestAppContext();
});

afterEach(async () => {
  while (cleanups.length) cleanups.pop()?.();
  await app.dispose();
});

/** The app context with the richer codec in place of the stub. */
function withRichCodec(ctx: AppContext): AppContext {
  return { ...ctx, services: { ...ctx.services, markdownCodec: new FakeRichCodec() } };
}

function setup(content: DocJSON, options: { rich?: boolean } = {}) {
  const ctx = options.rich === false ? app.ctx : withRichCodec(app.ctx);
  const controller: EditorController = createEditorController(ctx, 'host');
  const result = createTestEditor({ content, extra: clipboard(controller) });
  controller.editor = result.editor;
  cleanups.push(result.destroy);
  return result.editor;
}

function copyText(editor: Editor): string {
  const { view } = editor;
  const slice = view.state.selection.content();
  const text = view.someProp('clipboardTextSerializer', (serialize) => serialize(slice, view));
  return text ?? '';
}

function paste(editor: Editor, data: Record<string, string>): boolean {
  const event = {
    clipboardData: { getData: (type: string) => data[type] ?? '' },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = editor;
  return !!view.someProp('handlePaste', (handler) => handler(view, event, Slice.empty));
}

describe('copy', () => {
  it('puts markdown from the codec on the clipboard', () => {
    const editor = setup(
      b.doc(
        b.heading(1, 'Launch'),
        b.bulletList('One', 'Two'),
        b.paragraph('Some ', b.text('bold', b.mark.bold())),
      ),
    );
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(copyText(editor)).toBe('# Launch\n\n- One\n- Two\n\nSome **bold**\n');
  });

  it('copies part of a line without a trailing line break', () => {
    const editor = setup(b.doc(b.paragraph('Hello world')));
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    );
    expect(copyText(editor)).toBe('Hello');
  });

  it('names linked pages by their current title', () => {
    const page = app.ctx.workspace.createPage({ title: 'Mission control' });
    const editor = setup(b.doc(b.paragraph('See ', b.pageLink(page.id))));
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(copyText(editor)).toBe('See [[Mission control]]');
  });
});

describe('paste', () => {
  it('turns pasted markdown into blocks through the codec', () => {
    const target = app.ctx.workspace.createPage({ title: 'Apollo' });
    const editor = setup(b.doc(b.paragraph()));
    const markdown = [
      '# Plan',
      '',
      '- first',
      '- second',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '> quoted',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      'See **this** and [[apollo]].',
    ].join('\n');
    expect(paste(editor, { 'text/plain': markdown })).toBe(true);
    expect(blockTexts(editor)).toEqual([
      'heading:Plan',
      'bulletList:firstsecond',
      'taskList:donetodo',
      'blockquote:quoted',
      'codeBlock:const x = 1;',
      'paragraph:See this and .',
    ]);
    const last = editor.state.doc.lastChild;
    let linked: unknown = null;
    last?.descendants((node) => {
      if (node.type.name === 'pageLink') linked = node.attrs.pageId;
    });
    expect(linked).toBe(target.id);
  });

  it('merges a pasted line into the paragraph with the caret', () => {
    const editor = setup(b.doc(b.paragraph('Hello world')));
    editor.commands.setTextSelection(7);
    paste(editor, { 'text/plain': 'big **bold** ' });
    expect(blockTexts(editor)).toEqual(['paragraph:Hello big bold world']);
  });

  it('turns HTML from other apps into blocks, sanitized, never raw HTML', () => {
    const editor = setup(b.doc(b.paragraph()));
    const html =
      '<h2>Notes</h2><p>From <b>Google Docs</b> <img src=x onerror="alert(1)"><script>alert(2)</script></p>' +
      '<ul><li>alpha</li><li>beta</li></ul><p><a href="javascript:alert(3)">bad link</a></p>';
    expect(paste(editor, { 'text/html': html, 'text/plain': 'Notes' })).toBe(true);
    expect(blockTexts(editor)).toEqual([
      'heading:Notes',
      'paragraph:From Google Docs ',
      'bulletList:alphabeta',
      'paragraph:bad link',
    ]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain('script');
    expect(json).not.toContain('javascript:');
    expect(json).not.toContain('onerror');
  });

  it('leaves HTML from a Tessera editor to ProseMirror, which keeps every block', () => {
    const editor = setup(b.doc(b.paragraph()));
    const html =
      '<div data-pm-slice="0 0 []"><div data-type="toggle"><div data-type="toggle-summary">T</div></div></div>';
    expect(isEditorHTML(html)).toBe(true);
    expect(paste(editor, { 'text/html': html })).toBe(false);
  });

  it('pastes plain text as is inside code blocks', () => {
    const editor = setup(b.doc(b.codeBlock('x')));
    editor.commands.setTextSelection(2);
    expect(paste(editor, { 'text/plain': '# not a heading' })).toBe(false);
  });

  it('works with the stub codec too (paragraphs and headings)', () => {
    const editor = setup(b.doc(b.paragraph()), { rich: false });
    paste(editor, { 'text/plain': '# Title\n\nFirst paragraph\n\nSecond' });
    expect(blockTexts(editor)).toEqual([
      'heading:Title',
      'paragraph:First paragraph',
      'paragraph:Second',
    ]);
  });
});

describe('sanitizeHTML', () => {
  it('drops scripts, handlers, styles and unsafe URLs', () => {
    const clean = sanitizeHTML(
      '<p style="color:red" onclick="x()">Hi<script>bad()</script><iframe src="https://x"></iframe></p><a href="javascript:x">l</a>',
    );
    expect(clean).not.toMatch(/script|onclick|iframe|style=|javascript:/);
    expect(clean).toContain('Hi');
  });
});
