import type { DateValue, JsonValue, PropertyDefinition, ResolvedRow } from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import { Button, IconButton, Switch, cn } from '@tessera/ui';
import { FileText, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { ensureOption, setCell, type DatabaseRef } from '../../model/operations';
import { readCell, readDateValue } from '../../query/cells';
import {
  dayKeyOfInstant,
  timeOfInstant,
  todayKey,
  zonedTimeToInstant,
  type DayKey,
} from '../../query/dates';
import { cellToText, dateToPlainText } from '../../query/format';
import { parseCellText, parseDateText } from '../../query/parse';
import type { QueryContext } from '../../query/types';
import { OptionBadge, displayTitle } from '../common';
import { runAction } from '../hooks';
import { MonthCalendar } from '../month-calendar';
import { SearchList, type SearchListItem } from '../search-list';

/** Where the grid moves after an edit ends. */
export type EditMove = 'down' | 'up' | 'right' | 'left' | null;

export interface CellEditorProps {
  database: DatabaseRef;
  row: ResolvedRow;
  property: PropertyDefinition;
  queryCtx: QueryContext;
  /** Text typed to start editing: it replaces the value. */
  initialText?: string | null;
  /** Editing ended (committed or cancelled). */
  onDone: (move?: EditMove) => void;
  className?: string;
}

/** Property types edited in place as text. */
export const TEXT_EDITOR_TYPES = new Set(['title', 'text', 'number', 'url', 'email']);

/** Property types edited in a popover. */
export const POPOVER_EDITOR_TYPES = new Set(['select', 'multiSelect', 'date', 'relation']);

function currentText(
  row: ResolvedRow,
  property: PropertyDefinition,
  queryCtx: QueryContext,
): string {
  if (property.type === 'title') return row.title;
  return cellToText(readCell(row, property), property, queryCtx);
}

/**
 * Edits title, text, number, URL and email cells as text. Enter saves (Shift+Enter adds a line in
 * text cells), Tab saves and moves, Escape cancels, leaving the field saves.
 */
export function TextCellEditor({
  database,
  row,
  property,
  queryCtx,
  initialText,
  onDone,
  className,
}: CellEditorProps) {
  const ctx = useAppContext();
  const original = currentText(row, property, queryCtx);
  const [draft, setDraft] = useState(initialText ?? original);
  const [invalid, setInvalid] = useState(false);
  const finished = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const multiline = property.type === 'text';

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  /** Saves the draft; returns false when it does not parse (numbers). */
  const save = (text: string): boolean => {
    if (text === original && initialText == null) return true;
    const parsed = parseCellText(text, property, queryCtx);
    if (parsed.kind === 'invalid') return false;
    let value: JsonValue | null = null;
    if (parsed.kind === 'title') value = parsed.title;
    else if (parsed.kind === 'value') value = parsed.value;
    else return true;
    runAction(ctx, () => setCell(ctx, database, row.id, property, value));
    return true;
  };

  const finish = (move: EditMove) => {
    if (finished.current) return;
    if (!save(draft)) {
      setInvalid(true);
      return;
    }
    finished.current = true;
    onDone(move);
  };

  // Scrolling a virtualized row away unmounts the editor: keep what was typed.
  useEffect(
    () => () => {
      if (!finished.current) save(draftRef.current);
    },
    // Runs once on unmount; `save` reads the latest draft through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only flush of the latest draft
    [],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finished.current = true;
      onDone(null);
    } else if (event.key === 'Enter' && !(multiline && event.shiftKey)) {
      event.preventDefault();
      finish(null);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      finish(event.shiftKey ? 'left' : 'right');
    }
  };

  const common = {
    'aria-label': t('cellEditor', { property: property.name || t('untitled') }),
    'aria-invalid': invalid || undefined,
    value: draft,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      setInvalid(false);
    },
    onKeyDown,
    onBlur: () => {
      if (finished.current) return;
      if (!save(draft)) {
        ctx.toast({ variant: 'error', title: t('invalidNumber', { text: draft }) });
      }
      finished.current = true;
      onDone(null);
    },
    placeholder:
      property.type === 'url'
        ? t('urlPlaceholder')
        : property.type === 'email'
          ? t('emailPlaceholder')
          : property.type === 'number'
            ? t('numberPlaceholder')
            : undefined,
    className: cn(
      'block w-full resize-none bg-surface px-2 py-1.5 text-sm text-fg outline-none placeholder:text-fg-subtle',
      invalid && 'text-danger-text',
      className,
    ),
  };
  return multiline ? (
    <textarea
      ref={inputRef}
      rows={Math.min(8, Math.max(1, draft.split('\n').length))}
      {...common}
    />
  ) : (
    <input
      ref={inputRef}
      inputMode={property.type === 'number' ? 'decimal' : undefined}
      type={property.type === 'email' ? 'email' : property.type === 'url' ? 'url' : 'text'}
      {...common}
    />
  );
}

