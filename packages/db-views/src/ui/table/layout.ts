import type { PropertyType } from '@tessera/core';

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

/** A column's width before anyone resizes it. */
export function defaultColumnWidth(type: PropertyType): number {
  return DEFAULT_WIDTHS[type];
}
