import {
  newId,
  updateView,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  type PropertyDefinition,
  type ViewConfig,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Select,
  cn,
} from '@tessera/ui';
import { Layers, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { t } from '../../i18n';
import type { DatabaseRef } from '../../model/operations';
import { todayKey } from '../../query/dates';
import { isConditionActive } from '../../query/filter';
import {
  addNode,
  changeConditionOperator,
  changeConditionProperty,
  emptyFilter,
  newCondition,
  operatorsFor,
  removeNode,
  replaceNode,
} from '../../query/filter-edit';
import type { QueryContext } from '../../query/types';
import { PropertyIcon } from '../common';
import { runAction } from '../hooks';
import { FilterValueEditor } from './filter-values';

export interface FilterBuilderProps {
  database: DatabaseRef;
  view: ViewConfig;
  properties: readonly PropertyDefinition[];
  queryCtx: QueryContext;
  /** Focus this condition's value (a condition just added from a column menu). */
  focusId?: string | null;
}

function propertyOptions(properties: readonly PropertyDefinition[]) {
  return properties.map((property) => ({
    value: property.id,
    label: (
      <span className="flex items-center gap-1.5">
        <PropertyIcon type={property.type} />
        <span className="truncate">{property.name || t('untitled')}</span>
      </span>
    ),
  }));
}

/**
 * Builds a view's filter: rules (property, condition, value) joined by And or Or, and one level of
 * nested groups. Every control is a native or Radix control, so it works with the keyboard alone;
 * rules that are not complete yet are marked and ignored.
 */
export function FilterBuilder({
  database,
  view,
  properties,
  queryCtx,
  focusId,
}: FilterBuilderProps) {
  const ctx = useAppContext();
  const root = view.filter ?? emptyFilter();
  const byId = new Map(properties.map((property) => [property.id, property]));
  const today = todayKey(queryCtx.now, queryCtx.timeZone);
  const write = (next: FilterGroup) =>
    runAction(ctx, () =>
      updateView(database.doc, view.id, { filter: next.children.length > 0 ? next : null }),
    );
  const firstProperty = properties.find((property) => property.type !== 'formula');

  const renderCondition = (condition: FilterCondition, group: FilterGroup, index: number) => {
    const property = byId.get(condition.propertyId);
    const active = property ? isConditionActive(condition, properties, queryCtx) : false;
    return (
      <div key={condition.id} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
        <Conjunction
          group={group}
          index={index}
          onChange={(conjunction) => write(replaceNode(root, group.id, { ...group, conjunction }))}
        />
        <Select
          size="sm"
          aria-label={t('filterProperty')}
          className="w-36 shrink-0"
          value={condition.propertyId}
          onValueChange={(propertyId) => {
            const next = byId.get(propertyId);
            if (next)
              write(replaceNode(root, condition.id, changeConditionProperty(condition, next)));
          }}
          options={propertyOptions(properties)}
        />
        {property ? (
          <>
            <Select
              size="sm"
              aria-label={t('filterOperator')}
              className="w-36 shrink-0"
              value={condition.operator}
              onValueChange={(operator) =>
                write(
                  replaceNode(
                    root,
                    condition.id,
                    changeConditionOperator(condition, property, operator as FilterOperator),
                  ),
                )
              }
              options={operatorsFor(property.type).map((operator) => ({
                value: operator,
                label: t(`op_${operator}`),
              }))}
            />
            <FilterValueEditor
              condition={condition}
              property={property}
              today={today}
              focusOnMount={focusId === condition.id}
              onChange={(value) => {
                const { value: _old, ...rest } = condition;
                const next: FilterCondition = value === undefined ? rest : { ...rest, value };
                write(replaceNode(root, condition.id, next));
              }}
            />
          </>
        ) : (
          <span className="flex-1 text-ui text-fg-muted">{t('filterInactive')}</span>
        )}
        <IconButton
          size="sm"
          label={t('deleteFilterRule')}
          icon={<Trash2 />}
          onClick={() => write(removeNode(root, condition.id))}
        />
        {!active && property ? <span className="sr-only">{t('filterInactive')}</span> : null}
      </div>
    );
  };

  const renderGroup = (group: FilterGroup, index: number) => (
    <div key={group.id} className="flex items-start gap-1.5">
      <Conjunction
        group={root}
        index={index}
        onChange={(conjunction) => write({ ...root, conjunction })}
      />
      <div
        role="group"
        aria-label={t('filterGroupLabel')}
        className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-border bg-bg-subtle p-2"
      >
        {group.children.map((child, childIndex) =>
          child.type === 'condition' ? renderCondition(child, group, childIndex) : null,
        )}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!firstProperty}
            onClick={() =>
              firstProperty && write(addNode(root, newCondition(firstProperty), group.id))
            }
          >
            <Plus aria-hidden="true" />
            {t('addFilterRule')}
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label={t('more')} icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                icon={<Trash2 />}
                destructive
                onSelect={() => write(removeNode(root, group.id))}
              >
                {t('deleteFilterGroup')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="flex w-[min(40rem,calc(100vw-2rem))] flex-col gap-2"
      aria-label={t('filterBuilder')}
    >
      {root.children.length === 0 ? (
        <p className="px-1 text-ui text-fg-muted">{t('noResultsHint')}</p>
      ) : null}
      {root.children.map((child: FilterNode, index) =>
        child.type === 'condition'
          ? renderCondition(child, root, index)
          : renderGroup(child, index),
      )}
      <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!firstProperty}
          onClick={() => firstProperty && write(addNode(root, newCondition(firstProperty)))}
        >
          <Plus aria-hidden="true" />
          {t('addFilterRule')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!firstProperty}
          onClick={() =>
            firstProperty &&
            write(
              addNode(root, {
                type: 'group',
                id: newId(),
                conjunction: root.conjunction === 'and' ? 'or' : 'and',
                children: [newCondition(firstProperty)],
              }),
            )
          }
        >
          <Layers aria-hidden="true" />
          {t('addFilterGroup')}
        </Button>
        {root.children.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              runAction(ctx, () => updateView(database.doc, view.id, { filter: null }))
            }
          >
            {t('clearFilters')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** "Where" for the first rule, an And/Or picker for the second, the conjunction after that. */
function Conjunction({
  group,
  index,
  onChange,
}: {
  group: FilterGroup;
  index: number;
  onChange: (conjunction: 'and' | 'or') => void;
}) {
  const label = group.conjunction === 'and' ? t('filterAnd') : t('filterOr');
  if (index === 0)
    return <span className="w-16 shrink-0 px-1 text-ui text-fg-muted">{t('filterWhere')}</span>;
  if (index === 1)
    return (
      <Select
        size="sm"
        aria-label={t('filterGroupLabel')}
        className="w-16 shrink-0"
        value={group.conjunction}
        onValueChange={(value) => onChange(value === 'or' ? 'or' : 'and')}
        options={[
          { value: 'and', label: t('filterAnd') },
          { value: 'or', label: t('filterOr') },
        ]}
      />
    );
  return <span className={cn('w-16 shrink-0 px-1 text-ui text-fg-muted')}>{label}</span>;
}
