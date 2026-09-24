import { Hono } from 'hono';
import { z } from 'zod';
import { forbidden, HttpError, invalid, notFound } from '../../errors';
import { isClientDocName } from '../../sync/doc-names';
import type { Invite } from '../../workspaces/workspace-service';
import { fields, readJson, requireAuth, type AppEnv, type AppServices } from '../context';

const roleSchema = z.enum(['owner', 'editor', 'viewer']);

/** Largest version snapshot accepted (base64 in JSON). */
const MAX_VERSION_BYTES = 32 * 1024 * 1024;

const versionSchema = z.object({
  id: fields.id,
  docName: z
    .string()
    .refine((name) => /^page:[A-Za-z0-9_-]{1,64}$/.test(name), 'must be a page doc'),
  createdAt: z.number().int().positive(),
  kind: z.enum(['auto', 'manual', 'restore']),
  label: z.string().trim().max(200).nullable().default(null),
  state: z.base64().max(Math.ceil((MAX_VERSION_BYTES * 4) / 3) + 4),
});

function inviteUrl(services: AppServices, token: string): string | null {
  return services.config.publicUrl
    ? `${services.config.publicUrl}/?invite=${encodeURIComponent(token)}`
    : null;
}

function publicInvite(invite: Invite) {
  return {
    id: invite.id,
    role: invite.role,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    uses: invite.uses,
  };
}

export function workspaceRoutes(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { workspaces } = services;

  app.get('/', (c) => {
    const auth = requireAuth(c);
    return c.json({ workspaces: workspaces.listForUser(auth.user.id) });
  });

  app.post('/', async (c) => {
    const auth = requireAuth(c);
    const body = await readJson(
      c,
      z.object({ id: fields.id.optional(), name: fields.workspaceName }),
    );
    if (services.config.signupMode === 'closed' && !auth.user.isOwner)
      throw forbidden('Only the server owner can create workspaces on this server.');
    const workspace = workspaces.create({ ...body, ownerId: auth.user.id });
    services.logger.info({ workspaceId: workspace.id, userId: auth.user.id }, 'workspace created');
    return c.json({ workspace: { ...workspace, role: 'owner', memberCount: 1 } }, 201);
  });

  app.get('/:id', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    const role = workspaces.requireRole(id, auth.user.id, 'viewer');
    const workspace = workspaces.get(id);
    if (!workspace) throw notFound('Workspace not found.');
    return c.json({ workspace: { ...workspace, role } });
  });

  app.patch('/:id', async (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'owner');
    const body = await readJson(c, z.object({ name: fields.workspaceName }));
    return c.json({ workspace: workspaces.rename(id, body.name) });
  });

  app.delete('/:id', async (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'owner');
    workspaces.delete(id);
    await services.assets.deleteWorkspaceFiles(id);
    services.logger.info({ workspaceId: id, userId: auth.user.id }, 'workspace deleted');
    return c.body(null, 204);
  });

  // Members.

  app.get('/:id/members', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    const role = workspaces.requireRole(id, auth.user.id, 'viewer');
    const members = workspaces.members(id).map((member) => ({
      ...member,
      // Emails are for owners, who manage people.
      email: role === 'owner' || member.userId === auth.user.id ? member.email : null,
    }));
    return c.json({ members });
  });

  app.patch('/:id/members/:userId', async (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'owner');
    const body = await readJson(c, z.object({ role: roleSchema }));
    workspaces.setRole(id, c.req.param('userId'), body.role);
    return c.body(null, 204);
  });

  app.delete('/:id/members/:userId', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    const userId = c.req.param('userId');
    // Anyone may leave; only owners remove others.
    workspaces.requireRole(id, auth.user.id, userId === auth.user.id ? 'viewer' : 'owner');
    workspaces.removeMember(id, userId);
    return c.body(null, 204);
  });

  // Docs (the client's background sync compares sequence numbers to find changed docs).

  app.get('/:id/docs', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'viewer');
    return c.json({ docs: services.persistence.listDocs(id) });
  });

  app.delete('/:id/docs/:docName', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'editor');
    const docName = c.req.param('docName');
    if (!isClientDocName(docName) || docName.startsWith('ws:'))
      throw invalid('Only page and database docs can be deleted.');
    services.persistence.deleteDoc(id, docName);
    // Anyone still editing it is disconnected; the tombstone keeps them from reconnecting.
    services.hooks.docDeleted(id, docName);
    services.logger.info({ workspaceId: id, docName, userId: auth.user.id }, 'doc deleted');
    return c.body(null, 204);
  });

  // Version history.

  app.get('/:id/versions', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'viewer');
    const docName = c.req.query('doc') ?? '';
    if (!isClientDocName(docName)) throw invalid('Pass ?doc=page:<id>.');
    return c.json({ versions: services.versions.list(id, docName) });
  });

  app.get('/:id/versions/:versionId', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'viewer');
    const found = services.versions.get(id, c.req.param('versionId'));
    if (!found) throw notFound('Version not found.');
    return c.json({ version: found.meta, state: Buffer.from(found.state).toString('base64') });
  });

  app.post('/:id/versions', async (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'editor');
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_VERSION_BYTES * 1.4)
      throw new HttpError(413, 'too_large', 'This version is too large to upload.');
    const body = await readJson(c, versionSchema);
    const state = new Uint8Array(Buffer.from(body.state, 'base64'));
    const { meta, created } = services.versions.create(id, {
      id: body.id,
      docName: body.docName,
      createdAt: body.createdAt,
      createdBy: auth.user.id,
      authorName: auth.user.name,
      label: body.label,
      kind: body.kind,
      state,
    });
    return c.json({ version: meta }, created ? 201 : 200);
  });

  // Invites (owners).

  app.get('/:id/invites', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'owner');
    return c.json({ invites: workspaces.listInvites(id).map(publicInvite) });
  });

  app.post('/:id/invites', async (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'owner');
    const body = await readJson(
      c,
      z.object({
        role: z.enum(['editor', 'viewer']),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .nullable()
          .default(24 * 7),
        maxUses: z.number().int().min(1).max(1000).nullable().default(1),
      }),
    );
    const { invite, token } = workspaces.createInvite({
      ...body,
      workspaceId: id,
      createdBy: auth.user.id,
    });
    return c.json({ invite: publicInvite(invite), token, url: inviteUrl(services, token) }, 201);
  });

  app.delete('/:id/invites/:inviteId', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    workspaces.requireRole(id, auth.user.id, 'owner');
    workspaces.revokeInvite(id, c.req.param('inviteId'));
    return c.body(null, 204);
  });

  return app;
}
