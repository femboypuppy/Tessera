import {
  FILTER_OPERATORS_BY_TYPE,
  newId,
  type DateOperand,
  type DateRangeOperand,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  type FilterValue,
  type PropertyDefinition,
  type PropertyType,
} from '@tessera/core';

/*
 * Immutable edits of a view's filter tree, for the filter builder. Every function returns a new
 * tree; the builder writes it back with `updateView`.
 */

/** Operators that take no value. */
export const VALUELESS_OPERATORS: readonly FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/** Operators that take a list of option or page IDs. */
export const LIST_OPERATORS: readonly FilterOperator[] = [
  'isAnyOf',
  'isNoneOf',
  'containsAnyOf',
  'containsAllOf',
  'containsNoneOf',
];

const DEFAULT_OPERATORS: Readonly<Record<PropertyType, FilterOperator>> = {
  title: 'contains',
  text: 'contains',
  url: 'contains',
  email: 'contains',
  number: 'is',
  select: 'is',
  multiSelect: 'contains',
  date: 'is',
  createdTime: 'is',
  updatedTime: 'is',
  checkbox: 'is',
  relation: 'contains',
  formula: 'isNotEmpty',
};

const TODAY: DateOperand = { kind: 'relative', unit: 'day', amount: 0 };
const THIS_WEEK: DateRangeOperand = { kind: 'range', range: 'thisWeek' };

/** The operator a new condition on this type starts with. */
export function defaultOperator(type: PropertyType): FilterOperator {
  return DEFAULT_OPERATORS[type];
}

function isDateType(type: PropertyType): boolean {
  return type === 'date' || type === 'createdTime' || type === 'updatedTime';
}

function isRangeOperand(value: FilterValue | undefined): value is DateRangeOperand {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value.kind === 'range' || value.kind === 'between')
  );
}

function isDateOperand(value: FilterValue | undefined): value is DateOperand {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value.kind === 'exact' || value.kind === 'relative')
  );
}

/**
 * The value a condition keeps when its operator changes: lists and single values convert into each
 * other, dates switch between a day and a range, value-less operators drop it.
 */
export function adaptValue(
  type: PropertyType,
  operator: FilterOperator,
  value: FilterValue | undefined,
): FilterValue | undefined {
  if (VALUELESS_OPERATORS.includes(operator)) return undefined;
  if (type === 'checkbox') return typeof value === 'boolean' ? value : true;
  if (isDateType(type)) {
    if (operator === 'isWithin') return isRangeOperand(value) ? value : THIS_WEEK;
    return isDateOperand(value) ? value : TODAY;
  }
  if (LIST_OPERATORS.includes(operator)) {
    if (Array.isArray(value)) return value;
    return typeof value === 'string' && value ? [value] : [];
  }
  if (Array.isArray(value)) return value[0];
  if (type === 'number') return typeof value === 'number' ? value : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** A new condition on a property, with its default operator and value. */
export function newCondition(property: PropertyDefinition): FilterCondition {
  const operator = defaultOperator(property.type);
  const condition: FilterCondition = {
    type: 'condition',
    id: newId(),
    propertyId: property.id,
    operator,
  };
  const value = adaptValue(property.type, operator, undefined);
  if (value !== undefined) condition.value = value;
  return condition;
}

/** An empty root group. */
export function emptyFilter(): FilterGroup {
  return { type: 'group', id: newId(), conjunction: 'and', children: [] };
}

function mapNodes(group: FilterGroup, map: (node: FilterNode) => FilterNode | null): FilterGroup {
  const children: FilterNode[] = [];
  for (const child of group.children) {
    const mapped = map(child);
    if (mapped === null) continue;
    children.push(mapped.type === 'group' ? mapNodes(mapped, map) : mapped);
  }
  return { ...group, children };
}

/** Adds a node to the group with `groupId` (the root when omitted). */
export function addNode(root: FilterGroup | null, node: FilterNode, groupId?: string): FilterGroup {
  const base = root ?? emptyFilter();
  if (!groupId || groupId === base.id) return { ...base, children: [...base.children, node] };
  return mapNodes(base, (child) =>
    child.type === 'group' && child.id === groupId
      ? { ...child, children: [...child.children, node] }
      : child,
  );
}

/** Replaces the node with `id`. */
export function replaceNode(root: FilterGroup, id: string, next: FilterNode): FilterGroup {
  if (root.id === id && next.type === 'group') return next;
  return mapNodes(root, (child) => (child.id === id ? next : child));
}

/** Removes the node with `id`; groups left empty are removed too. */
export function removeNode(root: FilterGroup, id: string): FilterGroup {
  const pruned = mapNodes(root, (child) => (child.id === id ? null : child));
  return mapNodes(pruned, (child) =>
    child.type === 'group' && child.children.length === 0 ? null : child,
  );
}

/** Finds a node by ID. */
export function findNode(root: FilterGroup | null, id: string): FilterNode | undefined {
  if (!root) return undefined;
  if (root.id === id) return root;
  for (const child of root.children) {
    if (child.id === id) return child;
    if (child.type === 'group') {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Points a condition at another property (operator and value reset for its type). */
export function changeConditionProperty(
  condition: FilterCondition,
  property: PropertyDefinition,
): FilterCondition {
  return { ...newCondition(property), id: condition.id };
}

/** Changes a condition's operator, keeping what it can of the value. */
export function changeConditionOperator(
  condition: FilterCondition,
  property: PropertyDefinition,
  operator: FilterOperator,
): FilterCondition {
  const { value: _value, ...rest } = condition;
  const next: FilterCondition = { ...rest, operator };
  const value = adaptValue(property.type, operator, condition.value);
  if (value !== undefined) next.value = value;
  return next;
}

/** The operators a property type offers, in menu order. */
export function operatorsFor(type: PropertyType): readonly FilterOperator[] {
  return FILTER_OPERATORS_BY_TYPE[type];
}

/** How many conditions a tree holds. */
export function countConditions(node: FilterNode | null | undefined): number {
  if (!node) return 0;
  if (node.type === 'condition') return 1;
  return node.children.reduce((sum, child) => sum + countConditions(child), 0);
}
