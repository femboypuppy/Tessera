import { build as b, validateDocJSON, type DocJSON } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { blockTexts, createTestEditor } from '../test-utils';
import {
  blockAt,
  canTurnInto,
  deleteBlocks,
  duplicateBlock,
  insertBlocks,
  moveBlock,
  setBlockColor,
  slashTarget,
  turnInto,
  type BlockRef,
} from './blocks';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(content: DocJSON) {
  const result = createTestEditor({ content });
  cleanups.push(result.destroy);
  return result;
}

/** Position of the first textblock whose text is `text` (inside it). */
function posOfText(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isTextblock && node.textContent === text) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`No block "${text}"`);
  return found;
}

function blockOf(editor: Editor, text: string): BlockRef {
  const block = blockAt(editor.state.doc.resolve(posOfText(editor, text)));
  if (!block) throw new Error(`No block around "${text}"`);
  return block;
}

function caretIn(editor: Editor, text: string) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOfText(editor, text))),
  );
}

function valid(editor: Editor): boolean {
  return validateDocJSON(editor.getJSON()).ok;
}

describe('blockAt', () => {
  it('resolves list items, quotes and callouts from their first line', () => {
    const { editor } = setup(
      b.doc(
        b.bulletList(b.listItem(b.paragraph('Item'), b.paragraph('Nested'))),
        b.callout({ emoji: '💡' }, b.paragraph('Callout line'), b.paragraph('Second')),
        b.toggle(['Summary'], [b.paragraph('Inside')], { open: true }),
      ),
    );
    expect(blockOf(editor, 'Item').node.type.name).toBe('listItem');
    expect(blockOf(editor, 'Nested').node.type.name).toBe('paragraph');
    expect(blockOf(editor, 'Callout line').node.type.name).toBe('callout');
    expect(blockOf(editor, 'Second').node.type.name).toBe('paragraph');
    expect(blockOf(editor, 'Summary').node.type.name).toBe('toggle');
    expect(blockOf(editor, 'Inside').node.type.name).toBe('paragraph');
  });
});

describe('turnInto', () => {
  it('turns a paragraph into a heading, keeping its text, ID and color', () => {
    const { editor } = setup(
      b.doc({
        type: 'paragraph',
        attrs: { blockId: 'keep1234', color: 'blue' },
        content: [b.text('Title', b.mark.bold())],
      }),
    );
    expect(turnInto(editor, 0, 'heading2')).toBe(true);
    const heading = editor.state.doc.firstChild;
    expect(heading?.type.name).toBe('heading');
    expect(heading?.attrs).toMatchObject({ level: 2, blockId: 'keep1234', color: 'blue' });
    expect(heading?.firstChild?.marks[0]?.type.name).toBe('bold');
    expect(valid(editor)).toBe(true);
  });

  it('joins a new list item with the list before it', () => {
    const { editor } = setup(b.doc(b.bulletList('One', 'Two'), b.paragraph('Three')));
    turnInto(editor, blockOf(editor, 'Three').pos, 'bulletList');
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    expect(editor.state.selection.$from.parent.textContent).toBe('Three');
  });

  it('splits a list around an item turned into a heading', () => {
    const { editor } = setup(b.doc(b.orderedList('One', 'Two', 'Three')));
    turnInto(editor, blockOf(editor, 'Two').pos, 'heading1');
    expect(blockTexts(editor)).toEqual(['orderedList:One', 'heading:Two', 'orderedList:Three']);
    expect(valid(editor)).toBe(true);
  });

  it('changes the type of one list item by splitting its list', () => {
    const { editor } = setup(b.doc(b.bulletList('One', 'Two', 'Three')));
    turnInto(editor, blockOf(editor, 'Two').pos, 'taskList');
    expect(blockTexts(editor)).toEqual(['bulletList:One', 'taskList:Two', 'bulletList:Three']);
  });

  it('unwraps a toggle into a paragraph followed by its hidden blocks', () => {
    const { editor } = setup(b.doc(b.toggle(['Summary'], [b.paragraph('A'), b.paragraph('B')])));
    turnInto(editor, 0, 'paragraph');
    expect(blockTexts(editor)).toEqual(['paragraph:Summary', 'paragraph:A', 'paragraph:B']);
  });

  it('wraps a paragraph into a toggle, a quote and a callout', () => {
    for (const type of ['toggle', 'blockquote', 'callout'] as const) {
      const { editor } = setup(b.doc(b.paragraph('Text')));
      expect(turnInto(editor, 0, type)).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe(type);
      expect(editor.state.doc.firstChild?.textContent).toBe('Text');
      expect(valid(editor)).toBe(true);
    }
  });

  it('turns code into text with line breaks and back', () => {
    const { editor } = setup(b.doc(b.codeBlock('one\ntwo', 'js')));
    turnInto(editor, 0, 'paragraph');
    const paragraph = editor.state.doc.firstChild;
    expect(paragraph?.type.name).toBe('paragraph');
    expect(paragraph?.childCount).toBe(3); // text, hardBreak, text
    turnInto(editor, 0, 'codeBlock');
    expect(editor.state.doc.firstChild?.textContent).toBe('one\ntwo');
  });

  it('refuses conversions a container does not allow (headings in table cells)', () => {
    const { editor } = setup(b.doc(b.table({ header: false }, ['Cell'])));
    const cellParagraph = posOfText(editor, 'Cell') - 1;
    expect(canTurnInto(editor, cellParagraph, 'heading1')).toBe(false);
    expect(canTurnInto(editor, cellParagraph, 'paragraph')).toBe(true);
  });
});

