import type { AssetInfo } from '@tessera/core';
import { z } from 'zod';
import { base64ToBytes, bytesToBase64 } from './base64';
import {
  assetResultSchema,
  authResultSchema,
  createdInviteSchema,
  docsSchema,
  errorSchema,
  healthSchema,
  invitePreviewSchema,
  invitesSchema,
  meSchema,
  membersSchema,
  sessionsSchema,
  uploadedVersionSchema,
  userSchema,
  versionSchema,
  versionsSchema,
  workspaceResultSchema,
  workspacesSchema,
  type AuthResult,
  type Role,
  type ServerVersionMeta,
} from './schemas';
import { ServerApiError } from './errors';

export { ServerApiError };

/** How this device authenticates: the web app's cookie, or the desktop app's bearer token. */
export type AuthMode = 'cookie' | 'bearer';

export interface ServerApiOptions {
  mode: AuthMode;
  /** The bearer token (bearer mode). */
  getToken?: () => Promise<string | null>;
  /** Stores a token the server handed out (bearer mode). */
  setToken?: (token: string | null) => Promise<void>;
  fetch?: typeof fetch;
}

interface RequestOptions<S extends z.ZodType | null> {
  schema: S;
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** A typed client for the Tessera server's HTTP API. */
export class ServerApi {
  private readonly fetchFn: typeof fetch;

  constructor(
    readonly serverUrl: string,
    private readonly options: ServerApiOptions,
  ) {
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
  }

  get mode(): AuthMode {
    return this.options.mode;
  }

  // Server and account.

  health(signal?: AbortSignal) {
    return this.request('GET', '/api/health', {
      schema: healthSchema,
      ...(signal ? { signal } : {}),
    });
  }

  async setup(input: { setupCode: string; name: string; email: string; password: string }) {
    return this.signedIn(
      await this.request('POST', '/api/auth/setup', {
        schema: authResultSchema,
        body: this.withClient(input),
      }),
    );
  }

  async signup(input: { name: string; email: string; password: string; inviteToken?: string }) {
    return this.signedIn(
      await this.request('POST', '/api/auth/signup', {
        schema: authResultSchema,
        body: this.withClient(input),
      }),
    );
  }

  async login(input: { email: string; password: string }) {
    return this.signedIn(
      await this.request('POST', '/api/auth/login', {
        schema: authResultSchema,
        body: this.withClient(input),
      }),
    );
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/api/auth/logout', { schema: null });
    } finally {
      await this.options.setToken?.(null);
    }
  }

  /** The signed-in account, or null when signed out (401). */
  async me() {
    try {
      return await this.request('GET', '/api/auth/me', { schema: meSchema });
    } catch (error) {
      if (error instanceof ServerApiError && error.status === 401) return null;
      throw error;
    }
  }

  async renameMe(name: string) {
    return (await this.request('PATCH', '/api/auth/me', { schema: renamedSchema, body: { name } }))
      .user;
  }

  async sessions() {
    return (await this.request('GET', '/api/auth/sessions', { schema: sessionsSchema })).sessions;
  }

  revokeSession(sessionId: string) {
    return this.request('DELETE', `/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
      schema: null,
    });
  }

  // Workspaces.

  async workspaces() {
    return (await this.request('GET', '/api/workspaces', { schema: workspacesSchema })).workspaces;
  }

  async createWorkspace(input: { id?: string; name: string }) {
    return (
      await this.request('POST', '/api/workspaces', { schema: workspaceResultSchema, body: input })
    ).workspace;
  }

  async workspace(id: string) {
    return (
      await this.request('GET', `/api/workspaces/${enc(id)}`, { schema: workspaceResultSchema })
    ).workspace;
  }

  async members(workspaceId: string) {
    return (
      await this.request('GET', `/api/workspaces/${enc(workspaceId)}/members`, {
        schema: membersSchema,
      })
    ).members;
  }

  setRole(workspaceId: string, userId: string, role: Role) {
    return this.request('PATCH', `/api/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, {
      schema: null,
      body: { role },
    });
  }

