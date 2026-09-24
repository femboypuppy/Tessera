import { Hono } from 'hono';
import { clientIp, limit, requireAuth, type AppEnv, type AppServices } from '../context';

/** Invite links: anyone with the token can preview it; a signed-in user can accept it. */
export function inviteRoutes(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { workspaces } = services;

  app.get('/:token', (c) => {
    limit(services, `invite:${clientIp(c, services.config.trustProxy)}`, 60, 60_000);
    const checked = workspaces.checkInvite(c.req.param('token'));
    if (!checked) throw workspaces.inviteError('not_found');
    if (checked.problem) throw workspaces.inviteError(checked.problem);
    const workspace = workspaces.get(checked.invite.workspaceId);
    if (!workspace) throw workspaces.inviteError('not_found');
    const inviter = checked.invite.createdBy
      ? services.auth.getUser(checked.invite.createdBy)
      : null;
    return c.json({
      workspace: { id: workspace.id, name: workspace.name },
      role: checked.invite.role,
      invitedBy: inviter?.name ?? null,
      expiresAt: checked.invite.expiresAt,
      signupMode: services.config.signupMode,
    });
  });

  app.post('/:token/accept', (c) => {
    limit(services, `invite:${clientIp(c, services.config.trustProxy)}`, 60, 60_000);
    const auth = requireAuth(c);
    const { workspace, role } = workspaces.acceptInvite(c.req.param('token'), auth.user.id);
    return c.json({ workspace: { ...workspace, role } });
  });

  return app;
}
