import { tagKey, type PageKind } from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import {
  Badge,
  Button,
  Checkbox,
  cn,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  Switch,
} from '@tessera/ui';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Hash,
  ListChecks,
  Plus,
  Search,
  SearchX,
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
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import { formatQuery, hasFilters, parseQuery, type ParsedQuery } from '../engine/query';
import type { RichSearchHit, TagCount } from '../engine/types';
import { t } from '../i18n';
import { isMiniSearchIndex } from '../services/guards';
import { displayTitle, Highlighted, PageGlyph, relativeTime, usePagePath } from '../ui/common';
import {
  openSearch,
  syncSearchParamsFromLocation,
  useSearchParamsState,
  type SearchParams,
} from './location';

const PAGE_SIZE = 20;

interface ResultsState {
  key: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  hits: RichSearchHit[];
  total: number;
  tookMs: number;
}

function resultsKey(params: SearchParams): string {
  return JSON.stringify([params.query, params.page, params.includeRows]);
}

function useResults(params: SearchParams): [ResultsState, () => void] {
  const ctx = useAppContext();
  const index = ctx.services.searchIndex;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ResultsState>({
    key: '',
    status: 'idle',
    hits: [],
    total: 0,
    tookMs: 0,
  });
  useEffect(() => {
    if (!isMiniSearchIndex(index)) return undefined;
    return index.subscribe(() => setVersion((value) => value + 1));
  }, [index]);
  useEffect(() => {
    const key = resultsKey(params);
    const parsed = parseQuery(params.query);
    if (!parsed.text && !hasFilters(parsed)) {
      setState({ key, status: 'idle', hits: [], total: 0, tookMs: 0 });
      return undefined;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, key, status: 'loading' }));
    const started = performance.now();
    index
      .query(params.query, {
        limit: PAGE_SIZE,
        offset: (params.page - 1) * PAGE_SIZE,
        includeRows: params.includeRows,
        signal: controller.signal,
      })
      .then(
        (results) => {
          if (controller.signal.aborted) return;
          setState({
            key,
            status: 'done',
            hits: results.hits as RichSearchHit[],
            total: results.total,
            tookMs: performance.now() - started,
          });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn('[search] query failed', error);
          setState({ key, status: 'error', hits: [], total: 0, tookMs: 0 });
        },
      );
    return () => controller.abort();
  }, [index, params, version]);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  return [state, retry];
}

function useTagList(): TagCount[] {
  const ctx = useAppContext();
  const [tags, setTags] = useState<TagCount[]>([]);
  useEffect(() => {
    const index = ctx.services.searchIndex;
    if (!isMiniSearchIndex(index)) return undefined;
    let active = true;
    const load = () =>
      index.tags().then(
        (list) => {
          if (active) setTags(list);
        },
        () => undefined,
      );
    void load();
    const off = index.subscribe(() => void load());
    return () => {
      active = false;
      off();
    };
  }, [ctx]);
  return tags;
}

function ResultRow({ hit, query }: { hit: RichSearchHit; query: string }) {
  const ctx = useAppContext();
  const snapshot = usePages();
  const page = snapshot.get(hit.pageId);
  const path = usePagePath(hit.pageId);
  const title = displayTitle(page?.title ?? hit.title);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const options: { heading?: string; blockId?: string } = {};
    if (hit.heading) options.heading = hit.heading;
    else if (hit.blockId) options.blockId = hit.blockId;
    ctx.navigate(hit.pageId, options);
  };
  return (
    <li>
      <a
        href={`/p/${encodeURIComponent(hit.pageId)}`}
        onClick={open}
        data-query={query}
        className="duration-fast group/result -mx-3 flex gap-3 rounded-lg px-3 py-2.5 transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
      >
        <PageGlyph
          page={page ?? { kind: hit.kind }}
          isRow={snapshot.isRow(hit.pageId)}
          className="mt-0.5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <Highlighted
              text={title}
              ranges={page?.title === hit.title ? hit.titleHighlights : undefined}
              className="truncate text-sm font-medium text-fg"
            />
            {path ? <span className="min-w-0 truncate text-xs text-fg-subtle">{path}</span> : null}
          </span>
          {hit.snippet ? (
            <Highlighted
              text={hit.snippet.text}
              ranges={hit.snippet.highlights}
              className="line-clamp-2 text-ui text-fg-muted"
            />
          ) : null}
          <span className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-fg-subtle">
            {hit.tags?.slice(0, 4).map((tag) => (
              <Badge key={tag} tone="neutral" className="font-normal">
                #{tag}
              </Badge>
            ))}
            {page ? <span>{t('edited', { when: relativeTime(page.updatedAt) })}</span> : null}
          </span>
        </span>
      </a>
    </li>
  );
}

