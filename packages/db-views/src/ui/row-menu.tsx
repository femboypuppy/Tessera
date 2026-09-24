import type { ResolvedRow } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@tessera/ui';
import { Copy, FileText, MoreHorizontal, PanelRightOpen, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { duplicateRows, trashRows, type DatabaseRef } from '../model/operations';
import { displayTitle } from './common';
import { runAction } from './hooks';

/** Deletes rows (to the trash) with an Undo toast. */
export function deleteRowsWithUndo(
  ctx: Parameters<typeof trashRows>[0] & { toast: ReturnType<typeof useAppContext>['toast'] },
  ids: readonly string[],
): void {
  runAction(ctx, () => {
    const undo = trashRows(ctx, ids);
    ctx.toast({
      title: t('rowDeleted', { count: ids.length }),
      action: { label: t('undo'), onClick: undo },
    });
  });
}

/** The "…" menu of a card or list row: open, open in side peek, duplicate, delete. */
export function RowMenu({
  database,
  row,
  onOpen,
  extra,
  readOnly,
  className,
}: {
  database: DatabaseRef;
  row: ResolvedRow;
  onOpen: (mode: 'page' | 'peek') => void;
  /** Items shown before the destructive ones (a board's "Move to"). */
  extra?: ReactNode;
  readOnly: boolean;
  className?: string;
}) {
  const ctx = useAppContext();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('rowActions', { title: displayTitle(row.title) })}
          icon={<MoreHorizontal />}
          tooltip={false}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn('bg-surface', className)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem icon={<FileText />} onSelect={() => onOpen('page')}>
          {t('openRowFull')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<PanelRightOpen />} onSelect={() => onOpen('peek')}>
          {t('openInSidePeek')}
        </DropdownMenuItem>
        {!readOnly ? (
          <>
            {extra}
            <DropdownMenuItem
              icon={<Copy />}
              onSelect={() => runAction(ctx, () => duplicateRows(ctx, database, [row.id]))}
            >
              {t('duplicateRow')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Trash2 />}
              destructive
              onSelect={() => deleteRowsWithUndo(ctx, [row.id])}
            >
              {t('deleteRow')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
