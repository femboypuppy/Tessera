import { z } from 'zod';

/**
 * Shapes of the server's responses. Everything from the network is validated before use (a
 * server of another version, a proxy error page or a hostile server must never crash the app).
 */

export const roleSchema = z.enum(['owner', 'editor', 'viewer']);
export type Role = z.infer<typeof roleSchema>;

export const healthSchema = z.object({
  ok: z.literal(true),
  name: z.literal('tessera'),
  version: z.string(),
  setupRequired: z.boolean(),
  signupMode: z.enum(['invite', 'open', 'closed']),
  maxUploadBytes: z.number().optional(),
});
export type Health = z.infer<typeof healthSchema>;

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isOwner: z.boolean(),
});
export type ServerUser = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  kind: z.enum(['cookie', 'bearer']),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  current: z.boolean(),
});
export type ServerSession = z.infer<typeof sessionSchema>;

export const authResultSchema = z.object({
  user: userSchema,
  session: sessionSchema,
  token: z.string().optional(),
  inviteProblem: z.string().nullable().optional(),
});
export type AuthResult = z.infer<typeof authResultSchema>;

export const meSchema = z.object({ user: userSchema, session: sessionSchema });
export type Me = z.infer<typeof meSchema>;

export const sessionsSchema = z.object({ sessions: z.array(sessionSchema) });

export const serverWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  createdAt: z.number(),
  memberCount: z.number().optional(),
});
export type ServerWorkspace = z.infer<typeof serverWorkspaceSchema>;

export const workspacesSchema = z.object({ workspaces: z.array(serverWorkspaceSchema) });
export const workspaceResultSchema = z.object({ workspace: serverWorkspaceSchema });

export const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  role: roleSchema,
  joinedAt: z.number(),
});
export type Member = z.infer<typeof memberSchema>;
export const membersSchema = z.object({ members: z.array(memberSchema) });

export const inviteSchema = z.object({
  id: z.string(),
  role: z.enum(['editor', 'viewer']),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  maxUses: z.number().nullable(),
  uses: z.number(),
});
export type Invite = z.infer<typeof inviteSchema>;
export const invitesSchema = z.object({ invites: z.array(inviteSchema) });
export const createdInviteSchema = z.object({
  invite: inviteSchema,
  token: z.string(),
  url: z.string().nullable(),
});

export const invitePreviewSchema = z.object({
  workspace: z.object({ id: z.string(), name: z.string() }),
  role: z.enum(['editor', 'viewer']),
  invitedBy: z.string().nullable(),
  expiresAt: z.number().nullable(),
  signupMode: z.enum(['invite', 'open', 'closed']),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const docsSchema = z.object({
  docs: z.array(z.object({ name: z.string(), seq: z.number(), updatedAt: z.number().optional() })),
});

export const versionMetaSchema = z.object({
  id: z.string(),
  docName: z.string(),
  createdAt: z.number(),
  createdBy: z.string().nullable(),
  authorName: z.string().nullable(),
  label: z.string().nullable(),
  kind: z.enum(['auto', 'manual', 'restore']),
  size: z.number(),
});
export type ServerVersionMeta = z.infer<typeof versionMetaSchema>;
export const versionsSchema = z.object({ versions: z.array(versionMetaSchema) });
export const versionSchema = z.object({ version: versionMetaSchema, state: z.base64() });
export const uploadedVersionSchema = z.object({ version: versionMetaSchema });

export const assetResultSchema = z.object({
  asset: z.object({
    assetId: z.string(),
    mimeType: z.string(),
    size: z.number(),
    name: z.string().nullable(),
    createdAt: z.number(),
  }),
});

export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
