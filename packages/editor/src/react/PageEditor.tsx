import { getPageContent, type DocHandle, type PageBodyProps } from '@tessera/core';
import { useAppContext, useContributions, usePageDoc } from '@tessera/core/react';
import { Button, EmptyState, Skeleton } from '@tessera/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { contributedExtensions } from '../contributed';
import { editorExtensions } from '../editor-extensions';
import { t } from '../i18n';
import { focusBody, focusTail, revealTarget } from './focus';
import '../styles/editor.css';

function EditorSkeleton() {
  return (
    <div className="tess-editor-skeleton" aria-busy="true" aria-label={t('loading')}>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

interface EditorViewProps extends PageBodyProps {
  handle: DocHandle;
}

function EditorView({
  handle,
  readOnly,
  target,
  focusTitle,
  registerFocusHandler,
}: EditorViewProps) {
  const ctx = useAppContext();
  const contributions = useContributions('editorExtensions');
  const focusTitleRef = useRef(focusTitle);
  focusTitleRef.current = focusTitle;

  const extensions = useMemo(
    () =>
      editorExtensions({
        fragment: getPageContent(handle.doc),
        focusTitle: (position) => focusTitleRef.current(position),
        resizableTables: true,
        extra: contributedExtensions(contributions, ctx),
      }),
    [handle, contributions, ctx],
  );

  const editor = useEditor(
    {
      extensions,
      editable: !readOnly,
      shouldRerenderOnTransaction: false,
      immediatelyRender: true,
      enableContentCheck: true,
      editorProps: {
        attributes: {
          class: 'tess-editor',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('editorLabel'),
          spellcheck: 'true',
        },
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (editor.isEditable !== !readOnly) editor.setEditable(!readOnly);
    editor.view.dom.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
  }, [editor, readOnly]);

  useEffect(
    () => registerFocusHandler((position) => focusBody(editor, position)),
    [editor, registerFocusHandler],
  );

  // Scroll to the navigation target once per distinct target (the object changes every render).
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetKey = target ? `${target.heading ?? ''}#${target.blockId ?? ''}` : '';
  useEffect(() => {
    const current = targetRef.current;
    if (!targetKey || !current || editor.isDestroyed) return undefined;
    // Wait a frame so node views have their final size before scrolling.
    const frame = requestAnimationFrame(() => revealTarget(editor, current));
    return () => cancelAnimationFrame(frame);
  }, [editor, targetKey]);

  return (
    <div className="tess-editor-root" data-readonly={readOnly || undefined}>
      <EditorContent editor={editor} />
      {!readOnly ? (
        // A generous click target under the last block, like Notion: it adds a block to type in.
        <div
          className="tess-editor-tail"
          aria-hidden="true"
          onMouseDown={(event) => {
            event.preventDefault();
            focusTail(editor);
          }}
        />
      ) : null}
    </div>
  );
}

function PageEditorLoader(props: PageBodyProps & { onRetry: () => void }) {
  const { handle, loaded, error } = usePageDoc(props.pageId);
  if (error) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={t('loadError')}
        description={t('loadErrorHint')}
        actions={<Button onClick={props.onRetry}>{t('retry')}</Button>}
      />
    );
  }
  if (!loaded || !handle || handle.id !== props.pageId) return <EditorSkeleton />;
  return <EditorView key={handle.docName} handle={handle} {...props} />;
}

/**
 * The `page` body: the block editor bound to the page doc's `content` fragment. Registered as
 * `pageBodies.page` by `apps/web/src/features/editor` and loaded lazily.
 */
export default function PageEditor(props: PageBodyProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PageEditorLoader
      key={`${props.pageId}:${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
