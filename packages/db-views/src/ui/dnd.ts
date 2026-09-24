import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMemo } from 'react';
import { t } from '../i18n';

/**
 * Pointer (after a few pixels, so clicks still click) and keyboard sensors for dnd-kit: Space or
 * Enter picks up, arrows move, Space or Enter drops, Escape cancels.
 */
export function useDragSensors(options: { sortable?: boolean } = {}) {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(
      KeyboardSensor,
      options.sortable ? { coordinateGetter: sortableKeyboardCoordinates } : {},
    ),
  );
}

/** Translated screen reader messages for dragging; `name` turns an ID into a label. */
export function useDragAccessibility(name: (id: UniqueIdentifier) => string): {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
} {
  return useMemo(
    () => ({
      screenReaderInstructions: { draggable: t('dndInstructions') },
      announcements: {
        onDragStart: ({ active }) => t('dndPickedUp', { name: name(active.id) }),
        onDragOver: ({ active, over }) =>
          over
            ? t('dndOver', { name: name(active.id), target: name(over.id) })
            : t('dndOutside', { name: name(active.id) }),
        onDragEnd: ({ active, over }) =>
          over
            ? t('dndDropped', { name: name(active.id), target: name(over.id) })
            : t('dndDroppedNowhere', { name: name(active.id) }),
        onDragCancel: ({ active }) => t('dndCancelled', { name: name(active.id) }),
      },
    }),
    [name],
  );
}
