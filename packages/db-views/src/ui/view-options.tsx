import { updateView, type CardSize, type ViewConfig } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@tessera/ui';
import { Calendar, Image, LayoutGrid, Rows3 } from 'lucide-react';
import { t } from '../i18n';
import type { DatabaseRef } from '../model/operations';
import type { DatabaseSnapshot } from '../model/store';
import { PropertyIcon } from './common';
import { runAction } from './hooks';

/** Layout options of board, gallery, calendar and list views (in the "…" menu). */
export function ViewOptionsItems({
  database,
  snapshot,
  view,
}: {
  database: DatabaseRef;
  snapshot: DatabaseSnapshot;
  view: ViewConfig;
}) {
  const ctx = useAppContext();
  const patch = (value: Parameters<typeof updateView>[2]) =>
    runAction(ctx, () => updateView(database.doc, view.id, value));
  const cards = view.type === 'board' ? view.board : view.gallery;
  const cardKey = view.type === 'board' ? 'board' : 'gallery';
  const urlProperties = snapshot.properties.filter((property) => property.type === 'url');

  const cardItems =
    view.type === 'board' || view.type === 'gallery' ? (
      <>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Image />}>{t('cardCover')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={cards.cover.kind === 'property' ? cards.cover.propertyId : cards.cover.kind}
              onValueChange={(value) =>
                patch({
                  [cardKey]: {
                    cover:
                      value === 'none' || value === 'pageContent'
                        ? { kind: value }
                        : { kind: 'property', propertyId: value },
                  },
                })
              }
            >
              <DropdownMenuRadioItem value="none">{t('cover_none')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="pageContent">
                {t('cover_pageContent')}
              </DropdownMenuRadioItem>
              {urlProperties.map((property) => (
                <DropdownMenuRadioItem key={property.id} value={property.id}>
                  {property.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<LayoutGrid />}>{t('cardSize')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={cards.size}
              onValueChange={(size) => patch({ [cardKey]: { size: size as CardSize } })}
            >
              {(['small', 'medium', 'large'] as const).map((size) => (
                <DropdownMenuRadioItem key={size} value={size}>
                  {t(`size_${size}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          checked={cards.fitCover}
          onCheckedChange={(checked) => patch({ [cardKey]: { fitCover: checked === true } })}
        >
          {t('fitCover')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={cards.showPropertyNames}
          onCheckedChange={(checked) =>
            patch({ [cardKey]: { showPropertyNames: checked === true } })
          }
        >
          {t('showPropertyNames')}
        </DropdownMenuCheckboxItem>
      </>
    ) : null;

  if (view.type === 'board') {
    const groupable = snapshot.properties.filter((property) =>
      ['select', 'multiSelect', 'checkbox'].includes(property.type),
    );
    return (
      <>
        <DropdownMenuLabel>{t('viewOptions')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Rows3 />}>{t('groupBy')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={view.group?.propertyId ?? ''}
              onValueChange={(propertyId) =>
                patch({
                  group: {
                    propertyId,
                    order: [],
                    hidden: [],
                    collapsed: [],
                    hideEmptyGroups: false,
                    dateBucket: 'month',
                  },
                })
              }
            >
              {groupable.map((property) => (
                <DropdownMenuRadioItem key={property.id} value={property.id}>
                  <span className="flex items-center gap-1.5">
                    <PropertyIcon type={property.type} />
                    {property.name}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {cardItems}
        <DropdownMenuCheckboxItem
          checked={view.board.colorColumns}
          onCheckedChange={(checked) => patch({ board: { colorColumns: checked === true } })}
        >
          {t('colorColumns')}
        </DropdownMenuCheckboxItem>
        {view.group ? (
          <DropdownMenuCheckboxItem
            checked={view.group.hideEmptyGroups}
            onCheckedChange={(checked) =>
              view.group && patch({ group: { ...view.group, hideEmptyGroups: checked === true } })
            }
          >
            {t('hideEmptyGroups')}
          </DropdownMenuCheckboxItem>
        ) : null}
      </>
    );
  }
  if (view.type === 'gallery') {
    return (
      <>
        <DropdownMenuLabel>{t('viewOptions')}</DropdownMenuLabel>
        {cardItems}
      </>
    );
  }
  if (view.type === 'calendar') {
    const dates = snapshot.properties.filter((property) => property.type === 'date');
    return (
      <>
        <DropdownMenuLabel>{t('viewOptions')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Calendar />}>
            {t('calendarDateProperty')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={view.calendar.datePropertyId ?? dates[0]?.id ?? ''}
              onValueChange={(datePropertyId) => patch({ calendar: { datePropertyId } })}
            >
              {dates.map((property) => (
                <DropdownMenuRadioItem key={property.id} value={property.id}>
                  {property.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('weekStartsOn')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={String(view.calendar.weekStartsOn)}
              onValueChange={(value) =>
                patch({ calendar: { weekStartsOn: value === '0' ? 0 : 1 } })
              }
            >
              <DropdownMenuRadioItem value="1">{t('monday')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="0">{t('sunday')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          checked={view.calendar.showWeekends}
          onCheckedChange={(checked) => patch({ calendar: { showWeekends: checked === true } })}
        >
          {t('showWeekends')}
        </DropdownMenuCheckboxItem>
      </>
    );
  }
  return (
    <>
      <DropdownMenuLabel>{t('viewOptions')}</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={view.list.showPropertyNames}
        onCheckedChange={(checked) => patch({ list: { showPropertyNames: checked === true } })}
      >
        {t('showPropertyNames')}
      </DropdownMenuCheckboxItem>
    </>
  );
}
