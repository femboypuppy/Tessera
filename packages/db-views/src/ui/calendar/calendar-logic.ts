import type { DateValue } from '@tessera/core';
import {
  addDays,
  dayKeyOfInstant,
  timeOfInstant,
  zonedTimeToInstant,
  type DayKey,
} from '../../query/dates';

/** A row placed on the calendar by the days its date covers (viewer's zone). */
export interface CalendarItem<T = unknown> {
  id: string;
  startDay: DayKey;
  endDay: DayKey;
  data: T;
}

/** An item's bar within one week row. */
export interface PlacedItem<T = unknown> {
  item: CalendarItem<T>;
  lane: number;
  /** Index of the first visible day the bar covers. */
  startCol: number;
  /** Number of visible days it covers. */
  span: number;
  /** The item started before this week (or on a hidden weekend day). */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Lays out a week's items in lanes, like a calendar app: earlier items first, longer ones first
 * on the same day, each in the first lane free for all its days. `days` are the visible days of
 * the week in order (weekends may be hidden); items covering only hidden days are left out.
 */
export function layoutWeek<T>(
  days: readonly DayKey[],
  items: readonly CalendarItem<T>[],
): PlacedItem<T>[] {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return [];
  const relevant = items
    .filter((item) => item.startDay <= last && item.endDay >= first)
    .sort(
      (a, b) =>
        (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : 0) ||
        (a.endDay > b.endDay ? -1 : a.endDay < b.endDay ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const laneEnds: number[] = [];
  const placed: PlacedItem<T>[] = [];
  for (const item of relevant) {
    const startCol = days.findIndex((day) => day >= item.startDay);
    let endCol = -1;
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const day = days[i];
      if (day !== undefined && day <= item.endDay) {
        endCol = i;
        break;
      }
    }
    if (startCol < 0 || endCol < startCol) continue;
    let lane = laneEnds.findIndex((end) => end < startCol);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(endCol);
    } else {
      laneEnds[lane] = endCol;
    }
    placed.push({
      item,
      lane,
      startCol,
      span: endCol - startCol + 1,
      continuesBefore: item.startDay < (days[startCol] ?? item.startDay),
      continuesAfter: item.endDay > (days[endCol] ?? item.endDay),
    });
  }
  return placed;
}

/** How many placed items on each day sit in lanes past `maxLanes` (the "+N more" counts). */
export function hiddenCounts(
  placed: readonly PlacedItem[],
  dayCount: number,
  maxLanes: number,
): number[] {
  const counts = Array.from({ length: dayCount }, () => 0);
  for (const entry of placed) {
    if (entry.lane < maxLanes) continue;
    for (let col = entry.startCol; col < entry.startCol + entry.span; col += 1)
      counts[col] = (counts[col] ?? 0) + 1;
  }
  return counts;
}

function shiftPoint(value: string, includeTime: boolean, days: number, timeZone: string): string {
  if (!includeTime) return addDays(value, days);
  const ms = Date.parse(value);
  const { hour, minute } = timeOfInstant(ms, timeZone);
  const day = addDays(dayKeyOfInstant(ms, timeZone), days);
  return new Date(zonedTimeToInstant(day, hour, minute, timeZone)).toISOString();
}

/**
 * Moves a date by whole days, keeping its length and its wall-clock times (in the value's own zone
 * when it has one), the way dragging an event to another day does.
 */
export function shiftDateValue(value: DateValue, days: number, viewerZone: string): DateValue {
  const zone = value.timeZone ?? viewerZone;
  const next: DateValue = {
    ...value,
    start: shiftPoint(value.start, !!value.includeTime, days, zone),
  };
  if (value.end) next.end = shiftPoint(value.end, !!value.includeTime, days, zone);
  return next;
}

/**
 * Sets the last day of a date (dragging a bar's edge): a range when it differs from the start, a
 * single day otherwise. An end before the start clamps to the start.
 */
export function withEndDay(value: DateValue, endDay: DayKey, viewerZone: string): DateValue {
  const zone = value.timeZone ?? viewerZone;
  const startDay = value.includeTime ? dayKeyOfInstant(Date.parse(value.start), zone) : value.start;
  const day = endDay < startDay ? startDay : endDay;
  const { end: _end, ...rest } = value;
  if (day === startDay && !value.includeTime) return rest;
  if (!value.includeTime) return { ...rest, end: day };
  const source = value.end ?? value.start;
  const { hour, minute } = timeOfInstant(Date.parse(source), zone);
  const endIso = new Date(zonedTimeToInstant(day, hour, minute, zone)).toISOString();
  return Date.parse(endIso) <= Date.parse(value.start) ? rest : { ...rest, end: endIso };
}
