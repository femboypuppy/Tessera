import {
  RELATIVE_DATE_RANGES,
  type DateOperand,
  type DateRangeOperand,
  type FilterCondition,
  type FilterValue,
  type PropertyDefinition,
  type RelativeDateRange,
} from '@tessera/core';
import { usePages } from '@tessera/core/react';
import { Input, Popover, PopoverContent, PopoverTrigger, Select, cn } from '@tessera/ui';
import { ChevronDown, FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { LIST_OPERATORS, VALUELESS_OPERATORS } from '../../query/filter-edit';
import { cleanNumber } from '../../query/format';
import { parseNumberText } from '../../query/parse';
import { OptionBadge, displayTitle } from '../common';
import { SearchList, type SearchListItem } from '../search-list';

/** A text field that writes after a short pause (so filters don't re-run on every key). */
function DraftInput({
  value,
  onCommit,
  label,
  inputMode,
  focusOnMount,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  inputMode?: 'decimal';
  focusOnMount?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  useEffect(() => setDraft(value), [value]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const schedule = (next: string) => {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => latest.current(next), 300);
  };
  return (
    <Input
      ref={inputRef}
      aria-label={label}
      value={draft}
      inputMode={inputMode}
      placeholder={t('filterValue')}
      onChange={(event) => schedule(event.target.value)}
      onBlur={() => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          if (timer.current !== null) window.clearTimeout(timer.current);
          onCommit(draft);
        }
      }}
      className="h-7 text-ui"
    />
  );
}

/** A button opening a searchable list (option and page pickers). */
function PickerButton({
  label,
  summary,
  items,
  selected,
  multiple,
  onChange,
  emptyText,
  focusOnMount,
}: {
  label: string;
  summary: ReactNode;
  items: readonly SearchListItem[];
  selected: readonly string[];
  multiple: boolean;
  onChange: (ids: string[]) => void;
  emptyText: string;
  focusOnMount?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) triggerRef.current?.focus();
  }, [focusOnMount]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          className="flex h-7 w-full min-w-0 items-center gap-1 rounded-md border border-border bg-bg px-2 text-left text-ui text-fg hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{summary}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <SearchList
          items={items}
          label={label}
          placeholder={t('searchProperties')}
          selectedIds={multiple ? new Set(selected) : undefined}
          onSelect={(item) => {
            if (!multiple) {
              onChange([item.id]);
              setOpen(false);
              return;
            }
            onChange(
              selected.includes(item.id)
                ? selected.filter((id) => id !== item.id)
                : [...selected, item.id],
            );
          }}
          emptyText={emptyText}
          onEscape={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

type DateMode = 'today' | 'tomorrow' | 'yesterday' | 'daysAgo' | 'daysAhead' | 'exact';

function dateMode(value: DateOperand): DateMode {
  if (value.kind === 'exact') return 'exact';
  if (value.unit !== 'day') return value.amount < 0 ? 'daysAgo' : 'daysAhead';
  if (value.amount === 0) return 'today';
  if (value.amount === 1) return 'tomorrow';
  if (value.amount === -1) return 'yesterday';
  return value.amount < 0 ? 'daysAgo' : 'daysAhead';
}

function DateOperandEditor({
  value,
  onChange,
  today,
}: {
  value: DateOperand;
  onChange: (value: DateOperand) => void;
  today: string;
}) {
  const mode = dateMode(value);
  const days =
    value.kind === 'relative' ? Math.abs(value.amount * (value.unit === 'week' ? 7 : 1)) : 7;
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      <Select
        size="sm"
        aria-label={t('filterValue')}
        value={mode}
        className="min-w-0 flex-1"
        onValueChange={(next) => {
          const choice = next as DateMode;
          if (choice === 'today') onChange({ kind: 'relative', unit: 'day', amount: 0 });
          else if (choice === 'tomorrow') onChange({ kind: 'relative', unit: 'day', amount: 1 });
          else if (choice === 'yesterday') onChange({ kind: 'relative', unit: 'day', amount: -1 });
          else if (choice === 'daysAgo') onChange({ kind: 'relative', unit: 'day', amount: -days });
          else if (choice === 'daysAhead')
            onChange({ kind: 'relative', unit: 'day', amount: days });
          else onChange({ kind: 'exact', date: value.kind === 'exact' ? value.date : today });
        }}
        options={[
          { value: 'today', label: t('range_today') },
          { value: 'tomorrow', label: t('range_tomorrow') },
          { value: 'yesterday', label: t('range_yesterday') },
          { value: 'daysAgo', label: t('daysAgo') },
          { value: 'daysAhead', label: t('daysFromNow') },
          { value: 'exact', label: t('exactDate') },
        ]}
      />
      {mode === 'daysAgo' || mode === 'daysAhead' ? (
        <Input
          type="number"
          min={1}
          aria-label={mode === 'daysAgo' ? t('daysAgo') : t('daysFromNow')}
          value={days}
          onChange={(event) => {
            const amount = Math.max(1, Math.min(3650, Math.trunc(Number(event.target.value) || 1)));
            onChange({
              kind: 'relative',
              unit: 'day',
              amount: mode === 'daysAgo' ? -amount : amount,
            });
          }}
          className="h-7 w-16 text-ui"
        />
      ) : null}
      {mode === 'exact' && value.kind === 'exact' ? (
        <Input
          type="date"
          aria-label={t('exactDate')}
          value={value.date}
          onChange={(event) => {
            if (event.target.value) onChange({ kind: 'exact', date: event.target.value });
          }}
          className="h-7 w-36 text-ui"
        />
      ) : null}
    </div>
  );
}

