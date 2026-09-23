import { isValidId, newId } from '@tessera/core';
import type { Db } from '../db/database';
import { conflict, forbidden, HttpError, invalid, notFound } from '../errors';
import { hashToken, randomToken } from '../auth/tokens';

export type Role = 'owner' | 'editor' | 'viewer';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/** Whether `role` includes the permissions of `required`. */
export function hasRole(role: Role | null, required: Role): boolean {
  return role !== null && RANK[role] >= RANK[required];
}

export interface Workspace {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: number;
}

export interface Invite {
  id: string;
  workspaceId: string;
  role: Exclude<Role, 'owner'>;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  revokedAt: number | null;
}

interface InviteRow {
  id: string;
  workspace_id: string;
  role: Exclude<Role, 'owner'>;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  revoked_at: number | null;
}

const toInvite = (row: InviteRow): Invite => ({
  id: row.id,
  workspaceId: row.workspace_id,
  role: row.role,
  createdBy: row.created_by,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  maxUses: row.max_uses,
  uses: row.uses,
  revokedAt: row.revoked_at,
});

/** Why an invite can't be used. */
export type InviteProblem = 'not_found' | 'expired' | 'used_up' | 'revoked';

const INVITE_MESSAGES: Record<InviteProblem, string> = {
  not_found: 'This invite link is not valid.',
  expired: 'This invite link has expired. Ask for a new one.',
  used_up: 'This invite link has already been used.',
  revoked: 'This invite link was revoked.',
};

/**
 * Workspaces, members, roles and invites. Roles apply to a whole workspace: owners manage members
 * and invites, editors write, viewers read. Every check happens here, on the server.
 */
export class WorkspaceService {
  private readonly membershipListeners = new Set<(workspaceId: string, userId: string) => void>();
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  create(input: { id?: string; name: string; ownerId: string }): Workspace {
    const id = input.id ?? newId();
    if (!isValidId(id)) throw invalid('Invalid workspace ID.');
    const workspace: Workspace = {
      id,
      name: input.name.trim().slice(0, 100),
      createdBy: input.ownerId,
      createdAt: this.now(),
    };
    this.db.transaction(() => {
      if (this.get(id)) throw conflict('A workspace with this ID already exists on the server.');
      this.db
        .prepare('INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(workspace.id, workspace.name, workspace.createdBy, workspace.createdAt);
      this.db
        .prepare(
          'INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(id, input.ownerId, 'owner', workspace.createdAt);
    })();
    return workspace;
  }

  get(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      { id: string; name: string; created_by: string | null; created_at: number } | undefined;
    return row
      ? { id: row.id, name: row.name, createdBy: row.created_by, createdAt: row.created_at }
      : null;
  }

  listForUser(userId: string): Array<Workspace & { role: Role; memberCount: number }> {
    const rows = this.db
      .prepare(
        `SELECT w.*, m.role, (SELECT COUNT(*) FROM members mm WHERE mm.workspace_id = w.id) AS member_count
         FROM workspaces w JOIN members m ON m.workspace_id = w.id
         WHERE m.user_id = ? ORDER BY w.name COLLATE NOCASE`,
      )
      .all(userId) as Array<{
      id: string;
      name: string;
      created_by: string | null;
      created_at: number;
      role: Role;
      member_count: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdBy: row.created_by,
      createdAt: row.created_at,
      role: row.role,
      memberCount: row.member_count,
    }));
  }

  rename(id: string, name: string): Workspace {
    this.db
      .prepare('UPDATE workspaces SET name = ? WHERE id = ?')
      .run(name.trim().slice(0, 100), id);
    const workspace = this.get(id);
    if (!workspace) throw notFound('Workspace not found.');
    return workspace;
  }

  /** Deletes a workspace and everything in it (docs, history, members, invites, asset rows). */
  delete(id: string): void {
    const members = this.members(id);
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    for (const member of members) this.emitMembership(id, member.userId);
  }

  roleOf(workspaceId: string, userId: string): Role | null {
    const row = this.db
      .prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?')
      .get(workspaceId, userId) as { role: Role } | undefined;
    return row?.role ?? null;
  }

  /** The caller's role, or a 404 (not a member: don't reveal that the workspace exists). */
  requireRole(workspaceId: string, userId: string, required: Role): Role {
    const role = this.roleOf(workspaceId, userId);
    if (!role) throw notFound('Workspace not found.');
    if (!hasRole(role, required)) throw forbidden(`This needs the ${required} role.`);
    return role;
  }

