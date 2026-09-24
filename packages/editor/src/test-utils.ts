import { getPageContent, type DocJSON, writeDocJSON } from '@tessera/core';
import { Editor, type AnyExtension } from '@tiptap/core';
import * as Y from 'yjs';
import { editorExtensions, type EditorExtensionsOptions } from './editor-extensions';

/** A headless editor bound to a fresh page doc, for tests. */
export function createTestEditor(
  options: {
    content?: DocJSON;
    doc?: Y.Doc;
    extra?: AnyExtension[];
  } & Omit<EditorExtensionsOptions, 'fragment' | 'extra'> = {},
): { editor: Editor; doc: Y.Doc; element: HTMLElement; destroy: () => void } {
  const doc = options.doc ?? new Y.Doc();
  if (options.content) writeDocJSON(doc, options.content);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: editorExtensions({
      ...options,
      fragment: getPageContent(doc),
      extra: options.extra ?? [],
    }),
  });
  return {
    editor,
    doc,
    element,
    destroy: () => {
      editor.destroy();
      element.remove();
    },
  };
}

/** Links two Y.Docs so every update in one reaches the other (a fake sync provider). */
export function linkDocs(a: Y.Doc, b: Y.Doc): () => void {
  const toB = (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, update, 'remote');
  };
  const toA = (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, update, 'remote');
  };
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'remote');
  a.on('update', toB);
  b.on('update', toA);
  return () => {
    a.off('update', toB);
    b.off('update', toA);
  };
}

/** Text of each top-level block, for compact assertions. */
export function blockTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.forEach((node) => texts.push(`${node.type.name}:${node.textContent}`));
  return texts;
}

/**
 * Types text like a user: each character goes through `handleTextInput` first (so input rules and
 * suggestion triggers run), then is inserted when nothing handled it. `\n` presses Enter.
 */
export function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    if (char === '\n') {
      pressKey(editor, 'Enter');
      continue;
    }
    const { view } = editor;
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, char, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

/** Presses a key (with optional modifiers) through the editor's keymaps, like a real keydown. */
export function pressKey(
  editor: Editor,
  key: string,
  modifiers: { shift?: boolean; mod?: boolean; alt?: boolean } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: !!modifiers.shift,
    ctrlKey: !!modifiers.mod,
    altKey: !!modifiers.alt,
    bubbles: true,
    cancelable: true,
  });
  const { view } = editor;
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false;
  return handled;
}
