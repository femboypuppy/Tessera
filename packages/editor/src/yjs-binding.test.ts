import {
  build as b,
  docJSONEqual,
  readDocJSON,
  updateDocJSON,
  validateDocJSON,
  writeDocJSON,
} from '@tessera/core';
import { kitchenSinkDoc } from '@tessera/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blockTexts, createTestEditor, linkDocs } from './test-utils';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(...args: Parameters<typeof createTestEditor>) {
  const result = createTestEditor(...args);
  cleanups.push(result.destroy);
  return result;
}

describe('editor bound to the page doc', () => {
  it('renders the stored content exactly (kitchen sink)', () => {
    const { editor, doc } = setup({ content: kitchenSinkDoc() });
    expect(docJSONEqual(editor.getJSON(), kitchenSinkDoc())).toBe(true);
    // Rendering never rewrites the stored content.
    expect(docJSONEqual(readDocJSON(doc), kitchenSinkDoc())).toBe(true);
  });

  it('opening an empty page writes nothing', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    setup({ doc });
    expect(updates).toBe(0);
  });

  it('writes edits to Yjs as valid DocJSON', () => {
    const { editor, doc } = setup({ content: b.doc(b.paragraph('Hello')) });
    editor.commands.setTextSelection(6);
    editor.commands.insertContent(' world');
    editor.commands.enter();
    editor.commands.insertContent('Second');
    const stored = readDocJSON(doc);
    expect(validateDocJSON(stored).ok).toBe(true);
    expect(stored.content.map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
    expect(blockTexts(editor)).toEqual(['paragraph:Hello world', 'paragraph:Second']);
  });

  it('assigns unique block IDs to new blocks, and a new one to the split half', () => {
    const { editor } = setup({ content: b.doc(b.paragraph('One')) });
    editor.commands.setTextSelection(4);
    editor.commands.insertContent('!');
    editor.commands.enter();
    editor.commands.insertContent('Two');
    editor.commands.enter();
    editor.commands.insertContent('Three');
    const ids: unknown[] = [];
    editor.state.doc.forEach((node) => ids.push(node.attrs.blockId));
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it('gives pasted copies of a block a new ID and keeps the original', () => {
    const { editor } = setup({
      content: b.doc({ type: 'paragraph', attrs: { blockId: 'orig1234' }, content: [b.text('A')] }),
    });
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      attrs: { blockId: 'orig1234' },
      content: [{ type: 'text', text: 'Copy' }],
    });
    const ids: unknown[] = [];
    editor.state.doc.forEach((node) => ids.push(node.attrs.blockId));
    expect(ids[0]).toBe('orig1234');
    expect(ids[1]).not.toBe('orig1234');
    expect(typeof ids[1]).toBe('string');
  });

  it('undo only reverts this user’s edits', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    writeDocJSON(local, b.doc(b.paragraph('Start')));
    cleanups.push(linkDocs(local, remote));
    const { editor } = setup({ doc: local });

    editor.commands.setTextSelection(6);
    editor.commands.insertContent(' mine');
    // Someone else edits the same page.
    updateDocJSON(remote, (current) => ({
      ...current,
      content: [...current.content, b.paragraph('Theirs')],
    }));
    expect(blockTexts(editor)).toEqual(['paragraph:Start mine', 'paragraph:Theirs']);

    editor.commands.undo();
    expect(blockTexts(editor)).toEqual(['paragraph:Start', 'paragraph:Theirs']);
    editor.commands.redo();
    expect(blockTexts(editor)).toEqual(['paragraph:Start mine', 'paragraph:Theirs']);
  });

  it('shows remote edits live and keeps both sides converged', () => {
    const a = new Y.Doc();
    const bDoc = new Y.Doc();
    cleanups.push(linkDocs(a, bDoc));
    const first = setup({ doc: a });
    const second = setup({ doc: bDoc });
    first.editor.commands.insertContent('From A');
    expect(blockTexts(second.editor)).toEqual(['paragraph:From A']);
    second.editor.commands.setTextSelection(second.editor.state.doc.content.size - 1);
    second.editor.commands.insertContent(' and B');
    expect(blockTexts(first.editor)).toEqual(['paragraph:From A and B']);
    expect(docJSONEqual(readDocJSON(a), readDocJSON(bDoc))).toBe(true);
  });
});