describe('slashTarget', () => {
  it('converts the paragraph itself when its container allows it', () => {
    const { editor } = setup(b.doc(b.callout({}, b.paragraph('In callout'))));
    caretIn(editor, 'In callout');
    const target = slashTarget(editor, 'heading1');
    expect(editor.state.doc.nodeAt(target ?? -1)?.type.name).toBe('paragraph');
  });

  it('converts the whole list item from its first line', () => {
    const { editor } = setup(b.doc(b.bulletList('Item')));
    caretIn(editor, 'Item');
    const target = slashTarget(editor, 'heading1');
    expect(editor.state.doc.nodeAt(target ?? -1)?.type.name).toBe('listItem');
  });

  it('has no target for headings inside table cells', () => {
    const { editor } = setup(b.doc(b.table({ header: false }, ['Cell'])));
    caretIn(editor, 'Cell');
    expect(slashTarget(editor, 'heading1')).toBeNull();
  });
});

describe('duplicate, delete, color and move', () => {
  it('duplicates a block with a new block ID', () => {
    const { editor } = setup(
      b.doc({ type: 'paragraph', attrs: { blockId: 'orig5678' }, content: [b.text('Copy me')] }),
    );
    duplicateBlock(editor, blockOf(editor, 'Copy me'));
    const ids: unknown[] = [];
    editor.state.doc.forEach((node) => ids.push(node.attrs.blockId));
    expect(blockTexts(editor)).toEqual(['paragraph:Copy me', 'paragraph:Copy me']);
    expect(ids[0]).toBe('orig5678');
    expect(ids[1]).not.toBe('orig5678');
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('deletes blocks and removes a list left empty', () => {
    const { editor } = setup(b.doc(b.paragraph('Keep'), b.bulletList('Only item')));
    deleteBlocks(editor, [blockOf(editor, 'Only item')]);
    expect(blockTexts(editor)).toEqual(['paragraph:Keep']);
  });

  it('never leaves the document empty', () => {
    const { editor } = setup(b.doc(b.paragraph('Last')));
    deleteBlocks(editor, [blockOf(editor, 'Last')]);
    expect(blockTexts(editor)).toEqual(['paragraph:']);
  });

  it('colors blocks that support colors', () => {
    const { editor } = setup(b.doc(b.paragraph('Color me'), b.codeBlock('x')));
    expect(setBlockColor(editor, blockOf(editor, 'Color me'), 'red-background')).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.color).toBe('red-background');
    expect(setBlockColor(editor, { pos: 10, node: editor.state.doc.child(1) }, 'red')).toBe(false);
  });

  it('moves blocks up and down, keeping the caret', () => {
    const { editor } = setup(b.doc(b.paragraph('A'), b.paragraph('B'), b.paragraph('C')));
    caretIn(editor, 'C');
    moveBlock(editor, blockOf(editor, 'C'), 'up');
    expect(blockTexts(editor)).toEqual(['paragraph:A', 'paragraph:C', 'paragraph:B']);
    expect(editor.state.selection.$from.parent.textContent).toBe('C');
    moveBlock(editor, blockOf(editor, 'A'), 'down');
    expect(blockTexts(editor)).toEqual(['paragraph:C', 'paragraph:A', 'paragraph:B']);
  });

  it('moves the first list item over the block above, keeping it a list item', () => {
    const { editor } = setup(b.doc(b.paragraph('Before'), b.bulletList('One', 'Two')));
    caretIn(editor, 'One');
    moveBlock(editor, blockOf(editor, 'One'), 'up');
    expect(blockTexts(editor)).toEqual(['bulletList:One', 'paragraph:Before', 'bulletList:Two']);
    expect(editor.state.selection.$from.parent.textContent).toBe('One');
    // And back: it rejoins its list.
    moveBlock(editor, blockOf(editor, 'One'), 'down');
    expect(blockTexts(editor)).toEqual(['paragraph:Before', 'bulletList:OneTwo']);
    expect(editor.state.doc.child(1).childCount).toBe(2);
    expect(editor.state.selection.$from.parent.textContent).toBe('One');
    expect(valid(editor)).toBe(true);
  });

  it('moves a paragraph through a list one item at a time', () => {
    const { editor } = setup(b.doc(b.paragraph('P'), b.bulletList('A', 'B', 'C')));
    caretIn(editor, 'P');
    moveBlock(editor, blockOf(editor, 'P'), 'down');
    expect(blockTexts(editor)).toEqual(['bulletList:A', 'paragraph:P', 'bulletList:BC']);
    moveBlock(editor, blockOf(editor, 'P'), 'down');
    expect(blockTexts(editor)).toEqual(['bulletList:AB', 'paragraph:P', 'bulletList:C']);
    moveBlock(editor, blockOf(editor, 'P'), 'down');
    expect(blockTexts(editor)).toEqual(['bulletList:ABC', 'paragraph:P']);
    expect(editor.state.selection.$from.parent.textContent).toBe('P');
    moveBlock(editor, blockOf(editor, 'P'), 'up');
    expect(blockTexts(editor)).toEqual(['bulletList:AB', 'paragraph:P', 'bulletList:C']);
    expect(valid(editor)).toBe(true);
  });

  it('moves a block out of a callout at its edge', () => {
    const { editor } = setup(b.doc(b.callout({}, b.paragraph('Inside'), b.paragraph('Last'))));
    moveBlock(editor, blockOf(editor, 'Last'), 'down');
    expect(blockTexts(editor)).toEqual(['callout:Inside', 'paragraph:Last']);
  });

  it('keeps a block selection on the moved block', () => {
    const { editor } = setup(b.doc(b.paragraph('A'), b.paragraph('B')));
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 3)));
    moveBlock(editor, blockOf(editor, 'B'), 'up');
    expect(blockTexts(editor)).toEqual(['paragraph:B', 'paragraph:A']);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.textContent).toBe('B');
  });
});

describe('insertBlocks', () => {
  it('replaces the empty paragraph with the caret and adds a paragraph after atoms', () => {
    const { editor } = setup(b.doc(b.paragraph('Intro'), b.paragraph()));
    const hr = editor.schema.nodes.horizontalRule?.create();
    if (!hr) throw new Error('no hr');
    insertBlocks(editor, editor.state.doc.content.size - 1, [hr]);
    expect(blockTexts(editor)).toEqual(['paragraph:Intro', 'horizontalRule:', 'paragraph:']);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });
});
