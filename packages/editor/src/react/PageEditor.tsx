import { getPageContent, type DocHandle, type PageBodyProps } from '@tessera/core';
import { useAppContext, useContributions, usePageDoc } from '@tessera/core/react';
import { Button, EmptyState, Skeleton } from '@tessera/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import { AlertTriangle } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { clipboard } from '../clipboard/clipboard';
import { CodeHighlight } from '../code/highlight';
import { contributedExtensions } from '../contributed';
import { editorExtensions } from '../editor-extensions';
import { blockSelection } from '../extensions/block-selection';
import { links } from '../extensions/links';
import { watchRemoteCursors } from '../extensions/remote-cursors';
import { pageLinkCommand } from '../menus/page-link-command';
import { LinkPreview } from './LinkPreview';
import { mediaDrop } from '../extensions/media-drop';
import { BlockHandle } from '../handle/BlockHandle';
import { blockHandle } from '../handle/handle-plugin';
import { t } from '../i18n';
import { slashCommand } from '../menus/slash-command';
import { SuggestionMenu } from '../menus/SuggestionMenu';
import { createNodeViews } from '../node-views';
import { EditorControllerContext } from './context';
import { createEditorController } from './controller';
import { EditorPopovers } from './EditorPopovers';
import { focusBody, focusTail, revealTarget } from './focus';
import { SelectionToolbar } from './SelectionToolbar';
import { TableControls } from './TableControls';
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
  pageId,
  readOnly,
  target,
  focusTitle,
  registerFocusHandler,
}: EditorViewProps) {
  const ctx = useAppContext();
  const contributions = useContributions('editorExtensions');
  const focusTitleRef = useRef(focusTitle);
  focusTitleRef.current = focusTitle;
  const controller = useMemo(() => createEditorController(ctx, pageId), [ctx, pageId]);
  const rootRef = useRef<HTMLDivElement>(null);

  const extensions = useMemo(
    () =>
      editorExtensions({
        fragment: getPageContent(handle.doc),
        focusTitle: (position) => focusTitleRef.current(position),
        resizableTables: true,
        nodeViews: createNodeViews(controller),
        extra: [
          CodeHighlight,
          slashCommand(controller),
          pageLinkCommand(controller),
          links(controller),
          mediaDrop(controller),
          ...clipboard(controller),
          blockHandle(controller),
          blockSelection(controller),
          ...contributedExtensions(contributions, ctx),
        ],
      }),
    [handle, contributions, ctx, controller],
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
  controller.editor = editor;

  useEffect(() => {
    controller.readOnly.set(readOnly);
    if (editor.isEditable !== !readOnly) editor.setEditable(!readOnly);
    editor.view.dom.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
    if (readOnly) {
      controller.menu.set(null);
      controller.closePopover({ focusEditor: false });
    }
  }, [editor, controller, readOnly]);

  useEffect(
    () => () => {
      controller.closePopover({ focusEditor: false });
      controller.releaseLinkPreview({ immediate: true });
    },
    [controller],
  );

  useEffect(
    () => registerFocusHandler((position) => focusBody(editor, position)),
    [editor, registerFocusHandler],
  );

  // Collaborators' carets, while a sync provider is connected.
  useEffect(
    () => (handle.sync ? watchRemoteCursors(editor, handle.sync) : undefined),
    [editor, handle],
  );

  // Scroll to the navigation target once per distinct target (the object changes every render).
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetKey = targetKeyOf(target);
  useEffect(() => {
    const current = targetRef.current;
    if (!targetKey || !current || editor.isDestroyed) return undefined;
    // Wait a frame so node views have their final size before scrolling.
    const frame = requestAnimationFrame(() => revealTarget(editor, current));
    return () => cancelAnimationFrame(frame);
  }, [editor, targetKey]);

  return (
    <EditorControllerContext.Provider value={controller}>
      <div ref={rootRef} className="tess-editor-root" data-readonly={readOnly || undefined}>
        <BlockHandle controller={controller} editor={editor} root={rootRef} />
        <TableControls controller={controller} editor={editor} root={rootRef} />
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
      <SuggestionMenu controller={controller} editor={editor} />
      <EditorPopovers controller={controller} editor={editor} />
      <LinkPreview controller={controller} />
      <SelectionToolbar controller={controller} editor={editor} />
    </EditorControllerContext.Provider>
  );
}

function targetKeyOf(target: PageBodyProps['target']): string {
  return target ? `${target.heading ?? ''}#${target.blockId ?? ''}` : '';
}

/**
 * The editor re-renders only for what it uses. The page's metadata changes with every keystroke
 * of its title, and `target` and `focusTitle` are new objects on every render of the page (the
 * latest `focusTitle` is read through a ref, and every version focuses the same title).
 */
function sameEditorProps(previous: EditorViewProps, next: EditorViewProps): boolean {
  return (
    previous.handle === next.handle &&
    previous.pageId === next.pageId &&
    previous.readOnly === next.readOnly &&
    previous.registerFocusHandler === next.registerFocusHandler &&
    targetKeyOf(previous.target) === targetKeyOf(next.target)
  );
}

const MemoEditorView = memo(EditorView, sameEditorProps);

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
  return <MemoEditorView key={handle.docName} handle={handle} {...props} />;
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
