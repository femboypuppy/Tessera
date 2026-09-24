import {
  type BlockRendererRegistration,
  type BlockRendererRegistry,
  type EmbedInsert,
  type JsonValue,
} from '@tessera/core';
import { FeatureBoundary, Skeleton } from '@tessera/ui';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Puzzle } from 'lucide-react';
import { Suspense, useCallback, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { useEditorController } from '../react/context';
import { useStore } from '../react/store';
import { isValidEmbed } from '../schema/nodes/embed';

/** The renderer registered for a kind, re-rendering when the registry changes. */
export function useBlockRenderer(
  blocks: BlockRendererRegistry,
  kind: string,
): BlockRendererRegistration | undefined {
  const get = useCallback(() => blocks.resolve(kind), [blocks, kind]);
  return useSyncExternalStore(blocks.subscribe, get, get);
}

/** Shown for kinds no feature renders (a disabled plugin, a newer version). Never loses data. */
export function NeedsPlugin({ kind }: { kind: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-dashed border-border-strong bg-bg-subtle px-4 py-3"
      role="note"
    >
      <Puzzle className="mt-0.5 size-4 flex-none text-fg-subtle" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{t('needsPlugin')}</p>
        <p className="mt-0.5 text-ui text-fg-muted">{t('needsPluginHint', { kind })}</p>
      </div>
    </div>
  );
}

/**
 * The `embed` node view: renders the component the `BlockRendererRegistry` has for the node's
 * kind (inside an error boundary), or the "needs a plugin" placeholder. Updates from the renderer
 * are validated before they reach the document.
 */
export function EmbedView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const controller = useEditorController();
  const readOnly = useStore(controller.readOnly);
  const kind = typeof node.attrs.kind === 'string' ? node.attrs.kind : '';
  const registration = useBlockRenderer(controller.ctx.blocks, kind);
  const ref = typeof node.attrs.ref === 'string' ? node.attrs.ref : null;
  const data = (node.attrs.data ?? null) as JsonValue | null;
  const blockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : null;

  const updateAttrs = useCallback(
    (patch: { ref?: string | null; data?: JsonValue | null }) => {
      const next: EmbedInsert = {
        kind,
        ref: patch.ref === undefined ? ref : patch.ref,
        data: patch.data === undefined ? data : patch.data,
      };
      if (!controller.isEditable() || !isValidEmbed(next)) return;
      updateAttributes({ ref: next.ref ?? null, data: next.data ?? null });
    },
    [controller, kind, ref, data, updateAttributes],
  );
  const updateData = useCallback(
    (nextData: JsonValue | null) => updateAttrs({ data: nextData }),
    [updateAttrs],
  );
  const remove = useCallback(() => {
    if (controller.isEditable()) deleteNode();
  }, [controller, deleteNode]);

  const Component = registration?.component;
  return (
    <NodeViewWrapper
      className="tess-embed"
      data-kind={kind}
      data-block-id={blockId ?? undefined}
      data-selected={selected || undefined}
    >
      {Component ? (
        <FeatureBoundary featureId={registration.label ?? kind} resetKeys={[kind, ref]}>
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <Component
              kind={kind}
              ref={ref}
              data={data}
              blockId={blockId}
              pageId={controller.pageId}
              selected={selected}
              readOnly={readOnly}
              updateData={updateData}
              updateAttrs={updateAttrs}
              deleteBlock={remove}
            />
          </Suspense>
        </FeatureBoundary>
      ) : (
        <NeedsPlugin kind={kind} />
      )}
    </NodeViewWrapper>
  );
}
