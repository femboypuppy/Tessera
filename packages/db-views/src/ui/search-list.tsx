import { cn } from '@tessera/ui';
import { Check, Plus } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { foldText } from '../query/text';

/** One entry of a {@link SearchList}. */
export interface SearchListItem {
  id: string;
  /** Text matched by the search and read by screen readers. */
  label: string;
  keywords?: readonly string[];
  /** What the row shows (defaults to the label). */
  content?: ReactNode;
  icon?: ReactNode;
  /** Shown on the right (a shortcut, a count). */
  trailing?: ReactNode;
}

export interface SearchListProps<T extends SearchListItem> {
  items: readonly T[];
  /** Accessible name of the input. */
  label: string;
  placeholder?: string;
  onSelect: (item: T) => void;
  /** Offers a "Create …" row for text that matches nothing exactly. */
  createLabel?: (query: string) => string;
  onCreate?: (query: string) => void;
  /** Shown when nothing matches (and nothing can be created). */
  emptyText: string;
  /** IDs shown with a check mark (multi-select pickers). */
  selectedIds?: ReadonlySet<string>;
  onEscape?: () => void;
  /** Backspace in an empty input (removes the last chip in multi-selects). */
  onBackspaceEmpty?: () => void;
  autoFocus?: boolean;
  /** Controlled query (for callers that need it); uncontrolled otherwise. */
  initialQuery?: string;
  /** Rendered between the input and the list (chips of selected values). */
  header?: ReactNode;
  className?: string;
  listClassName?: string;
}

/**
 * A search box over a list, keyboard first: type to filter, arrows to move, Enter to pick, Escape
 * to leave. Follows the ARIA combobox pattern (focus stays in the input, `aria-activedescendant`
 * marks the highlighted option).
 */
export function SearchList<T extends SearchListItem>({
  items,
  label,
  placeholder,
  onSelect,
  createLabel,
  onCreate,
  emptyText,
  selectedIds,
  onEscape,
  onBackspaceEmpty,
  autoFocus = true,
  initialQuery = '',
  header,
  className,
  listClassName,
}: SearchListProps<T>) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = foldText(query.trim());
    if (!needle) return items;
    return items.filter((item) =>
      [item.label, ...(item.keywords ?? [])].some((text) => foldText(text).includes(needle)),
    );
  }, [items, query]);
  const trimmed = query.trim();
  const exact = items.some((item) => foldText(item.label) === foldText(trimmed));
  const canCreate = !!onCreate && !!createLabel && trimmed !== '' && !exact;
  const count = filtered.length + (canCreate ? 1 : 0);
  const active = Math.min(highlight, Math.max(0, count - 1));

  useEffect(() => setHighlight(0), [query]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const choose = (index: number) => {
    const item = filtered[index];
    if (item) onSelect(item);
    else if (canCreate && index === filtered.length) {
      onCreate?.(trimmed);
      setQuery('');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlight((active + 1) % Math.max(1, count));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight((active - 1 + Math.max(1, count)) % Math.max(1, count));
        break;
      case 'Home':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setHighlight(0);
        }
        break;
      case 'End':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setHighlight(Math.max(0, count - 1));
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (count > 0) choose(active);
        break;
      case 'Escape':
        if (onEscape) {
          event.preventDefault();
          event.stopPropagation();
          onEscape();
        }
        break;
      case 'Backspace':
        if (query === '' && onBackspaceEmpty) {
          event.preventDefault();
          onBackspaceEmpty();
        }
        break;
      default:
        break;
    }
  };

  const optionId = (index: number) => `${id}-option-${index}`;
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {header}
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={count > 0 ? optionId(active) : undefined}
        value={query}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus"
      />
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        aria-multiselectable={selectedIds ? true : undefined}
        className={cn('mt-1 max-h-72 min-h-0 overflow-y-auto', listClassName)}
      >
        {filtered.map((item, index) => {
          const selected = selectedIds?.has(item.id) ?? false;
          return (
            // Options of a combobox list are not focusable: focus stays in the input, which handles
            // the keyboard and points at the highlighted option with aria-activedescendant.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- ARIA combobox pattern
            <div
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={selectedIds ? selected : index === active}
              data-index={index}
              data-highlighted={index === active || undefined}
              onPointerMove={() => setHighlight(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg select-none data-[highlighted]:bg-hover"
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.content ?? item.label}</span>
              {item.trailing}
              {selectedIds ? (
                <Check
                  aria-hidden="true"
                  className={cn('size-4 shrink-0 text-accent-text', !selected && 'invisible')}
                />
              ) : null}
            </div>
          );
        })}
        {canCreate ? (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- ARIA combobox pattern (see above)
          <div
            id={optionId(filtered.length)}
            role="option"
            aria-selected={active === filtered.length}
            data-index={filtered.length}
            data-highlighted={active === filtered.length || undefined}
            onPointerMove={() => setHighlight(filtered.length)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(filtered.length)}
            className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg select-none data-[highlighted]:bg-hover"
          >
            <Plus aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate">{createLabel?.(trimmed)}</span>
          </div>
        ) : null}
        {count === 0 ? <p className="px-2 py-1.5 text-ui text-fg-muted">{emptyText}</p> : null}
      </div>
    </div>
  );
}
