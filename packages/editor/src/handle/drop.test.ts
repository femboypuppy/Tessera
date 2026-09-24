import { build as b } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor } from '../test-utils';
import { blockAtY } from './drop';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const LINE = 20;

/**
 * jsdom has no layout, so this stacks the blocks: every textblock or atom is one 20 px line, and a
 * container is as tall as what it shows (a closed toggle only its summary; what it hides is 0×0).
 */
function layOut(editor: Editor): void {
  const { view } = editor;
  const place = (node: PMNode, pos: number, top: number, hidden: boolean): number => {
    let height = 0;
    if (node.isTextblock || node.isAtom) height = LINE;
    else {
      const closed = node.type.name === 'toggle' && node.attrs.open !== true;
      let childTop = top;
      node.forEach((child, offset, index) => {
        const childHidden = hidden || (closed && index > 0);
        const used = place(child, pos + 1 + offset, childTop, childHidden);
        childTop += used;
      });
      height = childTop - top;
    }
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      const rect = hidden ? new DOMRect(0, 0, 0, 0) : new DOMRect(40, top, 600, height);
      dom.getBoundingClientRect = () => rect;
    }
    return hidden ? 0 : height;
  };
  let top = 100;
  editor.state.doc.forEach((node, offset) => {
    top += place(node, offset, top, false);
  });
}

function setup(...blocks: Parameters<typeof b.doc>): Editor {
  const result = createTestEditor({ content: b.doc(...blocks) });
  cleanups.push(result.destroy);
  layOut(result.editor);
  return result.editor;
}

/** The block at a height, as `type:text`. */
function at(editor: Editor, y: number): string | null {
  const block = blockAtY(editor.view, y);
  return block ? `${block.node.type.name}:${block.node.textContent}` : null;
}

describe('blockAtY', () => {
  it('finds top-level blocks by height, and the nearest one above or below them all', () => {
    const editor = setup(b.paragraph('One'), b.heading(2, 'Two'), b.paragraph('Three'));
    expect(at(editor, 105)).toBe('paragraph:One');
    expect(at(editor, 125)).toBe('heading:Two');
    expect(at(editor, 159)).toBe('paragraph:Three');
    expect(at(editor, 10)).toBe('paragraph:One');
    expect(at(editor, 900)).toBe('paragraph:Three');
  });

  it('finds list items (nested ones too) rather than lists', () => {
    const editor = setup(
      b.paragraph('Intro'),
      b.bulletList(b.listItem(b.paragraph('Fuel'), b.bulletList('Oxygen', 'Hydrogen')), 'Food'),
    );
    // Intro 100–120, Fuel 120–140, Oxygen 140–160, Hydrogen 160–180, Food 180–200.
    expect(at(editor, 130)).toBe('listItem:FuelOxygenHydrogen');
    expect(at(editor, 150)).toBe('listItem:Oxygen');
    expect(at(editor, 170)).toBe('listItem:Hydrogen');
    expect(at(editor, 190)).toBe('listItem:Food');
  });

  it('finds a toggle by its summary, the blocks it shows, and skips what it hides', () => {
    const editor = setup(
      b.toggle('Open', [b.paragraph('Shown')], { open: true }),
      b.toggle('Closed', [b.paragraph('Hidden')], { open: false }),
      b.paragraph('After'),
    );
    // Open 100–120, Shown 120–140, Closed 140–160, After 160–180.
    expect(at(editor, 110)).toBe('toggle:OpenShown');
    expect(at(editor, 130)).toBe('paragraph:Shown');
    expect(at(editor, 150)).toBe('toggle:ClosedHidden');
    expect(at(editor, 170)).toBe('paragraph:After');
  });

  it('treats atoms and tables as whole blocks', () => {
    const editor = setup(
      b.paragraph('Before'),
      b.horizontalRule(),
      b.table({ header: true }, ['Name', 'Role'], ['Neil', 'Commander']),
    );
    expect(at(editor, 125)).toBe('horizontalRule:');
    expect(at(editor, 150)).toBe('table:NameRoleNeilCommander');
  });

  it('finds the right block among thousands (binary search)', () => {
    const blocks = Array.from({ length: 3000 }, (_, index) => b.paragraph(`Line ${index}`));
    const editor = setup(...blocks);
    expect(at(editor, 100 + 1234 * LINE + 5)).toBe('paragraph:Line 1234');
    expect(at(editor, 100 + 2999 * LINE + 5)).toBe('paragraph:Line 2999');
  });
});
