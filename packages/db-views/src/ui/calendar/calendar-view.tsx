import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  updateView,
  type DateValue,
  type JsonValue,
  type PropertyDefinition,
  type ResolvedRow,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  EmptyState,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@tessera/ui';
import { CalendarDays, ChevronLeft, ChevronRight, Inbox, Plus } from 'lucide-react';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { t } from '../../i18n';
import { setCell, viewSetup } from '../../model/operations';
import { readDateValue } from '../../query/cells';
import {
  addDays,
  addMonths,
  dateSpan,
  dayOfWeek,
  daysBetween,
  startOfMonth,
  startOfWeek,
  timeOfInstant,
  todayKey,
  type DayKey,
} from '../../query/dates';
import { displayTitle } from '../common';
import type { ViewBodyProps } from '../database-view';
import { useDragAccessibility } from '../dnd';
import { runAction } from '../hooks';
import { monthGrid, weekdayNames } from '../month-calendar';
import {
  hiddenCounts,
  layoutWeek,
  shiftDateValue,
  withEndDay,
  type CalendarItem,
  type PlacedItem,
} from './calendar-logic';

interface ItemData {
  row: ResolvedRow;
  value: DateValue;
}

const LANE_HEIGHT = 24;
const DAY_HEADER = 28;
const MONTH_LANES = 3;

function fullDate(day: DayKey, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );
}