function DateRangeEditor({
  value,
  onChange,
  today,
}: {
  value: DateRangeOperand;
  onChange: (value: DateRangeOperand) => void;
  today: string;
}) {
  const choice = value.kind === 'range' ? value.range : 'between';
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-1">
      <Select
        size="sm"
        aria-label={t('filterValue')}
        value={choice}
        className="min-w-0 flex-1"
        onValueChange={(next) =>
          onChange(
            next === 'between'
              ? { kind: 'between', start: today, end: today }
              : { kind: 'range', range: next as RelativeDateRange },
          )
        }
        options={[
          ...RELATIVE_DATE_RANGES.map((range) => ({ value: range, label: t(`range_${range}`) })),
          { value: 'between', label: t('dateBetween') },
        ]}
      />
      {value.kind === 'between' ? (
        <div className="flex gap-1">
          <Input
            type="date"
            aria-label={t('startDate')}
            value={value.start}
            onChange={(event) => {
              if (event.target.value) onChange({ ...value, start: event.target.value });
            }}
            className="h-7 w-36 text-ui"
          />
          <Input
            type="date"
            aria-label={t('endDate')}
            value={value.end}
            onChange={(event) => {
              if (event.target.value) onChange({ ...value, end: event.target.value });
            }}
            className="h-7 w-36 text-ui"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The value editor of a filter condition, by property type and operator: text and numbers
 * (written after a pause), option and page pickers, checkbox states, and relative or exact dates.
 */
export function FilterValueEditor({
  condition,
  property,
  onChange,
  today,
  focusOnMount,
}: {
  condition: FilterCondition;
  property: PropertyDefinition;
  onChange: (value: FilterValue | undefined) => void;
  today: string;
  focusOnMount?: boolean;
}) {
  const pages = usePages();
  const { operator, value } = condition;
  const optionItems = useMemo<SearchListItem[]>(
    () =>
      (property.options ?? []).map((option) => ({
        id: option.id,
        label: option.name,
        content: <OptionBadge option={option} />,
      })),
    [property.options],
  );
  const pageItems = useMemo<SearchListItem[]>(() => {
    if (property.type !== 'relation') return [];
    const target = property.relation?.targetDatabaseId ?? null;
    const candidates = target
      ? pages.children(target, { includeRows: true })
      : pages.all().filter((page) => !pages.isTrashed(page.id));
    return candidates.slice(0, 2000).map((page) => ({
      id: page.id,
      label: displayTitle(page.title),
      icon: page.icon ? (
        <span aria-hidden="true">{page.icon}</span>
      ) : (
        <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      ),
    }));
  }, [pages, property]);

  if (VALUELESS_OPERATORS.includes(operator)) return <div className="min-w-0 flex-1" />;
  const label = t('filterValue');
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'formula':
      return (
        <div className="min-w-0 flex-1">
          <DraftInput
            label={label}
            focusOnMount={focusOnMount}
            value={typeof value === 'string' ? value : ''}
            onCommit={(next) => onChange(next === '' ? undefined : next)}
          />
        </div>
      );
    case 'number': {
      const percent = property.number?.format === 'percent';
      const shown =
        typeof value === 'number' ? String(cleanNumber(percent ? value * 100 : value)) : '';
      return (
        <div className="min-w-0 flex-1">
          <DraftInput
            label={label}
            inputMode="decimal"
            focusOnMount={focusOnMount}
            value={shown}
            onCommit={(next) => {
              const parsed = parseNumberText(next);
              if (!parsed) onChange(undefined);
              else onChange(percent && !parsed.percent ? parsed.value / 100 : parsed.value);
            }}
          />
        </div>
      );
    }
    case 'select':
    case 'multiSelect': {
      const multiple = LIST_OPERATORS.includes(operator);
      const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      const chosen = (property.options ?? []).filter((option) => selected.includes(option.id));
      return (
        <div className="min-w-0 flex-1">
          <PickerButton
            label={label}
            focusOnMount={focusOnMount}
            items={optionItems}
            selected={selected}
            multiple={multiple}
            emptyText={t('noOptions')}
            summary={
              chosen.length > 0 ? (
                chosen.map((option) => <OptionBadge key={option.id} option={option} />)
              ) : (
                <span className="text-fg-subtle">{t('anyOption')}</span>
              )
            }
            onChange={(ids) => onChange(multiple ? ids : ids[0])}
          />
        </div>
      );
    }
    case 'relation': {
      const selected = typeof value === 'string' ? [value] : [];
      return (
        <div className="min-w-0 flex-1">
          <PickerButton
            label={label}
            focusOnMount={focusOnMount}
            items={pageItems}
            selected={selected}
            multiple={false}
            emptyText={t('noPages')}
            summary={
              selected[0] ? (
                <span className="truncate">{displayTitle(pages.get(selected[0])?.title)}</span>
              ) : (
                <span className="text-fg-subtle">{t('relationPlaceholder')}</span>
              )
            }
            onChange={(ids) => onChange(ids[0])}
          />
        </div>
      );
    }
    case 'checkbox':
      return (
        <Select
          size="sm"
          aria-label={label}
          className={cn('min-w-0 flex-1')}
          value={value === false ? 'false' : 'true'}
          onValueChange={(next) => onChange(next === 'true')}
          options={[
            { value: 'true', label: t('checked') },
            { value: 'false', label: t('unchecked') },
          ]}
        />
      );
    case 'date':
    case 'createdTime':
    case 'updatedTime': {
      if (operator === 'isWithin') {
        const range: DateRangeOperand =
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          (value.kind === 'range' || value.kind === 'between')
            ? value
            : { kind: 'range', range: 'thisWeek' };
        return <DateRangeEditor value={range} onChange={onChange} today={today} />;
      }
      const operand: DateOperand =
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value.kind === 'exact' || value.kind === 'relative')
          ? value
          : { kind: 'relative', unit: 'day', amount: 0 };
      return <DateOperandEditor value={operand} onChange={onChange} today={today} />;
    }
  }
}
