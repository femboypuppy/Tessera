import { describe, expect, it } from 'vitest';
import {
  hiddenCounts,
  layoutWeek,
  shiftDateValue,
  withEndDay,
  type CalendarItem,
} from './calendar-logic';

const WEEK = [
  '2026-09-21',
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
];

function item(id: string, startDay: string, endDay = startDay): CalendarItem<null> {
  return { id, startDay, endDay, data: null };
}

describe('layoutWeek', () => {
  it('stacks overlapping items in lanes, longer ones first', () => {
    const placed = layoutWeek(WEEK, [
      item('short', '2026-09-22'),
      item('long', '2026-09-22', '2026-09-24'),
      item('later', '2026-09-25'),
      item('next', '2026-09-23'),
    ]);
    const byId = Object.fromEntries(placed.map((entry) => [entry.item.id, entry]));
    expect(byId.long).toMatchObject({ lane: 0, startCol: 1, span: 3 });
    expect(byId.short).toMatchObject({ lane: 1, startCol: 1, span: 1 });
    expect(byId.next).toMatchObject({ lane: 1, startCol: 2, span: 1 });
    // A free lane is reused.
    expect(byId.later).toMatchObject({ lane: 0, startCol: 4 });
  });

  it('clips items to the week and flags that they continue', () => {
    const [placed] = layoutWeek(WEEK, [item('trip', '2026-09-18', '2026-10-02')]);
    expect(placed).toMatchObject({
      startCol: 0,
      span: 7,
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(layoutWeek(WEEK, [item('before', '2026-09-01', '2026-09-20')])).toEqual([]);
    expect(layoutWeek([], [item('any', '2026-09-22')])).toEqual([]);
  });

  it('skips hidden weekend days and items that only cover them', () => {
    const weekdays = WEEK.slice(0, 5);
    expect(layoutWeek(weekdays, [item('saturday', '2026-09-26')])).toEqual([]);
    const [placed] = layoutWeek(weekdays, [item('long weekend', '2026-09-25', '2026-09-28')]);
    expect(placed).toMatchObject({ startCol: 4, span: 1, continuesAfter: true });
  });

  it('counts what does not fit per day', () => {
    const placed = layoutWeek(WEEK, [
      item('a', '2026-09-22'),
      item('b', '2026-09-22'),
      item('c', '2026-09-22', '2026-09-23'),
    ]);
    expect(hiddenCounts(placed, 7, 2)).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(hiddenCounts(placed, 7, 1)).toEqual([0, 2, 0, 0, 0, 0, 0]);
  });
});

describe('moving dates', () => {
  it('shifts days and ranges, keeping their length', () => {
    expect(shiftDateValue({ start: '2026-09-22' }, 2, 'UTC')).toEqual({ start: '2026-09-24' });
    expect(shiftDateValue({ start: '2026-09-22', end: '2026-09-25' }, -7, 'UTC')).toEqual({
      start: '2026-09-15',
      end: '2026-09-18',
    });
  });

  it('keeps wall-clock times across DST changes in the value or viewer zone', () => {
    // 09:30 in New York on Friday, moved over the November DST change.
    const moved = shiftDateValue(
      { start: '2026-10-30T13:30:00.000Z', includeTime: true, timeZone: 'America/New_York' },
      3,
      'UTC',
    );
    expect(moved.start).toBe('2026-11-02T14:30:00.000Z');
    const viewer = shiftDateValue(
      { start: '2026-03-27T09:00:00.000Z', end: '2026-03-27T10:00:00.000Z', includeTime: true },
      3,
      'Europe/Paris',
    );
    expect(viewer).toMatchObject({
      start: '2026-03-30T08:00:00.000Z',
      end: '2026-03-30T09:00:00.000Z',
    });
  });

  it('sets the end day of a date, making or removing a range', () => {
    expect(withEndDay({ start: '2026-09-22' }, '2026-09-25', 'UTC')).toEqual({
      start: '2026-09-22',
      end: '2026-09-25',
    });
    expect(withEndDay({ start: '2026-09-22', end: '2026-09-25' }, '2026-09-22', 'UTC')).toEqual({
      start: '2026-09-22',
    });
    // An end before the start clamps to the start.
    expect(withEndDay({ start: '2026-09-22' }, '2026-09-20', 'UTC')).toEqual({
      start: '2026-09-22',
    });
  });

  it('keeps end times when resizing timed dates', () => {
    const value = {
      start: '2026-09-22T09:00:00.000Z',
      end: '2026-09-22T11:00:00.000Z',
      includeTime: true,
    };
    expect(withEndDay(value, '2026-09-24', 'UTC')).toEqual({
      ...value,
      end: '2026-09-24T11:00:00.000Z',
    });
    // Back onto the start day: the end time is kept when it is after the start.
    expect(withEndDay(value, '2026-09-22', 'UTC')).toEqual(value);
    const noEnd = { start: '2026-09-22T09:00:00.000Z', includeTime: true };
    expect(withEndDay(noEnd, '2026-09-22', 'UTC')).toEqual(noEnd);
    expect(withEndDay(noEnd, '2026-09-23', 'UTC')).toEqual({
      ...noEnd,
      end: '2026-09-23T09:00:00.000Z',
    });
  });
});
