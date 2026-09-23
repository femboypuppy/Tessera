import { build as b } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor } from '../test-utils';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(...blocks: Parameters<typeof b.doc>): Editor {
  const result = createTestEditor({ content: b.doc(...blocks) });
  cleanups.push(result.destroy);
  return result.editor;
}

/** `tag:placeholder` for each element showing a placeholder, in document order. */
function placeholders(editor: Editor): string[] {
  return [...editor.view.dom.querySelectorAll('.tess-placeholder')].map(
    (element) =>
      `${element.tagName.toLowerCase()}:${element.getAttribute('data-placeholder') ?? ''}`,
  );
}

describe('placeholders', () => {
  it('names empty headings and toggle summaries', () => {
    const editor = setup(
      b.heading(1),
      b.paragraph('Body'),
      b.heading(2, 'Filled'),
      b.toggle([], [b.paragraph('Inside')], { open: true }),
    );
    expect(placeholders(editor)).toEqual(['h1:Heading 1', 'div:Toggle']);
  });

  it('updates as headings fill and empty, without touching the others', () => {
    const editor = setup(b.heading(1), b.paragraph('Body'), b.heading(3));
    expect(placeholders(editor)).toEqual(['h1:Heading 1', 'h3:Heading 3']);
    editor.commands.insertContentAt(1, 'Launch');
    expect(placeholders(editor)).toEqual(['h3:Heading 3']);
    editor.commands.deleteRange({ from: 1, to: 7 });
    expect(placeholders(editor)).toEqual(['h1:Heading 1', 'h3:Heading 3']);
    // A heading that becomes a paragraph loses its placeholder.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.setParagraph();
    expect(placeholders(editor)).toEqual(['h1:Heading 1']);
  });

  it('shows how to insert blocks on the focused empty paragraph', () => {
    const editor = setup(b.paragraph('Body'), b.paragraph());
    expect(placeholders(editor)).toEqual([]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    // jsdom doesn't focus contenteditable elements, so the focus event is sent directly.
    editor.view.dom.dispatchEvent(new FocusEvent('focus'));
    expect(placeholders(editor)).toEqual(['p:Type ‘/’ for commands']);
    editor.commands.insertContent('x');
    expect(placeholders(editor)).toEqual([]);
  });
});
