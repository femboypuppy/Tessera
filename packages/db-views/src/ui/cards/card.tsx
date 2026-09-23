import {
  extractImages,
  isSafeImageSrc,
  readDocJSON,
  type CardCover,
  type CardOptions,
  type PropertyDefinition,
  type ResolvedRow,
} from '@tessera/core';
import { useAppContext, usePage } from '@tessera/core/react';
import { cn, coverPresetBackground } from '@tessera/ui';
import { FileText } from 'lucide-react';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { t } from '../../i18n';
import { readCell } from '../../query/cells';
import type { QueryContext } from '../../query/types';
import { CellDisplay } from '../cells/display';
import { displayTitle } from '../common';

/** A resolved card cover: an image URL or a CSS background (cover presets). */
type CoverSource = { kind: 'image'; url: string } | { kind: 'background'; value: string } | null;

/** First images of row pages, by row and last edit, so scrolling back never reloads a doc. */
const contentCovers = new Map<string, string | null>();

function useVisible<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

/**
 * The cover of a card: nothing, a URL property holding an image, or the row page's cover (a
 * preset, an asset or an https image) and else the first image of its content. Page content is
 * read only when the card scrolls into view, one doc at a time, never for the whole database.
 */
function useCover(
  row: ResolvedRow,
  cover: CardCover,
  properties: readonly PropertyDefinition[],
  visible: boolean,
): CoverSource {
  const ctx = useAppContext();
  const page = usePage(row.id);
  const [source, setSource] = useState<CoverSource>(null);
  const pageCover = page?.cover;
  const coverKey = pageCover ? `${pageCover.kind}:${pageCover.value}` : '';
  const coverProperty =
    cover.kind === 'property'
      ? properties.find((property) => property.id === cover.propertyId)
      : undefined;
  const propertyValue = coverProperty ? readCell(row, coverProperty) : null;
  useEffect(() => {
    let cancelled = false;
    const set = (next: CoverSource) => {
      if (!cancelled) setSource(next);
    };
    if (cover.kind === 'none') {
      set(null);
      return undefined;
    }
    if (cover.kind === 'property') {
      set(
        typeof propertyValue === 'string' &&
          /^https:/i.test(propertyValue.trim()) &&
          isSafeImageSrc(propertyValue.trim())
          ? { kind: 'image', url: propertyValue.trim() }
          : null,
      );
      return undefined;
    }
    if (pageCover) {
      if (pageCover.kind === 'preset')
        set({ kind: 'background', value: coverPresetBackground(pageCover.value) });
      else if (pageCover.kind === 'url')
        set(isSafeImageSrc(pageCover.value) ? { kind: 'image', url: pageCover.value } : null);
      else
        void ctx.services.assetStore
          .getUrl(pageCover.value)
          .then((url) => set(url ? { kind: 'image', url } : null));
      return () => {
        cancelled = true;
      };
    }
    if (!visible) return undefined;
    const key = `${row.id}:${row.updatedAt}`;
    const known = contentCovers.get(key);
    const resolveImage = async (image: { assetId: string | null; src: string | null } | null) => {
      if (!image) return null;
      if (image.assetId) return ctx.services.assetStore.getUrl(image.assetId);
      return image.src && isSafeImageSrc(image.src) ? image.src : null;
    };
    if (known !== undefined) {
      set(known ? { kind: 'image', url: known } : null);
      return undefined;
    }
    void (async () => {
      const handle = await ctx.loadPageDoc(row.id);
      try {
        const [first] = extractImages(readDocJSON(handle.doc));
        const url = await resolveImage(first ?? null);
        contentCovers.set(key, url);
        if (contentCovers.size > 5000) contentCovers.clear();
        set(url ? { kind: 'image', url } : null);
      } finally {
        handle.release();
      }
    })().catch(() => set(null));
    return () => {
      cancelled = true;
    };
  }, [ctx, cover.kind, coverKey, pageCover, propertyValue, row.id, row.updatedAt, visible]);
  return source;
}

const COVER_HEIGHT = { small: 'h-24', medium: 'h-32', large: 'h-44' } as const;

export interface CardProps extends Omit<ComponentProps<'div'>, 'children'> {
  row: ResolvedRow;
  /** Visible properties (the title is shown separately). */
  properties: readonly PropertyDefinition[];
  allProperties: readonly PropertyDefinition[];
  options: CardOptions;
  queryCtx: QueryContext;
  dragging?: boolean;
  /** Trailing controls (the card menu). */
  actions?: ReactNode;
}

/** A board or gallery card: optional cover, icon and title, then the chosen properties. */
export const Card = memo(
  forwardRef<HTMLDivElement, CardProps>(function Card(
    { row, properties, allProperties, options, queryCtx, dragging, actions, className, ...props },
    forwarded,
  ) {
    const [visibleRef, visible] = useVisible<HTMLDivElement>();
    const cover = useCover(row, options.cover, allProperties, visible);
    const setRefs = useCallback(
      (element: HTMLDivElement | null) => {
        visibleRef.current = element;
        if (typeof forwarded === 'function') forwarded(element);
        else if (forwarded) forwarded.current = element;
      },
      [forwarded, visibleRef],
    );
    const values = properties.filter((property) => {
      const value = readCell(row, property);
      return !(
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        value === false
      );
    });
    return (
      <div
        ref={setRefs}
        className={cn(
          'group/card duration-fast relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-left shadow-subtle transition-shadow outline-none hover:shadow-popover focus-visible:ring-2 focus-visible:ring-focus',
          dragging && 'opacity-40',
          className,
        )}
        {...props}
      >
        {options.cover.kind !== 'none' ? (
          <div
            aria-hidden="true"
            className={cn('w-full shrink-0 bg-bg-subtle', COVER_HEIGHT[options.size])}
            style={cover?.kind === 'background' ? { background: cover.value } : undefined}
          >
            {!cover ? (
              <span className="flex size-full items-center justify-center text-fg-disabled">
                {row.icon ? (
                  <span className="text-3xl opacity-60">{row.icon}</span>
                ) : (
                  <FileText className="size-6" strokeWidth={1.5} />
                )}
              </span>
            ) : null}
            {cover?.kind === 'image' ? (
              <img
                src={cover.url}
                alt=""
                loading="lazy"
                className={cn('size-full', options.fitCover ? 'object-contain' : 'object-cover')}
              />
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            'flex min-w-0 flex-col gap-1.5',
            options.size === 'small' ? 'p-2' : 'p-2.5',
          )}
        >
          <div className="flex min-w-0 items-start gap-1.5">
            {row.icon ? (
              <span aria-hidden="true" className="shrink-0 text-base leading-5">
                {row.icon}
              </span>
            ) : null}
            <span
              className={cn(
                'min-w-0 flex-1 text-sm leading-5 font-medium break-words',
                !row.title.trim() && 'text-fg-subtle',
              )}
            >
              {displayTitle(row.title)}
            </span>
          </div>
          {values.map((property) => (
            <div key={property.id} className="flex min-w-0 flex-col gap-0.5">
              {options.showPropertyNames ? (
                <span className="text-2xs text-fg-subtle">{property.name || t('untitled')}</span>
              ) : null}
              <div className="flex min-w-0 items-center text-ui">
                <CellDisplay
                  row={row}
                  property={property}
                  queryCtx={queryCtx}
                  wrap
                  className="text-ui"
                />
              </div>
            </div>
          ))}
        </div>
        {actions}
      </div>
    );
  }),
);
