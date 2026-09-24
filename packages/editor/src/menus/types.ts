import type { IconComponent } from '@tessera/core';

/** One row of a suggestion menu (the slash menu, page autocomplete). */
export interface MenuItem {
  id: string;
  title: string;
  description?: string;
  /** A lucide icon or an emoji. */
  icon?: IconComponent | string | null;
  /** A shortcut hint shown on the right (`#`, `-`, `[]`…). */
  hint?: string;
  keywords?: readonly string[];
}

/** A titled group of rows. */
export interface MenuSection<T extends MenuItem = MenuItem> {
  id: string;
  label: string;
  items: T[];
}

/** An open suggestion menu. Items are grouped for display; keyboard focus moves over `flat`. */
export interface SuggestionMenuState<T extends MenuItem = MenuItem> {
  /** Slash commands, page autocomplete, or the choices after pasting a URL. */
  kind: 'slash' | 'page' | 'paste';
  /** Accessible name of the listbox. */
  label: string;
  query: string;
  sections: MenuSection<T>[];
  flat: T[];
  active: number;
  /** The caret rectangle to anchor to (read again on scroll and resize). */
  getRect: (() => DOMRect | null) | null;
  /** Shown when nothing matches. */
  emptyLabel: string;
  /** True while the first results are still loading (nothing to show yet). */
  loading?: boolean;
  select(item: T): void;
}

/** Flattens sections into the keyboard order. */
export function flattenSections<T extends MenuItem>(sections: MenuSection<T>[]): T[] {
  return sections.flatMap((section) => section.items);
}
