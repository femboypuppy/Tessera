import type { TagColor } from '@tessera/core';

/**
 * Colors for select options whose names say what they mean, so an imported status or priority
 * column reads at a glance (Done is green, Blocked is red). Notion's CSV exports and plain CSV
 * files carry no colors; other names keep the palette's rotation.
 */
const MEANINGS: ReadonlyArray<readonly [TagColor, readonly string[]]> = [
  [
    'green',
    [
      'done',
      'complete',
      'completed',
      'finished',
      'shipped',
      'released',
      'resolved',
      'approved',
      'published',
      'live',
      'read',
      'yes',
    ],
  ],
  ['blue', ['in progress', 'doing', 'active', 'started', 'ongoing', 'reading', 'wip', 'current']],
  ['yellow', ['in review', 'review', 'reviewing', 'waiting', 'pending', 'testing', 'medium']],
  ['orange', ['on hold', 'paused', 'at risk']],
  ['red', ['blocked', 'stuck', 'overdue', 'failed', 'urgent', 'critical', 'high', 'no']],
  [
    'gray',
    [
      'not started',
      'to do',
      'todo',
      'backlog',
      'to read',
      'planned',
      'idea',
      'draft',
      'low',
      'cancelled',
      'canceled',
      'abandoned',
      'archived',
    ],
  ],
];

const BY_NAME = new Map(
  MEANINGS.flatMap(([color, names]) => names.map((name) => [name, color] as const)),
);

/** The color an option's name suggests, or undefined to let the palette pick. */
export function suggestOptionColor(name: string): TagColor | undefined {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  return BY_NAME.get(key);
}
