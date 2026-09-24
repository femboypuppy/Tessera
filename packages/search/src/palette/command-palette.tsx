import {
  commandShortcuts,
  COMMANDS,
  formatShortcut,
  readDocJSON,
  type Command,
  type PageMeta,
} from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import {
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  Kbd,
  KeyCombo,
  Spinner,
  useMediaQuery,
  VisuallyHidden,
} from '@tessera/ui';
import { CornerDownLeft, Hash, Plus, Search, SquareTerminal, TriangleAlert } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { hasFilters, parseQuery } from '../engine/query';
import type { RichSearchHit, TagCount } from '../engine/types';
import { t } from '../i18n';
import { openSearch } from '../search-page/location';
import { isMiniSearchIndex } from '../services/guards';
import {
  displayTitle,
  focusSnippet,
  Highlighted,
  PageGlyph,
  relativeTime,
  usePagePath,
} from '../ui/common';
import { DocPreview, queryTerms, toPreviewBlocks, type PreviewBlock } from '../ui/doc-preview';
import { matchCommands } from './match-commands';
import { readRecent } from './recent';
import { paletteStore, usePaletteState } from './store';

type Item =
  | { kind: 'page'; key: string; pageId: string; hit: RichSearchHit | null }
  | { kind: 'command'; key: string; command: Command }
  | { kind: 'tag'; key: string; tag: TagCount }
  | { kind: 'create'; key: string; title: string }
  | { kind: 'search'; key: string; query: string };

interface Group {
  id: string;
  label: string;
  items: Item[];
}

interface SearchState {
  query: string;
  hits: RichSearchHit[];
  status: 'idle' | 'loading' | 'done' | 'error';
}

const SUGGESTED_COMMANDS = [
  COMMANDS.newPage,
  COMMANDS.search,
  COMMANDS.openGraph,
  COMMANDS.toggleTheme,
  COMMANDS.openSettings,
  COMMANDS.showShortcuts,
];
const PAGE_LIMIT = 6;

