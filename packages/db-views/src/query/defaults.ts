import {
  EMPTY_GROUP_KEY,
  type FilterGroup,
  type JsonValue,
  type PropertyDefinition,
} from '@tessera/core';
import { resolveDateOperand, todayKey } from './dates';
import type { QueryContext } from './types';

/**
 * Values for a new row so it shows up where it was added: what the view's top-level AND filter
 * conditions require (`Status is Done` → Done, `Tags contain Design` → [Design], `Done is checked`
 * → true) and, when added in a group, that group's value. Conditions that allow many values (`is
 * after`, `contains` on text) set nothing.
 *
 * @example
 * const values = newRowDefaults(view.filter, properties, ctx, { propertyId: statusId, key: doneId });
 */
export function newRowDefaults(
  filter: FilterGroup | null,
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
  group?: { propertyId: string; key: string },
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  const byId = new Map(properties.map((property) => [property.id, property]));
  const knows = (property: PropertyDefinition, id: unknown): id is string =>
    typeof id === 'string' && !!property.options?.some((option) => option.id === id);

  if (filter?.conjunction === 'and') {
    for (const node of filter.children) {
      if (node.type !== 'condition') continue;
      const property = byId.get(node.propertyId);
      if (!property) continue;
      const { operator, value } = node;
      switch (property.type) {
        case 'select':
          if (operator === 'is' && knows(property, value)) values[property.id] = value;
          if (operator === 'isAnyOf' && Array.isArray(value) && knows(property, value[0]))
            values[property.id] = value[0];
          break;
        case 'multiSelect':
          if (operator === 'contains' && knows(property, value)) values[property.id] = [value];
          if (operator === 'containsAllOf' && Array.isArray(value)) {
            const ids = value.filter((id) => knows(property, id));
            if (ids.length > 0) values[property.id] = ids;
          }
          if (operator === 'containsAnyOf' && Array.isArray(value) && knows(property, value[0]))
            values[property.id] = [value[0]];
          break;
        case 'checkbox':
          if (operator === 'is' && value === true) values[property.id] = true;
          if (operator === 'isNotEmpty') values[property.id] = true;
          break;
        case 'relation':
          if (operator === 'contains' && typeof value === 'string' && value)
            values[property.id] = [value];
          break;
        case 'text':
        case 'url':
        case 'email':
          if (operator === 'is' && typeof value === 'string' && value.trim())
            values[property.id] = value;
          break;
        case 'number':
          if (operator === 'is' && typeof value === 'number' && Number.isFinite(value))
            values[property.id] = value;
          break;
        case 'date': {
          if (
            operator !== 'is' ||
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value)
          )
            break;
          if (value.kind !== 'exact' && value.kind !== 'relative') break;
          const day = resolveDateOperand(value, todayKey(ctx.now, ctx.timeZone));
          if (day) values[property.id] = { start: day };
          break;
        }
        default:
          break;
      }
    }
  }

  const groupProperty = group ? byId.get(group.propertyId) : undefined;
  if (group && groupProperty && group.key !== EMPTY_GROUP_KEY) {
    const { key } = group;
    switch (groupProperty.type) {
      case 'select':
        if (knows(groupProperty, key)) values[groupProperty.id] = key;
        break;
      case 'multiSelect':
        if (knows(groupProperty, key)) values[groupProperty.id] = [key];
        break;
      case 'checkbox':
        values[groupProperty.id] = key === 'true';
        break;
      case 'number': {
        const number = Number(key);
        if (Number.isFinite(number)) values[groupProperty.id] = number;
        break;
      }
      case 'text':
      case 'url':
      case 'email':
        values[groupProperty.id] = key;
        break;
      case 'date':
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) values[groupProperty.id] = { start: key };
        break;
      default:
        break;
    }
  }
  if (group && groupProperty?.type === 'checkbox' && values[groupProperty.id] === false) {
    delete values[groupProperty.id];
  }
  return values;
}
