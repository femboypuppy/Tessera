import {
  getCellValue,
  type DateValue,
  type JsonValue,
  type PropertyDefinition,
  type ResolvedRow,
} from '@tessera/core';

const CURRENCY_PREFIX: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
  KRW: '₩',
};

function trimFloat(value: number): string {
  return String(Number(value.toPrecision(15)));
}

function formatNumber(value: number, property: PropertyDefinition): string {
  const config = property.number;
  if (config?.format === 'percent') return `${trimFloat(value * 100)}%`;
  if (config?.format === 'currency') {
    const digits = config.precision ?? 2;
    const amount = Math.abs(value)
      .toFixed(digits)
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sign = value < 0 ? '-' : '';
    const prefix = CURRENCY_PREFIX[config.currency];
    return prefix ? `${sign}${prefix}${amount}` : `${sign}${amount} ${config.currency}`;
  }
  return trimFloat(value);
}

function formatDate(value: DateValue): string {
  return value.end ? `${value.start} → ${value.end}` : value.start;
}

function isDateValue(value: JsonValue): value is DateValue & Record<string, JsonValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.start === 'string'
  );
}

/**
 * A cell as CSV text, in forms the importer reads back to the same type: option names, `Yes`/`No`,
 * ISO dates (`A → B` ranges), `45%`, `$1,200.00`, and relations as `Title (path/to/Page.md)`.
 */
export function formatCell(
  row: ResolvedRow,
  property: PropertyDefinition,
  relationLink: (pageId: string) => string | null,
): string {
  const value = getCellValue(row, property);
  if (value === null || value === undefined) return '';
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
      return typeof value === 'string' ? value : '';
    case 'number':
      return typeof value === 'number' ? formatNumber(value, property) : '';
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    case 'select':
      return property.options?.find((option) => option.id === value)?.name ?? '';
    case 'multiSelect':
      return Array.isArray(value)
        ? value
            .map((id) => property.options?.find((option) => option.id === id)?.name)
            .filter((name): name is string => Boolean(name))
            .join(', ')
        : '';
    case 'date':
      return isDateValue(value) ? formatDate(value) : '';
    case 'createdTime':
    case 'updatedTime':
      return typeof value === 'number' ? new Date(value).toISOString() : '';
    case 'relation':
      return Array.isArray(value)
        ? value
            .map((id) => (typeof id === 'string' ? relationLink(id) : null))
            .filter((link): link is string => link !== null)
            .join(', ')
        : '';
    default:
      return '';
  }
}
