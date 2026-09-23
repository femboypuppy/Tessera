import {
  isValidId,
  newId,
  NotFoundError,
  sortWorkspaces,
  ValidationError,
  type CreateWorkspaceInput,
  type WorkspaceInfo,
  type WorkspaceRegistry,
} from '@tessera/core';
import type { DesktopBackend } from '../backend/backend';
import type { FolderInfo, RegistryEntry, RegistryItem } from '../backend/protocol';

/** A workspace as the desktop picker shows it: with its folder and whether the folder is there. */
export type DesktopWorkspace = WorkspaceInfo & {
  path: string;
  status: RegistryItem['status'];
};

function toInfo(entry: RegistryEntry): WorkspaceInfo {
  const info: WorkspaceInfo = {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    createdAt: entry.createdAt,
  };
  if (entry.icon) info.icon = entry.icon;
  if (entry.serverUrl) info.serverUrl = entry.serverUrl;
  if (entry.lastOpenedAt !== undefined) info.lastOpenedAt = entry.lastOpenedAt;
  return info;
}

function toEntry(info: WorkspaceInfo & { path: string }, initializedAt?: number): RegistryEntry {
  const entry: RegistryEntry = {
    id: info.id,
    name: info.name,
    path: info.path,
    createdAt: info.createdAt,
  };
  if (info.icon) entry.icon = info.icon;
  if (info.serverUrl) entry.serverUrl = info.serverUrl;
  if (info.lastOpenedAt !== undefined) entry.lastOpenedAt = info.lastOpenedAt;
  if (initializedAt !== undefined) entry.initializedAt = initializedAt;
  return entry;
}

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new ValidationError('Workspace names cannot be empty');
  return [...trimmed].slice(0, 100).join('');
}

/** What {@link TauriWorkspaceRegistry.openFolder} did. */
export type OpenFolderResult =
  { kind: 'opened'; workspace: WorkspaceInfo } | { kind: 'created'; workspace: WorkspaceInfo };

/**
 * {@link WorkspaceRegistry} for the desktop app: the recent-workspaces list in the app's config
 * folder, where each workspace is a folder (`WorkspaceInfo.path`). Kept by the Rust side so both
 * windows share it; changes from the other window arrive through `subscribe`.
 *
 * - `create()` without a `path` puts the workspace in `~/Tessera/<name>`, outside the folders
 *   cloud services sync by default. The folder appears on the first edit.
 * - `list()` leaves out workspaces whose folder has disappeared (moved, deleted, on an unplugged
 *   drive), so the shell never opens one; `listAll()` includes them for the picker.
 * - `remove()` only forgets the workspace: the folder stays on disk.
 */
export class TauriWorkspaceRegistry implements WorkspaceRegistry {
  private readonly listeners = new Set<(workspaces: WorkspaceInfo[]) => void>();
  private readonly offChanges: () => void;
  private readonly defaultRoot: string | null;
  private readonly clock: () => number;

  constructor(
    private readonly backend: DesktopBackend,
    options: { defaultRoot: string | null; now?: () => number },
  ) {
    this.defaultRoot = options.defaultRoot;
    this.clock = options.now ?? (() => Date.now());
    this.offChanges = backend.onRegistryChanged((origin) => {
      // Our own changes are announced right away by `emit`.
      if (origin !== backend.windowLabel) void this.emit();
    });
  }

  /** The folder new workspaces go in by default (`~/Tessera`). */
  get defaultFolder(): string | null {
    return this.defaultRoot;
  }

  /** Every known workspace, including ones whose folder is missing, most recent first. */
  async listAll(): Promise<DesktopWorkspace[]> {
    const items = await this.backend.listRegistry();
    const byId = new Map(items.map((item) => [item.id, item]));
    return sortWorkspaces(items.map(toInfo)).map((info) => {
      const item = byId.get(info.id);
      return { ...info, path: item?.path ?? '', status: item?.status ?? 'missing' };
    });
  }

  async list(): Promise<WorkspaceInfo[]> {
    const items = await this.backend.listRegistry();
    return sortWorkspaces(items.filter((item) => item.status !== 'missing').map(toInfo));
  }

