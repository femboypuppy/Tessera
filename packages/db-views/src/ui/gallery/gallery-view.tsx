import { resolveViewProperties } from '@tessera/core';
import { Button, cn } from '@tessera/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../i18n';
import { Card } from '../cards/card';
import { displayTitle } from '../common';
import type { ViewBodyProps } from '../database-view';
import { runAction } from '../hooks';
import { RowMenu } from '../row-menu';
import { useAppContext } from '@tessera/core/react';

const GRID = {
  small: 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]',
  medium: 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]',
  large: 'grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]',
} as const;
const PAGE_SIZE = 60;

/**
 * The gallery: cards in a responsive grid (small, medium or large) with a cover (the row page's
 * cover or first image, or an image URL property), the title and the chosen properties. Covers
 * load only for cards on screen; more cards load on demand.
 */
export function GalleryView(props: ViewBodyProps) {
  const ctx = useAppContext();
  const { snapshot, view, result, readOnly, queryCtx } = props;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const cardProperties = resolveViewProperties(snapshot.properties, view)
    .filter((entry) => entry.visible && entry.property.type !== 'title')
    .map((entry) => entry.property);
  const rows = result.rows.slice(0, limit);
  return (
    <div className="flex flex-col gap-3">
      <ul className={cn('grid gap-3', GRID[view.gallery.size])} aria-label={t('viewGallery')}>
        {rows.map((row) => (
          <li key={row.id}>
            <Card
              row={row}
              properties={cardProperties}
              allProperties={snapshot.properties}
              options={view.gallery}
              queryCtx={queryCtx}
              surface={{
                role: 'button',
                tabIndex: 0,
                'aria-label': displayTitle(row.title),
                'data-card-id': row.id,
                onClick: () => props.onOpenRow(row.id, 'peek'),
                onKeyDown: (event) => {
                  if (
                    (event.key === 'Enter' || event.key === ' ') &&
                    event.target === event.currentTarget
                  ) {
                    event.preventDefault();
                    props.onOpenRow(row.id, 'peek');
                  }
                },
                className: 'cursor-pointer',
              }}
              className="h-full"
              actions={
                <RowMenu
                  database={props.database}
                  row={row}
                  onOpen={(mode) => props.onOpenRow(row.id, mode)}
                  readOnly={readOnly}
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                />
              }
            />
          </li>
        ))}
        {!readOnly ? (
          <li>
            <button
              type="button"
              onClick={() =>
                runAction(ctx, async () => {
                  const id = await props.onCreateRow({});
                  if (id) props.onOpenRow(id, 'peek');
                })
              }
              className="flex h-full min-h-24 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-ui text-fg-subtle hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('new')}
            </button>
          </li>
        ) : null}
      </ul>
      {result.rows.length > limit ? (
        <Button
          variant="ghost"
          className="self-center"
          onClick={() => setLimit((value) => value + PAGE_SIZE)}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