/** Keeps a search running for the palette query, fresh while the index changes. */
function usePaletteSearch(text: string, enabled: boolean): [SearchState, () => void] {
  const ctx = useAppContext();
  const index = ctx.services.searchIndex;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<SearchState>({ query: '', hits: [], status: 'idle' });
  useEffect(() => {
    if (!isMiniSearchIndex(index)) return undefined;
    return index.subscribe(() => setVersion((value) => value + 1));
  }, [index]);
  useEffect(() => {
    if (!enabled || !text.trim()) {
      setState({ query: text, hits: [], status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading' }));
    index.query(text, { limit: PAGE_LIMIT * 2, signal: controller.signal }).then(
      (results) => {
        if (!controller.signal.aborted)
          setState({ query: text, hits: results.hits as RichSearchHit[], status: 'done' });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn('[search] palette query failed', error);
        setState({ query: text, hits: [], status: 'error' });
      },
    );
    return () => controller.abort();
  }, [index, text, enabled, version]);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  return [state, retry];
}

/** The tags in use (once per palette session), when the search index knows them. */
function useTags(): TagCount[] {
  const ctx = useAppContext();
  const [tags, setTags] = useState<TagCount[]>([]);
  useEffect(() => {
    const index = ctx.services.searchIndex;
    if (!isMiniSearchIndex(index)) return undefined;
    let active = true;
    index.tags().then(
      (list) => {
        if (active) setTags(list);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [ctx]);
  return tags;
}

function useIndexStatus() {
  const ctx = useAppContext();
  const index = ctx.services.searchIndex;
  const subscribe = useCallback(
    (listener: () => void) =>
      isMiniSearchIndex(index) ? index.subscribeStatus(listener) : () => undefined,
    [index],
  );
  const get = useCallback(() => (isMiniSearchIndex(index) ? index.status : null), [index]);
  return useSyncExternalStore(subscribe, get, get);
}

function usePreview(pageId: string | null): {
  pageId: string | null;
  blocks: PreviewBlock[] | null;
  failed: boolean;
} {
  const ctx = useAppContext();
  const [state, setState] = useState<{
    pageId: string | null;
    blocks: PreviewBlock[] | null;
    failed: boolean;
  }>({ pageId: null, blocks: null, failed: false });
  useEffect(() => {
    if (!pageId) return undefined;
    let active = true;
    // A short delay: arrowing through results should not load every page on the way.
    const timer = setTimeout(() => {
      const page = ctx.workspace.getPage(pageId);
      if (!page || page.kind !== 'page') {
        setState({ pageId, blocks: [], failed: false });
        return;
      }
      ctx.loadPageDoc(pageId).then(
        (handle) => {
          try {
            if (!active) return;
            const snapshot = ctx.workspace.pages.getSnapshot();
            const blocks = toPreviewBlocks(
              readDocJSON(handle.doc),
              (id) => snapshot.get(id)?.title,
            );
            setState({ pageId, blocks, failed: false });
          } finally {
            handle.release();
          }
        },
        () => {
          if (active) setState({ pageId, blocks: null, failed: true });
        },
      );
    }, 70);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ctx, pageId]);
  return state.pageId === pageId ? state : { pageId, blocks: null, failed: false };
}

function Preview({ pageId, query }: { pageId: string; query: string }) {
  const snapshot = usePages();
  const page = snapshot.get(pageId);
  const path = usePagePath(pageId);
  const preview = usePreview(pageId);
  const terms = useMemo(() => queryTerms(parseQuery(query).text), [query]);
  if (!page) return null;
  const isRow = snapshot.isRow(pageId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-border px-4 pt-4 pb-3">
        <PageGlyph page={page} isRow={isRow} className="mt-0.5 size-5 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{displayTitle(page.title)}</p>
          <p className="truncate text-xs text-fg-subtle">
            {[
              path,
              page.kind === 'database' ? t('kindDatabase') : isRow ? t('kindRow') : null,
              t('edited', { when: relativeTime(page.updatedAt) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_80%,transparent)] px-4 py-3">
        {preview.failed ? (
          <p className="text-ui text-fg-subtle">{t('previewFailed')}</p>
        ) : preview.blocks === null ? (
          <div className="flex items-center gap-2 text-ui text-fg-subtle">
            <Spinner size="sm" label="" />
            {t('previewLoading')}
          </div>
        ) : preview.blocks.length === 0 ? (
          <p className="text-ui text-fg-subtle">{t('previewEmpty')}</p>
        ) : (
          <DocPreview blocks={preview.blocks} terms={terms} />
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  id,
  active,
  onPick,
  onHover,
  isApple,
  page,
  isRow,
}: {
  item: Item;
  id: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  isApple: boolean;
  page: PageMeta | undefined;
  isRow: boolean;
}) {
  const path = usePagePath(item.kind === 'page' ? item.pageId : null);
  let icon: ReactNode = null;
  let label: ReactNode = null;
  let detail: ReactNode = null;
  let trailing: ReactNode = null;
  switch (item.kind) {
    case 'page': {
      const hit = item.hit;
      icon = <PageGlyph page={page} isRow={isRow} />;
      const title = displayTitle(page?.title ?? hit?.title);
      label = (
        <Highlighted
          text={title}
          ranges={hit && page?.title === hit.title ? hit.titleHighlights : undefined}
        />
      );
      if (hit?.snippet && hit.matchedIn !== 'title') {
        const snippet = focusSnippet(hit.snippet);
        detail = <Highlighted text={snippet.text} ranges={snippet.highlights} />;
      } else if (path) {
        detail = path;
      }
      if (hit?.snippet && hit.matchedIn !== 'title' && path) {
        trailing = <span className="max-w-[40%] truncate text-xs text-fg-subtle">{path}</span>;
      }
      break;
    }
    case 'command': {
      const Icon = item.command.icon ?? SquareTerminal;
      icon = <Icon className="size-4 text-fg-subtle" />;
      label = item.command.title;
      const shortcut = commandShortcuts(item.command)[0];
      if (shortcut)
        trailing = <KeyCombo aria-hidden="true" keys={formatShortcut(shortcut, isApple)} />;
      break;
    }
    case 'tag':
      icon = <Hash className="size-4 text-fg-subtle" />;
      label = `#${item.tag.name}`;
      trailing = (
        <span className="text-xs text-fg-subtle">{t('pagesCount', { count: item.tag.count })}</span>
      );
      break;
    case 'create':
      icon = <Plus className="size-4 text-fg-subtle" />;
      label = t('createPage', { title: item.title });
      break;
    case 'search':
      icon = <Search className="size-4 text-fg-subtle" />;
      label = t('searchEverywhere', { query: item.query });
      break;
    default:
      break;
  }
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      data-active={active || undefined}
      onMouseMove={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      onKeyDown={(event) => {
        // Options are reached through the field (aria-activedescendant); this covers direct focus.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick();
        }
      }}
      className={cn(
        'group/item mx-2 flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-fg outline-none select-none',
        active && 'bg-active',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail ? <span className="truncate text-xs text-fg-subtle">{detail}</span> : null}
      </span>
      {trailing}
      {active ? (
        <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
      ) : null}
    </div>
  );
}

/**
 * While the palette is open, focus stays in it: a menu that closed just before (and restores focus
 * to its trigger a moment later) must not pull focus out of a modal dialog.
 */
function useKeepFocus(input: RefObject<HTMLInputElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return undefined;
    const onFocusIn = (event: FocusEvent) => {
      const field = input.current;
      const dialog = field?.closest('[role="dialog"]');
      if (!field || !dialog || !(event.target instanceof Node)) return;
      if (!dialog.contains(event.target)) field.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [input, open]);
}

function PaletteBody({ initialQuery, open }: { initialQuery: string; open: boolean }) {
  const ctx = useAppContext();
  const inputRef = useRef<HTMLInputElement>(null);
  useKeepFocus(inputRef, open);
  const snapshot = usePages();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const commandMode = query.startsWith('>');
  const text = commandMode ? query.slice(1).trim() : query.trim();
  const [search, retry] = usePaletteSearch(text, !commandMode);
  const tags = useTags();
  const status = useIndexStatus();
  const [recent] = useState(() => readRecent(ctx.settings.device, ctx.workspace.info.id));
  const isApple = ctx.platform.isApple;

  const available = useMemo(
    () => ctx.commands.available().filter((command) => command.id !== COMMANDS.openPalette),
    [ctx],
  );

  const groups = useMemo<Group[]>(() => {
    const live = (id: string) => snapshot.has(id) && !snapshot.isTrashed(id);
    const result: Group[] = [];
    if (commandMode) {
      result.push({
        id: 'commands',
        label: t('groupCommands'),
        items: matchCommands(available, text).map((command) => ({
          kind: 'command',
          key: `c:${command.id}`,
          command,
        })),
      });
      return result;
    }
    if (!text) {
      result.push({
        id: 'recent',
        label: t('groupRecent'),
        items: recent
          .filter(live)
          .slice(0, PAGE_LIMIT)
          .map((pageId) => ({ kind: 'page', key: `r:${pageId}`, pageId, hit: null })),
      });
      const suggested = SUGGESTED_COMMANDS.map((id) =>
        available.find((command) => command.id === id),
      ).filter((command): command is Command => command !== undefined);
      result.push({
        id: 'commands',
        label: t('groupCommands'),
        items: suggested.map((command) => ({ kind: 'command', key: `c:${command.id}`, command })),
      });
      return result;
    }
    // The latest finished results stay up while the next query runs (no flicker between keys).
    const hits = search.hits.filter((hit) => live(hit.pageId));
    const titleHits = hits.filter((hit) => hit.matchedIn === 'title').slice(0, PAGE_LIMIT);
    const contentHits = hits.filter((hit) => hit.matchedIn !== 'title').slice(0, PAGE_LIMIT);
    result.push({
      id: 'pages',
      label: t('groupPages'),
      items: titleHits.map((hit) => ({
        kind: 'page',
        key: `p:${hit.pageId}`,
        pageId: hit.pageId,
        hit,
      })),
    });
    result.push({
      id: 'content',
      label: t('groupContent'),
      items: contentHits.map((hit) => ({
        kind: 'page',
        key: `b:${hit.pageId}`,
        pageId: hit.pageId,
        hit,
      })),
    });
    const parsed = parseQuery(text);
    const words = text.length >= 2 ? matchCommands(available, text).slice(0, 4) : [];
    result.push({
      id: 'commands',
      label: t('groupCommands'),
      items: words.map((command) => ({ kind: 'command', key: `c:${command.id}`, command })),
    });
    const tagQuery = text.replace(/^#/, '').replace(/^tag:/i, '').toLowerCase();
    const tagItems = tagQuery ? tags.filter((tag) => tag.key.includes(tagQuery)).slice(0, 4) : [];
    result.push({
      id: 'tags',
      label: t('groupTags'),
      items: tagItems.map((tag) => ({ kind: 'tag', key: `t:${tag.key}`, tag })),
    });
    const title = hasFilters(parsed) ? parsed.text : text;
    const create: Item[] = [];
    if (title) create.push({ kind: 'create', key: 'create', title });
    create.push({ kind: 'search', key: 'search', query: text });
    result.push({ id: 'create', label: t('groupCreate'), items: create });
    return result;
  }, [available, commandMode, recent, search, snapshot, tags, text]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const active = Math.min(activeIndex, Math.max(0, flat.length - 1));
  const activeItem = flat[active];

  useEffect(() => {
    if (!activeItem) return;
    const element = document.getElementById(`${listId}-${activeItem.key}`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [activeItem, listId]);

  const pick = useCallback(
    (item: Item | undefined, openAll = false) => {
      if (openAll && text) {
        paletteStore.close();
        openSearch(ctx, { query: text });
        return;
      }
      if (!item) return;
      paletteStore.close();
      switch (item.kind) {
        case 'page': {
          const options: { heading?: string; blockId?: string } = {};
          if (item.hit?.heading) options.heading = item.hit.heading;
          else if (item.hit?.blockId) options.blockId = item.hit.blockId;
          ctx.navigate(item.pageId, options);
          break;
        }
        case 'command':
          void ctx.commands.execute(item.command.id, { source: 'palette' });
          break;
        case 'tag':
          openSearch(ctx, { query: `tag:${item.tag.name}` });
          break;
        case 'create': {
          const page = ctx.workspace.createPage({ title: item.title });
          ctx.navigate(page.id);
          break;
        }
        case 'search':
          openSearch(ctx, { query: item.query });
          break;
        default:
          break;
      }
    },
    [ctx, text],
  );

  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);

  const pendingEnter = useRef<string | null>(null);
  useEffect(() => {
    if (pendingEnter.current === null) return;
    if (pendingEnter.current !== text) {
      pendingEnter.current = null;
      return;
    }
    if (search.status === 'error') pendingEnter.current = null;
    else if (search.status === 'done' && search.query === text) {
      pendingEnter.current = null;
      pickRef.current(flat[0]);
    }
  }, [search, text, flat]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const count = flat.length;
    const move = (to: number) => {
      event.preventDefault();
      if (count > 0) setActiveIndex(((to % count) + count) % count);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(active + 1);
        break;
      case 'ArrowUp':
        move(active - 1);
        break;
      case 'PageDown':
        move(Math.min(count - 1, active + 5));
        break;
      case 'PageUp':
        move(Math.max(0, active - 5));
        break;
      case 'Enter': {
        event.preventDefault();
        const openAll = event.metaKey || event.ctrlKey;
        // Typed fast and pressed Enter before this text's results arrived: pick once they do,
        // rather than whatever the previous keystroke's list had first.
        if (
          !openAll &&
          !commandMode &&
          text &&
          (search.status !== 'done' || search.query !== text)
        ) {
          pendingEnter.current = text;
          break;
        }
        pick(activeItem, openAll);
        break;
      }
      default:
        break;
    }
  };

  const showPreview = wide && activeItem?.kind === 'page';
  const searching = search.status === 'loading' && search.query !== text;
  const nothing =
    !commandMode &&
    text &&
    search.status === 'done' &&
    groups.every((group) => group.id === 'create' || group.items.length === 0);
  const indexing = status?.state === 'indexing' && status.total > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        {searching ? (
          <Spinner size="sm" label="" className="size-4" />
        ) : (
          <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? `${listId}-${activeItem.key}` : undefined}
          aria-label={t('palette')}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the palette is opened on purpose; typing starts in its field
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          placeholder={commandMode ? t('paletteCommandPlaceholder') : t('palettePlaceholder')}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
        />
        <Kbd aria-hidden="true" className="hidden sm:inline-flex">
          esc
        </Kbd>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('palette')}
          data-query={search.status === 'done' ? search.query : undefined}
          className="min-h-0 flex-1 overflow-y-auto py-2"
        >
          {search.status === 'error' ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-ui text-fg-muted">
              <TriangleAlert aria-hidden="true" className="size-5 text-danger-text" />
              <p>{t('searchFailed')}</p>
              <button
                type="button"
                onClick={retry}
                className="rounded-md px-2 py-1 text-accent-text hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
              >
                {t('retry')}
              </button>
            </div>
          ) : null}
          {nothing ? (
            <div className="px-6 pt-6 pb-3 text-center">
              <p className="text-sm text-fg">{t('noResults', { query: text })}</p>
              <p className="mt-1 text-ui text-fg-muted">{t('noResultsHint')}</p>
            </div>
          ) : null}
          {commandMode && flat.length === 0 ? (
            <p className="px-4 pt-3 text-ui text-fg-subtle">{t('noCommands', { query: text })}</p>
          ) : null}
          {!text && !commandMode && groups[0]?.items.length === 0 ? (
            <p className="px-4 pt-2 pb-1 text-ui text-fg-subtle">{t('noRecent')}</p>
          ) : null}
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div
                key={group.id}
                role="group"
                aria-labelledby={`${listId}-g-${group.id}`}
                className="pb-1.5"
              >
                <div
                  id={`${listId}-g-${group.id}`}
                  className="px-4 pt-1.5 pb-1 text-xs font-medium text-fg-subtle"
                >
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const index = flat.indexOf(item);
                  const page = item.kind === 'page' ? snapshot.get(item.pageId) : undefined;
                  return (
                    <ItemRow
                      key={item.key}
                      id={`${listId}-${item.key}`}
                      item={item}
                      active={index === active}
                      isApple={isApple}
                      page={page}
                      isRow={item.kind === 'page' && snapshot.isRow(item.pageId)}
                      onHover={() => {
                        if (index !== active) setActiveIndex(index);
                      }}
                      onPick={() => pick(item)}
                    />
                  );
                })}
              </div>
            ))}
        </div>
        {showPreview && activeItem.kind === 'page' ? (
          <div className="hidden w-[46%] shrink-0 border-l border-border bg-bg-subtle/60 lg:block">
            <Preview pageId={activeItem.pageId} query={text} />
          </div>
        ) : null}
      </div>
      <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <KeyCombo aria-hidden="true" keys={['↑', '↓']} />
          {t('hintNavigate')}
        </span>
        <span className="flex items-center gap-1.5">
          <KeyCombo aria-hidden="true" keys={['↵']} />
          {t('hintOpen')}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <KeyCombo aria-hidden="true" keys={formatShortcut('Mod+Enter', isApple)} />
          {t('hintSearchPage')}
        </span>
        <span className="ml-auto hidden truncate md:inline">
          {indexing ? (
            <span className="flex items-center gap-1.5" role="status">
              <Spinner size="sm" label="" className="size-3" />
              {t('indexing', { done: status.done, total: status.total })}
            </span>
          ) : (
            t('hintCommands')
          )}
        </span>
      </div>
    </div>
  );
}

/** The command palette dialog (loaded on first open; see `PaletteHost`). */
export default function CommandPalette() {
  const { open, initialQuery, session } = usePaletteState();
  const wide = useMediaQuery('(min-width: 1024px)');
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : paletteStore.close())}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className={cn(
          'top-[10vh] h-[min(560px,80vh)] max-h-[80vh] p-0',
          wide ? 'max-w-[min(58rem,calc(100vw-2rem))]' : 'max-w-2xl',
        )}
      >
        <VisuallyHidden>
          <DialogTitle>{t('palette')}</DialogTitle>
        </VisuallyHidden>
        <PaletteBody key={session} initialQuery={initialQuery} open={open} />
      </DialogContent>
    </Dialog>
  );
}
