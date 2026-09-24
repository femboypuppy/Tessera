import { build as b } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import { Decoration, type DecorationSet } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestEditor } from '../test-utils';
import { CodeHighlight, codeHighlightKey, loadHighlighter } from './highlight';

const cleanups: Array<() => void> = [];

beforeAll(async () => {
  await loadHighlighter();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(...blocks: Parameters<typeof b.doc>) {
  const result = createTestEditor({ content: b.doc(...blocks), extra: [CodeHighlight] });
  cleanups.push(result.destroy);
  return result.editor;
}

function decorations(editor: Editor): Decoration[] {
  const set = codeHighlightKey.getState(editor.state) as DecorationSet;
  return set.find();
}

/** The highlighted spans as `text:class` pairs, in document order. */
function spans(editor: Editor): string[] {
  return decorations(editor)
    .sort((a, c) => a.from - c.from)
    .map((decoration) => {
      const text = editor.state.doc.textBetween(decoration.from, decoration.to);
      const attrs = (decoration as unknown as { type: { attrs: { class?: string } } }).type.attrs;
      return `${text}:${attrs.class ?? ''}`;
    });
}

/** Position of the end of the top-level block at `index`'s text. */
function endOf(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize;
  return pos + editor.state.doc.child(index).nodeSize - 1;
}

describe('code highlighting', () => {
  it('highlights code blocks by language', () => {
    const editor = setup(b.codeBlock('const x = 1;', 'js'));
    expect(spans(editor)).toEqual(expect.arrayContaining(['const:hljs-keyword', '1:hljs-number']));
  });

  it('leaves code blocks alone when typing elsewhere', () => {
    const editor = setup(b.codeBlock('const x = 1;', 'js'), b.paragraph('Notes'));
    const before = spans(editor);
    const created = vi.spyOn(Decoration, 'inline');
    try {
      editor.commands.insertContentAt(endOf(editor, 1), ' and more');
      editor.commands.insertContentAt(1, '// ');
      // Only the edited code block was decorated again; the edit after it created nothing.
      expect(created).toHaveBeenCalledTimes(spans(editor).length);
      created.mockClear();
      editor.commands.insertContentAt(endOf(editor, 1), '!');
      expect(created).not.toHaveBeenCalled();
    } finally {
      created.mockRestore();
    }
    expect(before).toContain('const:hljs-keyword');
  });

  it('highlights again what changed inside a code block', () => {
    const editor = setup(b.paragraph('Intro'), b.codeBlock('let x = 1;', 'js'));
    expect(spans(editor)).toContain('let:hljs-keyword');
    // Replace "1" with "'one'": the number becomes a string.
    const end = endOf(editor, 1);
    editor.commands.insertContentAt({ from: end - 2, to: end - 1 }, "'one'");
    expect(editor.state.doc.child(1).textContent).toBe("let x = 'one';");
    expect(spans(editor)).toEqual(
      expect.arrayContaining(['let:hljs-keyword', "'one':hljs-string"]),
    );
    expect(spans(editor).some((span) => span.endsWith('hljs-number'))).toBe(false);
  });

  it('highlights a code block added later, and forgets a removed one', () => {
    const editor = setup(b.paragraph('Intro'));
    expect(decorations(editor)).toHaveLength(0);
    editor.commands.insertContentAt(endOf(editor, 0) + 1, {
      type: 'codeBlock',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: 'def launch(): return True' }],
    });
    expect(spans(editor)).toEqual(
      expect.arrayContaining(['def:hljs-keyword', 'True:hljs-literal']),
    );
    editor.commands.deleteRange({ from: endOf(editor, 0) + 1, to: editor.state.doc.content.size });
    expect(decorations(editor)).toHaveLength(0);
  });

  it('follows a change of language', () => {
    const editor = setup(b.codeBlock('SELECT 1', null));
    expect(decorations(editor)).toHaveLength(0);
    editor.commands.updateAttributes('codeBlock', { language: 'sql' });
    expect(spans(editor)).toContain('SELECT:hljs-keyword');
  });
});
