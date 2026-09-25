import type { PropertyType } from '@tessera/core';
import type { CSSProperties } from 'react';

/** Fixed sizes of the table grid, in CSS pixels. */
export const ROW_HEIGHT = 34;
export const HEADER_HEIGHT = 34;
export const FOOTER_HEIGHT = 34;
export const GROUP_HEIGHT = 42;
export const GUTTER_WIDTH = 30;
export const ADD_COLUMN_WIDTH = 40;

const DEFAULT_WIDTHS: Readonly<Record<PropertyType, number>> = {
  title: 280,
  text: 220,
  number: 120,
  select: 160,
  multiSelect: 220,
  date: 180,
  checkbox: 100,
  url: 200,
  email: 200,
  relation: 220,
  createdTime: 180,
  updatedTime: 180,
  formula: 160,
};

/**
 * Frozen columns stick only while the table is wider than its scroller (the grid's
 * `data-scrolls-x`, see `TableView`): a sticky cell is a compositor layer of its own, two in every
 * row, which costs each scrolled frame work that buys nothing when nothing scrolls sideways.
 * `STICKY` is the class of the gutter and of labels pinned to the left edge.
 */
export const STICKY = 'group-data-[scrolls-x]/grid:sticky';

/** The class of a frozen column's cells: they stick at `--frozen-left` (see {@link frozenStyle}). */
export const FROZEN =
  'group-data-[scrolls-x]/grid:sticky group-data-[scrolls-x]/grid:left-(--frozen-left)';

/** The inline style of a frozen column's cell (none for other columns). */
export function frozenStyle(stickyLeft: number | null, zIndex: number): CSSProperties {
  return stickyLeft === null
    ? {}
    : ({ '--frozen-left': `${stickyLeft}px`, zIndex } as CSSProperties);
}

/** A column's width before anyone resizes it. */
export function defaultColumnWidth(type: PropertyType): number {
  return DEFAULT_WIDTHS[type];
}