/** Picks one option (select) or several (multi-select), creating options by typing. */
export function OptionsCellEditor({ database, row, property, queryCtx, onDone }: CellEditorProps) {
  const ctx = useAppContext();
  const multi = property.type === 'multiSelect';
  const value = readCell(row, property);
  const selected = useMemo(() => {
    const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const known = new Set(property.options?.map((option) => option.id));
    return ids.filter((id): id is string => typeof id === 'string' && known.has(id));
  }, [value, property.options]);
  const items = useMemo<Array<SearchListItem & { optionId: string }>>(
    () =>
      (property.options ?? []).map((option) => ({
        id: option.id,
        optionId: option.id,
        label: option.name,
        content: <OptionBadge option={option} />,
      })),
    [property.options],
  );
  const write = (ids: string[]) =>
    runAction(ctx, () => setCell(ctx, database, row.id, property, multi ? ids : (ids[0] ?? null)));
  const pick = (optionId: string) => {
    if (!multi) {
      write(optionId === selected[0] ? [] : [optionId]);
      onDone(null);
      return;
    }
    write(
      selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId],
    );
  };
  const byId = new Map(property.options?.map((option) => [option.id, option]));
  const chips = selected.length > 0 && (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {selected.map((id) => {
        const option = byId.get(id);
        if (!option) return null;
        return (
          <OptionBadge key={id} option={option} className="pr-0.5">
            <button
              type="button"
              aria-label={t('removeValue', { name: option.name })}
              onClick={() => write(selected.filter((other) => other !== id))}
              className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm opacity-70 hover:opacity-100"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </OptionBadge>
        );
      })}
    </div>
  );
  return (
    <SearchList
      items={items}
      label={t('cellEditor', { property: property.name })}
      placeholder={t('selectPlaceholder')}
      header={chips || null}
      selectedIds={multi ? new Set(selected) : undefined}
      onSelect={(item) => pick(item.optionId)}
      createLabel={(name) => t('createOption', { name })}
      onCreate={(name) =>
        runAction(ctx, () => {
          const option = ensureOption(database.doc, property.id, name);
          pick(option.id);
        })
      }
      emptyText={t('noOptions')}
      onEscape={() => onDone(null)}
      onBackspaceEmpty={() => {
        if (selected.length > 0) write(selected.slice(0, -1));
      }}
      className="w-64"
      initialQuery=""
      listClassName={cn(queryCtx.locale && 'max-h-64')}
    />
  );
}

