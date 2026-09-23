import {
  updateView,
  type PropertyDefinition,
  type ResolvedRow,
  type SummaryKind,
  type ViewConfig,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  cn,
} from '@tessera/ui';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';
import { t } from '../../i18n';
import type { DatabaseRef } from '../../model/operations';
import { DAY_MS } from '../../query/dates';
import { formatDateValue, formatNumber } from '../../query/format';
import { SUMMARY_KINDS_BY_TYPE, computeSummary, type SummaryResult } from '../../query/summary';
import type { QueryContext } from '../../query/types';
import { runAction } from '../hooks';
import { FOOTER_HEIGHT, GUTTER_WIDTH } from './layout';
import type { TableColumn } from './table-row';

/** A duration in days, weeks, months or years, whichever reads best. */
export function formatDuration(ms: number): string {
  const days = Math.round(ms / DAY_MS);
  if (days < 14) return t('durationDays', { count: days });
  if (days < 60) return t('durationWeeks', { count: Math.round(days / 7) });
  if (days < 730) return t('durationMonths', { count: Math.round(days / 30.44) });
  return t('durationYears', { count: Math.round(days / 365.25) });
}

/** A computed summary as display text. */
export function formatSummary(
  result: SummaryResult,
  property: PropertyDefinition,
  queryCtx: QueryContext,
): string {
  switch (result.type) {
    case 'none':
      return '';
    case 'count':
      return new Intl.NumberFormat(queryCtx.locale).format(result.value);
    case 'percent':
      return new Intl.NumberFormat(queryCtx.locale, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(result.value);
    case 'number':
      return result.value === null
        ? '—'
        : formatNumber(result.value, property.number, queryCtx.locale);
    case 'date':
      return result.value ? formatDateValue(result.value, property.date, queryCtx) : '—';
    case 'duration':
      return result.value === null ? '—' : formatDuration(result.value);
  }
}

/** The short label shown before a summary value ("Sum", "Checked"). */
function kindLabel(kind: SummaryKind): string {
  return t(`summary_${kind}`);
}

export interface SummaryRowProps {
  gridId: string;
  database: DatabaseRef;
  view: ViewConfig;
  columns: readonly TableColumn[];
  totalWidth: number;
  rows: readonly ResolvedRow[];
  queryCtx: QueryContext;
  activeCol: number | null;
  menuCol: number | null;
  onMenuChange: (col: number | null) => void;
  ariaRowIndex: number;
  readOnly: boolean;
}

/** The sticky footer: a summary per column, picked from the column's footer menu. */
export function SummaryRow({
  gridId,
  database,
  view,
  columns,
  totalWidth,
  rows,
  queryCtx,
  activeCol,
  menuCol,
  onMenuChange,
  ariaRowIndex,
  readOnly,
}: SummaryRowProps) {
  const ctx = useAppContext();
  const summaries = view.table.summaries;
  const values = useMemo(
    () =>
      columns.map((column) => {
        const kind = summaries[column.property.id] ?? 'none';
        return kind === 'none'
          ? ''
          : formatSummary(
              computeSummary(kind, rows, column.property, queryCtx),
              column.property,
              queryCtx,
            );
      }),
    [columns, summaries, rows, queryCtx],
  );
  return (
    <div
      role="row"
      aria-rowindex={ariaRowIndex}
      className="sticky bottom-0 z-[4] flex border-t border-border bg-bg"
      style={{ width: totalWidth, height: FOOTER_HEIGHT }}
    >
      <div className="sticky left-0 z-[2] shrink-0 bg-bg" style={{ width: GUTTER_WIDTH }} />
      {columns.map((column, col) => {
        const kind = summaries[column.property.id] ?? 'none';
        const value = values[col] ?? '';
        const kinds = SUMMARY_KINDS_BY_TYPE[column.property.type];
        return (
          <div
            key={column.property.id}
            id={`${gridId}-footer-${col}`}
            role="gridcell"
            aria-colindex={col + 2}
            data-active={activeCol === col || undefined}
            className={cn(
              'group/summary flex shrink-0 items-center justify-end bg-bg',
              activeCol === col &&
                'outline-2 -outline-offset-2 outline-transparent group-focus-within/grid:outline-accent',
            )}
            style={{
              width: column.width,
              ...(column.stickyLeft !== null
                ? { position: 'sticky', left: column.stickyLeft, zIndex: 1 }
                : {}),
            }}
          >
            <DropdownMenu
              open={menuCol === col}
              onOpenChange={(open) => onMenuChange(open ? col : null)}
              modal={false}
            >
              <DropdownMenuTrigger asChild disabled={readOnly}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(
                    'flex h-full max-w-full min-w-0 items-center justify-end gap-1 px-2 text-xs text-fg-muted outline-none hover:bg-hover',
                    kind === 'none' &&
                      'opacity-0 group-hover/summary:opacity-100 data-[state=open]:opacity-100',
                    activeCol === col && 'opacity-100',
                  )}
                >
                  {kind === 'none' ? (
                    <>
                      {t('summaryLabel')}
                      <ChevronDown aria-hidden="true" className="size-3" />
                    </>
                  ) : (
                    <>
                      <span className="shrink-0 text-fg-subtle">{kindLabel(kind)}</span>
                      <span className="truncate font-medium text-fg tabular-nums">{value}</span>
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuLabel>{column.property.name || t('untitled')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={kind}
                  onValueChange={(next) =>
                    runAction(ctx, () =>
                      updateView(database.doc, view.id, {
                        table: {
                          summaries: { ...summaries, [column.property.id]: next as SummaryKind },
                        },
                      }),
                    )
                  }
                >
                  {kinds.map((candidate) => (
                    <DropdownMenuRadioItem key={candidate} value={candidate}>
                      {kindLabel(candidate)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );
}
