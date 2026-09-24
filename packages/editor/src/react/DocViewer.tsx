import { docJSONEqual, type DocJSON, type DocViewerProps } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo } from 'react';
import { CodeHighlight } from '../code/highlight';
import { editorExtensions } from '../editor-extensions';
import { t } from '../i18n';
import { createNodeViews } from '../node-views';
import { EditorControllerContext } from './context';
import { createEditorController } from './controller';
import '../styles/editor.css';

/**
 * A read-only view of a document exactly as the page editor shows it (the same schema, node
 * views, embeds and code highlighting), for previews: version history, and anything else that
 * shows a `DocJSON` without editing it. Registered as the editor's `docViewers` contribution.
 */
export default function DocViewer({ doc, pageId }: DocViewerProps) {
  const ctx = useAppContext();
  const controller = useMemo(() => createEditorController(ctx, pageId ?? ''), [ctx, pageId]);
  const extensions = useMemo(
    () => editorExtensions({ nodeViews: createNodeViews(controller), extra: [CodeHighlight] }),
    [controller],
  );
  const editor = useEditor(
    {
      extensions,
      content: doc,
      editable: false,
      shouldRerenderOnTransaction: false,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          class: 'tess-editor tess-doc-viewer',
          role: 'document',
          'aria-readonly': 'true',
          'aria-label': t('docViewerLabel'),
        },
      },
    },
    [extensions],
  );
  controller.editor = editor;

  useEffect(() => {
    controller.readOnly.set(true);
  }, [controller]);

  // A new document (another version) replaces the content without rebuilding the editor.
  useEffect(() => {
    if (!docJSONEqual(editor.getJSON() as DocJSON, doc)) {
      editor.commands.setContent(doc, { emitUpdate: false });
    }
  }, [editor, doc]);

  return (
    <EditorControllerContext.Provider value={controller}>
      <EditorContent editor={editor} />
    </EditorControllerContext.Provider>
  );
}