/** Picks pages for a relation: rows of the target database, or any page. */
export function RelationCellEditor({ database, row, property, onDone }: CellEditorProps) {
  const ctx = useAppContext();
  const pages = usePages();
  const value = readCell(row, property);
  const selected = useMemo(
    () =>
      (Array.isArray(value) ? value : []).filter(
        (id): id is string => typeof id === 'string' && pages.has(id) && !pages.isTrashed(id),
      ),
    [value, pages],
  );
  const target = property.relation?.targetDatabaseId ?? null;
  const items = useMemo<SearchListItem[]>(() => {
    const candidates = target
      ? pages.children(target, { includeRows: true })
      : pages.all().filter((page) => !pages.isTrashed(page.id));
    return candidates
      .filter((page) => page.id !== row.id)
      .slice(0, 2000)
      .map((page) => ({
        id: page.id,
        label: displayTitle(page.title),
        icon: page.icon ? (
          <span aria-hidden="true" className="w-4 text-center">
            {page.icon}
          </span>
        ) : (
          <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        ),
      }));
  }, [pages, target, row.id]);
  const one = property.relation?.limit === 'one';
  const write = (ids: string[]) =>
    runAction(ctx, () => setCell(ctx, database, row.id, property, ids));
  const chips = selected.length > 0 && (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {selected.map((id) => (
        <span
          key={id}
          className="inline-flex max-w-full items-center gap-1 rounded-sm bg-hover px-1.5 text-xs leading-5 text-fg"
        >
          <span className="truncate">{displayTitle(pages.get(id)?.title)}</span>
          <button
            type="button"
            aria-label={t('removeValue', { name: displayTitle(pages.get(id)?.title) })}
            onClick={() => write(selected.filter((other) => other !== id))}
            className="inline-flex size-4 items-center justify-center rounded-sm text-fg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
  return (
    <SearchList
      items={items}
      label={t('cellEditor', { property: property.name })}
      placeholder={t('relationPlaceholder')}
      header={chips || null}
      selectedIds={new Set(selected)}
      onSelect={(item) => {
        if (one) {
          write(selected.includes(item.id) ? [] : [item.id]);
          onDone(null);
        } else {
          write(
            selected.includes(item.id)
              ? selected.filter((id) => id !== item.id)
              : [...selected, item.id],
          );
        }
      }}
      emptyText={t('noPages')}
      onEscape={() => onDone(null)}
      onBackspaceEmpty={() => {
        if (selected.length > 0) write(selected.slice(0, -1));
      }}
      className="w-72"
    />
  );
}

function timeText(iso: string, zone: string): string {
  const { hour, minute } = timeOfInstant(Date.parse(iso), zone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Edits a date: type it or pick it on the calendar, add an end date, include a time. Every change
 * is saved right away; Escape or clicking outside closes.
 */
export function DateCellEditor({ database, row, property, queryCtx, onDone }: CellEditorProps) {
  const ctx = useAppContext();
  const id = useId();
  const value = readDateValue(readCell(row, property));
  const zone = queryCtx.timeZone;
  const today = todayKey(queryCtx.now, zone);
  const dayOf = (text: string, includeTime: boolean | undefined) =>
    includeTime ? dayKeyOfInstant(Date.parse(text), zone) : text;
  const startDay = value ? dayOf(value.start, value.includeTime) : null;
  const endDay = value?.end ? dayOf(value.end, value.includeTime) : null;
  const [month, setMonth] = useState<DayKey>(startDay ?? today);
  const [focusDay, setFocusDay] = useState<DayKey>(startDay ?? today);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [draft, setDraft] = useState(value ? dateToPlainText(value, queryCtx) : '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value ? dateToPlainText(value, queryCtx) : '');
    // Re-sync the text when the stored value changes (picked on the calendar, remote edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized value
  }, [JSON.stringify(value)]);

  const write = (next: DateValue | null) =>
    runAction(ctx, () =>
      setCell(ctx, database, row.id, property, next as unknown as JsonValue | null),
    );

  const withTime = (day: DayKey, time: string) => {
    const [h = '9', m = '0'] = time.split(':');
    return new Date(zonedTimeToInstant(day, Number(h), Number(m), zone)).toISOString();
  };

  const build = (start: DayKey, end: DayKey | null, includeTime: boolean): DateValue => {
    const [low, high] = end && end < start ? [end, start] : [start, end];
    if (!includeTime) {
      const next: DateValue = { start: low };
      if (high && high !== low) next.end = high;
      return next;
    }
    const startTime = value?.includeTime ? timeText(value.start, zone) : '09:00';
    const endTime = value?.includeTime && value.end ? timeText(value.end, zone) : startTime;
    const next: DateValue = { start: withTime(low, startTime), includeTime: true };
    if (high) next.end = withTime(high, endTime);
    if (next.end && Date.parse(next.end) < Date.parse(next.start)) next.end = next.start;
    return next;
  };

  const hasEnd = value?.end != null || pickingEnd;
  const pick = (day: DayKey) => {
    if (hasEnd && startDay && pickingEnd) {
      write(build(startDay, day, !!value?.includeTime));
      setPickingEnd(false);
    } else if (hasEnd) {
      write(build(day, endDay ?? day, !!value?.includeTime));
      setPickingEnd(true);
    } else {
      write(build(day, null, !!value?.includeTime));
    }
    setFocusDay(day);
  };

  const commitDraft = () => {
    if (draft.trim() === '') {
      write(null);
      return;
    }
    const parsed = parseDateText(draft, queryCtx);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    write(parsed);
    const day = parsed.includeTime ? dayKeyOfInstant(Date.parse(parsed.start), zone) : parsed.start;
    setMonth(day);
    setFocusDay(day);
  };

  const setTime = (which: 'start' | 'end', time: string) => {
    if (!value?.includeTime || !startDay || !/^\d{2}:\d{2}$/.test(time)) return;
    const next: DateValue = { ...value };
    if (which === 'start') next.start = withTime(startDay, time);
    else next.end = withTime(endDay ?? startDay, time);
    if (next.end && Date.parse(next.end) < Date.parse(next.start)) next.end = next.start;
    write(next);
  };

  return (
    <div className="flex w-[16.5rem] flex-col gap-2">
      <div>
        <input
          aria-label={t('cellEditor', { property: property.name })}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          value={draft}
          placeholder="2026-09-23"
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onDone(null);
            }
          }}
          className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus aria-invalid:border-danger"
        />
        {invalid ? (
          <p id={`${id}-error`} className="mt-1 text-xs text-danger-text">
            {t('invalidDate', { text: draft })}
          </p>
        ) : null}
      </div>
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        focusDay={focusDay}
        onFocusDay={setFocusDay}
        onPick={pick}
        selectedStart={startDay}
        selectedEnd={endDay}
        today={today}
        weekStartsOn={queryCtx.weekStartsOn}
        locale={queryCtx.locale}
      />
      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <label className="flex items-center justify-between gap-2 text-ui text-fg">
          {t('endDate')}
          <Switch
            checked={hasEnd}
            onCheckedChange={(checked) => {
              if (!startDay) {
                setPickingEnd(checked);
                return;
              }
              if (checked) {
                write(build(startDay, startDay, !!value?.includeTime));
                setPickingEnd(true);
              } else {
                write(build(startDay, null, !!value?.includeTime));
                setPickingEnd(false);
              }
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-ui text-fg">
          {t('includeTime')}
          <Switch
            checked={!!value?.includeTime}
            disabled={!startDay}
            onCheckedChange={(checked) => {
              if (startDay) write(build(startDay, endDay, checked));
            }}
          />
        </label>
        {value?.includeTime ? (
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label={`${t('time')} (${t('startDate')})`}
              value={timeText(value.start, zone)}
              onChange={(event) => setTime('start', event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-1.5 text-ui text-fg"
            />
            {value.end ? (
              <input
                type="time"
                aria-label={`${t('time')} (${t('endDate')})`}
                value={timeText(value.end, zone)}
                onChange={(event) => setTime('end', event.target.value)}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-1.5 text-ui text-fg"
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <Button size="sm" variant="ghost" onClick={() => write(null)} disabled={!value}>
          {t('clearValue')}
        </Button>
        <IconButton size="sm" label={t('closePeek')} icon={<X />} onClick={() => onDone(null)} />
      </div>
    </div>
  );
}