function timeLabel(value: DateValue, zone: string, locale: string): string {
  if (!value.includeTime) return '';
  const { hour, minute } = timeOfInstant(Date.parse(value.start), value.timeZone ?? zone);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function DayCell({
  day,
  inMonth,
  today,
  focused,
  locale,
  readOnly,
  onCreate,
  onKeyDown,
  onFocus,
  minHeight,
}: {
  day: DayKey;
  inMonth: boolean;
  today: boolean;
  focused: boolean;
  locale: string;
  readOnly: boolean;
  onCreate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  minHeight: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day|${day}` });
  const label = fullDate(day, locale);
  return (
    // Clicking a day's empty space is a mouse shortcut for its "+" button (the keyboard path).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the day's "+" button is the accessible control
    <div
      ref={setNodeRef}
      data-day={day}
      onClick={(event) => {
        if (event.target === event.currentTarget && !readOnly) onCreate();
      }}
      className={cn(
        'group/day duration-fast relative border-r border-b border-border p-1 transition-colors',
        !inMonth && 'bg-bg-subtle',
        isOver && 'bg-accent-subtle',
      )}
      style={{ minHeight }}
    >
      <div className="flex h-5 items-center justify-between" data-day={day}>
        <span
          aria-hidden="true"
          data-day={day}
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs',
            inMonth ? 'text-fg-muted' : 'text-fg-subtle',
            today && 'bg-danger font-semibold text-danger-fg',
          )}
        >
          {Number(day.slice(8))}
        </span>
        {!readOnly ? (
          <button
            type="button"
            data-day-button={day}
            tabIndex={focused ? 0 : -1}
            aria-label={t('newOnDay', { date: label })}
            onClick={onCreate}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            className="inline-flex size-5 items-center justify-center rounded-md text-fg-subtle opacity-0 group-hover/day:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EventBar({
  placed,
  columns,
  readOnly,
  zone,
  locale,
  onOpen,
  onShift,
  onResizeTo,
  onResizePreview,
  showTime,
}: {
  placed: PlacedItem<ItemData>;
  columns: number;
  readOnly: boolean;
  zone: string;
  locale: string;
  onOpen: () => void;
  onShift: (days: number) => void;
  onResizeTo: (day: DayKey) => void;
  onResizePreview: (day: DayKey | null) => void;
  showTime: boolean;
}) {
  const { item } = placed;
  const { row, value } = item.data;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `item|${row.id}`,
    disabled: readOnly,
  });
  const resizing = useRef(false);
  const dayAt = (x: number, y: number): DayKey | null => {
    for (const element of document.elementsFromPoint(x, y)) {
      const day = element instanceof HTMLElement ? element.dataset.day : undefined;
      if (day) return day;
    }
    return null;
  };
  const time = showTime ? timeLabel(value, zone, locale) : '';
  const dates =
    item.startDay === item.endDay
      ? fullDate(item.startDay, locale)
      : `${fullDate(item.startDay, locale)} → ${fullDate(item.endDay, locale)}`;
  const title = displayTitle(row.title);
  return (
    <div
      ref={setNodeRef}
      className={cn('absolute z-[1] px-0.5', isDragging && 'z-20 opacity-70')}
      style={{
        left: `${(placed.startCol / columns) * 100}%`,
        width: `${(placed.span / columns) * 100}%`,
        top: DAY_HEADER + placed.lane * LANE_HEIGHT,
        height: LANE_HEIGHT - 2,
        transform: CSS.Translate.toString(transform),
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription={undefined}
        aria-describedby={undefined}
        data-row-id={row.id}
        aria-label={[title, dates, time].filter(Boolean).join(', ')}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen();
            return;
          }
          if (readOnly || !event.altKey) return;
          const step =
            event.key === 'ArrowLeft'
              ? -1
              : event.key === 'ArrowRight'
                ? 1
                : event.key === 'ArrowUp'
                  ? -7
                  : event.key === 'ArrowDown'
                    ? 7
                    : 0;
          if (!step) return;
          event.preventDefault();
          if (event.shiftKey) onResizeTo(addDays(item.endDay, step));
          else onShift(step);
        }}
        className={cn(
          'flex h-full w-full min-w-0 cursor-pointer items-center gap-1 border border-border bg-surface-raised px-1.5 text-left text-xs text-fg shadow-subtle outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus',
          placed.continuesBefore ? 'rounded-l-none border-l-0' : 'rounded-l-md',
          placed.continuesAfter ? 'rounded-r-none border-r-0' : 'rounded-r-md',
        )}
      >
        {row.icon ? <span aria-hidden="true">{row.icon}</span> : null}
        {time ? <span className="shrink-0 text-fg-subtle tabular-nums">{time}</span> : null}
        <span className={cn('truncate font-medium', !row.title.trim() && 'text-fg-subtle')}>
          {title}
        </span>
      </button>
      {!readOnly && !placed.continuesAfter ? (
        <div
          aria-hidden="true"
          title={t('resizeEnd')}
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            event.stopPropagation();
            event.preventDefault();
            resizing.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (resizing.current) onResizePreview(dayAt(event.clientX, event.clientY));
          }}
          onPointerUp={(event) => {
            if (!resizing.current) return;
            resizing.current = false;
            const day = dayAt(event.clientX, event.clientY);
            onResizePreview(null);
            if (day) onResizeTo(day);
          }}
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-accent/40"
        />
      ) : null}
    </div>
  );
}

function TrayItem({
  row,
  readOnly,
  onOpen,
}: {
  row: ResolvedRow;
  readOnly: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tray|${row.id}`,
    disabled: readOnly,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(isDragging && 'relative z-20 opacity-70')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription={undefined}
        aria-describedby={undefined}
        data-row-id={row.id}
        onClick={onOpen}
        className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-left text-ui text-fg shadow-subtle hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        {row.icon ? <span aria-hidden="true">{row.icon}</span> : null}
        <span className={cn('truncate', !row.title.trim() && 'text-fg-subtle')}>
          {displayTitle(row.title)}
        </span>
      </button>
    </li>
  );
}

/**
 * The calendar: rows placed by a date property in month or week layout. Drag an item to another
 * day to reschedule it, drag its right edge to change the end date, click a day (or its "+") to
 * add a row there, and schedule undated rows from the "No date" tray. With the keyboard: arrows
 * move between days, Enter adds a row; on an item, Alt+arrows move it and Alt+Shift+arrows change
 * its end.
 */
export function CalendarView(props: ViewBodyProps) {
  const ctx = useAppContext();
  const { database, snapshot, view, result, queryCtx, readOnly } = props;
  const zone = queryCtx.timeZone;
  const today = todayKey(queryCtx.now, zone);
  const [cursor, setCursor] = useState<DayKey>(today);
  const [focusDay, setFocusDay] = useState<DayKey>(today);
  const [trayOpen, setTrayOpen] = useState(false);
  const [resize, setResize] = useState<{ rowId: string; day: DayKey } | null>(null);
  const [grab, setGrab] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const dateProperty: PropertyDefinition | undefined =
    snapshot.properties.find(
      (property) => property.id === view.calendar.datePropertyId && property.type === 'date',
    ) ?? snapshot.properties.find((property) => property.type === 'date');
  const mode = view.calendar.mode;
  const weekStartsOn = view.calendar.weekStartsOn;

  const { items, undated } = useMemo(() => {
    const list: CalendarItem<ItemData>[] = [];
    const none: ResolvedRow[] = [];
    if (!dateProperty) return { items: list, undated: none };
    for (const row of result.rows) {
      const value = readDateValue(row.values[dateProperty.id]);
      if (!value) {
        none.push(row);
        continue;
      }
      const span = dateSpan(value, zone);
      list.push({ id: row.id, startDay: span.startDay, endDay: span.endDay, data: { row, value } });
    }
    return { items: list, undated: none };
  }, [result.rows, dateProperty, zone]);
  const shown = useMemo(
    () =>
      resize
        ? items.map((item) =>
            item.id === resize.rowId
              ? { ...item, endDay: resize.day < item.startDay ? item.startDay : resize.day }
              : item,
          )
        : items,
    [items, resize],
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const nameOf = useCallback(
    (id: string | number) => {
      const [kind, rest = ''] = String(id).split('|');
      if (kind === 'day') return fullDate(rest, queryCtx.locale);
      const row = snapshot.rows.find((candidate) => candidate.id === rest);
      return displayTitle(row?.title);
    },
    [queryCtx.locale, snapshot.rows],
  );
  const accessibility = useDragAccessibility(nameOf);

  if (!dateProperty) {
    return (
      <EmptyState
        className="rounded-md border border-dashed border-border"
        icon={<CalendarDays />}
        title={t('calendarNeedsDate')}
        actions={
          readOnly ? null : (
            <Button
              onClick={() =>
                runAction(ctx, () =>
                  updateView(
                    database.doc,
                    view.id,
                    viewSetup(database.doc, 'calendar', {
                      ...view,
                      calendar: { ...view.calendar, datePropertyId: null },
                    }),
                  ),
                )
              }
            >
              {t('calendarAddDate')}
            </Button>
          )
        }
      />
    );
  }

  const write = (rowId: string, value: DateValue | null) =>
    runAction(ctx, () =>
      setCell(ctx, database, rowId, dateProperty, value as unknown as JsonValue),
    );
  const createOn = (day: DayKey) =>
    runAction(ctx, async () => {
      const id = await props.onCreateRow({ values: { [dateProperty.id]: { start: day } } });
      if (id) props.onOpenRow(id, 'peek');
    });

  const weeks =
    mode === 'week'
      ? [Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor, weekStartsOn), i))]
      : monthGrid(cursor, weekStartsOn).filter(
          (week, index) => index < 5 || week.some((day) => day.slice(0, 7) === cursor.slice(0, 7)),
        );
  const visibleDays = (week: readonly DayKey[]) =>
    view.calendar.showWeekends
      ? week
      : week.filter((day) => dayOfWeek(day) !== 0 && dayOfWeek(day) !== 6);
  const columns = visibleDays(weeks[0] ?? []).length || 7;
  const names = weekdayNames(queryCtx.locale, weekStartsOn).filter((_, index) =>
    view.calendar.showWeekends ? true : ![0, 6].includes((index + weekStartsOn) % 7),
  );
  const title =
    mode === 'week'
      ? `${new Intl.DateTimeFormat(queryCtx.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${weeks[0]?.[0] ?? cursor}T00:00:00Z`))} – ${new Intl.DateTimeFormat(queryCtx.locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(Date.parse(`${weeks[0]?.[6] ?? cursor}T00:00:00Z`))}`
      : new Intl.DateTimeFormat(queryCtx.locale, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(Date.parse(`${startOfMonth(cursor)}T00:00:00Z`));
  const step = (direction: number) =>
    setCursor((day) =>
      mode === 'week' ? addDays(day, 7 * direction) : addMonths(startOfMonth(day), direction),
    );

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const [kind, rowId = ''] = String(active.id).split('|');
    if (kind !== 'item') {
      setGrab(0);
      return;
    }
    const item = byId.get(rowId);
    const pointer = activatorEvent as { clientX?: number; clientY?: number };
    let offset = 0;
    if (item && typeof pointer.clientX === 'number' && typeof pointer.clientY === 'number') {
      for (const element of document.elementsFromPoint(pointer.clientX, pointer.clientY)) {
        const day = element instanceof HTMLElement ? element.dataset.day : undefined;
        if (day) {
          offset = Math.max(0, daysBetween(item.startDay, day));
          break;
        }
      }
    }
    setGrab(offset);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || readOnly) return;
    const [kind, rowId = ''] = String(active.id).split('|');
    const [overKind, day = ''] = String(over.id).split('|');
    if (overKind !== 'day') return;
    if (kind === 'tray') {
      write(rowId, { start: day });
      return;
    }
    const item = byId.get(rowId);
    if (!item) return;
    const delta = daysBetween(item.startDay, addDays(day, -grab));
    if (delta !== 0) write(rowId, shiftDateValue(item.data.value, delta, zone));
  };

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: DayKey) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next: DayKey | null = null;
    if (event.key in moves) next = addDays(day, moves[event.key] ?? 0);
    else if (event.key === 'PageUp') next = mode === 'week' ? addDays(day, -7) : addMonths(day, -1);
    else if (event.key === 'PageDown') next = mode === 'week' ? addDays(day, 7) : addMonths(day, 1);
    else if (event.key === 'Home') next = startOfWeek(day, weekStartsOn);
    else if (event.key === 'End') next = addDays(startOfWeek(day, weekStartsOn), 6);
    if (!next) return;
    event.preventDefault();
    const visibleNow = weeks.flat();
    if (!visibleNow.includes(next)) setCursor(next);
    setFocusDay(next);
    requestAnimationFrame(() =>
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day-button="${next}"]`)?.focus(),
    );
  };

  const maxLanes = mode === 'week' ? Number.POSITIVE_INFINITY : MONTH_LANES;
  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      accessibility={accessibility}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 text-base font-semibold text-fg" aria-live="polite">
            {title}
          </h3>
          <span className="flex-1" />
          <div
            className="flex items-center rounded-md border border-border p-0.5"
            role="group"
            aria-label={t('layout')}
          >
            {(['month', 'week'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={readOnly}
                onClick={() =>
                  runAction(ctx, () =>
                    updateView(database.doc, view.id, { calendar: { mode: value } }),
                  )
                }
                className="h-6 rounded-sm px-2 text-ui text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none aria-pressed:bg-active aria-pressed:text-fg"
              >
                {value === 'month' ? t('calendarMonth') : t('calendarWeek')}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCursor(today);
              setFocusDay(today);
            }}
          >
            {t('today')}
          </Button>
          <IconButton
            size="sm"
            label={mode === 'week' ? t('previousWeek') : t('previousMonth')}
            icon={<ChevronLeft />}
            onClick={() => step(-1)}
          />
          <IconButton
            size="sm"
            label={mode === 'week' ? t('nextWeek') : t('nextMonth')}
            icon={<ChevronRight />}
            onClick={() => step(1)}
          />
          <Button
            size="sm"
            variant={trayOpen ? 'secondary' : 'ghost'}
            aria-pressed={trayOpen}
            onClick={() => setTrayOpen((open) => !open)}
          >
            <Inbox aria-hidden="true" />
            {t('noDateTray')} ({undated.length})
          </Button>
        </div>
        <div className="flex min-w-0 gap-3">
          <div
            ref={gridRef}
            role="group"
            aria-label={title}
            className="min-w-0 flex-1 overflow-hidden rounded-md border-t border-l border-border"
          >
            <div
              aria-hidden="true"
              className="grid"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {names.map((name) => (
                <div
                  key={name}
                  className="border-r border-b border-border px-2 py-1 text-2xs font-medium text-fg-subtle uppercase"
                >
                  {name}
                </div>
              ))}
            </div>
            {weeks.map((week) => {
              const days = visibleDays(week);
              const placed = layoutWeek(days, shown);
              const hidden = hiddenCounts(placed, days.length, maxLanes);
              const lanes = placed.reduce((max, entry) => Math.max(max, entry.lane + 1), 0);
              const height =
                mode === 'week'
                  ? Math.max(360, DAY_HEADER + lanes * LANE_HEIGHT + 32)
                  : DAY_HEADER + MONTH_LANES * LANE_HEIGHT + 24;
              return (
                <div
                  key={week[0]}
                  role="group"
                  aria-label={t('weekOf', { date: fullDate(week[0] ?? cursor, queryCtx.locale) })}
                  className="relative grid"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                  {days.map((day, col) => (
                    <div key={day} className="contents">
                      <DayCell
                        day={day}
                        inMonth={mode === 'week' || day.slice(0, 7) === cursor.slice(0, 7)}
                        today={day === today}
                        focused={
                          day === focusDay ||
                          (!weeks.flat().includes(focusDay) && day === days[0] && week === weeks[0])
                        }
                        locale={queryCtx.locale}
                        readOnly={readOnly}
                        onCreate={() => createOn(day)}
                        onKeyDown={(event) => onDayKeyDown(event, day)}
                        onFocus={() => setFocusDay(day)}
                        minHeight={height}
                      />
                      {(hidden[col] ?? 0) > 0 ? (
                        <MoreItems
                          day={day}
                          col={col}
                          columns={columns}
                          count={hidden[col] ?? 0}
                          items={shown.filter((item) => item.startDay <= day && item.endDay >= day)}
                          onOpen={(rowId) => props.onOpenRow(rowId, 'peek')}
                          locale={queryCtx.locale}
                        />
                      ) : null}
                    </div>
                  ))}
                  {placed
                    .filter((entry) => entry.lane < maxLanes)
                    .map((entry) => (
                      <EventBar
                        key={entry.item.id}
                        placed={entry}
                        columns={columns}
                        readOnly={readOnly}
                        zone={zone}
                        locale={queryCtx.locale}
                        showTime={!entry.continuesBefore}
                        onOpen={() => props.onOpenRow(entry.item.id, 'peek')}
                        onShift={(delta) =>
                          write(entry.item.id, shiftDateValue(entry.item.data.value, delta, zone))
                        }
                        onResizeTo={(day) =>
                          write(entry.item.id, withEndDay(entry.item.data.value, day, zone))
                        }
                        onResizePreview={(day) =>
                          setResize(day ? { rowId: entry.item.id, day } : null)
                        }
                      />
                    ))}
                </div>
              );
            })}
          </div>
          {trayOpen ? (
            <aside
              aria-label={t('noDateTray')}
              className="w-56 shrink-0 rounded-md border border-border bg-bg-subtle p-2"
            >
              <h3 className="px-1 text-xs font-medium text-fg-subtle">{t('noDateTray')}</h3>
              <p className="mt-0.5 px-1 text-2xs text-fg-subtle">
                {undated.length > 0 ? t('noDateTrayHint') : t('noDateEmpty')}
              </p>
              <ul className="mt-2 flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
                {undated.map((row) => (
                  <TrayItem
                    key={row.id}
                    row={row}
                    readOnly={readOnly}
                    onOpen={() => props.onOpenRow(row.id, 'peek')}
                  />
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      </div>
    </DndContext>
  );
}

function MoreItems({
  day,
  col,
  columns,
  count,
  items,
  onOpen,
  locale,
}: {
  day: DayKey;
  col: number;
  columns: number;
  count: number;
  items: readonly CalendarItem<ItemData>[];
  onOpen: (rowId: string) => void;
  locale: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="absolute z-[2] rounded-sm px-1.5 text-2xs font-medium text-fg-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          style={{
            left: `calc(${(col / columns) * 100}% + 4px)`,
            top: DAY_HEADER + MONTH_LANES * LANE_HEIGHT,
          }}
        >
          {t('moreItems', { count })}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60">
        <p className="px-1 pb-1 text-xs font-medium text-fg-subtle">{fullDate(day, locale)}</p>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-ui hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                {item.data.row.icon ? <span aria-hidden="true">{item.data.row.icon}</span> : null}
                <span className="truncate">{displayTitle(item.data.row.title)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
