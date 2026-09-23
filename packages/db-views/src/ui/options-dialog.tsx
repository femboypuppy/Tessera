import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  TAG_COLORS,
  moveSelectOption,
  updateSelectOption,
  type PropertyDefinition,
  type SelectOption,
  type TagColor,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Badge,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  cn,
} from '@tessera/ui';
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { t } from '../i18n';
import { deleteOptionUndoable, ensureOption, type DatabaseRef } from '../model/operations';
import { OptionBadge, colorLabel } from './common';
import { useDragAccessibility, useDragSensors } from './dnd';
import { runAction } from './hooks';

function OptionRow({
  database,
  property,
  option,
  index,
  count,
}: {
  database: DatabaseRef;
  property: PropertyDefinition;
  option: SelectOption;
  index: number;
  count: number;
}) {
  const ctx = useAppContext();
  const [name, setName] = useState(option.name);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  });
  const rename = () => {
    const next = name.trim();
    if (!next) {
      setName(option.name);
      return;
    }
    if (next !== option.name)
      runAction(ctx, () =>
        updateSelectOption(database.doc, property.id, option.id, { name: next }),
      );
  };
  const move = (offset: number) =>
    runAction(ctx, () => {
      const siblings = property.options ?? [];
      const target = siblings[index + offset];
      if (!target) return;
      moveSelectOption(
        database.doc,
        property.id,
        option.id,
        offset < 0 ? { before: target.id } : { after: target.id },
      );
    });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 rounded-md bg-surface py-1 pr-1',
        isDragging && 'relative z-10 shadow-popover',
      )}
    >
      <button
        type="button"
        aria-label={`${t('dragToReorder')}: ${option.name}`}
        className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-fg-subtle hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <Input
        aria-label={t('renameOption')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            rename();
          }
        }}
        className="h-7 min-w-0 flex-1"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${t('optionColor')}: ${colorLabel(option.color)}`}
            className="inline-flex h-7 shrink-0 items-center rounded-md px-1 hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            <Badge tone={option.color} className="w-5 px-0" aria-hidden="true">
              &nbsp;
            </Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={option.color}
            onValueChange={(color) =>
              runAction(ctx, () =>
                updateSelectOption(database.doc, property.id, option.id, {
                  color: color as TagColor,
                }),
              )
            }
          >
            {TAG_COLORS.map((color) => (
              <DropdownMenuRadioItem key={color} value={color}>
                <span className="flex items-center gap-2">
                  <Badge tone={color} className="w-4 px-0" aria-hidden="true">
                    &nbsp;
                  </Badge>
                  {colorLabel(color)}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        size="sm"
        label={t('moveUp')}
        icon={<ArrowUp />}
        disabled={index === 0}
        onClick={() => move(-1)}
      />
      <IconButton
        size="sm"
        label={t('moveDown')}
        icon={<ArrowDown />}
        disabled={index === count - 1}
        onClick={() => move(1)}
      />
      <IconButton
        size="sm"
        label={t('deleteOption')}
        icon={<Trash2 />}
        onClick={() =>
          runAction(ctx, () => {
            const handle = deleteOptionUndoable(database, property.id, option.id);
            ctx.toast({
              title: t('optionDeleted', { name: option.name }),
              action: { label: t('undo'), onClick: handle.undo },
            });
          })
        }
      />
    </li>
  );
}

/**
 * Edits a select property's options: rename, recolor, reorder (drag or the arrow buttons),
 * delete (with Undo) and add.
 */
export function OptionsDialog({
  open,
  onOpenChange,
  database,
  property,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: DatabaseRef;
  property: PropertyDefinition;
}) {
  const ctx = useAppContext();
  const [draft, setDraft] = useState('');
  const options = useMemo(() => property.options ?? [], [property.options]);
  const sensors = useDragSensors({ sortable: true });
  const nameOf = useCallback(
    (id: string | number) => options.find((option) => option.id === id)?.name ?? String(id),
    [options],
  );
  const accessibility = useDragAccessibility(nameOf);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = options.findIndex((option) => option.id === active.id);
    const to = options.findIndex((option) => option.id === over.id);
    if (from < 0 || to < 0) return;
    runAction(ctx, () =>
      moveSelectOption(
        database.doc,
        property.id,
        String(active.id),
        to > from ? { after: String(over.id) } : { before: String(over.id) },
      ),
    );
  };
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    runAction(ctx, () => ensureOption(database.doc, property.id, name));
    setDraft('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {t('options')} · {property.name || t('untitled')}
          </DialogTitle>
          <DialogDescription>{t('dragToReorder')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
            accessibility={accessibility}
          >
            <SortableContext
              items={options.map((option) => option.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-0.5" aria-label={t('options')}>
                {options.map((option, index) => (
                  <OptionRow
                    key={`${option.id}:${option.name}`}
                    database={database}
                    property={property}
                    option={option}
                    index={index}
                    count={options.length}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="mt-3 flex items-center gap-2">
            <Input
              aria-label={t('addOption')}
              placeholder={t('addOption')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
            />
          </div>
          {options.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1" aria-hidden="true">
              {options.map((option) => (
                <OptionBadge key={option.id} option={option} />
              ))}
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