  members(workspaceId: string): Member[] {
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.name, u.email, m.role, m.created_at
         FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? ORDER BY u.name COLLATE NOCASE`,
      )
      .all(workspaceId) as Array<{
      user_id: string;
      name: string;
      email: string;
      role: Role;
      created_at: number;
    }>;
    return rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: row.created_at,
    }));
  }

  setRole(workspaceId: string, userId: string, role: Role): void {
    this.db.transaction(() => {
      const current = this.roleOf(workspaceId, userId);
      if (!current) throw notFound('This person is not a member.');
      if (current === 'owner' && role !== 'owner' && this.ownerCount(workspaceId) <= 1)
        throw new HttpError(409, 'last_owner', 'A workspace needs at least one owner.');
      this.db
        .prepare('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?')
        .run(role, workspaceId, userId);
    })();
    this.emitMembership(workspaceId, userId);
  }

  removeMember(workspaceId: string, userId: string): void {
    this.db.transaction(() => {
      const current = this.roleOf(workspaceId, userId);
      if (!current) throw notFound('This person is not a member.');
      if (current === 'owner' && this.ownerCount(workspaceId) <= 1)
        throw new HttpError(409, 'last_owner', 'A workspace needs at least one owner.');
      this.db
        .prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?')
        .run(workspaceId, userId);
    })();
    this.emitMembership(workspaceId, userId);
  }

  /** Called when a member's role changes or they are removed (their sockets reconnect). */
  onMembershipChanged(listener: (workspaceId: string, userId: string) => void): () => void {
    this.membershipListeners.add(listener);
    return () => this.membershipListeners.delete(listener);
  }

  // Invites.

  createInvite(input: {
    workspaceId: string;
    role: Exclude<Role, 'owner'>;
    createdBy: string;
    expiresInHours: number | null;
    maxUses: number | null;
  }): { invite: Invite; token: string } {
    const token = randomToken(24);
    const now = this.now();
    const invite: Invite = {
      id: newId(),
      workspaceId: input.workspaceId,
      role: input.role,
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: input.expiresInHours === null ? null : now + input.expiresInHours * 3_600_000,
      maxUses: input.maxUses,
      uses: 0,
      revokedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO invites (id, token_hash, workspace_id, role, created_by, created_at, expires_at, max_uses, uses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        invite.id,
        hashToken(token),
        invite.workspaceId,
        invite.role,
        invite.createdBy,
        invite.createdAt,
        invite.expiresAt,
        invite.maxUses,
      );
    return { invite, token };
  }

  listInvites(workspaceId: string): Invite[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM invites WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
      )
      .all(workspaceId) as InviteRow[];
    return rows.map(toInvite);
  }

  revokeInvite(workspaceId: string, inviteId: string): void {
    const result = this.db
      .prepare(
        'UPDATE invites SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL',
      )
      .run(this.now(), inviteId, workspaceId);
    if (result.changes === 0) throw notFound('Invite not found.');
  }

  /** Looks up an invite by its token and says whether it can be used. */
  checkInvite(token: string): { invite: Invite; problem: InviteProblem | null } | null {
    if (!token || token.length > 200) return null;
    const row = this.db
      .prepare('SELECT * FROM invites WHERE token_hash = ?')
      .get(hashToken(token)) as InviteRow | undefined;
    if (!row) return null;
    const invite = toInvite(row);
    let problem: InviteProblem | null = null;
    if (invite.revokedAt !== null) problem = 'revoked';
    else if (invite.expiresAt !== null && invite.expiresAt <= this.now()) problem = 'expired';
    else if (invite.maxUses !== null && invite.uses >= invite.maxUses) problem = 'used_up';
    return { invite, problem };
  }

  /** Throws the right error for an unusable invite. */
  inviteError(problem: InviteProblem): HttpError {
    return new HttpError(
      problem === 'not_found' ? 404 : 410,
      `invite_${problem}`,
      INVITE_MESSAGES[problem],
    );
  }

  /**
   * Uses an invite for a user, atomically: checks it, counts the use and adds the membership
   * (keeping a higher role the user already has).
   */
  acceptInvite(token: string, userId: string): { workspace: Workspace; role: Role } {
    const result = this.db.transaction(() => {
      const checked = this.checkInvite(token);
      if (!checked) throw this.inviteError('not_found');
      if (checked.problem) throw this.inviteError(checked.problem);
      const { invite } = checked;
      const workspace = this.get(invite.workspaceId);
      if (!workspace) throw this.inviteError('not_found');
      this.db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
      const current = this.roleOf(invite.workspaceId, userId);
      let role: Role = invite.role;
      if (current && hasRole(current, invite.role)) role = current;
      else if (current)
        this.db
          .prepare('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?')
          .run(invite.role, invite.workspaceId, userId);
      else
        this.db
          .prepare(
            'INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(invite.workspaceId, userId, invite.role, this.now());
      return { workspace, role, changed: current !== role };
    })();
    if (result.changed) this.emitMembership(result.workspace.id, userId);
    return { workspace: result.workspace, role: result.role };
  }

  private ownerCount(workspaceId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'")
      .get(workspaceId) as { n: number };
    return row.n;
  }

  private emitMembership(workspaceId: string, userId: string): void {
    for (const listener of this.membershipListeners) listener(workspaceId, userId);
  }
}
