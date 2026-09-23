import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { ViewType } from '../database/views';
import type { JsonValue } from '../json';
import type { PageCover, PageMeta } from '../model/page-meta';
import type { CreatePageInput, MoveTarget, TrashChange } from '../model/pages';
import type { ListPosition } from '../order';
import type { ExporterRegistry, ImporterRegistry } from '../services/import-export';
import type { ServiceKey, ServiceMap } from '../services/registry';
import type { WorkspaceInfo } from '../services/workspace-registry';
import type { BlockRendererRegistry } from './blocks';
import type { CommandRegistry } from './commands';
import type { DocHandle } from './doc-manager';
import type { EventBus } from './events';
import type { ContributionRegistry } from './feature';
import type { PagesStore } from './pages-store';
import type { PlatformInfo } from './platform';
import type { SettingsStore } from './settings';
import type { CurrentUser } from './user';

/** An icon component (lucide-react icons fit). */
export type IconComponent = ComponentType<{
  className?: string;
  size?: number | string;
  strokeWidth?: number;
}>;

/** Options for {@link AppContext.navigate}. */
export interface NavigateOptions {
  /** Replace the history entry instead of pushing one. */
  replace?: boolean;
  /** Scroll to this heading (text, matched case-insensitively) after opening the page. */
  heading?: string;
  /** Scroll to and highlight this block after opening the page. */
  blockId?: string;
}

/** A toast notification. Use `action` for undo. */
export interface ToastOptions {
  /** Translated. */
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  action?: { label: string; onClick: () => void };
  /** Default 5000 ms; errors stay longer. */
  durationMs?: number;
}

export interface ToastHandle {
  dismiss(): void;
}

/** A confirmation dialog for destructive actions. */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
}

/**
 * The UI services the shell provides to the runtime. Features call them through `AppContext`.
 * (`packages/core/testing` provides a recording fake.)
 */
export interface ShellBridge {
  navigate(pageId: string, options?: NavigateOptions): void;
  navigateTo(path: string, options?: { replace?: boolean }): void;
  /** Opens a workspace in the shell (see {@link AppContext.switchWorkspace}). */
  switchWorkspace(workspaceId: string): void;
  getCurrentPageId(): string | null;
  openSidePanel(id: string): void;
  closeSidePanel(): void;
  toast(options: ToastOptions): ToastHandle;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

/** Input for {@link WorkspaceApi.createDatabase}. Names are translated by the caller. */
export interface CreateDatabaseInput extends Omit<CreatePageInput, 'kind'> {
  titlePropertyName: string;
  viewName: string;
  viewType?: ViewType;
}

/** Input for {@link WorkspaceApi.addDatabaseRow}. */
export interface AddDatabaseRowInput {
  title?: string;
  icon?: string;
  values?: Record<string, JsonValue | null>;
  position?: ListPosition;
}

/**
 * The open workspace: page-tree operations bound to the workspace doc and the current user.
 * Every change is a Yjs transaction, synced and persisted; `page.*` events follow automatically.
 *
 * @example
 * const page = ctx.workspace.createPage({ title: 'Ideas', parentId: null });
 * ctx.navigate(page.id);
 */
export interface WorkspaceApi {
  readonly info: WorkspaceInfo;
  /** The workspace Y.Doc (`ws:<id>`), for core helpers that take it. */
  readonly doc: Y.Doc;
  /** Reactive page tree (`usePages()` reads it). */
  readonly pages: PagesStore;
  getPage(id: string): PageMeta | undefined;
  createPage(input?: CreatePageInput): PageMeta;
  renamePage(id: string, title: string): void;
  movePage(id: string, target: MoveTarget): void;
  setIcon(id: string, icon: string | null): void;
  setCover(id: string, cover: PageCover | null): void;
  setFavorite(id: string, favorite: boolean): void;
  trashPage(id: string): TrashChange;
  restorePage(id: string): TrashChange;
  /** Deletes the page, its subtree, their docs and (for rows) their row entries. */
  deletePagePermanently(id: string): Promise<PageMeta[]>;
  emptyTrash(): Promise<PageMeta[]>;
  /** Copies a page (metadata, content and props, not subpages) right after the original. */
  duplicatePage(id: string): Promise<PageMeta>;
  /** Creates a database page and initializes its database doc (title property and one view). */
  createDatabase(
    input: CreateDatabaseInput,
  ): Promise<{ page: PageMeta; titlePropertyId: string; viewId: string }>;
  /** Creates a row: its page (child of the database page) and its entry in the database doc. */
  addDatabaseRow(databaseId: string, input?: AddDatabaseRowInput): Promise<PageMeta>;
}

/**
 * Everything a feature can use. One per workspace session; `activate(ctx)` receives it, and
 * components read it with `useAppContext()` from `@tessera/core/react`.
 */
export interface AppContext {
  readonly workspace: WorkspaceApi;
  /** Ref-counted lease on a page doc (`page:<id>`). Release it when done. */
  acquirePageDoc(pageId: string): DocHandle;
  /** Ref-counted lease on a database doc (`db:<id>`). Release it when done. */
  acquireDatabaseDoc(databaseId: string): DocHandle;
  /** Acquire and wait until loaded. */
  loadPageDoc(pageId: string): Promise<DocHandle>;
  loadDatabaseDoc(databaseId: string): Promise<DocHandle>;
  /** Resolved services (the best available implementation of each). */
  readonly services: ServiceMap;
  /** Which implementation each service resolved to (diagnostics). */
  readonly serviceSources: Readonly<Record<ServiceKey, string>>;
  readonly events: EventBus;
  readonly commands: CommandRegistry;
  readonly blocks: BlockRendererRegistry;
  /** Routes, panels, sections and other UI contributions (static ones from modules included). */
  readonly contributions: ContributionRegistry;
  readonly importers: ImporterRegistry;
  readonly exporters: ExporterRegistry;
  readonly settings: { readonly device: SettingsStore; readonly workspace: SettingsStore };
  /** Always the current value; `user.changed` fires on changes. */
  readonly currentUser: CurrentUser;
  readonly platform: PlatformInfo;
  navigate(pageId: string, options?: NavigateOptions): void;
  /** Navigates to a route (`/graph`, `/search?q=x`, `/settings/plugins`). */
  navigateTo(path: string, options?: { replace?: boolean }): void;
  /**
   * Makes the shell open a workspace from the `WorkspaceRegistry`, closing this session (this
   * context stops working). With the current workspace's ID it reopens it, which resolves its
   * services again: call it after connecting the workspace to a server.
   *
   * @example
   * const info = await ctx.services.workspaceRegistry.create({ name, path: folder });
   * ctx.switchWorkspace(info.id);
   */
  switchWorkspace(workspaceId: string): void;
  getCurrentPageId(): string | null;
  openSidePanel(id: string): void;
  closeSidePanel(): void;
  toast(options: ToastOptions | string): ToastHandle;
  confirm(options: ConfirmOptions): Promise<boolean>;
}
