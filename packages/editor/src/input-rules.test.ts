import { build as b, type DocJSON } from '@tessera/core';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { links } from './extensions/links';
import { createEditorController } from './react/controller';
import { blockTexts, createTestEditor, typeText } from './test-utils';

let app: TestAppContext;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
  app = await createTestAppContext();
});

afterEach(async () => {
  while (cleanups.length) cleanups.pop()?.();
  await app.dispose();
});

function setup(content: DocJSON = b.doc(b.paragraph())): Editor {
  const controller = createEditorController(app.ctx, 'page-under-test');
  const result = createTestEditor({ content, extra: [links(controller)] });
  controller.editor = result.editor;
  result.editor.commands.focus('end');
  cleanups.push(result.destroy);
  return result.editor;
}

function first(editor: Editor) {
  const node = editor.state.doc.firstChild;
  if (!node) throw new Error('empty document');
  return node;
}

function marksOf(editor: Editor, text: string): string[] {
  let marks: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === text) marks = node.marks.map((mark) => mark.type.name);
  });
  return marks;
}

describe('block input rules (markdown shortcuts)', () => {
  it.each([
    ['# ', 'heading', { level: 1 }],
    ['## ', 'heading', { level: 2 }],
    ['### ', 'heading', { level: 3 }],
    ['- ', 'bulletList', {}],
    ['* ', 'bulletList', {}],
    ['+ ', 'bulletList', {}],
    ['1. ', 'orderedList', { start: 1 }],
    ['3. ', 'orderedList', { start: 3 }],
    ['> ', 'blockquote', {}],
    ['``` ', 'codeBlock', {}],
  ])('"%s" makes a %s', (shortcut, type, attrs) => {
    const editor = setup();
    typeText(editor, `${shortcut}Text`);
    expect(first(editor).type.name).toBe(type);
    expect(first(editor).attrs).toMatchObject(attrs);
    expect(first(editor).textContent).toBe('Text');
  });

  it('"```js " starts a code block with a language', () => {
    const editor = setup();
    typeText(editor, '```js ');
    expect(first(editor).type.name).toBe('codeBlock');
    expect(first(editor).attrs.language).toBe('js');
  });

  it.each([
    ['[] ', false],
    ['[ ] ', false],
    ['[x] ', true],
  ])('"%s" makes a to-do (checked: %s)', (shortcut, checked) => {
    const editor = setup();
    typeText(editor, `${shortcut}Task`);
    expect(first(editor).type.name).toBe('taskList');
    expect(first(editor).firstChild?.attrs.checked).toBe(checked);
    expect(first(editor).textContent).toBe('Task');
  });

  it('"---" makes a divider', () => {
    const editor = setup();
    typeText(editor, '---');
    expect(blockTexts(editor)[0]).toBe('horizontalRule:');
  });
});

describe('mark input rules', () => {
  it.each([
    ['**bold** ', 'bold', 'bold'],
    ['__bold__ ', 'bold', 'bold'],
    ['*italic* ', 'italic', 'italic'],
    ['_italic_ ', 'italic', 'italic'],
    ['`code` ', 'code', 'code'],
    ['~~strike~~ ', 'strike', 'strike'],
    ['==marked== ', 'marked', 'highlight'],
  ])('"%s" applies %s', (typed, text, mark) => {
    const editor = setup();
    typeText(editor, `Some ${typed}`);
    expect(marksOf(editor, text)).toContain(mark);
    expect(editor.state.doc.textContent).not.toContain('*');
  });

  it('typing a URL then a space links it', () => {
    const editor = setup();
    typeText(editor, 'Visit https://tessera.dev now');
    expect(marksOf(editor, 'https://tessera.dev')).toContain('link');
  });
});

describe('inline node input rules', () => {
  it('"#tag " makes a tag, keeping nested names', () => {
    const editor = setup();
    typeText(editor, 'Filed under #project/alpha and more');
    const tags: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tag') tags.push(String(node.attrs.name));
    });
    expect(tags).toEqual(['project/alpha']);
    expect(editor.state.doc.textContent).toBe('Filed under  and more');
  });

  it('leaves invalid tags ("#1984") and headings as text', () => {
    const editor = setup();
    typeText(editor, 'Year #1984 was');
    let tags = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tag') tags += 1;
    });
    expect(tags).toBe(0);
    expect(editor.state.doc.textContent).toBe('Year #1984 was');
  });

  it('"[[Exact title]]" links to the page with that title', () => {
    const page = app.ctx.workspace.createPage({ title: 'Mission control' });
    const editor = setup();
    typeText(editor, 'See [[mission control]]');
    const link = editor.state.doc.firstChild?.lastChild;
    expect(link?.type.name).toBe('pageLink');
    expect(link?.attrs.pageId).toBe(page.id);
  });

  it('"[[Unknown]]" stays text', () => {
    const editor = setup();
    typeText(editor, 'See [[Nowhere]]');
    expect(editor.state.doc.textContent).toBe('See [[Nowhere]]');
  });
});
