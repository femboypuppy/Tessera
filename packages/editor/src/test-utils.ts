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
