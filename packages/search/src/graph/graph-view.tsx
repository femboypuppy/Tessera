import { type JsonValue } from '@tessera/core';
import { useAppContext, useSetting } from '@tessera/core/react';
import {
  Button,
  Checkbox,
  cn,
  EmptyState,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Spinner,
  Switch,
} from '@tessera/ui';
import {
  ArrowRight,
  Maximize,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { normalizeTerm } from '../engine/text';
import type { GraphSnapshot } from '../engine/types';
import { t } from '../i18n';
import { displayTitle } from '../ui/common';
import {
  buildGraph,
  colorGraph,
  DEFAULT_FILTERS,
  reseed,
  type ColorBy,
  type GraphFilters,
  type GroupInfo,
  type TesseraGraph,
} from './build';
import { loadGraph, useGraphData } from './data';
import { GraphCanvas, useGraphTestHooks, type GraphCanvasHandle } from './graph-canvas';
import { GraphFallback } from './graph-fallback';
import { readGraphFocus } from './location';
import { useGraphTheme } from './theme';
import { useGraphLayout } from './use-layout';

/** View options remembered per device (`graph.options`). */
interface GraphOptions {
  colorBy: ColorBy | 'auto';
  showOrphans: boolean;
  showRows: boolean;
  depth: number | null;
}

function readOptions(value: JsonValue): GraphOptions {
  const input = (
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  ) as Record<string, JsonValue>;
  const depth = input.depth;
  return {
    colorBy: input.colorBy === 'tag' || input.colorBy === 'parent' ? input.colorBy : 'auto',
    showOrphans: input.showOrphans !== false,
    showRows: input.showRows === true,
    depth: depth === 1 || depth === 2 || depth === 3 ? depth : null,
  };
}

/** An empty graph for the layout hook while the snapshot loads. */
const EMPTY_GRAPH = buildGraph({ nodes: [], edges: [], tags: [] }, DEFAULT_FILTERS);

/** Tags when a good share of pages have one, top-level pages otherwise. */
function autoColorBy(snapshot: GraphSnapshot): ColorBy {
  const tagged = snapshot.nodes.filter((node) => node.tags.length > 0).length;
  return snapshot.tags.length > 0 && tagged > snapshot.nodes.length * 0.3 ? 'tag' : 'parent';
}

interface Suggestion {
  id: string;
  title: string;
}

function useSuggestions(graph: TesseraGraph, query: string): Suggestion[] {
  return useMemo(() => {
    const wanted = normalizeTerm(query.trim());
    if (!wanted) return [];
    const prefix: Suggestion[] = [];
    const inside: Suggestion[] = [];
    graph.forEachNode((id, attributes) => {
      const title = normalizeTerm(attributes.label);
      if (title.startsWith(wanted)) prefix.push({ id, title: attributes.label });
      else if (title.includes(wanted)) inside.push({ id, title: attributes.label });
    });
    const byTitle = (a: Suggestion, b: Suggestion) => a.title.localeCompare(b.title);
    return [...prefix.sort(byTitle), ...inside.sort(byTitle)].slice(0, 8);
  }, [graph, query]);
}

function GraphSearch({
  graph,
  focused,
  onFocus,
  onOpen,
}: {
  graph: TesseraGraph;
  focused: string | null;
  onFocus(id: string): void;
  onOpen(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const suggestions = useSuggestions(graph, query);
  const listId = useId();
  const current = suggestions[Math.min(active, suggestions.length - 1)];
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && current) {
        onFocus(current.id);
        setOpen(false);
      } else if (focused) {
        onOpen(focused);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-fg-subtle"
      />
      <input
        role="combobox"
        aria-label={t('graphSearch')}
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && current ? `${listId}-${current.id}` : undefined}
        value={query}
        placeholder={t('graphSearchPlaceholder')}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-lg border border-border bg-surface/95 pr-3 pl-8 text-sm text-fg shadow-popover backdrop-blur outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus"
      />
      {open && query.trim() ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t('graphSearch')}
          className="absolute inset-x-0 top-10 z-10 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-popover"
        >
          {suggestions.length === 0 ? (
            <p className="px-2 py-1.5 text-ui text-fg-subtle">{t('graphNoMatch')}</p>
          ) : (
            suggestions.map((suggestion, index) => (
              <div
                key={suggestion.id}
                id={`${listId}-${suggestion.id}`}
                role="option"
                aria-selected={suggestion === current}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => {
                  onFocus(suggestion.id);
                  setOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onFocus(suggestion.id);
                }}
                className={cn(
                  'flex h-8 cursor-pointer items-center rounded-md px-2 text-sm text-fg',
                  suggestion === current && 'bg-active',
                )}
              >
                <span className="truncate">{displayTitle(suggestion.title)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function FiltersPopover({
  snapshot,
  tags,
  setTags,
  options,
  setOptions,
  focused,
}: {
  snapshot: GraphSnapshot;
  tags: string[];
  setTags(tags: string[]): void;
  options: GraphOptions;
  setOptions(options: GraphOptions): void;
  focused: string | null;
}) {
  const orphansId = useId();
  const rowsId = useId();
  const active =
    tags.length > 0 || !options.showOrphans || options.showRows || options.depth !== null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={active ? 'subtle' : 'secondary'} className="shadow-popover">
          <SlidersHorizontal aria-hidden="true" />
          {t('graphFilters')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={orphansId} className="text-sm text-fg">
              {t('graphShowOrphans')}
            </label>
            <Switch
              id={orphansId}
              checked={options.showOrphans}
              onCheckedChange={(checked) => setOptions({ ...options, showOrphans: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={rowsId} className="text-sm text-fg">
              {t('graphShowRows')}
            </label>
            <Switch
              id={rowsId}
              checked={options.showRows}
              onCheckedChange={(checked) => setOptions({ ...options, showRows: checked })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-fg">{t('graphDepth')}</span>
            <Select
              size="sm"
              aria-label={t('graphDepth')}
              value={options.depth === null ? 'all' : String(options.depth)}
              onValueChange={(value) =>
                setOptions({ ...options, depth: value === 'all' ? null : Number(value) })
              }
              options={[
                { value: 'all', label: t('graphDepthAll') },
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
              ]}
            />
            <span className={cn('text-xs text-fg-subtle', focused && 'text-fg-muted')}>
              {t('graphDepthHint')}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-fg">{t('graphTags')}</span>
            {snapshot.tags.length === 0 ? (
              <span className="text-xs text-fg-subtle">{t('filterTagsNone')}</span>
            ) : (
              <ul className="-mx-1 flex max-h-44 flex-col overflow-y-auto">
                {snapshot.tags.slice(0, 40).map((tag) => {
                  const id = `graph-tag-${tag.key}`;
                  const checked = tags.includes(tag.key);
                  return (
                    <li key={tag.key}>
                      <label
                        htmlFor={id}
                        className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-hover"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(value) =>
                            setTags(
                              value === true
                                ? [...tags, tag.key]
                                : tags.filter((key) => key !== tag.key),
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">#{tag.name}</span>
                        <span className="text-xs text-fg-subtle">{tag.count}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Legend({ groups }: { groups: GroupInfo[] }) {
  if (groups.length === 0) return null;
  return (
    <section
      aria-label={t('graphLegend')}
      className="pointer-events-auto max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface/90 px-3 py-2 shadow-popover backdrop-blur"
    >
      <ul className="flex flex-col gap-1">
        {groups.map((group) => (
          <li key={group.key} className="flex items-center gap-2 text-xs text-fg-muted">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: group.color }}
            />
            <span className="min-w-0 flex-1 truncate">{group.label}</span>
            <span className="text-fg-subtle tabular-nums">{group.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The global graph (`/graph`): every page and link, laid out by ForceAtlas2 in a worker. */
export default function GraphView() {
  const ctx = useAppContext();
  const theme = useGraphTheme();
  const data = useGraphData(loadGraph, 'global');
  const [stored, setStored] = useSetting<JsonValue>(ctx.settings.device, 'graph.options', {});
  const options = useMemo(() => readOptions(stored), [stored]);
  const setOptions = (next: GraphOptions) => setStored({ ...next });
  const [tags, setTags] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(() => readGraphFocus());
  const [run, setRun] = useState(0);
  const canvas = useRef<GraphCanvasHandle>(null);
  const current = useRef<TesseraGraph | null>(null);
  const hintId = useId();
  const [failed, setFailed] = useState(false);
  // A new key mounts a new renderer (Try again after WebGL failed).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = t('graphDocumentTitle');
  }, []);

  const filters: GraphFilters = useMemo(
    () => ({
      tags,
      showOrphans: options.showOrphans,
      showRows: options.showRows,
      depth: options.depth,
      focus: focused,
    }),
    [tags, options.showOrphans, options.showRows, options.depth, focused],
  );
  const snapshot = data.snapshot;
  const graph = useMemo(() => {
    if (!snapshot) return null;
    // Keep positions across rebuilds (filters, live updates) so the picture doesn't jump.
    const previous = new Map<string, { x: number; y: number }>();
    current.current?.forEachNode((id, attributes) =>
      previous.set(id, { x: attributes.x, y: attributes.y }),
    );
    return buildGraph(snapshot, filters, previous);
  }, [snapshot, filters]);
  useEffect(() => {
    current.current = graph;
  }, [graph]);
  const colorBy: ColorBy =
    options.colorBy === 'auto' ? (snapshot ? autoColorBy(snapshot) : 'parent') : options.colorBy;
  const [legend, setLegend] = useState<GroupInfo[]>([]);
  useEffect(() => {
    if (!graph || !snapshot) return;
    setLegend(
      colorGraph(graph, snapshot, colorBy, theme, {
        other: t('moreOther'),
        none: t('graphNoTag'),
        untitled: t('untitled'),
      }),
    );
  }, [graph, snapshot, colorBy, theme]);

  const running = useGraphLayout(graph ?? EMPTY_GRAPH, { run });

  const focusNode = useCallback((id: string) => {
    setFocused(id);
    canvas.current?.focusNode(id);
  }, []);
  const open = useCallback((id: string) => ctx.navigate(id), [ctx]);

  // Center on the focused page once the layout has placed it.
  const centered = useRef<string | null>(null);
  useEffect(() => {
    if (!focused || running || centered.current === focused || !graph?.hasNode(focused)) return;
    centered.current = focused;
    canvas.current?.focusNode(focused);
  }, [focused, running, graph]);

  useGraphTestHooks(canvas, running);

  if (data.status === 'error' && !snapshot) {
    return (
      <EmptyState
        className="mt-24"
        tone="danger"
        icon={<TriangleAlert />}
        title={t('graphFailed')}
        actions={<Button onClick={data.retry}>{t('retry')}</Button>}
      />
    );
  }
  if (!graph || !snapshot) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ui text-fg-muted">
        <Spinner size="sm" label="" />
        {t('graphLoading')}
      </div>
    );
  }
  if (snapshot.nodes.length === 0) {
    return (
      <EmptyState
        className="mt-24"
        icon={<Network />}
        title={t('graphEmptyTitle')}
        description={t('graphEmptyHint')}
      />
    );
  }
  const focusTitle =
    focused && graph.hasNode(focused) ? graph.getNodeAttribute(focused, 'label') : null;
  return (
    <div className="relative h-full min-h-[24rem] w-full overflow-hidden bg-bg">
      <h1 className="sr-only">{t('graphTitle')}</h1>
      <p id={hintId} className="sr-only">
        {t('graphDescription')}
      </p>
      {failed ? (
        <div className="absolute inset-0 overflow-y-auto">
          <GraphFallback
            graph={graph}
            onOpen={open}
            onRetry={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          />
        </div>
      ) : (
        <GraphCanvas
          key={attempt}
          ref={canvas}
          graph={graph}
          theme={theme}
          focused={focused}
          onNodeClick={open}
          onError={() => setFailed(true)}
          labelThreshold={graph.order > 1500 ? 9 : 8}
          // Room for the search, filters, legend and zoom controls over the canvas, and for
          // labels right of the outermost nodes: the fitted graph stays clear of all of them.
          padding={96}
          large={graph.order > 3000 || graph.size > 6000}
          label={`${t('graphTitle')}: ${t('graphStats', { nodes: graph.order, edges: graph.size })}`}
          describedBy={hintId}
          className="absolute inset-0"
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex w-[min(20rem,100%)] flex-col gap-2">
          <GraphSearch graph={graph} focused={focused} onFocus={focusNode} onOpen={open} />
          {focusTitle !== null && focused ? (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface/95 py-1 pr-1 pl-3 text-ui shadow-popover backdrop-blur">
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {t('graphFocused', { title: displayTitle(focusTitle) })}
              </span>
              <IconButton
                size="sm"
                label={t('openPage', { title: displayTitle(focusTitle) })}
                icon={<ArrowRight />}
                onClick={() => open(focused)}
              />
              <IconButton
                size="sm"
                label={t('graphClearFocus')}
                icon={<X />}
                onClick={() => {
                  setFocused(null);
                  centered.current = null;
                  canvas.current?.reset();
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <Select
            size="sm"
            aria-label={t('graphColorBy')}
            value={colorBy}
            className="w-40 bg-surface shadow-popover"
            onValueChange={(value) => setOptions({ ...options, colorBy: value as ColorBy })}
            options={[
              { value: 'tag', label: `${t('graphColorBy')}: ${t('graphColorTag')}` },
              { value: 'parent', label: `${t('graphColorBy')}: ${t('graphColorParent')}` },
            ]}
          />
          <FiltersPopover
            snapshot={snapshot}
            tags={tags}
            setTags={setTags}
            options={options}
            setOptions={setOptions}
            focused={focused}
          />
        </div>
      </div>
      {failed ? null : (
        <div className="pointer-events-none absolute bottom-3 left-3 hidden sm:block">
          <Legend groups={legend} />
        </div>
      )}
      <div className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2">
        <div
          hidden={failed}
          className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-surface/95 shadow-popover backdrop-blur"
        >
          <IconButton
            label={t('graphZoomIn')}
            icon={<Plus />}
            onClick={() => canvas.current?.zoomIn()}
            className="rounded-none"
          />
          <IconButton
            label={t('graphZoomOut')}
            icon={<Minus />}
            onClick={() => canvas.current?.zoomOut()}
            className="rounded-none"
          />
          <IconButton
            label={t('graphReset')}
            icon={<Maximize />}
            onClick={() => canvas.current?.reset()}
            className="rounded-none"
          />
          <IconButton
            label={t('graphRelayout')}
            icon={<RefreshCw />}
            onClick={() => {
              reseed(graph, snapshot);
              setRun((value) => value + 1);
            }}
            className="rounded-none"
          />
        </div>
        <p
          role="status"
          className="pointer-events-auto flex items-center gap-1.5 rounded-md bg-surface/80 px-2 py-1 text-xs text-fg-subtle backdrop-blur"
        >
          {running ? <Spinner size="sm" label="" className="size-3" /> : null}
          {running
            ? t('graphLayoutRunning')
            : t('graphStats', { nodes: graph.order, edges: graph.size })}
        </p>
      </div>
    </div>
  );
}
