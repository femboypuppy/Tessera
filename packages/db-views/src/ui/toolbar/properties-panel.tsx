import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  listProperties,
  resolveViewProperties,
  type PropertyDefinition,
  type ViewConfig,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { Button, Switch, cn } from '@tessera/ui';
import { GripVertical } from 'lucide-react';
import { useCallback, useId } from 'react';
import { t } from '../../i18n';
import {
  materializeViewProperties,
  movePropertyInView,
  setAllPropertiesVisible,
  setPropertyVisible,
  type DatabaseRef,
} from '../../model/operations';
import { PropertyIcon } from '../common';
import { useDragAccessibility, useDragSensors } from '../dnd';
import { runAction } from '../hooks';

function PropertyRow({
  property,
  visible,
  onToggle,
}: {
  property: PropertyDefinition;
  visible: boolean;
  onToggle: (visible: boolean) => void;
}) {
  const id = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: property.id,
  });
  const isTitle = property.type === 'title';
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md bg-surface px-1',
        isDragging && 'relative z-10 shadow-popover',
      )}
    >
      <button
        type="button"
        aria-label={`${t('dragToReorder')}: ${property.name}`}
        className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-fg-subtle hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <PropertyIcon type={property.type} />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-ui text-fg">
        {property.name || t('untitled')}
      </label>
      <Switch id={id} checked={visible} disabled={isTitle} onCheckedChange={onToggle} />
    </li>
  );
}

/** Which properties a view shows, and in what order (drag, or the arrow keys once picked up). */
export function PropertiesPanel({
  database,
  view,
  properties,
}: {
  database: DatabaseRef;
  view: ViewConfig;
  properties: readonly PropertyDefinition[];
}) {
  const ctx = useAppContext();
  const entries = resolveViewProperties(properties, view);
  const sensors = useDragSensors({ sortable: true });
  const nameOf = useCallback(
    (id: string | number) =>
      properties.find((property) => property.id === id)?.name || t('untitled'),
    [properties],
  );
  const accessibility = useDragAccessibility(nameOf);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const list = materializeViewProperties(listProperties(database.doc), view);
    const target = list.findIndex((entry) => entry.propertyId === over.id);
    if (target >= 0)
      runAction(ctx, () => movePropertyInView(database, view.id, String(active.id), target));
  };
  return (
    <div className="flex w-72 flex-col gap-2" aria-label={t('properties')}>
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-fg-subtle">{t('shownInView')}</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runAction(ctx, () => setAllPropertiesVisible(database, view.id, true))}
          >
            {t('showAll')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runAction(ctx, () => setAllPropertiesVisible(database, view.id, false))}
          >
            {t('hideAll')}
          </Button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={accessibility}
      >
        <SortableContext
          items={entries.map((entry) => entry.property.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {entries.map((entry) => (
              <PropertyRow
                key={entry.property.id}
                property={entry.property}
                visible={entry.visible}
                onToggle={(visible) =>
                  runAction(ctx, () =>
                    setPropertyVisible(database, view.id, entry.property.id, visible),
                  )
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
