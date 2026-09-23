import type { ComponentType } from 'react';
import type { PageKind, PageMeta } from '../model/page-meta';
import type { Exporter, Importer } from '../services/import-export';
import type { AnyServiceRegistration } from '../services/registry';
import type { AppContext, IconComponent } from './app-context';
import type { BlockRendererRegistration } from './blocks';
import type { Command } from './commands';

/**
 * A route contributed by a feature. Paths must not collide with the shell's: `/`, `/p/*`,
 * `/trash`, `/settings/*`, `/dev/*`. Lazy-load heavy screens with `React.lazy`.
 */
export interface FeatureRoute {
  /** For example `/graph` or `/search`. */
  path: string;
  component: ComponentType;
  /**
   * `app` (default): rendered in the main area, with the sidebar and top bar. `bare`: the
   * component fills the window on its own (the desktop quick-capture window, print views). The
   * workspace session and global shortcuts still work.
   */
  layout?: 'app' | 'bare';
}

/** A block in the sidebar. `top` sections sit under the search button; `bottom` above "Trash". */
export interface SidebarSectionContribution {
  id: string;
  order?: number;
  position?: 'top' | 'bottom';
  component: ComponentType;
}

/**
 * Props of a page body (`pageBodies`). The body renders under the title; it registers a focus
 * handler so Enter in the title moves into it, and calls `focusTitle` (ArrowUp at its start).
 */
export interface PageBodyProps {
  pageId: string;
  page: PageMeta;
  readOnly: boolean;
  /**
   * Where the navigation that opened the page asked to scroll (`ctx.navigate(id, { heading })` or
   * `{ blockId }`), or null. The body scrolls to it once its content is loaded.
   */
  target: { heading?: string; blockId?: string } | null;
  /** Moves focus to the page title, caret at the start or end. */
  focusTitle(position?: 'start' | 'end'): void;
  /** Registers what happens when the title asks the body to take focus. Returns an unregister function. */
  registerFocusHandler(handler: (position: 'start' | 'end') => void): () => void;
}

/** The body for one page kind: the editor provides `page`, the databases feature `database`. */
export interface PageBodyContribution {
  kind: PageKind;
  component: ComponentType<PageBodyProps>;
}

/** Props of page top sections and header actions. */
export interface PageSectionProps {
  pageId: string;
  page: PageMeta;
  readOnly: boolean;
}

/** Rendered between the title and the body (for example the properties of a database row). */
export interface PageSectionContribution {
  id: string;
  order?: number;
  /** Show only for some pages (default: all). */
  when?(page: PageMeta, ctx: AppContext): boolean;
  component: ComponentType<PageSectionProps>;
}

/** Buttons in the top bar when a page is open (presence avatars, share, history). */
export type PageHeaderActionContribution = PageSectionContribution;

/** Rendered after the page body (the optional backlinks footer). Same props as top sections. */
export type PageFooterSectionContribution = PageSectionContribution;

/** Props of a side panel. */
export interface SidePanelProps {
  pageId: string | null;
  page: PageMeta | null;
  close(): void;
}

/** A panel in the right side-panel host (backlinks, history, local graph, plugin panels). */
export interface SidePanelContribution {
  /** Well-known IDs: `backlinks`, `local-graph`, `history`; plugins use `plugin:<id>/<panel>`. */
  id: string;
  /** Translated. */
  title: string;
  icon?: IconComponent;
  order?: number;
  when?(page: PageMeta | null, ctx: AppContext): boolean;
  component: ComponentType<SidePanelProps>;
}

/** Always-visible top bar items (the sync status indicator). */
export interface TopBarItemContribution {
  id: string;
  order?: number;
  component: ComponentType;
}

/** A section in Settings (`/settings/<id>`). */
export interface SettingsPanelContribution {
  id: string;
  title: string;
  description?: string;
  icon?: IconComponent;
  order?: number;
  keywords?: string[];
  component: ComponentType;
}

/**
 * A first-run button ("Import from Notion", "Open demo workspace"). The shell creates and opens a
 * workspace named `workspaceName`, then calls `run` with its context.
 */
export interface OnboardingActionContribution {
  id: string;
  title: string;
  description?: string;
  icon?: IconComponent;
  order?: number;
  workspaceName: string;
  run(ctx: AppContext): void | Promise<void>;
}

/**
 * An always-mounted component for UI that commands open: the command palette, the import and
 * export dialogs, a workspace picker. It renders nothing until opened (keep its open state in your
 * own store, set by your command) and uses `Dialog` or `Sheet` from `packages/ui`. Keep it light
 * and lazy-load the dialog's content: overlays are part of the startup bundle.
 *
 * @example
 * overlays: [{ id: 'palette', component: CommandPaletteHost }],
 * commands: [{ id: COMMANDS.openPalette, shortcut: 'Mod+K', run: () => usePaletteStore.getState().open() }],
 */
export interface OverlayContribution {
  id: string;
  order?: number;
  component: ComponentType;
}

/**
 * Behavior added to the editor by other features (keymaps, decorations, ProseMirror plugins).
 * `create` returns a TipTap `Extension` built with the editor's `@tiptap/core` version. It must not
 * add nodes or marks: the schema is fixed by `@tessera/core`.
 */
export interface EditorExtensionContribution {
  id: string;
  /** Higher runs first (TipTap priority). Default 100. */
  priority?: number;
  create(ctx: AppContext): unknown;
}

