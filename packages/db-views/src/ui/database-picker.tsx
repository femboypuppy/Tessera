import { listViews } from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@tessera/ui';
import { Database } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { t } from '../i18n';
import { displayTitle } from './common';
import { runAction } from './hooks';
import { SearchList, type SearchListItem } from './search-list';

/** Picks a database for "Linked view of database"; resolves with its first view, or null. */
export function DatabasePicker({
  onPick,
}: {
  onPick: (choice: { databaseId: string; viewId: string } | null) => void;
}) {
  const ctx = useAppContext();
  const pages = usePages();
  const done = useRef(false);
  const finish = (choice: { databaseId: string; viewId: string } | null) => {
    if (done.current) return;
    done.current = true;
    onPick(choice);
  };
  const items = useMemo<SearchListItem[]>(
    () =>
      pages
        .all()
        .filter((page) => page.kind === 'database' && !pages.isTrashed(page.id))
        .map((page) => ({
          id: page.id,
          label: displayTitle(page.title),
          icon: page.icon ? (
            <span aria-hidden="true">{page.icon}</span>
          ) : (
            <Database aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          ),
        })),
    [pages],
  );
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : finish(null))}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('pickDatabase')}</DialogTitle>
          <DialogDescription>{t('pickDatabaseHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-5">
          <SearchList
            items={items}
            label={t('searchDatabases')}
            placeholder={t('searchDatabases')}
            emptyText={t('noDatabases')}
            onEscape={() => finish(null)}
            onSelect={(item) =>
              runAction(ctx, async () => {
                const handle = await ctx.loadDatabaseDoc(item.id);
                try {
                  const [view] = listViews(handle.doc);
                  if (view) finish({ databaseId: item.id, viewId: view.id });
                } finally {
                  handle.release();
                }
              })
            }
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
