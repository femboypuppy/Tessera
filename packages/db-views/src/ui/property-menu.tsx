import {
  DATE_DISPLAY_FORMATS,
  updateProperty,
  type PropertyDefinition,
  type PropertyType,
  type ResolvedRow,
  type ViewConfig,
} from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@tessera/ui';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpNarrowWide,
  Calendar,
  Copy,
  EyeOff,
  Hash,
  ListFilter,
  Pencil,
  Rows3,
  Settings2,
  Sigma,
  Trash2,
} from 'lucide-react';
import { t } from '../i18n';
import {
  changePropertyType,
  deletePropertyUndoable,
  duplicateProperty,
  enableTwoWay,
  unlinkTwoWay,
  type DatabaseRef,
} from '../model/operations';
import type { QueryContext } from '../query/types';
import { PICKABLE_TYPES, PropertyIcon, displayTitle, typeLabel } from './common';
import { runAction } from './hooks';

const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'BRL',
  'MXN',
  'KRW',
  'SEK',
];

/** What the menu can do besides editing the property itself. */
export interface PropertyMenuActions {
  rename: () => void;
  editOptions?: () => void;
  editFormula?: () => void;
  sort?: (direction: 'asc' | 'desc') => void;
  filter?: () => void;
  groupBy?: () => void;
  hide?: () => void;
  insert?: (side: 'left' | 'right') => void;
  move?: (side: 'left' | 'right') => void;
}

export interface PropertyMenuItemsProps {
  database: DatabaseRef;
  property: PropertyDefinition;
  rows: readonly ResolvedRow[];
  queryCtx: QueryContext;
  actions: PropertyMenuActions;
  view?: ViewConfig;
  readOnly?: boolean;
}

/**
 * The items of a property's menu (put them in a `DropdownMenuContent`): rename, type and its
 * options, sorting and filtering, hiding, inserting and moving columns, duplicating, deleting.
 */
