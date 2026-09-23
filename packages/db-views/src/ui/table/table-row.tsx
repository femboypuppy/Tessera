import type { PropertyDefinition, ResolvedRow } from '@tessera/core';
import { Popover, PopoverAnchor, PopoverContent, cn } from '@tessera/ui';
import { MoreHorizontal, PanelRightOpen } from 'lucide-react';
import { memo, type MouseEvent, type PointerEvent } from 'react';
import { t } from '../../i18n';
import type { DatabaseRef } from '../../model/operations';
import type { QueryContext } from '../../query/types';
import { displayTitle } from '../common';
import { CellDisplay } from '../cells/display';
import {
  DateCellEditor,
  OptionsCellEditor,
  POPOVER_EDITOR_TYPES,
  RelationCellEditor,
  TextCellEditor,
  type CellEditorProps,
  type EditMove,
} from '../cells/editors';
import { GUTTER_WIDTH } from './layout';

/** A visible column with its geometry. */
export interface TableColumn {
  property: PropertyDefinition;
  width: number;
  /** Offset from the start of the row (after the gutter). */
  left: number;
  /** Sticky offset for frozen columns, null otherwise. */
  stickyLeft: number | null;
}

export interface CellEvents {
  onCellPointerDown: (rowIndex: number, col: number, event: PointerEvent<HTMLDivElement>) => void;
  onCellPointerEnter: (rowIndex: number, col: number) => void;
  onCellClick: (rowIndex: number, col: number, event: MouseEvent<HTMLDivElement>) => void;
  onCellDoubleClick: (rowIndex: number, col: number) => void;
  onEditDone: (move?: EditMove) => void;
  onOpenPeek: (rowId: string) => void;
  onRowMenu: (rowIndex: number, x: number, y: number) => void;
}

export interface TableRowProps {
  gridId: string;
  database: DatabaseRef;
  row: ResolvedRow;
  rowIndex: number;
  /** 1-based, counting the header row (ARIA). */
  ariaRowIndex: number;
  columns: readonly TableColumn[];
  totalWidth: number;
  top: number;
  height: number | null;
  measure?: (element: HTMLElement | null) => void;
  itemIndex: number;
  activeCol: number | null;
  rangeCols: readonly [number, number] | null;
  editing: { col: number; initialText: string | null } | null;
  wrap: boolean;
  readOnly: boolean;
  queryCtx: QueryContext;
  events: CellEvents;
}

/** The id of a cell element, for `aria-activedescendant`. */
export function cellElementId(gridId: string, rowIndex: number, col: number): string {
  return `${gridId}-cell-${rowIndex}-${col}`;
}

function Editor(props: CellEditorProps) {
  switch (props.property.type) {
    case 'select':
    case 'multiSelect':
      return <OptionsCellEditor {...props} />;
    case 'date':
      return <DateCellEditor {...props} />;
    case 'relation':
      return <RelationCellEditor {...props} />;
    default:
      return <TextCellEditor {...props} />;
  }
}

