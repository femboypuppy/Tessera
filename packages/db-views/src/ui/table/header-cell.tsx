import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { updateProperty, type PropertyDefinition, type ResolvedRow } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, cn } from '@tessera/ui';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { t } from '../../i18n';
import type { DatabaseRef } from '../../model/operations';
import type { QueryContext } from '../../query/types';
import { PropertyIcon } from '../common';
import { runAction } from '../hooks';
import { PropertyMenuItems, type PropertyMenuActions } from '../property-menu';
import { HEADER_HEIGHT } from './layout';

export interface HeaderCellProps {
  id: string;
  database: DatabaseRef;
  property: PropertyDefinition;
  rows: readonly ResolvedRow[];
  queryCtx: QueryContext;
  width: number;
  /** Sticky offset from the left for frozen columns. */
  stickyLeft: number | null;
  colIndex: number;
  active: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  renaming: boolean;
  onRenameEnd: () => void;
  onResizeLive: (width: number | null) => void;
  onResizeEnd: (width: number) => void;
  actions: PropertyMenuActions;
  readOnly: boolean;
  onPointerDownCell: () => void;
  /** Runs after the column menu closed (see `useAfterMenuClose`). */
  onMenuCloseAutoFocus: (event: Event) => void;
}

/** A column header: name and type icon, its menu, inline rename, drag to reorder, resize edge. */
export function HeaderCell({
  id,
  database,
  property,
  rows,
  queryCtx,
  width,
  stickyLeft,
  colIndex,
  active,
  menuOpen,
  onMenuOpenChange,
  renaming,
  onRenameEnd,
  onResizeLive,
  onResizeEnd,
  actions,
  readOnly,
  onPointerDownCell,
  onMenuCloseAutoFocus,
}: HeaderCellProps) {
  const ctx = useAppContext();
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: property.id,
    disabled: readOnly || renaming,
  });
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);

  const resize = useRef<{ x: number; width: number } | null>(null);
  const onResizeDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    resize.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return;
    onResizeLive(Math.max(60, resize.current.width + event.clientX - resize.current.x));
  };
  const onResizeUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return;
    const next = Math.max(60, resize.current.width + event.clientX - resize.current.x);
    resize.current = null;
    onResizeLive(null);
    onResizeEnd(next);
  };

  const style: CSSProperties = {
    width,
    height: HEADER_HEIGHT,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(stickyLeft !== null ? { position: 'sticky', left: stickyLeft, zIndex: 3 } : {}),
  };
  const name = property.name || t('untitled');
  return (
    <div
      ref={setNodeRef}
      id={id}
      role="columnheader"
      aria-colindex={colIndex + 2}
      style={style}
      data-active={active || undefined}
      data-property-id={property.id}
      data-property-type={property.type}
      className={cn(
        'group/header relative flex shrink-0 items-center border-r border-b border-border bg-bg',
        active && 'outline-2 -outline-offset-2 outline-accent',
        isDragging && 'z-20 opacity-80 shadow-popover',
      )}
    >
      {renaming ? (
        <RenameInput
          initial={property.name}
          label={t('propertyName')}
          onDone={(value) => {
            if (value !== null && value.trim() !== property.name)
              runAction(ctx, () => updateProperty(database.doc, property.id, { name: value }));
            onRenameEnd();
          }}
        />
      ) : (
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange} modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label={name}
              aria-haspopup="menu"
              onPointerDown={(event) => {
                listeners?.onPointerDown?.(event);
                onPointerDownCell();
                // The menu opens on click, so a drag never opens it.
                event.preventDefault();
              }}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                onMenuOpenChange(!menuOpen);
              }}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-ui font-medium text-fg-muted outline-none hover:bg-hover"
            >
              <PropertyIcon type={property.type} />
              <span className="truncate">{name}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-60"
            onCloseAutoFocus={onMenuCloseAutoFocus}
          >
            <PropertyMenuItems
              database={database}
              property={property}
              rows={rows}
              queryCtx={queryCtx}
              actions={actions}
              readOnly={readOnly}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!readOnly ? (
        <div
          aria-hidden="true"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize after:absolute after:inset-y-1 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent hover:after:bg-accent"
        />
      ) : null}
    </div>
  );
}

/** A text field that edits a name in place: Enter or blur saves, Escape cancels. */
export function RenameInput({
  initial,
  label,
  onDone,
  className,
}: {
  initial: string;
  label: string;
  onDone: (value: string | null) => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }}
      className={cn(
        'mx-1 h-7 w-full min-w-0 rounded-md border border-accent bg-bg px-1.5 text-ui text-fg ring-2 ring-focus outline-none',
        className,
      )}
    />
  );
}
