import { NotFoundError, ValidationError } from '../errors';
import { isValidId, newId } from '../ids';

/** A workspace known on this device. */
export interface WorkspaceInfo {
  /** nanoid(21). The workspace doc is `ws:<id>`. */
  id: string;
  name: string;
  /** Emoji icon for the workspace switcher. */
  icon?: string;
  /** Sync server URL (`https://…`), or null/absent for a local-only workspace. */
  serverUrl?: string | null;
  /** Desktop only: the folder that holds the workspace. */
  path?: string;
  createdAt: number;
  lastOpenedAt?: number;
}

/** Input for {@link WorkspaceRegistry.create}. */
export interface CreateWorkspaceInput {
  name: string;
  icon?: string;
  serverUrl?: string | null;
  path?: string;
  /** Defaults to a new nanoid (pass the server's ID when opening a server workspace locally). */
  id?: string;
}

/**
 * The list of workspaces on this device. Implementations: in-memory (core, 0), IndexedDB
 * (`@tessera/sync`, 50), recent folders (`@tessera/desktop`, 100). Resolved once at app start.
 *
 * `remove` forgets a workspace. Browser implementations also delete its local data; the desktop
 * implementation only removes it from the recent list (the folder stays on disk).
 *
 * @example
 * const ws = await registry.create({ name: 'Personal' });
 * await registry.open(ws.id); // marks it as the most recently opened
 */
export interface WorkspaceRegistry {
  /** Every workspace, most recently opened first. */
  list(): Promise<WorkspaceInfo[]>;
  get(id: string): Promise<WorkspaceInfo | null>;
  create(input: CreateWorkspaceInput): Promise<WorkspaceInfo>;
  /** Marks the workspace as opened now and returns it. */
  open(id: string): Promise<WorkspaceInfo>;
  rename(id: string, name: string): Promise<void>;
  update(
    id: string,
    patch: Partial<Pick<WorkspaceInfo, 'name' | 'icon' | 'serverUrl' | 'path'>>,
  ): Promise<WorkspaceInfo>;
  remove(id: string): Promise<void>;
  subscribe(listener: (workspaces: WorkspaceInfo[]) => void): () => void;
  dispose?(): void | Promise<void>;
}

/** Sorts workspaces most recently opened (then created) first. */
export function sortWorkspaces(workspaces: Iterable<WorkspaceInfo>): WorkspaceInfo[] {
  return [...workspaces].sort(
    (a, b) =>
      (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id),
  );
}

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new ValidationError('Workspace names cannot be empty');
  return trimmed.slice(0, 100);
}

/** In-memory {@link WorkspaceRegistry}. `onRemove` lets the owner drop the workspace's data. */
export class MemoryWorkspaceRegistry implements WorkspaceRegistry {
  private readonly workspaces = new Map<string, WorkspaceInfo>();
  private readonly listeners = new Set<(workspaces: WorkspaceInfo[]) => void>();
  private readonly onRemove: ((id: string) => void) | undefined;
  private readonly clock: () => number;

  constructor(options: { onRemove?: (id: string) => void; now?: () => number } = {}) {
    this.onRemove = options.onRemove;
    this.clock = options.now ?? (() => Date.now());
  }

  async list(): Promise<WorkspaceInfo[]> {
    return sortWorkspaces(this.workspaces.values()).map((ws) => ({ ...ws }));
  }

  async get(id: string): Promise<WorkspaceInfo | null> {
    const ws = this.workspaces.get(id);
    return ws ? { ...ws } : null;
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceInfo> {
    const id = input.id ?? newId();
    if (!isValidId(id)) throw new ValidationError('Invalid workspace ID', [id]);
    if (this.workspaces.has(id)) throw new ValidationError(`Workspace "${id}" already exists`);
    const ws: WorkspaceInfo = { id, name: cleanName(input.name), createdAt: this.clock() };
    if (input.icon) ws.icon = input.icon;
    if (input.serverUrl) ws.serverUrl = input.serverUrl;
    if (input.path) ws.path = input.path;
    this.workspaces.set(id, ws);
    await this.emit();
    return { ...ws };
  }

  async open(id: string): Promise<WorkspaceInfo> {
    const ws = this.require(id);
    // Strictly increasing, so "most recently opened" is unambiguous even within one millisecond.
    const latest = Math.max(0, ...[...this.workspaces.values()].map((w) => w.lastOpenedAt ?? 0));
    ws.lastOpenedAt = Math.max(this.clock(), latest + 1);
    await this.emit();
    return { ...ws };
  }

  async rename(id: string, name: string): Promise<void> {
    await this.update(id, { name });
  }

  async update(
    id: string,
    patch: Partial<Pick<WorkspaceInfo, 'name' | 'icon' | 'serverUrl' | 'path'>>,
  ): Promise<WorkspaceInfo> {
    const ws = this.require(id);
    if (patch.name !== undefined) ws.name = cleanName(patch.name);
    if (patch.icon !== undefined) ws.icon = patch.icon;
    if (patch.serverUrl !== undefined) ws.serverUrl = patch.serverUrl;
    if (patch.path !== undefined) ws.path = patch.path;
    await this.emit();
    return { ...ws };
  }

  async remove(id: string): Promise<void> {
    this.require(id);
    this.workspaces.delete(id);
    this.onRemove?.(id);
    await this.emit();
  }

  subscribe(listener: (workspaces: WorkspaceInfo[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private require(id: string): WorkspaceInfo {
    const ws = this.workspaces.get(id);
    if (!ws) throw new NotFoundError('Workspace', id);
    return ws;
  }

  private async emit(): Promise<void> {
    const list = await this.list();
    for (const listener of this.listeners) listener(list);
  }
}
