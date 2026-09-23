import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Session, User } from '../../auth/auth-service';
import { safeEqual } from '../../auth/tokens';
import { forbidden, HttpError, notFound, unauthorized } from '../../errors';
import {
  clientIp,
  fields,
  isHttps,
  limit,
  readJson,
  requireAuth,
  type AppContext,
  type AppEnv,
  type AppServices,
} from '../context';
import { SESSION_COOKIE } from '../cookies';

const clientField = z.enum(['web', 'desktop']).default('web');
const deviceField = z.string().trim().max(100).optional();

const setupSchema = z.object({
  setupCode: z.string().trim().min(1, 'is required').max(100),
  name: fields.name,
  email: fields.email,
  password: fields.password,
  client: clientField,
  deviceName: deviceField,
});

const signupSchema = z.object({
  name: fields.name,
  email: fields.email,
  password: fields.password,
  inviteToken: z.string().max(200).optional(),
  client: clientField,
  deviceName: deviceField,
});

const loginSchema = z.object({
  email: fields.email,
  password: z.string().min(1, 'is required').max(256),
  client: clientField,
  deviceName: deviceField,
});

export function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, isOwner: user.isOwner };
}

export function publicSession(session: Session, currentId: string | null) {
  return {
    id: session.id,
    kind: session.kind,
    deviceName: session.deviceName,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    current: session.id === currentId,
  };
}

/** Starts a session: a cookie for the web app, a bearer token in the body for the desktop app. */
function startSession(
  c: AppContext,
  services: AppServices,
  user: User,
  client: 'web' | 'desktop',
  deviceName: string | undefined,
  extra: Record<string, unknown> = {},
) {
  const { token, session } = services.auth.createSession(user.id, {
    kind: client === 'desktop' ? 'bearer' : 'cookie',
    deviceName: deviceName ?? null,
    userAgent: c.req.header('user-agent') ?? null,
    ip: clientIp(c, services.config.trustProxy),
  });
  if (client === 'web') {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps(c, services.config),
      path: '/',
      maxAge: services.config.sessionDays * 24 * 60 * 60,
    });
  }
  return c.json(
    {
      user: publicUser(user),
      session: publicSession(session, session.id),
      ...(client === 'desktop' ? { token } : {}),
      ...extra,
    },
    201,
  );
}

export function authRoutes(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ip = (c: AppContext) => clientIp(c, services.config.trustProxy);

  // First run: create the owner. Needs the setup code the server logged at boot, so a stranger
  // who finds a fresh server can't claim it.
  app.post('/setup', async (c) => {
    limit(services, `setup:${ip(c)}`, 10, 15 * 60_000);
    if (services.auth.hasUsers() || !services.setup.code)
      throw new HttpError(
        409,
        'already_set_up',
        'This server already has an owner. Sign in instead.',
      );
    const body = await readJson(c, setupSchema);
    if (!safeEqual(body.setupCode.toUpperCase(), services.setup.code.toUpperCase()))
      throw forbidden('The setup code is wrong. It is printed in the server log.');
    const user = await services.auth.createUser({ ...body, isOwner: true });
    services.setup.code = null;
    services.logger.info({ userId: user.id }, 'owner account created');
    return startSession(c, services, user, body.client, body.deviceName);
  });

  app.post('/signup', async (c) => {
    limit(services, `signup:${ip(c)}`, 10, 60 * 60_000);
    const body = await readJson(c, signupSchema);
    const mode = services.config.signupMode;
    if (!services.auth.hasUsers())
      throw new HttpError(409, 'setup_required', 'Set up the server first (create the owner).');
    if (mode === 'closed')
      throw forbidden('Sign-ups are closed on this server. Ask its owner for an account.');
    if (mode === 'invite') {
      const checked = body.inviteToken ? services.workspaces.checkInvite(body.inviteToken) : null;
      if (!checked) throw forbidden('Sign-ups need an invite link on this server.');
      if (checked.problem) throw services.workspaces.inviteError(checked.problem);
    }
    const user = await services.auth.createUser(body);
    let inviteProblem: string | null = null;
    if (body.inviteToken) {
      try {
        services.workspaces.acceptInvite(body.inviteToken, user.id);
      } catch (error) {
        // The account exists either way; an invite used up meanwhile is reported, not fatal.
        if (!(error instanceof HttpError)) throw error;
        inviteProblem = error.message;
      }
    }
    return startSession(c, services, user, body.client, body.deviceName, { inviteProblem });
  });

  app.post('/login', async (c) => {
    const body = await readJson(c, loginSchema);
    const email = body.email.toLowerCase();
    limit(services, `login:ip:${ip(c)}`, 30, 5 * 60_000);
    limit(services, `login:email:${email}`, 10, 5 * 60_000);
    const user = await services.auth.verifyLogin(email, body.password);
    if (!user) throw new HttpError(401, 'invalid_credentials', 'The email or password is wrong.');
    services.rateLimiter.reset(`login:email:${email}`);
    return startSession(c, services, user, body.client, body.deviceName);
  });

  app.post('/logout', (c) => {
    const auth = c.get('auth');
    if (auth) services.auth.revokeSession(auth.user.id, auth.session.id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  app.get('/me', (c) => {
    const auth = requireAuth(c);
    return c.json({
      user: publicUser(auth.user),
      session: publicSession(auth.session, auth.session.id),
    });
  });

  app.patch('/me', async (c) => {
    const auth = requireAuth(c);
    const body = await readJson(c, z.object({ name: fields.name }));
    const user = services.auth.renameUser(auth.user.id, body.name);
    if (!user) throw unauthorized();
    return c.json({ user: publicUser(user) });
  });

  app.get('/sessions', (c) => {
    const auth = requireAuth(c);
    return c.json({
      sessions: services.auth
        .listSessions(auth.user.id)
        .map((session) => publicSession(session, auth.session.id)),
    });
  });

  app.delete('/sessions/:id', (c) => {
    const auth = requireAuth(c);
    const id = c.req.param('id');
    if (!services.auth.revokeSession(auth.user.id, id)) throw notFound('Session not found.');
    if (id === auth.session.id) deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  return app;
}
