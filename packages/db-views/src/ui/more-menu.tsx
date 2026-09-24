import { setRowTemplate, updateView, type ResolvedRow, type ViewConfig } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@tessera/ui';
import { FilePlus, LayoutTemplate, Snowflake, WrapText, XCircle } from 'lucide-react';
import { t } from '../i18n';
import { templatePageOf, type DatabaseRef } from '../model/operations';
import type { DatabaseSnapshot } from '../model/store';
import type { QueryResult } from '../query/run';
import type { QueryContext } from '../query/types';
import { runAction } from './hooks';
import { ViewOptionsItems } from './view-options';
import { ExportCsvItem } from './csv/export-item';

export interface MoreMenuItemsProps {
  database: DatabaseRef;
  databaseTitle: string;
  snapshot: DatabaseSnapshot;
  view: ViewConfig;
  result: QueryResult<ResolvedRow>;
  queryCtx: QueryContext;
  readOnly: boolean;
}

/** The "…" menu of a view: layout options, the row template and CSV export. */
export function MoreMenuItems({
  database,
  databaseTitle,
  snapshot,
  view,
  result,
  queryCtx,
  readOnly,
}: MoreMenuItemsProps) {
  const ctx = useAppContext();
  const template = templatePageOf(ctx, database.doc);
  return (
    <>
      {!readOnly && view.type === 'table' ? (
        <>
          <DropdownMenuLabel>{t('viewOptions')}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={view.table.wrapCells}
            onCheckedChange={(checked) =>
              runAction(ctx, () =>
                updateView(database.doc, view.id, { table: { wrapCells: checked === true } }),
              )
            }
          >
            <span className="flex items-center gap-2">
              <WrapText aria-hidden="true" className="size-4 text-fg-muted" />
              {t('wrapCells')}
            </span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={view.table.frozenColumns > 0}
            onCheckedChange={(checked) =>
              runAction(ctx, () =>
                updateView(database.doc, view.id, {
                  table: { frozenColumns: checked === true ? 1 : 0 },
                }),
              )
            }
          >
            <span className="flex items-center gap-2">
              <Snowflake aria-hidden="true" className="size-4 text-fg-muted" />
              {t('freezeFirstColumn')}
            </span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {!readOnly && view.type !== 'table' ? (
        <>
          <ViewOptionsItems database={database} snapshot={snapshot} view={view} />
          <DropdownMenuSeparator />
        </>
      ) : null}
      {!readOnly ? (
        <>
          <DropdownMenuLabel>{t('templateTitle')}</DropdownMenuLabel>
          {template ? (
            <>
              <DropdownMenuItem
                icon={<LayoutTemplate />}
                onSelect={() => ctx.navigate(template.id)}
              >
                {t('editTemplate')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<XCircle />}
                onSelect={() => runAction(ctx, () => setRowTemplate(database.doc, null))}
              >
                {t('removeTemplate')}
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              icon={<FilePlus />}
              onSelect={() =>
                runAction(ctx, () => {
                  const page = ctx.workspace.createPage({
                    parentId: database.id,
                    title: t('templateTitle'),
                  });
                  setRowTemplate(database.doc, page.id);
                  ctx.navigate(page.id);
                })
              }
            >
              {t('createTemplate')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
        </>
      ) : null}
      <ExportCsvItem
        databaseTitle={databaseTitle}
        snapshot={snapshot}
        view={view}
        result={result}
        queryCtx={queryCtx}
      />
    </>
  );
}
