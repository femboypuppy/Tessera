import { SETTING_KEYS, type AppContext } from '@tessera/core';
import { ServerApiError, type ServerApi } from '../../client/api';
import { authModeFor, serverApi } from '../../client/connection';
import { healthSchema, type Health, type Me } from '../../client/schemas';
import { normalizeServerUrl } from '../../client/server-url';
import { TEMP_WORKSPACE_KEY } from '../../feature/server-sync';
import { t } from '../../i18n';
import { syncStateFor } from '../../provider/shared';

/** Device setting: the workspace the onboarding "join" action created (removed once joined). */
export const JOIN_WORKSPACE_KEY = 'sync.joinWorkspace';

export type ServerCheck =
  | { ok: true; serverUrl: string; api: ServerApi; health: Health; me: Me | null }
  | { ok: false; message: string };

/**
 * Checks an address: is it reachable, is it a Tessera server, and does it accept this app's
 * origin with credentials (CORS)? Also returns who is signed in there already.
 */
export async function checkServer(ctx: AppContext, input: string): Promise<ServerCheck> {
  const serverUrl = normalizeServerUrl(input);
  if (!serverUrl) return { ok: false, message: t('serverAddressInvalid') };
  // Without credentials first: the health endpoint answers every origin.
  let health: Health;
  try {
    const response = await fetch(`${serverUrl}/api/health`, { credentials: 'omit' });
    const parsed = healthSchema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, message: t('serverNotTessera') };
    health = parsed.data;
  } catch {
    return { ok: false, message: t('serverUnreachable') };
  }
  const api = serverApi(serverUrl, authModeFor(ctx.platform));
  try {
    const me = await api.me();
    return { ok: true, serverUrl, api, health, me };
  } catch (error) {
    if (error instanceof ServerApiError && error.isNetworkError)
      return { ok: false, message: t('serverOriginBlocked', { origin: window.location.origin }) };
    throw error;
  }
}

/** After signing in: the account becomes this device's user. */
export function adoptAccount(ctx: AppContext, me: Me): void {
  if (ctx.settings.device.get(SETTING_KEYS.userId) !== me.user.id)
    ctx.settings.device.set(SETTING_KEYS.userId, me.user.id);
  ctx.settings.device.set(SETTING_KEYS.userName, me.user.name);
}

/**
 * Uploads the open (local) workspace: creates it on the server with the same ID, marks every
 * local doc as not yet on the server, links the workspace and reopens it, so the background sync
 * sends everything.
 */
export async function uploadWorkspace(ctx: AppContext, api: ServerApi): Promise<void> {
  const info = ctx.workspace.info;
  try {
    await api.createWorkspace({ id: info.id, name: info.name });
  } catch (error) {
    // Uploaded before (and disconnected since): reconnect if it is still ours.
    if (!(error instanceof ServerApiError && error.status === 409)) throw error;
    await api.workspace(info.id);
  }
  const syncState = await syncStateFor(info.id);
  await syncState.markDirty(await ctx.services.docStore.list());
  await ctx.services.workspaceRegistry.update(info.id, { serverUrl: api.serverUrl });
  ctx.switchWorkspace(info.id);
}

/** Opens a server workspace on this device (adding it to the list) and switches to it. */
export async function openServerWorkspace(
  ctx: AppContext,
  api: ServerApi,
  workspace: { id: string; name: string },
): Promise<void> {
  const registry = ctx.services.workspaceRegistry;
  const existing = await registry.get(workspace.id);
  if (existing) {
    if (existing.serverUrl !== api.serverUrl)
      await registry.update(workspace.id, { serverUrl: api.serverUrl });
  } else {
    await registry.create({ id: workspace.id, name: workspace.name, serverUrl: api.serverUrl });
  }
  // Joining from the first-run screen created an empty workspace: forget it once we've left.
  const current = ctx.workspace.info.id;
  if (
    current !== workspace.id &&
    ctx.settings.device.get(JOIN_WORKSPACE_KEY) === current &&
    ctx.workspace.pages.getSnapshot().all().length === 0
  ) {
    ctx.settings.device.set(TEMP_WORKSPACE_KEY, current);
  }
  ctx.settings.device.set(JOIN_WORKSPACE_KEY, undefined);
  ctx.switchWorkspace(workspace.id);
}

/** Stops syncing the open workspace; its data stays on this device. */
export async function disconnectWorkspace(ctx: AppContext): Promise<void> {
  const id = ctx.workspace.info.id;
  await ctx.services.workspaceRegistry.update(id, { serverUrl: null });
  ctx.switchWorkspace(id);
}