  removeMember(workspaceId: string, userId: string) {
    return this.request('DELETE', `/api/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, {
      schema: null,
    });
  }

  async docs(workspaceId: string) {
    return (
      await this.request('GET', `/api/workspaces/${enc(workspaceId)}/docs`, { schema: docsSchema })
    ).docs;
  }

  deleteDoc(workspaceId: string, docName: string) {
    return this.request('DELETE', `/api/workspaces/${enc(workspaceId)}/docs/${enc(docName)}`, {
      schema: null,
    });
  }

  // Invites.

  async invites(workspaceId: string) {
    return (
      await this.request('GET', `/api/workspaces/${enc(workspaceId)}/invites`, {
        schema: invitesSchema,
      })
    ).invites;
  }

  createInvite(
    workspaceId: string,
    input: { role: 'editor' | 'viewer'; expiresInHours: number | null; maxUses: number | null },
  ) {
    return this.request('POST', `/api/workspaces/${enc(workspaceId)}/invites`, {
      schema: createdInviteSchema,
      body: input,
    });
  }

  revokeInvite(workspaceId: string, inviteId: string) {
    return this.request('DELETE', `/api/workspaces/${enc(workspaceId)}/invites/${enc(inviteId)}`, {
      schema: null,
    });
  }

  previewInvite(token: string) {
    return this.request('GET', `/api/invites/${enc(token)}`, { schema: invitePreviewSchema });
  }

  async acceptInvite(token: string) {
    return (
      await this.request('POST', `/api/invites/${enc(token)}/accept`, {
        schema: workspaceResultSchema,
      })
    ).workspace;
  }

  // Versions.

  async versions(workspaceId: string, docName: string): Promise<ServerVersionMeta[]> {
    return (
      await this.request(
        'GET',
        `/api/workspaces/${enc(workspaceId)}/versions?doc=${enc(docName)}`,
        {
          schema: versionsSchema,
        },
      )
    ).versions;
  }

  async version(workspaceId: string, versionId: string) {
    const result = await this.request(
      'GET',
      `/api/workspaces/${enc(workspaceId)}/versions/${enc(versionId)}`,
      {
        schema: versionSchema,
      },
    );
    return { meta: result.version, state: base64ToBytes(result.state) };
  }

  async uploadVersion(
    workspaceId: string,
    input: {
      id: string;
      docName: string;
      createdAt: number;
      kind: 'auto' | 'manual' | 'restore';
      label: string | null;
      state: Uint8Array;
    },
  ) {
    return (
      await this.request('POST', `/api/workspaces/${enc(workspaceId)}/versions`, {
        schema: uploadedVersionSchema,
        body: { ...input, state: bytesToBase64(input.state) },
      })
    ).version;
  }

  // Assets.

  uploadAsset(workspaceId: string, info: AssetInfo, blob: Blob) {
    const headers: Record<string, string> = {
      'content-type': info.mimeType || 'application/octet-stream',
    };
    if (info.name) headers['x-tessera-asset-name'] = encodeURIComponent(info.name);
    return this.request('PUT', `/api/assets/${enc(workspaceId)}/${enc(info.assetId)}`, {
      schema: assetResultSchema,
      raw: blob,
      headers,
    });
  }

  /** Downloads an asset, or null when the server doesn't have it. */
  async downloadAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<{ blob: Blob; info: AssetInfo } | null> {
    const response = await this.send('GET', `/api/assets/${enc(workspaceId)}/${enc(assetId)}`, {});
    if (response.status === 404) return null;
    if (!response.ok) throw await this.errorFrom(response);
    const blob = await response.blob();
    const rawName = response.headers.get('x-tessera-asset-name');
    let name: string | null = null;
    if (rawName) {
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = null;
      }
    }
    const createdAt = Number(response.headers.get('x-tessera-created-at'));
    return {
      blob,
      info: {
        assetId,
        name,
        mimeType:
          (response.headers.get('content-type') ?? blob.type).split(';')[0]?.trim() ||
          'application/octet-stream',
        size: blob.size,
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      },
    };
  }

  // Plumbing.

  private withClient<T extends object>(input: T): T & { client: 'web' | 'desktop' } {
    return { ...input, client: this.options.mode === 'bearer' ? 'desktop' : 'web' };
  }

  private async signedIn(result: AuthResult): Promise<AuthResult> {
    if (this.options.mode === 'bearer' && result.token) await this.options.setToken?.(result.token);
    return result;
  }

  private async send(
    method: string,
    path: string,
    options: {
      body?: unknown;
      raw?: BodyInit;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (this.options.mode === 'bearer') {
      const token = await this.options.getToken?.();
      if (token) headers.set('authorization', `Bearer ${token}`);
    }
    try {
      return await this.fetchFn(`${this.serverUrl}${path}`, {
        method,
        headers,
        credentials: this.options.mode === 'cookie' ? 'include' : 'omit',
        body:
          options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
      throw new ServerApiError(0, 'unreachable', 'The server could not be reached.');
    }
  }

  private async request<S extends z.ZodType | null>(
    method: string,
    path: string,
    options: RequestOptions<S>,
  ): Promise<S extends z.ZodType ? z.infer<S> : void> {
    const response = await this.send(method, path, options);
    if (!response.ok) throw await this.errorFrom(response);
    type Result = S extends z.ZodType ? z.infer<S> : void;
    if (!options.schema || response.status === 204) return undefined as Result;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ServerApiError(
        response.status,
        'bad_response',
        'The server sent an unexpected answer.',
      );
    }
    const parsed = options.schema.safeParse(json);
    if (!parsed.success)
      throw new ServerApiError(
        response.status,
        'bad_response',
        'The server sent an unexpected answer.',
      );
    return parsed.data as Result;
  }

  private async errorFrom(response: Response): Promise<ServerApiError> {
    try {
      const parsed = errorSchema.safeParse(await response.json());
      if (parsed.success)
        return new ServerApiError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
        );
    } catch {
      // Not JSON (a proxy's error page).
    }
    return new ServerApiError(
      response.status,
      'http_error',
      `The server answered ${response.status}.`,
    );
  }
}

const renamedSchema = z.object({ user: userSchema });

function enc(value: string): string {
  return encodeURIComponent(value);
}
