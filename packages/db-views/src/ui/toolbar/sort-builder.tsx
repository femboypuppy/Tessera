import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { updateView, type PropertyDefinition, type SortRule, type ViewConfig } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { Button, IconButton, Select, cn } from '@tessera/ui';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { t } from '../../i18n';
import type { DatabaseRef } from '../../model/operations';
import { PropertyIcon } from '../common';
import { useDragAccessibility, useDragSensors } from '../dnd';
import { runAction } from '../hooks';

function SortRow({
  rule,
  index,
  count,
  properties,
  onChange,
  onMove,
  onRemove,
}: {
  rule: SortRule;
  index: number;
  count: number;
  properties: readonly PropertyDefinition[];
  onChange: (rule: SortRule) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.propertyId,
  });
  const property = properties.find((candidate) => candidate.id === rule.propertyId);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 rounded-md bg-surface',
        isDragging && 'relative z-10 shadow-popover',
      )}
    >
      <button
        type="button"
        aria-label={`${t('dragToReorder')}: ${property?.name ?? ''}`}
        className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-fg-subtle hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <Select
        size="sm"
        aria-label={t('filterProperty')}
        className="min-w-0 flex-1"
        value={rule.propertyId}
        onValueChange={(propertyId) => onChange({ ...rule, propertyId })}
        options={properties.map((candidate) => ({
          value: candidate.id,
          label: (
            <span className="flex items-center gap-1.5">
              <PropertyIcon type={candidate.type} />
              <span className="truncate">{candidate.name || t('untitled')}</span>
            </span>
          ),
        }))}
      />
      <Select
        size="sm"
        aria-label={t('sort')}
        className="w-32 shrink-0"
        value={rule.direction}
        onValueChange={(direction) =>
          onChange({ ...rule, direction: direction === 'desc' ? 'desc' : 'asc' })
        }
        options={[
          { value: 'asc', label: t('sortAscending') },
          { value: 'desc', label: t('sortDescending') },
        ]}
      />
      <IconButton
        size="sm"
        label={t('moveUp')}
        icon={<ArrowUp />}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      />
      <IconButton
        size="sm"
        label={t('moveDown')}
        icon={<ArrowDown />}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      />
      <IconButton size="sm" label={t('deleteSort')} icon={<Trash2 />} onClick={onRemove} />
    </li>
  );
}

/** Edits a view's sort rules: add, change, reorder (drag or the arrows) and remove. */
export function SortBuilder({
  database,
  view,
  properties,
}: {
  database: DatabaseRef;
  view: ViewConfig;
  properties: readonly PropertyDefinition[];
}) {
  const ctx = useAppContext();
  const sorts = view.sorts.filter((rule) =>
    properties.some((property) => property.id === rule.propertyId),
  );
  const write = (next: SortRule[]) =>
    runAction(ctx, () => updateView(database.doc, view.id, { sorts: next }));
  const sensors = useDragSensors({ sortable: true });
  const nameOf = useCallback(
    (id: string | number) =>
      properties.find((property) => property.id === id)?.name || t('untitled'),
    [properties],
  );
  const accessibility = useDragAccessibility(nameOf);
  const unused = properties.filter(
    (property) => !sorts.some((rule) => rule.propertyId === property.id),
  );
  const move = (index: number, offset: number) => {
    const next = [...sorts];
    const [rule] = next.splice(index, 1);
    if (!rule) return;
    next.splice(index + offset, 0, rule);
    write(next);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = sorts.findIndex((rule) => rule.propertyId === active.id);
    const to = sorts.findIndex((rule) => rule.propertyId === over.id);
    if (from >= 0 && to >= 0) move(from, to - from);
  };
  return (
    <div
      className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2"
      aria-label={t('sortBuilder')}
    >
      {sorts.length === 0 ? <p className="px-1 text-ui text-fg-muted">{t('addSort')}</p> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={accessibility}
      >
        <SortableContext
          items={sorts.map((rule) => rule.propertyId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1">
            {sorts.map((rule, index) => (
              <SortRow
                key={rule.propertyId}
                rule={rule}
                index={index}
                count={sorts.length}
                properties={properties.filter(
                  (property) =>
                    property.id === rule.propertyId ||
                    !sorts.some((other) => other.propertyId === property.id),
                )}
                onChange={(next) => write(sorts.map((other, i) => (i === index ? next : other)))}
                onMove={(offset) => move(index, offset)}
                onRemove={() => write(sorts.filter((_, i) => i !== index))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={unused.length === 0}
          onClick={() => {
            const next = unused[0];
            if (next) write([...sorts, { propertyId: next.id, direction: 'asc' }]);
          }}
        >
          <Plus aria-hidden="true" />
          {t('addSort')}
        </Button>
        {sorts.length > 0 ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => write([])}>
            {t('removeSort')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
