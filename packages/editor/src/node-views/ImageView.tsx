import { isSafeImageSrc } from '@tessera/core';
import { cn, Spinner } from '@tessera/ui';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { ImageOff, Type } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../i18n';
import { useEditorController } from '../react/context';
import { useStore } from '../react/store';
import { parseImageWidth } from '../schema/nodes/image';

type Source =
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'missing' }
  | { state: 'error' };

/** Resolves an image's URL: an asset from the `AssetStore`, or a safe `src`. */
function useImageSource(assetId: string | null, src: string | null): Source {
  const controller = useEditorController();
  const [source, setSource] = useState<Source>(() =>
    assetId
      ? { state: 'loading' }
      : isSafeImageSrc(src)
        ? { state: 'ready', url: src }
        : { state: 'missing' },
  );
  useEffect(() => {
    if (!assetId) {
      setSource(isSafeImageSrc(src) ? { state: 'ready', url: src } : { state: 'missing' });
      return undefined;
    }
    let active = true;
    setSource({ state: 'loading' });
    controller.ctx.services.assetStore.getUrl(assetId).then(
      (url) => {
        if (!active) return;
        if (url) setSource({ state: 'ready', url });
        else setSource(isSafeImageSrc(src) ? { state: 'ready', url: src } : { state: 'missing' });
      },
      () => {
        if (active) setSource({ state: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [controller, assetId, src]);
  return source;
}

/**
 * The `image` node view: the picture (from the asset store or a safe URL), side handles to resize
 * it (a percentage of the page width), an editable caption (`title`) and alt text.
 */
export function ImageView({ node, updateAttributes, selected, getPos }: ReactNodeViewProps) {
  const controller = useEditorController();
  const readOnly = useStore(controller.readOnly);
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null;
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null;
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const caption = typeof node.attrs.title === 'string' ? node.attrs.title : '';
  const storedWidth = parseImageWidth(node.attrs.width);
  const source = useImageSource(assetId, src);
  const [failed, setFailed] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [captionOpen, setCaptionOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const altButtonRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const width = dragWidth ?? storedWidth;
  const blockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : undefined;

  useEffect(() => setFailed(false), [source]);
  // "Caption" moves focus into the new caption field.
  useEffect(() => {
    if (captionOpen) captionRef.current?.focus();
  }, [captionOpen]);

  const startResize = (side: 'left' | 'right') => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current;
    const container = frame?.parentElement;
    if (!frame || !container) return;
    const startX = event.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    const available = container.getBoundingClientRect().width || startWidth;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let latest = parseImageWidth((startWidth / available) * 100) ?? 100;
    const move = (moveEvent: PointerEvent) => {
      // The image is centered, so each side moves half the width change.
      const delta = (moveEvent.clientX - startX) * (side === 'right' ? 2 : -2);
      latest = parseImageWidth(((startWidth + delta) / available) * 100) ?? latest;
      setDragWidth(latest);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setDragWidth(null);
      updateAttributes({ width: latest >= 100 ? null : latest });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const openAlt = () => {
    const pos = getPos();
    if (pos === undefined || !altButtonRef.current) return;
    controller.openPopover({
      request: { kind: 'imageAlt', pos },
      anchor: altButtonRef.current,
      returnFocus: altButtonRef.current,
    });
  };

  const showCaption = caption.length > 0 || captionOpen || (selected && !readOnly);

  return (
    <NodeViewWrapper
      className="tess-image"
      data-block-id={blockId}
      data-selected={selected || undefined}
    >
      <figure className="m-0 flex flex-col items-center">
        <div
          ref={frameRef}
          className={cn(
            'group/image relative max-w-full rounded-md',
            selected && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
          )}
          style={{ width: width ? `${width}%` : undefined }}
          data-drag-handle=""
        >
          {source.state === 'ready' && !failed ? (
            <img
              src={source.url}
              alt={alt}
              className="block h-auto w-full rounded-md"
              draggable={false}
              onError={() => setFailed(true)}
            />
          ) : (
            <div
              role="img"
              aria-label={alt || t('imageMissing')}
              className="flex min-h-40 w-[min(100%,36rem)] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-bg-subtle px-6 py-8 text-center text-ui text-fg-muted"
            >
              {source.state === 'loading' ? (
                <Spinner label={t('imageLoading')} />
              ) : (
                <>
                  <ImageOff className="size-5 text-fg-subtle" aria-hidden="true" />
                  <span>
                    {source.state === 'error' || failed ? t('imageError') : t('imageMissing')}
                  </span>
                </>
              )}
            </div>
          )}
          {!readOnly ? (
            <>
              {(['left', 'right'] as const).map((side) => (
                <span
                  key={side}
                  role="presentation"
                  className={cn(
                    'tess-image-handle duration-fast absolute top-1/2 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full border border-surface bg-fg/60 opacity-0 transition-opacity group-hover/image:opacity-100',
                    side === 'left' ? 'left-2' : 'right-2',
                    (selected || dragWidth !== null) && 'opacity-100',
                  )}
                  onPointerDown={startResize(side)}
                  title={t('imageResize')}
                />
              ))}
              <div className="duration-fast absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/image:opacity-100 focus-within:opacity-100">
                <button
                  ref={altButtonRef}
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-surface/90 px-2 text-2xs font-medium text-fg shadow-subtle backdrop-blur hover:bg-surface focus-visible:ring-2 focus-visible:ring-focus"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openAlt}
                >
                  {t('imageAlt')}
                </button>
                {!caption && !captionOpen ? (
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-surface/90 px-2 text-2xs font-medium text-fg shadow-subtle backdrop-blur hover:bg-surface focus-visible:ring-2 focus-visible:ring-focus"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setCaptionOpen(true)}
                  >
                    <Type className="size-3" aria-hidden="true" />
                    {t('imageCaption')}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        {showCaption ? (
          readOnly ? (
            caption ? (
              <figcaption className="mt-2 w-full text-center text-ui text-fg-muted">
                {caption}
              </figcaption>
            ) : null
          ) : (
            <figcaption className="mt-1.5 w-full">
              <input
                className="w-full bg-transparent text-center text-ui text-fg-muted outline-none placeholder:text-fg-subtle"
                value={caption}
                placeholder={t('imageCaptionPlaceholder')}
                aria-label={t('imageCaption')}
                maxLength={2000}
                ref={captionRef}
                onChange={(event) => updateAttributes({ title: event.target.value || null })}
                onBlur={() => setCaptionOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.preventDefault();
                    controller.editor?.commands.focus();
                  }
                }}
              />
            </figcaption>
          )
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}