function TagFilter({
  parsed,
  tags,
  onChange,
}: {
  parsed: ParsedQuery;
  tags: TagCount[];
  onChange: (next: ParsedQuery) => void;
}) {
  const selected = new Set(parsed.tags.map((tag) => tagKey(tag)));
  const label =
    parsed.tags.length === 0
      ? t('filterTags')
      : parsed.tags.length === 1
        ? `#${parsed.tags[0] ?? ''}`
        : t('filterTagsCount', { count: parsed.tags.length });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={parsed.tags.length ? 'subtle' : 'secondary'}>
          <Hash aria-hidden="true" />
          {label}
          <ChevronDown aria-hidden="true" className="text-fg-subtle" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-60 overflow-y-auto p-1">
        {tags.length === 0 ? (
          <p className="px-2 py-1.5 text-ui text-fg-subtle">{t('filterTagsNone')}</p>
        ) : (
          <ul aria-label={t('filterTags')} className="flex flex-col">
            {tags.map((tag) => {
              const id = `tag-filter-${tag.key}`;
              return (
                <li key={tag.key}>
                  <label
                    htmlFor={id}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-hover"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.has(tag.key)}
                      onCheckedChange={(checked) => {
                        const rest = parsed.tags.filter((name) => tagKey(name) !== tag.key);
                        onChange({
                          ...parsed,
                          tags: checked === true ? [...rest, tag.name] : rest,
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">#{tag.name}</span>
                    <span className="text-xs text-fg-subtle">{tag.count}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function InsideFilter({
  parsed,
  onChange,
}: {
  parsed: ParsedQuery;
  onChange: (next: ParsedQuery) => void;
}) {
  const snapshot = usePages();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const candidates = useMemo(() => {
    const wanted = filter.trim().toLocaleLowerCase();
    return snapshot
      .all()
      .filter(
        (page) =>
          page.title.trim() &&
          !snapshot.isTrashed(page.id) &&
          !snapshot.isRow(page.id) &&
          snapshot.children(page.id, { includeRows: true }).length > 0 &&
          (!wanted || page.title.toLocaleLowerCase().includes(wanted)),
      )
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 50);
  }, [filter, snapshot]);
  const current = parsed.within[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={current ? 'subtle' : 'secondary'}>
          <FolderTree aria-hidden="true" />
          <span className="max-w-40 truncate">{current ?? t('filterIn')}</span>
          <ChevronDown aria-hidden="true" className="text-fg-subtle" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <label htmlFor={inputId} className="sr-only">
          {t('filterInPlaceholder')}
        </label>
        <Input
          id={inputId}
          value={filter}
          placeholder={t('filterInPlaceholder')}
          onChange={(event) => setFilter(event.target.value)}
        />
        <ul className="mt-1 flex max-h-64 flex-col overflow-y-auto">
          <li>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              onClick={() => {
                onChange({ ...parsed, within: [] });
                setOpen(false);
              }}
            >
              {t('filterInAny')}
            </button>
          </li>
          {candidates.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                aria-pressed={current === page.title}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none aria-pressed:bg-active"
                onClick={() => {
                  onChange({ ...parsed, within: [page.title] });
                  setOpen(false);
                }}
              >
                <PageGlyph page={page} />
                <span className="min-w-0 flex-1 truncate">{page.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('pagination')} className="mt-6 flex items-center justify-center gap-3">
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft aria-hidden="true" />
        {t('previousPage')}
      </Button>
      <span className="text-ui text-fg-muted" aria-current="page">
        {t('pageOf', { page, pages })}
      </span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('nextPage')}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}

function SyntaxHelp() {
  const rows: Array<[string, string]> = [
    ['tag:space', t('syntaxTag')],
    ['in:"Projects"', t('syntaxIn')],
    ['type:database', t('syntaxType')],
    ['is:task', t('syntaxTask')],
  ];
  return (
    <section className="mx-auto mt-2 max-w-md rounded-xl border border-border p-4">
      <h2 className="mb-2 text-xs font-medium text-fg-subtle">{t('syntaxTitle')}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui">
        {rows.map(([syntax, meaning]) => (
          <div key={syntax} className="contents">
            <dt>
              <Kbd className="font-mono">{syntax}</Kbd>
            </dt>
            <dd className="text-fg-muted">{meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The full search page (`/search?q=`): filters, result counts and pagination. */
export default function SearchPage() {
  const ctx = useAppContext();
  const params = useSearchParamsState();
  const [input, setInput] = useState(params.query);
  const [results, retry] = useResults(params);
  const tags = useTagList();
  const inputRef = useRef<HTMLInputElement>(null);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();
  const parsed = useMemo(() => parseQuery(params.query), [params.query]);

  useEffect(() => {
    syncSearchParamsFromLocation();
    document.title = t('documentTitle');
    inputRef.current?.focus();
  }, []);
  // Follow navigations to /search from elsewhere (a tag click, the palette).
  const [shownQuery, setShownQuery] = useState(params.query);
  if (shownQuery !== params.query) {
    setShownQuery(params.query);
    if (typing.current === null) setInput(params.query);
  }
  useEffect(
    () => () => {
      if (typing.current) clearTimeout(typing.current);
    },
    [],
  );

  const update = (next: Partial<SearchParams>, replace = true) =>
    openSearch(ctx, { ...params, page: 1, ...next }, { replace });
  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInput(value);
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => {
      typing.current = null;
      update({ query: value });
    }, 150);
  };
  const setParsed = (next: ParsedQuery) => {
    const query = formatQuery(next);
    setInput(query);
    update({ query }, false);
  };
  const pages = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const empty = !parsed.text && !hasFilters(parsed);
  const typeValue = parsed.kinds.length === 1 ? (parsed.kinds[0] as PageKind) : 'any';
  const filtered = hasFilters(parsed) || !params.includeRows;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-24 md:px-8">
      <h1 className="mb-4 text-2xl font-semibold text-fg">{t('searchTitle')}</h1>
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          {t('searchInputLabel')}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          ref={inputRef}
          id={inputId}
          type="search"
          value={input}
          onChange={onInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (typing.current) clearTimeout(typing.current);
              typing.current = null;
              update({ query: input });
            }
          }}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          className="h-10 pr-9 pl-9 text-[15px]"
        />
        {input ? (
          <IconButton
            label={t('clearSearch')}
            icon={<X />}
            size="sm"
            tooltip={false}
            className="absolute top-1/2 right-2 -translate-y-1/2"
            onClick={() => {
              setInput('');
              update({ query: '' });
              inputRef.current?.focus();
            }}
          />
        ) : null}
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('filters')}
      >
        <Select
          size="sm"
          aria-label={t('filterType')}
          value={typeValue}
          className="w-36"
          onValueChange={(value) =>
            setParsed({ ...parsed, kinds: value === 'any' ? [] : [value as PageKind] })
          }
          options={[
            { value: 'any', label: t('filterAny') },
            { value: 'page', label: t('filterPages') },
            { value: 'database', label: t('filterDatabases') },
          ]}
        />
        <TagFilter parsed={parsed} tags={tags} onChange={setParsed} />
        <InsideFilter parsed={parsed} onChange={setParsed} />
        <Button
          size="sm"
          variant={parsed.hasTasks ? 'subtle' : 'secondary'}
          aria-pressed={parsed.hasTasks}
          onClick={() => setParsed({ ...parsed, hasTasks: !parsed.hasTasks })}
        >
          <ListChecks aria-hidden="true" />
          {t('filterTasks')}
        </Button>
        <label className="ml-1 flex items-center gap-2 text-ui text-fg-muted">
          <Switch
            checked={params.includeRows}
            onCheckedChange={(checked) => update({ includeRows: checked }, false)}
          />
          {t('filterRows')}
        </label>
        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = { ...parsed, tags: [], within: [], kinds: [], hasTasks: false };
              const query = formatQuery(next);
              setInput(query);
              update({ query, includeRows: true }, false);
            }}
          >
            {t('clearFilters')}
          </Button>
        ) : null}
      </div>

      <div className="mt-6">
        {empty ? (
          <>
            <EmptyState
              icon={<Search />}
              title={t('searchEmptyTitle')}
              description={t('searchEmptyHint')}
              className="py-8"
            />
            <SyntaxHelp />
          </>
        ) : results.status === 'error' ? (
          <EmptyState
            tone="danger"
            icon={<TriangleAlert />}
            title={t('searchFailed')}
            actions={<Button onClick={retry}>{t('retry')}</Button>}
          />
        ) : results.status === 'loading' && results.hits.length === 0 ? (
          <div aria-busy="true" aria-label={t('searchTitle')} className="flex flex-col gap-5 pt-2">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-3">
                <Skeleton className="size-4" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : results.status === 'done' && results.total === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={t('noMatchesTitle')}
            description={t('noMatchesHint', { query: params.query })}
            actions={
              parsed.text ? (
                <Button
                  onClick={() => {
                    const page = ctx.workspace.createPage({ title: parsed.text });
                    ctx.navigate(page.id);
                  }}
                >
                  <Plus aria-hidden="true" />
                  {t('createPage', { title: parsed.text })}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="mb-2 text-xs text-fg-subtle" role="status" aria-live="polite">
              {t('results', { count: results.total })}{' '}
              <span className="tabular-nums">
                {t('resultsTook', { ms: Math.max(1, Math.round(results.tookMs)) })}
              </span>
            </p>
            <ul
              aria-label={t('searchTitle')}
              className={cn(
                'flex flex-col gap-0.5 transition-opacity',
                results.status === 'loading' && 'opacity-60',
              )}
            >
              {results.hits.map((hit) => (
                <ResultRow key={hit.pageId} hit={hit} query={params.query} />
              ))}
            </ul>
            <Pagination
              page={params.page}
              pages={pages}
              onPage={(page) => {
                openSearch(ctx, { ...params, page });
                document.getElementById('main')?.scrollTo({ top: 0 });
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
