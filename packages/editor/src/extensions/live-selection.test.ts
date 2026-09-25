import { build as b } from '@tessera/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockTexts, createTestEditor, pressKey } from '../test-utils';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
});

/** "Notes" then "Title", focused, with the caret at the start of "Title". */
function setup() {
  const result = createTestEditor({ content: b.doc(b.paragraph('Notes'), b.paragraph('Title')) });
  cleanups.push(result.destroy);
  const { editor } = result;
  editor.view.focus();
  editor.commands.setTextSelection(8);
  const title = editor.view.dom.querySelectorAll('p')[1]?.firstChild;
  if (!title) throw new Error('No "Title" text node');
  return { ...result, title };
}

describe('LiveSelection', () => {
  it('runs a key at the caret the browser moved, before the browser reports the move', () => {
    const { editor, title } = setup();
    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.state.selection.$head.parentOffset).toBe(0);
    // End moved the caret; its selectionchange event hasn't arrived when Enter is handled.
    document.getSelection()?.collapse(title, 5);
    expect(editor.state.selection.$head.parentOffset).toBe(0);
    pressKey(editor, 'Enter');
    expect(blockTexts(editor)).toEqual(['paragraph:Notes', 'paragraph:Title', 'paragraph:']);
    expect(editor.state.selection.$head.parent.textContent).toBe('');
  });

  it('carries a range the browser extended to the key (Shift+End, then Backspace)', () => {
    const { editor, title } = setup();
    document.getSelection()?.setBaseAndExtent(title, 0, title, 3);
    pressKey(editor, 'Backspace');
    expect(blockTexts(editor)).toEqual(['paragraph:Notes', 'paragraph:le']);
  });

  it('leaves the selection alone when the editor already has the caret', () => {
    const { editor } = setup();
    const dispatch = vi.spyOn(document, 'dispatchEvent');
    const transactions = vi.fn();
    editor.on('transaction', transactions);
    pressKey(editor, 'ArrowRight');
    expect(dispatch).not.toHaveBeenCalled();
    expect(transactions).not.toHaveBeenCalled();
  });
});
