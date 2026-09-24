import {
  EMPTY_GROUP_KEY,
  updateView,
  type GroupConfig,
  type PropertyDefinition,
  type ViewConfig,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@tessera/ui';
import {
  ArrowUpDown,
  ChevronDown,
  Eye,
  ListFilter,
  MoreHorizontal,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import type { DatabaseRef } from '../../model/operations';
import { countConditions } from '../../query/filter-edit';
import type { QueryContext } from '../../query/types';
import { PropertyIcon } from '../common';
import { runAction } from '../hooks';
import { FilterBuilder } from './filter-builder';
import { PropertiesPanel } from './properties-panel';
import { SortBuilder } from './sort-builder';

export type ToolbarPanel = 'filter' | 'sort' | 'properties' | null;

export interface ToolbarProps {
  database: DatabaseRef;
  view: ViewConfig;
  properties: readonly PropertyDefinition[];
  queryCtx: QueryContext;
  readOnly: boolean;
  search: string;
  onSearch: (search: string) => void;
  panel: ToolbarPanel;
  onPanel: (panel: ToolbarPanel) => void;
  focusFilterId: string | null;
  onNewRow: (useTemplate: boolean) => void;
  hasTemplate: boolean;
  /** Items for the "…" menu (layout options, templates, export). */
  moreMenu: ReactNode;
  compact: boolean;
}

function ToolbarButton({
  icon,
  label,
  active,
  compact,
  ...props
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  compact: boolean;
} & Omit<React.ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={compact ? label : undefined}
      className={cn(
        'duration-fast inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-ui transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover [&_svg]:size-4',
        active ? 'text-accent-text' : 'text-fg-muted hover:text-fg',
      )}
      {...props}
    >
      {icon}
      {compact ? null : <span>{label}</span>}
    </button>
  );
}

/**
 * The view toolbar: filter, sort, group (tables), properties, search, more options and "New".
 * Panels are popovers the parent controls, so a column's "Filter" can open the filter builder.
 */
export function Toolbar({
  database,
  view,
  properties,
  queryCtx,
  readOnly,
  search,
  onSearch,
  panel,
  onPanel,
  focusFilterId,
  onNewRow,
  hasTemplate,
  moreMenu,
  compact,
}: ToolbarProps) {
  const ctx = useAppContext();
  const [searching, setSearching] = useState(search !== '');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);
  const filterCount = countConditions(view.filter);
  const sortCount = view.sorts.length;
  const open = (which: ToolbarPanel) => (next: boolean) => onPanel(next ? which : null);
  const groupable = properties.filter((property) => property.type !== 'formula');
  const setGroup = (group: GroupConfig | null) =>
    runAction(ctx, () => updateView(database.doc, view.id, { group }));
  const groupProperty = properties.find((property) => property.id === view.group?.propertyId);

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-0.5">
      <Popover open={panel === 'filter'} onOpenChange={open('filter')}>
        <PopoverTrigger asChild>
          <ToolbarButton
            compact={compact}
            icon={<ListFilter />}
            label={filterCount > 0 ? t('filters', { count: filterCount }) : t('filter')}
            active={filterCount > 0}
            disabled={readOnly && filterCount === 0}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="p-3">
          <FilterBuilder
            database={database}
            view={view}
            properties={properties}
            queryCtx={queryCtx}
            focusId={focusFilterId}
          />
        </PopoverContent>
      </Popover>
      <Popover open={panel === 'sort'} onOpenChange={open('sort')}>
        <PopoverTrigger asChild>
          <ToolbarButton
            compact={compact}
            icon={<ArrowUpDown />}
            label={sortCount > 0 ? t('sorts', { count: sortCount }) : t('sort')}
            active={sortCount > 0}
            disabled={readOnly}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="p-3">
          <SortBuilder database={database} view={view} properties={properties} />
        </PopoverContent>
      </Popover>
      {view.type === 'table' || view.type === 'list' ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <ToolbarButton
              compact={compact}
              icon={<Rows3 />}
              label={groupProperty ? `${t('group')}: ${groupProperty.name}` : t('group')}
              active={!!groupProperty}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
            <DropdownMenuLabel>{t('groupBy')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={view.group?.propertyId ?? ''}
              onValueChange={(propertyId) =>
                setGroup(
                  propertyId
                    ? {
                        propertyId,
                        order: [],
                        hidden: [],
                        collapsed: [],
                        hideEmptyGroups: false,
                        dateBucket: view.group?.dateBucket ?? 'month',
                      }
                    : null,
                )
              }
            >
              <DropdownMenuRadioItem value="">{t('noGrouping')}</DropdownMenuRadioItem>
              {groupable.map((property) => (
                <DropdownMenuRadioItem key={property.id} value={property.id}>
                  <span className="flex items-center gap-1.5">
                    <PropertyIcon type={property.type} />
                    {property.name || t('untitled')}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {view.group && groupProperty ? (
              <>
                <DropdownMenuSeparator />
                {['date', 'createdTime', 'updatedTime'].includes(groupProperty.type) ? (
                  <DropdownMenuRadioGroup
                    value={view.group.dateBucket}
                    onValueChange={(bucket) =>
                      view.group &&
                      setGroup({ ...view.group, dateBucket: bucket as GroupConfig['dateBucket'] })
                    }
                  >
                    <DropdownMenuLabel>{t('dateBucket')}</DropdownMenuLabel>
                    {(['day', 'week', 'month', 'year'] as const).map((bucket) => (
                      <DropdownMenuRadioItem key={bucket} value={bucket}>
                        {t(`bucket_${bucket}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                ) : null}
                <DropdownMenuCheckboxItem
                  checked={view.group.hideEmptyGroups}
                  onCheckedChange={(checked) =>
                    view.group && setGroup({ ...view.group, hideEmptyGroups: checked === true })
                  }
                >
                  {t('hideEmptyGroups')}
                </DropdownMenuCheckboxItem>
                {view.group.hidden.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{t('hiddenGroups')}</DropdownMenuLabel>
                    {view.group.hidden.map((key) => {
                      const option = groupProperty.options?.find(
                        (candidate) => candidate.id === key,
                      );
                      return (
                        <DropdownMenuItem
                          key={key}
                          icon={<Eye />}
                          onSelect={() =>
                            view.group &&
                            setGroup({
                              ...view.group,
                              hidden: view.group.hidden.filter((other) => other !== key),
                            })
                          }
                        >
                          {key === EMPTY_GROUP_KEY
                            ? t('noValue', { property: groupProperty.name })
                            : (option?.name ?? key)}
                        </DropdownMenuItem>
                      );
                    })}
                  </>
                ) : null}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Popover open={panel === 'properties'} onOpenChange={open('properties')}>
        <PopoverTrigger asChild>
          <ToolbarButton
            compact={compact}
            icon={<SlidersHorizontal />}
            label={t('properties')}
            disabled={readOnly}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="p-2">
          <PropertiesPanel database={database} view={view} properties={properties} />
        </PopoverContent>
      </Popover>
      {searching ? (
        <div className="relative flex items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 size-3.5 text-fg-subtle"
          />
          <input
            ref={searchRef}
            type="search"
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onSearch('');
                setSearching(false);
              }
            }}
            onBlur={() => {
              if (!search) setSearching(false);
            }}
            className="h-7 w-44 rounded-md border border-border bg-bg pr-7 pl-7 text-ui text-fg outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              aria-label={t('clearSearch')}
              onClick={() => {
                onSearch('');
                searchRef.current?.focus();
              }}
              className="absolute right-1 inline-flex size-5 items-center justify-center rounded-sm text-fg-muted hover:bg-hover"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          ) : null}
        </div>
      ) : (
        <IconButton
          size="md"
          label={t('search')}
          icon={<Search />}
          onClick={() => setSearching(true)}
        />
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton size="md" label={t('moreDatabaseActions')} icon={<MoreHorizontal />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {moreMenu}
        </DropdownMenuContent>
      </DropdownMenu>
      {!readOnly ? (
        <div className="ml-1 flex items-center">
          <Button
            size="sm"
            variant="primary"
            onClick={() => onNewRow(true)}
            className={cn(hasTemplate && 'rounded-r-none')}
          >
            <Plus aria-hidden="true" />
            {t('new')}
          </Button>
          {hasTemplate ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="primary"
                  aria-label={t('newRowFromTemplate')}
                  className="rounded-l-none border-l border-accent-fg/20 px-1"
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onNewRow(true)}>
                  {t('newRowFromTemplate')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onNewRow(false)}>
                  {t('newRowBlank')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
