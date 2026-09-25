import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  VIEW_TYPES,
  duplicateView,
  moveView,
  updateView,
  type ViewConfig,
  type ViewType,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@tessera/ui';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Copy,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import {
  addDatabaseView,
  changeViewType,
  deleteViewUndoable,
  viewTypeName,
  type DatabaseRef,
} from '../model/operations';
import { VIEW_ICONS } from './common';
import { useDragAccessibility, useDragSensors } from './dnd';
import { runAction, useAfterMenuClose } from './hooks';
import { RenameInput } from './table/header-cell';

function Tab({
  view,
  active,
  index,
  count,
  tabId,
  panelId,
  readOnly,
  renaming,
  onSelect,
  onRename,
  onRenameEnd,
  onKeyDown,
  database,
  onDeleted,
}: {
  view: ViewConfig;
  active: boolean;
  index: number;
  count: number;
  tabId: string;
  panelId: string;
  readOnly: boolean;
  renaming: boolean;
  onSelect: () => void;
  onRename: () => void;
  onRenameEnd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  database: DatabaseRef;
  onDeleted: () => void;
}) {
  const ctx = useAppContext();
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
    disabled: readOnly || renaming,
  });
  const Icon = VIEW_ICONS[view.type];
  const name = view.name || viewTypeName(view.type);
  const hasMenu = active && !readOnly;
  const [menuOpen, setMenuOpen] = useState(false);
  const tabRef = useRef<HTMLButtonElement>(null);
  if (renaming) {
    return (
      <div className="flex h-8 w-40 items-center">
        <RenameInput
          initial={view.name}
          label={t('viewName')}
          onDone={(value) => {
            if (value !== null && value.trim())
              runAction(ctx, () => updateView(database.doc, view.id, { name: value }));
            onRenameEnd();
          }}
        />
      </div>
    );
  }
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative flex items-center', isDragging && 'z-10 opacity-80')}
    >
      <button
        ref={tabRef}
        type="button"
        role="tab"
        id={tabId}
        aria-selected={active}
        aria-controls={panelId}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        tabIndex={active ? 0 : -1}
        onPointerDown={(event) => listeners?.onPointerDown?.(event)}
        onKeyDown={(event) => {
          // The active tab's menu: ↓, Shift+F10 or the menu key (its chevron is for the mouse).
          if (
            hasMenu &&
            (event.key === 'ArrowDown' ||
              event.key === 'ContextMenu' ||
              (event.key === 'F10' && event.shiftKey))
          ) {
            event.preventDefault();
            setMenuOpen(true);
            return;
          }
          onKeyDown(event);
        }}
        onContextMenu={(event) => {
          if (!hasMenu) return;
          event.preventDefault();
          setMenuOpen(true);
        }}
        onClick={onSelect}
        onDoubleClick={() => {
          if (!readOnly) onRename();
        }}
        className={cn(
          'duration-fast -mb-px inline-flex h-8 max-w-48 items-center gap-1.5 border-b-2 px-2 text-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus',
          active
            ? 'border-fg font-medium text-fg'
            : 'border-transparent text-fg-muted hover:text-fg',
        )}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      {hasMenu ? (
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          {/* Outside the tab list's accessibility tree (a tab list holds only tabs): keyboard
              and screen reader users open this menu from the tab itself. */}
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              label={t('viewOptions')}
              icon={<ChevronDown />}
              tooltip={false}
              tabIndex={-1}
              aria-hidden="true"
              className="-ml-1.5"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onCloseAutoFocus={(event) => {
              // Back to the tab (the chevron takes no focus); a rename focuses its own field.
              event.preventDefault();
              tabRef.current?.focus();
            }}
          >
            <DropdownMenuItem icon={<Pencil />} onSelect={onRename}>
              {t('renameView')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<LayoutGrid />}>{t('layout')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={view.type}
                  onValueChange={(type) =>
                    runAction(ctx, () => changeViewType(database, view.id, type as ViewType))
                  }
                >
                  {VIEW_TYPES.map((type) => {
                    const TypeIcon = VIEW_ICONS[type];
                    return (
                      <DropdownMenuRadioItem key={type} value={type}>
                        <span className="flex items-center gap-2">
                          <TypeIcon aria-hidden="true" className="size-4 text-fg-muted" />
                          {viewTypeName(type)}
                        </span>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              icon={<Copy />}
              onSelect={() =>
                runAction(ctx, () =>
                  duplicateView(database.doc, view.id, { name: t('copyOf', { title: name }) }),
                )
              }
            >
              {t('duplicateView')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ArrowLeft />}
              disabled={index === 0}
              onSelect={() =>
                runAction(ctx, () => moveView(database.doc, view.id, { index: index - 1 }))
              }
            >
              {t('moveViewLeft')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ArrowRight />}
              disabled={index === count - 1}
              onSelect={() =>
                runAction(ctx, () => moveView(database.doc, view.id, { index: index + 1 }))
              }
            >
              {t('moveViewRight')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Trash2 />}
              destructive
              disabled={count <= 1}
              onSelect={() =>
                runAction(ctx, () => {
                  const handle = deleteViewUndoable(database, view.id);
                  onDeleted();
                  ctx.toast({
                    title: t('viewDeleted', { name }),
                    action: { label: t('undo'), onClick: handle.undo },
                  });
                })
              }
            >
              {t('deleteView')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * The views of a database as tabs: arrows move between them, Enter or a click switches, double
 * click renames; the active tab's menu renames, changes the layout, duplicates, moves and deletes.
 * Drag tabs to reorder them; "+" adds a view of any layout.
 */
export function ViewTabs({
  database,
  views,
  activeId,
  onSelect,
  panelId,
  idPrefix,
  readOnly,
}: {
  database: DatabaseRef;
  views: readonly ViewConfig[];
  activeId: string;
  onSelect: (viewId: string) => void;
  panelId: string;
  idPrefix: string;
  readOnly: boolean;
}) {
  const ctx = useAppContext();
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const afterAdd = useAfterMenuClose();
  const sensors = useDragSensors();
  const nameOf = useCallback(
    (id: string | number) => {
      const view = views.find((candidate) => candidate.id === id);
      return view ? view.name || viewTypeName(view.type) : String(id);
    },
    [views],
  );
  const accessibility = useDragAccessibility(nameOf);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const target = views.findIndex((view) => view.id === over.id);
    runAction(ctx, () => moveView(database.doc, String(active.id), { index: target }));
  };
  const focusTab = (index: number) => {
    const view = views[(index + views.length) % views.length];
    if (!view) return;
    onSelect(view.id);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${view.id}`)?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(views.length - 1);
    } else if (event.key === 'F2' && !readOnly) {
      event.preventDefault();
      setRenaming(views[index]?.id ?? null);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={onDragEnd}
        accessibility={accessibility}
      >
        <SortableContext
          items={views.map((view) => view.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={listRef}
            role="tablist"
            aria-label={t('views')}
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
          >
            {views.map((view, index) => (
              <Tab
                key={view.id}
                view={view}
                active={view.id === activeId}
                index={index}
                count={views.length}
                tabId={`${idPrefix}-tab-${view.id}`}
                panelId={panelId}
                readOnly={readOnly}
                renaming={renaming === view.id}
                onSelect={() => onSelect(view.id)}
                onRename={() => setRenaming(view.id)}
                onRenameEnd={() => setRenaming(null)}
                onKeyDown={(event) => onKeyDown(event, index)}
                database={database}
                onDeleted={() => {
                  const next = views[index === 0 ? 1 : index - 1];
                  if (next) onSelect(next.id);
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {!readOnly ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" label={t('addView')} icon={<Plus />} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={afterAdd.onCloseAutoFocus}>
            {VIEW_TYPES.map((type) => {
              const Icon = VIEW_ICONS[type];
              return (
                <DropdownMenuItem
                  key={type}
                  icon={<Icon />}
                  onSelect={() =>
                    runAction(ctx, () => {
                      const view = addDatabaseView(database, type);
                      onSelect(view.id);
                      afterAdd.schedule(() =>
                        requestAnimationFrame(() =>
                          document.getElementById(`${idPrefix}-tab-${view.id}`)?.focus(),
                        ),
                      );
                    })
                  }
                >
                  {viewTypeName(type)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