export function PropertyMenuItems({
  database,
  property,
  rows,
  queryCtx,
  actions,
  readOnly,
}: PropertyMenuItemsProps) {
  const ctx = useAppContext();
  const pages = usePages();
  const isTitle = property.type === 'title';
  const update = (patch: Parameters<typeof updateProperty>[2]) =>
    runAction(ctx, () => updateProperty(database.doc, property.id, patch));
  const changeType = (type: PropertyType) => {
    // A new formula needs an expression: open the editor once the menu has closed.
    if (type === 'formula') actions.editFormula?.();
    runAction(ctx, async () => {
      const handle = await changePropertyType(ctx, database, rows, property.id, type, queryCtx);
      if (!handle) return;
      ctx.toast({
        title: t('typeChanged', { name: property.name || t('untitled'), type: typeLabel(type) }),
        action: { label: t('undo'), onClick: handle.undo },
      });
    });
  };
  const databases = pages
    .all()
    .filter((page) => page.kind === 'database' && !pages.isTrashed(page.id));
  const targetId = property.relation?.targetDatabaseId ?? null;
  const targetTitle = targetId ? displayTitle(pages.get(targetId)?.title) : '';

  if (readOnly) {
    return actions.sort ? (
      <>
        <DropdownMenuItem icon={<ArrowUpNarrowWide />} onSelect={() => actions.sort?.('asc')}>
          {t('sortAscendingShort')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<ArrowDownWideNarrow />} onSelect={() => actions.sort?.('desc')}>
          {t('sortDescendingShort')}
        </DropdownMenuItem>
      </>
    ) : null;
  }

  return (
    <>
      <DropdownMenuItem icon={<Pencil />} onSelect={actions.rename}>
        {t('renameProperty')}
      </DropdownMenuItem>
      {!isTitle ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<PropertyIcon type={property.type} />}>
            {t('propertyType')}: {typeLabel(property.type)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={property.type}
              onValueChange={(value) => changeType(value as PropertyType)}
            >
              {PICKABLE_TYPES.map((type) => (
                <DropdownMenuRadioItem key={type} value={type}>
                  <span className="flex items-center gap-2">
                    <PropertyIcon type={type} />
                    {typeLabel(type)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {property.type === 'number' ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Hash />}>{t('numberFormat')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={property.number?.format ?? 'plain'}
              onValueChange={(format) => update({ number: { format: format as 'plain' } })}
            >
              <DropdownMenuRadioItem value="plain">{t('format_plain')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="percent">{t('format_percent')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="currency">{t('format_currency')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {property.number?.format === 'currency' ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t('currency')}: {property.number.currency}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={property.number.currency}
                    onValueChange={(currency) => update({ number: { currency } })}
                  >
                    {CURRENCIES.map((code) => (
                      <DropdownMenuRadioItem key={code} value={code}>
                        {code}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('precision')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={String(property.number?.precision ?? 'auto')}
                  onValueChange={(value) =>
                    update({ number: { precision: value === 'auto' ? null : Number(value) } })
                  }
                >
                  <DropdownMenuRadioItem value="auto">{t('precisionAuto')}</DropdownMenuRadioItem>
                  {[0, 1, 2, 3, 4].map((digits) => (
                    <DropdownMenuRadioItem key={digits} value={String(digits)}>
                      {(1).toFixed(digits)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {property.type === 'date' ||
      property.type === 'createdTime' ||
      property.type === 'updatedTime' ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Calendar />}>{t('dateFormat')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={property.date?.format ?? 'medium'}
              onValueChange={(format) => update({ date: { format: format as 'medium' } })}
            >
              {DATE_DISPLAY_FORMATS.map((format) => (
                <DropdownMenuRadioItem key={format} value={format}>
                  {t(`dateFormat_${format}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={property.date?.timeFormat ?? 'locale'}
              onValueChange={(timeFormat) =>
                update({ date: { timeFormat: timeFormat as 'locale' } })
              }
            >
              <DropdownMenuRadioItem value="locale">{t('timeFormat_locale')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="12h">{t('timeFormat_12h')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="24h">{t('timeFormat_24h')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {(property.type === 'select' || property.type === 'multiSelect') && actions.editOptions ? (
        <DropdownMenuItem icon={<Settings2 />} onSelect={actions.editOptions}>
          {t('options')}
        </DropdownMenuItem>
      ) : null}
      {property.type === 'formula' && actions.editFormula ? (
        <DropdownMenuItem icon={<Sigma />} onSelect={actions.editFormula}>
          {t('editFormula')}
        </DropdownMenuItem>
      ) : null}
      {property.type === 'relation' ? (
        <>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<PropertyIcon type="relation" />}>
              {t('relatedTo')}: {targetId ? targetTitle : t('relationAnyPage')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={targetId ?? ''}
                onValueChange={(value) =>
                  runAction(ctx, async () => {
                    if (property.relation?.backPropertyId)
                      await unlinkTwoWay(ctx, database.doc, property);
                    updateProperty(database.doc, property.id, {
                      relation: { targetDatabaseId: value || null, backPropertyId: null },
                    });
                  })
                }
              >
                <DropdownMenuRadioItem value="">{t('relationAnyPage')}</DropdownMenuRadioItem>
                {databases.map((page) => (
                  <DropdownMenuRadioItem key={page.id} value={page.id}>
                    {page.icon ? `${page.icon} ` : ''}
                    {displayTitle(page.title)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t('relationLimit')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={property.relation?.limit ?? 'many'}
                onValueChange={(limit) => update({ relation: { limit: limit as 'many' } })}
              >
                <DropdownMenuRadioItem value="many">{t('relationLimitMany')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="one">{t('relationLimitOne')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {targetId ? (
            <DropdownMenuCheckboxItem
              checked={!!property.relation?.backPropertyId}
              onCheckedChange={(checked) =>
                runAction(ctx, async () => {
                  if (checked) await enableTwoWay(ctx, database, property.id);
                  else await unlinkTwoWay(ctx, database.doc, property);
                })
              }
            >
              {t('twoWayRelation', { database: targetTitle })}
            </DropdownMenuCheckboxItem>
          ) : null}
        </>
      ) : null}
      <DropdownMenuSeparator />
      {actions.sort ? (
        <>
          <DropdownMenuItem icon={<ArrowUpNarrowWide />} onSelect={() => actions.sort?.('asc')}>
            {t('sortAscendingShort')}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<ArrowDownWideNarrow />} onSelect={() => actions.sort?.('desc')}>
            {t('sortDescendingShort')}
          </DropdownMenuItem>
        </>
      ) : null}
      {actions.filter ? (
        <DropdownMenuItem icon={<ListFilter />} onSelect={actions.filter}>
          {t('filter')}
        </DropdownMenuItem>
      ) : null}
      {actions.groupBy ? (
        <DropdownMenuItem icon={<Rows3 />} onSelect={actions.groupBy}>
          {t('groupBy')}
        </DropdownMenuItem>
      ) : null}
      {actions.hide && !isTitle ? (
        <DropdownMenuItem icon={<EyeOff />} onSelect={actions.hide}>
          {t('hideProperty')}
        </DropdownMenuItem>
      ) : null}
      {actions.insert ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<ArrowLeft />} onSelect={() => actions.insert?.('left')}>
            {t('insertLeft')}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<ArrowRight />} onSelect={() => actions.insert?.('right')}>
            {t('insertRight')}
          </DropdownMenuItem>
        </>
      ) : null}
      {actions.move ? (
        <>
          <DropdownMenuItem onSelect={() => actions.move?.('left')}>
            {t('moveColumnLeft')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.move?.('right')}>
            {t('moveColumnRight')}
          </DropdownMenuItem>
        </>
      ) : null}
      {!isTitle ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Copy />}
            onSelect={() =>
              runAction(ctx, () =>
                duplicateProperty(database, property.id, t('copyOf', { title: property.name })),
              )
            }
          >
            {t('duplicateProperty')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() =>
              runAction(ctx, async () => {
                const handle = await deletePropertyUndoable(ctx, database, property.id);
                ctx.toast({
                  title: t('propertyDeleted', { name: property.name || t('untitled') }),
                  action: { label: t('undo'), onClick: handle.undo },
                });
              })
            }
          >
            {t('deleteProperty')}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}