/** Every kind of UI contribution. */
export interface ContributionMap {
  routes: FeatureRoute;
  sidebarSections: SidebarSectionContribution;
  pageBodies: PageBodyContribution;
  pageTopSections: PageSectionContribution;
  pageFooterSections: PageFooterSectionContribution;
  pageHeaderActions: PageHeaderActionContribution;
  pageSidePanels: SidePanelContribution;
  topBarItems: TopBarItemContribution;
  settingsPanels: SettingsPanelContribution;
  onboardingActions: OnboardingActionContribution;
  editorExtensions: EditorExtensionContribution;
  overlays: OverlayContribution;
}

export type ContributionKind = keyof ContributionMap;

/** A registered contribution, tagged with the feature that owns it (for error boundaries). */
export type Contribution<K extends ContributionKind> = ContributionMap[K] & {
  readonly featureId: string;
};

/**
 * Holds every UI contribution. Static ones come from `FeatureModule` fields; features can add more
 * at runtime (the plugins feature adds a panel per plugin).
 *
 * @example
 * const off = ctx.contributions.register('pageSidePanels', { id: 'plugin:pomodoro/timer', title: 'Pomodoro', component: Timer }, 'plugins');
 */
export interface ContributionRegistry {
  register<K extends ContributionKind>(
    kind: K,
    item: ContributionMap[K],
    featureId: string,
  ): () => void;
  /** Contributions of a kind, sorted by `order` (then registration order). */
  list<K extends ContributionKind>(kind: K): ReadonlyArray<Contribution<K>>;
  subscribe(listener: () => void): () => void;
  /** Increments on every change (a `useSyncExternalStore` snapshot). */
  getVersion(): number;
}

/** Creates a {@link ContributionRegistry}. */
export function createContributionRegistry(): ContributionRegistry {
  const items = new Map<ContributionKind, Array<Contribution<ContributionKind>>>();
  const listeners = new Set<() => void>();
  let version = 0;
  const cache = new Map<ContributionKind, ReadonlyArray<Contribution<ContributionKind>>>();
  const notify = () => {
    version += 1;
    cache.clear();
    for (const listener of [...listeners]) listener();
  };
  return {
    register(kind, item, featureId) {
      const entry = { ...item, featureId } as Contribution<ContributionKind>;
      const list = items.get(kind) ?? [];
      list.push(entry);
      items.set(kind, list);
      notify();
      return () => {
        const current = items.get(kind);
        const index = current?.indexOf(entry) ?? -1;
        if (current && index >= 0) {
          current.splice(index, 1);
          notify();
        }
      };
    },
    list<K extends ContributionKind>(kind: K) {
      let sorted = cache.get(kind);
      if (!sorted) {
        sorted = (items.get(kind) ?? [])
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const orderA = (a.item as { order?: number }).order ?? 0;
            const orderB = (b.item as { order?: number }).order ?? 0;
            return orderA - orderB || a.index - b.index;
          })
          .map(({ item }) => item);
        cache.set(kind, sorted);
      }
      // Items are stored per kind, so the list for `kind` only holds Contribution<K>.
      return sorted as unknown as ReadonlyArray<Contribution<K>>;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
  };
}

/**
 * A feature: what it contributes to the app. `apps/web/src/features/<area>/index.ts` exports one;
 * the shell loads all of them. Keep the module light (register, then lazy-load components and
 * services with dynamic `import()`); the shell wraps every contributed component in an error
 * boundary, and an `activate` that throws disables only its own feature.
 *
 * Lifecycle: static contributions and services are read at startup; `activate(ctx)` runs each time
 * a workspace opens (after services resolve), and its returned cleanup runs when it closes. If
 * `activate` throws, everything the feature registered (statically, or through `ctx` during
 * `activate`) is removed and the rest of the app keeps working.
 *
 * @example
 * export const backlinksFeature = defineFeature({
 *   id: 'backlinks',
 *   pageSidePanels: [{ id: PANELS.backlinks, title: t('backlinks'), icon: Link2, component: lazy(() => import('@tessera/search/backlinks-panel')) }],
 * });
 */
export interface FeatureModule {
  /** Unique: `editor`, `sync`, `databases`, `search`, `graph`, `backlinks`, `plugins`, `import-export`, `desktop`. */
  id: string;
  routes?: FeatureRoute[];
  sidebarSections?: SidebarSectionContribution[];
  commands?: Command[];
  pageBodies?: Partial<Record<PageKind, ComponentType<PageBodyProps>>>;
  pageTopSections?: PageSectionContribution[];
  pageFooterSections?: PageFooterSectionContribution[];
  pageHeaderActions?: PageHeaderActionContribution[];
  pageSidePanels?: SidePanelContribution[];
  topBarItems?: TopBarItemContribution[];
  blockRenderers?: BlockRendererRegistration[];
  editorExtensions?: EditorExtensionContribution[];
  settingsPanels?: SettingsPanelContribution[];
  onboardingActions?: OnboardingActionContribution[];
  overlays?: OverlayContribution[];
  importers?: Importer[];
  exporters?: Exporter[];
  services?: AnyServiceRegistration[];
  activate?(ctx: AppContext): void | (() => void) | Promise<void | (() => void)>;
}

/** Identity helper for typing feature modules. */
export function defineFeature(module: FeatureModule): FeatureModule {
  return module;
}

/** Well-known side panel IDs. */
export const PANELS = {
  backlinks: 'backlinks',
  localGraph: 'local-graph',
  history: 'history',
} as const;