/** One row of the table grid. Memoized: only rows whose data or selection changed re-render. */
export const TableRow = memo(function TableRow({
  gridId,
  database,
  row,
  rowIndex,
  ariaRowIndex,
  columns,
  totalWidth,
  top,
  height,
  measure,
  itemIndex,
  activeCol,
  rangeCols,
  editing,
  wrap,
  readOnly,
  queryCtx,
  events,
}: TableRowProps) {
  const selectedRow = rangeCols !== null;
  return (
    // Rows and cells are not focusable: the grid keeps focus and points at the active cell with
    // aria-activedescendant (the ARIA grid pattern for virtualized grids).
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- ARIA grid with aria-activedescendant
    <div
      ref={measure}
      role="row"
      aria-rowindex={ariaRowIndex}
      aria-selected={selectedRow || undefined}
      data-index={itemIndex}
      data-row-id={row.id}
      className="group/row absolute top-0 left-0 flex border-b border-border bg-bg"
      style={{
        width: totalWidth,
        transform: `translateY(${top}px)`,
        ...(height !== null ? { height } : { minHeight: 34 }),
      }}
      onContextMenu={(event) => {
        if (readOnly) return;
        event.preventDefault();
        events.onRowMenu(rowIndex, event.clientX, event.clientY);
      }}
    >
      <div
        className="sticky left-0 z-[2] flex shrink-0 items-center justify-center bg-bg"
        style={{ width: GUTTER_WIDTH }}
      >
        {!readOnly ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('rowActions', { title: displayTitle(row.title) })}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              events.onRowMenu(rowIndex, rect.left, rect.bottom);
            }}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
      {columns.map((column, col) => {
        const { property } = column;
        const active = activeCol === col;
        const inRange = rangeCols !== null && col >= rangeCols[0] && col <= rangeCols[1];
        const isEditing = editing?.col === col;
        const popover = isEditing && POPOVER_EDITOR_TYPES.has(property.type);
        const editorProps: CellEditorProps = {
          database,
          row,
          property,
          queryCtx,
          initialText: editing?.initialText ?? null,
          onDone: events.onEditDone,
        };
        const content = (
          <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-2">
            {property.type === 'title' && row.icon ? (
              <span aria-hidden="true" className="shrink-0 text-[15px] leading-none">
                {row.icon}
              </span>
            ) : null}
            <CellDisplay
              row={row}
              property={property}
              queryCtx={queryCtx}
              wrap={wrap}
              className={property.type === 'title' ? 'font-medium' : undefined}
            />
          </div>
        );
        return (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- ARIA grid with aria-activedescendant (keys go to the grid)
          <div
            key={property.id}
            id={cellElementId(gridId, rowIndex, col)}
            role="gridcell"
            aria-colindex={col + 2}
            aria-selected={inRange || undefined}
            aria-readonly={readOnly || undefined}
            data-active={active || undefined}
            data-in-range={inRange || undefined}
            data-property-id={property.id}
            onPointerDown={(event) => events.onCellPointerDown(rowIndex, col, event)}
            onPointerEnter={() => events.onCellPointerEnter(rowIndex, col)}
            onClick={(event) => events.onCellClick(rowIndex, col, event)}
            onDoubleClick={() => events.onCellDoubleClick(rowIndex, col)}
            style={{
              width: column.width,
              ...(column.stickyLeft !== null
                ? { position: 'sticky', left: column.stickyLeft, zIndex: 1 }
                : {}),
            }}
            className={cn(
              'relative flex shrink-0 cursor-default items-start border-r border-border bg-bg py-1.5 select-none',
              !wrap && 'items-center py-0',
              inRange && 'bg-selected',
              active && 'z-[2] outline-2 -outline-offset-2 outline-accent',
            )}
          >
            {content}
            {property.type === 'title' && !isEditing ? (
              <button
                type="button"
                tabIndex={-1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  events.onOpenPeek(row.id);
                }}
                className="absolute top-1/2 right-1.5 hidden h-6 -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-surface px-1.5 text-xs font-medium text-fg-muted shadow-subtle group-hover/row:inline-flex hover:bg-hover hover:text-fg"
              >
                <PanelRightOpen aria-hidden="true" className="size-3.5" />
                {t('openRow')}
              </button>
            ) : null}
            {isEditing && !popover ? (
              <div
                className="absolute top-0 left-0 z-30 min-w-full rounded-sm bg-surface shadow-popover ring-2 ring-accent"
                style={{
                  width: property.type === 'text' ? Math.max(column.width, 320) : undefined,
                }}
              >
                <Editor {...editorProps} />
              </div>
            ) : null}
            {popover ? (
              <Popover
                open
                onOpenChange={(open) => {
                  if (!open) events.onEditDone(null);
                }}
              >
                <PopoverAnchor className="absolute inset-0" />
                <PopoverContent
                  align="start"
                  sideOffset={2}
                  className="p-2"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Editor {...editorProps} />
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
