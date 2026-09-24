import { IconButton, cn } from '@tessera/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import {
  addDays,
  addMonths,
  dayOfWeek,
  startOfMonth,
  startOfWeek,
  type DayKey,
} from '../query/dates';

const dayLabel = (day: DayKey, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );

/** The 6×7 days shown for a month, starting on the configured weekday. */
export function monthGrid(month: DayKey, weekStartsOn: 0 | 1): DayKey[][] {
  const first = startOfWeek(startOfMonth(month), weekStartsOn);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(first, week * 7 + day)),
  );
}

/** Weekday names (short), in display order. */
export function weekdayNames(
  locale: string,
  weekStartsOn: 0 | 1,
  width: 'short' | 'narrow' = 'short',
): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
  // 2026-01-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(Date.parse(`${addDays('2026-01-04', (i + weekStartsOn) % 7)}T00:00:00Z`)),
  );
}

export interface MonthCalendarProps {
  /** Any day of the month to show. */
  month: DayKey;
  onMonthChange: (month: DayKey) => void;
  /** The day with keyboard focus (moves with the arrows). */
  focusDay: DayKey;
  onFocusDay: (day: DayKey) => void;
  onPick: (day: DayKey) => void;
  selectedStart?: DayKey | null;
  selectedEnd?: DayKey | null;
  today: DayKey;
  weekStartsOn: 0 | 1;
  locale: string;
  /** Focus the focused day on mount. */
  autoFocus?: boolean;
}

/**
 * A month grid for picking days: arrows move by day and week, PageUp/PageDown by month, Home/End
 * to the week's ends, Enter or Space picks. Days of a selected range are highlighted.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  focusDay,
  onFocusDay,
  onPick,
  selectedStart,
  selectedEnd,
  today,
  weekStartsOn,
  locale,
  autoFocus,
}: MonthCalendarProps) {
  const grid = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn]);
  const names = useMemo(() => weekdayNames(locale, weekStartsOn), [locale, weekStartsOn]);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(!!autoFocus);
  const monthKey = month.slice(0, 7);
  const title = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${monthKey}-01T00:00:00Z`));

  useEffect(() => {
    if (!focusRequested.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  const move = (day: DayKey) => {
    focusRequested.current = true;
    onFocusDay(day);
    if (day.slice(0, 7) !== monthKey) onMonthChange(day);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: DayKey) => {
    const moves: Record<string, () => DayKey> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      PageUp: () => addMonths(day, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(day, event.shiftKey ? 12 : 1),
      Home: () => startOfWeek(day, weekStartsOn),
      End: () => addDays(startOfWeek(day, weekStartsOn), 6),
    };
    const next = moves[event.key];
    if (next) {
      event.preventDefault();
      move(next());
    }
  };

  const low =
    selectedStart && selectedEnd && selectedEnd < selectedStart ? selectedEnd : selectedStart;
  const high =
    selectedStart && selectedEnd && selectedEnd < selectedStart ? selectedStart : selectedEnd;
  return (
    <div className="w-[15.5rem] select-none">
      <div className="mb-1 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium" aria-live="polite">
          {title}
        </p>
        <IconButton
          size="sm"
          label={t('previousMonth')}
          icon={<ChevronLeft />}
          onClick={() => onMonthChange(addMonths(month, -1))}
        />
        <IconButton
          size="sm"
          label={t('nextMonth')}
          icon={<ChevronRight />}
          onClick={() => onMonthChange(addMonths(month, 1))}
        />
      </div>
      <div ref={gridRef} role="grid" aria-label={title} className="grid gap-px">
        <div role="row" className="grid grid-cols-7">
          {names.map((name) => (
            <div
              key={name}
              role="columnheader"
              className="flex h-7 items-center justify-center text-2xs text-fg-subtle"
            >
              {name}
            </div>
          ))}
        </div>
        {grid.map((week) => (
          <div role="row" key={week[0]} className="grid grid-cols-7">
            {week.map((day) => {
              const inMonth = day.slice(0, 7) === monthKey;
              const isStart = day === low;
              const isEnd = day === (high ?? low);
              const inRange = !!low && !!high && day > low && day < high;
              const selected = isStart || isEnd;
              return (
                <div role="gridcell" key={day} aria-selected={selected || inRange}>
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === focusDay ? 0 : -1}
                    aria-label={dayLabel(day, locale)}
                    aria-current={day === today ? 'date' : undefined}
                    onClick={() => onPick(day)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                    onFocus={() => {
                      if (day !== focusDay) onFocusDay(day);
                    }}
                    className={cn(
                      'duration-fast flex h-8 w-full items-center justify-center rounded-md text-ui transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus',
                      !inMonth && 'text-fg-subtle',
                      inRange && 'rounded-none bg-accent-subtle',
                      selected && 'bg-accent font-medium text-accent-fg hover:bg-accent-hover',
                      day === today && !selected && 'font-semibold text-accent-text',
                      dayOfWeek(day) === 0 && '',
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
