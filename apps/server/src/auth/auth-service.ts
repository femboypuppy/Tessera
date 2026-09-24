import { newId } from '@tessera/core';
import type { Db } from '../db/database';
import { conflict } from '../errors';
import { hashPassword, verifyPassword, type PasswordHashOptions } from './passwords';
import { hashToken, randomToken } from './tokens';

export interface User {
  id: string;
  email: string;
  name: string;
  /** The server owner (the first account): may create workspaces in `closed` mode. */
  isOwner: boolean;
  createdAt: number;
}

export type SessionKind = 'cookie' | 'bearer';

export interface Session {
  id: string;
  userId: string;
  kind: SessionKind;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_owner: number;
  created_at: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  kind: SessionKind;
  device_name: string | null;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  isOwner: row.is_owner === 1,
  createdAt: row.created_at,
});

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind,
  deviceName: row.device_name,
  userAgent: row.user_agent,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
});

export interface AuthServiceOptions {
  sessionDays: number;
  now?: () => number;
  hashing?: PasswordHashOptions;
}

/** Extend a session's expiry at most this often (sliding expiration). */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Accounts and sessions. Passwords are hashed with argon2id; session tokens are random and only
 * their SHA-256 is stored. Sessions slide: each use extends them by `sessionDays`.
 */
export class AuthService {
  private readonly now: () => number;
  private readonly revokedListeners = new Set<(sessionIds: string[]) => void>();
  /** A hash to verify against when an email is unknown, so timing doesn't reveal accounts. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Db,
    private readonly options: AuthServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  hasUsers(): boolean {
    return this.db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
  }

  async createUser(input: {
    email: string;
    name: string;
    password: string;
    isOwner?: boolean;
  }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    if (this.findUserByEmail(email)) throw conflict('An account with this email already exists.');
    const passwordHash = await hashPassword(input.password, this.options.hashing);
    const user: User = {
      id: newId(),
      email,
      name: input.name.trim(),
      isOwner: input.isOwner === true,
      createdAt: this.now(),
    };
    try {
      this.db
        .prepare(
          'INSERT INTO users (id, email, name, password_hash, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(user.id, user.email, user.name, passwordHash, user.isOwner ? 1 : 0, user.createdAt);
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
        throw conflict('An account with this email already exists.');
      throw error;
    }
    return user;
  }

  getUser(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  findUserByEmail(email: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  renameUser(id: string, name: string): User | null {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), id);
    return this.getUser(id);
  }

  async setPassword(id: string, password: string): Promise<void> {
    const hash = await hashPassword(password, this.options.hashing);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  /** Checks an email and password. Takes about as long whether or not the account exists. */
  async verifyLogin(email: string, password: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    if (!row) {
      this.dummyHash ??= hashPassword(randomToken(), this.options.hashing);
      await verifyPassword(await this.dummyHash, password);
      return null;
    }
    return (await verifyPassword(row.password_hash, password)) ? toUser(row) : null;
  }

  createSession(
    userId: string,
    details: {
      kind: SessionKind;
      deviceName?: string | null;
      userAgent?: string | null;
      ip?: string | null;
    },
  ): { token: string; session: Session } {
    const token = randomToken();
    const now = this.now();
    const session: Session = {
      id: newId(),
      userId,
      kind: details.kind,
      deviceName: details.deviceName?.slice(0, 100) ?? null,
      userAgent: details.userAgent?.slice(0, 300) ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.lifetime(),
    };
    this.db
      .prepare(
        `INSERT INTO sessions (id, token_hash, user_id, kind, device_name, user_agent, ip, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        hashToken(token),
        userId,
        session.kind,
        session.deviceName,
        session.userAgent,
        details.ip?.slice(0, 64) ?? null,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
      );
    return { token, session };
  }

  /** The user and session of a token, or null when unknown or expired (extends valid ones). */
  resolveToken(token: string | null | undefined): { user: User; session: Session } | null {
    if (!token || token.length > 200) return null;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token_hash = ?')
      .get(hashToken(token)) as SessionRow | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.expires_at <= now) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
      return null;
    }
    const user = this.getUser(row.user_id);
    if (!user) return null;
    if (now - row.last_seen_at >= TOUCH_INTERVAL_MS) {
      row.last_seen_at = now;
      row.expires_at = now + this.lifetime();
      this.db
        .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
        .run(row.last_seen_at, row.expires_at, row.id);
    }
    return { user, session: toSession(row) };
  }

  /** Whether a session still exists and hasn't expired (checked on every sync message). */
  isSessionActive(sessionId: string): boolean {
    const row = this.db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(sessionId) as
      { expires_at: number } | undefined;
    return row !== undefined && row.expires_at > this.now();
  }

  listSessions(userId: string): Session[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC',
      )
      .all(userId, this.now()) as SessionRow[];
    return rows.map(toSession);
  }

  /** Revokes a session of a user. Returns false when there is no such session. */
  revokeSession(userId: string, sessionId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
      .run(sessionId, userId);
    if (result.changes > 0) this.emitRevoked([sessionId]);
    return result.changes > 0;
  }

  /** Removes expired sessions (periodic maintenance). */
  pruneExpired(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now()).changes;
  }

  /** Called with session IDs as they are revoked (the sync server closes their sockets). */
  onSessionsRevoked(listener: (sessionIds: string[]) => void): () => void {
    this.revokedListeners.add(listener);
    return () => this.revokedListeners.delete(listener);
  }

  private emitRevoked(sessionIds: string[]): void {
    for (const listener of this.revokedListeners) listener(sessionIds);
  }

  private lifetime(): number {
    return this.options.sessionDays * 24 * 60 * 60 * 1000;
  }
}
