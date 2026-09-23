import {
  toError,
  type PropertyType,
  type SelectOption,
  type TagColor,
  type ViewType,
} from '@tessera/core';
import { Badge, cn, getLocale } from '@tessera/ui';
import {
  AlignLeft,
  ArrowUpRight,
  AtSign,
  Calendar,
  CalendarDays,
  CircleChevronDown,
  Clock,
  GalleryVerticalEnd,
  Hash,
  History,
  LayoutList,
  Link,
  List,
  Sigma,
  SquareCheck,
  SquareKanban,
  Table2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { t } from '../i18n';

/** The icon of each property type (column headers, property lists, pickers). */
export const PROPERTY_ICONS: Readonly<Record<PropertyType, LucideIcon>> = {
  title: Type,
  text: AlignLeft,
  number: Hash,
  select: CircleChevronDown,
  multiSelect: List,
  date: Calendar,
  checkbox: SquareCheck,
  url: Link,
  email: AtSign,
  relation: ArrowUpRight,
  createdTime: Clock,
  updatedTime: History,
  formula: Sigma,
};

/** The icon of each view type (tabs, the add-view menu). */
export const VIEW_ICONS: Readonly<Record<ViewType, LucideIcon>> = {
  table: Table2,
  board: SquareKanban,
  calendar: CalendarDays,
  gallery: GalleryVerticalEnd,
  list: LayoutList,
};

/** Property types people can pick (formulas stay reserved until a formula engine ships). */
export const PICKABLE_TYPES: readonly PropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'email',
  'relation',
  'createdTime',
  'updatedTime',
];

export function PropertyIcon({ type, className }: { type: PropertyType; className?: string }) {
  const Icon = PROPERTY_ICONS[type];
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0 text-fg-subtle', className)} />;
}

/** The translated name of a property type. */
export function typeLabel(type: PropertyType): string {
  return t(`type_${type}`);
}

/** The translated name of a tag color. */
export function colorLabel(color: TagColor): string {
  return t(`color_${color}`);
}

/** A select option as a colored tag. */
export function OptionBadge({
  option,
  className,
  children,
  ...props
}: { option: Pick<SelectOption, 'color' | 'name'>; children?: ReactNode } & Omit<
  ComponentProps<'span'>,
  'children'
>) {
  return (
    <Badge tone={option.color} className={cn('max-w-full shrink-0', className)} {...props}>
      <span className="truncate">{option.name}</span>
      {children}
    </Badge>
  );
}

/** A row or page title for display ("Untitled" when empty). */
export function displayTitle(title: string | undefined): string {
  return title?.trim() ? title : t('untitled');
}

/**
 * The locale for numbers and dates: the browser's regional variant when it matches the app's
 * language (en-GB for English), else the app's language.
 */
export function displayLocale(): string {
  const app = getLocale();
  const browser = typeof navigator === 'undefined' ? '' : navigator.language;
  return browser && browser.split('-')[0] === app.split('-')[0] ? browser : app;
}

/** Turns an unknown failure into a short message for a toast. */
export function errorMessage(error: unknown): string {
  return toError(error).message;
}