  async get(id: string): Promise<WorkspaceInfo | null> {
    const item = (await this.backend.listRegistry()).find((candidate) => candidate.id === id);
    return item && item.status !== 'missing' ? toInfo(item) : null;
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceInfo> {
    const id = input.id ?? newId();
    if (!isValidId(id)) throw new ValidationError('Invalid workspace ID', [id]);
    const name = cleanName(input.name);
    const items = await this.backend.listRegistry();
    if (items.some((item) => item.id === id))
      throw new ValidationError(`Workspace "${id}" already exists`);
    let path = input.path;
    if (!path) {
      if (!this.defaultRoot)
        throw new ValidationError('Choose a folder for the workspace (no home folder found)');
      path = await this.backend.suggestFolder(this.defaultRoot, name);
    } else {
      const folder = await this.backend.inspectFolder(path);
      if (folder.workspace && folder.workspace.id !== id)
        throw new ValidationError(
          `"${folder.name}" already holds the workspace "${folder.workspace.name}". Open it instead.`,
        );
    }
    const info: WorkspaceInfo & { path: string } = { id, name, path, createdAt: this.clock() };
    if (input.icon) info.icon = input.icon;
    if (input.serverUrl) info.serverUrl = input.serverUrl;
    await this.backend.upsertRegistry(toEntry(info));
    await this.emit();
    return toInfo(toEntry(info));
  }

  async open(id: string): Promise<WorkspaceInfo> {
    const entry = await this.backend.touchRegistry(id);
    await this.emit();
    return toInfo(entry);
  }

  async rename(id: string, name: string): Promise<void> {
    await this.update(id, { name });
  }

  async update(
    id: string,
    patch: Partial<Pick<WorkspaceInfo, 'name' | 'icon' | 'serverUrl' | 'path'>>,
  ): Promise<WorkspaceInfo> {
    const item = (await this.backend.listRegistry()).find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundError('Workspace', id);
    const { status: _status, initializedAt, ...entry } = item;
    const next: RegistryEntry = { ...entry };
    if (patch.name !== undefined) next.name = cleanName(patch.name);
    if (patch.icon !== undefined) next.icon = patch.icon;
    if (patch.serverUrl !== undefined) {
      if (patch.serverUrl) next.serverUrl = patch.serverUrl;
      else delete next.serverUrl;
    }
    if (patch.path !== undefined) next.path = patch.path;
    if (initializedAt !== undefined && patch.path === undefined) next.initializedAt = initializedAt;
    await this.backend.upsertRegistry(next);
    if (patch.name !== undefined && next.name !== item.name) {
      // The name is also stored in the folder, so it travels with it. The workspace may not be
      // open (or not exist on disk yet); then the registry is enough.
      await this.backend.setWorkspaceName(id, next.name).catch(() => undefined);
    }
    await this.emit();
    return toInfo(next);
  }

  async remove(id: string): Promise<void> {
    await this.backend.removeRegistry(id);
    await this.emit();
  }

  subscribe(listener: (workspaces: WorkspaceInfo[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.offChanges();
    this.listeners.clear();
  }

  /**
   * Adds a folder chosen in a dialog. A folder that holds a workspace is opened as that
   * workspace (updating its path if it moved); any other folder becomes a new workspace named
   * after it. Callers confirm non-empty and cloud-synced folders first ({@link FolderInfo}).
   */
  async openFolder(folder: FolderInfo): Promise<OpenFolderResult> {
    const items = await this.backend.listRegistry();
    if (folder.workspace) {
      const manifest = folder.workspace;
      const existing = items.find((item) => item.id === manifest.id);
      if (existing) {
        const workspace =
          existing.path === folder.path
            ? toInfo(existing)
            : await this.update(existing.id, { path: folder.path });
        return { kind: 'opened', workspace };
      }
      const info: WorkspaceInfo & { path: string } = {
        id: manifest.id,
        name: cleanName(manifest.name || folder.name || 'Workspace'),
        path: folder.path,
        createdAt: manifest.createdAt || this.clock(),
      };
      await this.backend.upsertRegistry(toEntry(info, this.clock()));
      await this.emit();
      return { kind: 'opened', workspace: toInfo(toEntry(info)) };
    }
    const sameFolder = items.find((item) => item.path === folder.path);
    if (sameFolder) return { kind: 'opened', workspace: toInfo(sameFolder) };
    const workspace = await this.create({ name: folder.name || 'Workspace', path: folder.path });
    return { kind: 'created', workspace };
  }

  /** Points a workspace whose folder went missing at its new location. */
  async locate(id: string, folder: FolderInfo): Promise<WorkspaceInfo> {
    if (!folder.workspace || folder.workspace.id !== id)
      throw new ValidationError(`"${folder.name}" doesn't hold this workspace`);
    return this.update(id, { path: folder.path });
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return;
    const list = await this.list();
    for (const listener of [...this.listeners]) listener(list);
  }
}
