import { afterEach, describe, expect, it } from 'vitest';
import {
  addMember,
  bootstrap,
  signUp,
  startTestServer,
  testClock,
  cleanupServers,
  type TestServer,
} from '../testing/harness';

const servers: TestServer[] = [];

async function server(...args: Parameters<typeof startTestServer>): Promise<TestServer> {
  const t = await startTestServer(...args);
  servers.push(t);
  return t;
}

afterEach(async () => {
  await cleanupServers(servers);
});

describe('workspaces and roles', () => {
  it('creates workspaces (keeping a local ID on upload) and lists them with the role', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const uploaded = await t.api('POST', '/api/workspaces', {
      token: ownerToken,
      body: { id: 'local-ws_123', name: 'Uploaded from my laptop' },
    });
    expect(uploaded.status).toBe(201);
    const duplicate = await t.api('POST', '/api/workspaces', {
      token: ownerToken,
      body: { id: 'local-ws_123', name: 'Again' },
    });
    expect(duplicate.status).toBe(409);
    const list = await t.api<{ workspaces: Array<{ id: string; role: string }> }>(
      'GET',
      '/api/workspaces',
      {
        token: ownerToken,
      },
    );
    expect(list.body.workspaces.map((ws) => ws.id).sort()).toEqual(
      [workspaceId, 'local-ws_123'].sort(),
    );
    expect(list.body.workspaces.every((ws) => ws.role === 'owner')).toBe(true);
  });

  it('hides workspaces from non-members and enforces roles', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const stranger = await signUp(t, 'stranger@example.com');
    expect(
      (await t.api('GET', `/api/workspaces/${workspaceId}`, { token: stranger.token })).status,
    ).toBe(404);
    expect(
      (await t.api('GET', `/api/workspaces/${workspaceId}/docs`, { token: stranger.token })).status,
    ).toBe(404);
    const viewer = await addMember(t, ownerToken, workspaceId, 'viewer@example.com', 'viewer');
    expect(
      (await t.api('GET', `/api/workspaces/${workspaceId}`, { token: viewer.token })).body,
    ).toMatchObject({
      workspace: { role: 'viewer' },
    });
    const rename = await t.api('PATCH', `/api/workspaces/${workspaceId}`, {
      token: viewer.token,
      body: { name: 'Mine now' },
    });
    expect(rename.status).toBe(403);
    const deleteDoc = await t.api('DELETE', `/api/workspaces/${workspaceId}/docs/page:abc`, {
      token: viewer.token,
    });
    expect(deleteDoc.status).toBe(403);
    const invite = await t.api('POST', `/api/workspaces/${workspaceId}/invites`, {
      token: viewer.token,
      body: { role: 'editor' },
    });
    expect(invite.status).toBe(403);
    expect((await t.api('GET', '/api/workspaces')).status).toBe(401);
  });

  it('lets owners change roles, but never removes the last owner', async () => {
    const t = await server();
    const { ownerToken, ownerId, workspaceId } = await bootstrap(t);
    const editor = await addMember(t, ownerToken, workspaceId, 'editor@example.com', 'editor');
    const members = await t.api<{
      members: Array<{ userId: string; role: string; email: string | null }>;
    }>('GET', `/api/workspaces/${workspaceId}/members`, { token: editor.token });
    expect(members.body.members).toHaveLength(2);
    // Editors don't see other people's emails.
    expect(members.body.members.find((m) => m.userId === ownerId)?.email).toBeNull();
    const demoteSelf = await t.api('PATCH', `/api/workspaces/${workspaceId}/members/${ownerId}`, {
      token: ownerToken,
      body: { role: 'viewer' },
    });
    expect(demoteSelf.status).toBe(409);
    const promote = await t.api(
      'PATCH',
      `/api/workspaces/${workspaceId}/members/${editor.userId}`,
      {
        token: ownerToken,
        body: { role: 'owner' },
      },
    );
    expect(promote.status).toBe(204);
    expect(
      (
        await t.api('PATCH', `/api/workspaces/${workspaceId}/members/${ownerId}`, {
          token: ownerToken,
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(204);
    const leave = await t.api('DELETE', `/api/workspaces/${workspaceId}/members/${ownerId}`, {
      token: ownerToken,
    });
    expect(leave.status).toBe(204);
    expect(
      (await t.api('GET', `/api/workspaces/${workspaceId}`, { token: ownerToken })).status,
    ).toBe(404);
  });
});

describe('invites', () => {
  it('previews an invite and grants its role once accepted', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t, 'Mission control');
    const created = await t.api<{ token: string; url: string | null; invite: { maxUses: number } }>(
      'POST',
      `/api/workspaces/${workspaceId}/invites`,
      { token: ownerToken, body: { role: 'viewer' } },
    );
    expect(created.status).toBe(201);
    expect(created.body.invite.maxUses).toBe(1);
    const preview = await t.api('GET', `/api/invites/${created.body.token}`);
    expect(preview.body).toMatchObject({
      workspace: { name: 'Mission control' },
      role: 'viewer',
      invitedBy: 'Ada Owner',
    });
    const guest = await signUp(t, 'guest@example.com');
    const accepted = await t.api('POST', `/api/invites/${created.body.token}/accept`, {
      token: guest.token,
    });
    expect(accepted.body).toMatchObject({ workspace: { id: workspaceId, role: 'viewer' } });
    expect((await t.api('POST', `/api/invites/${created.body.token}/accept`)).status).toBe(401);
  });

  it('is single-use when configured that way', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const created = await t.api<{ token: string }>(
      'POST',
      `/api/workspaces/${workspaceId}/invites`,
      {
        token: ownerToken,
        body: { role: 'editor', maxUses: 1 },
      },
    );
    const first = await signUp(t, 'first@example.com');
    const second = await signUp(t, 'second@example.com');
    expect(
      (await t.api('POST', `/api/invites/${created.body.token}/accept`, { token: first.token }))
        .status,
    ).toBe(200);
    const reused = await t.api<{ error: { code: string } }>(
      'POST',
      `/api/invites/${created.body.token}/accept`,
      {
        token: second.token,
      },
    );
    expect(reused.status).toBe(410);
    expect(reused.body.error.code).toBe('invite_used_up');
    expect(
      (await t.api('GET', `/api/workspaces/${workspaceId}`, { token: second.token })).status,
    ).toBe(404);
  });

  it('allows several uses when configured, and none after expiry', async () => {
    const clock = testClock();
    const t = await server({}, { now: clock.now });
    const { ownerToken, workspaceId } = await bootstrap(t);
    const created = await t.api<{ token: string }>(
      'POST',
      `/api/workspaces/${workspaceId}/invites`,
      {
        token: ownerToken,
        body: { role: 'editor', maxUses: null, expiresInHours: 2 },
      },
    );
    for (const email of ['a@example.com', 'b@example.com']) {
      const account = await signUp(t, email);
      expect(
        (await t.api('POST', `/api/invites/${created.body.token}/accept`, { token: account.token }))
          .status,
      ).toBe(200);
    }
    clock.advance(2 * 60 * 60 * 1000 + 1);
    const late = await signUp(t, 'late@example.com');
    const expired = await t.api<{ error: { code: string } }>(
      'POST',
      `/api/invites/${created.body.token}/accept`,
      {
        token: late.token,
      },
    );
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('invite_expired');
    expect((await t.api('GET', `/api/invites/${created.body.token}`)).status).toBe(410);
  });

  it('can be revoked, and unknown tokens are not found', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const created = await t.api<{ token: string; invite: { id: string } }>(
      'POST',
      `/api/workspaces/${workspaceId}/invites`,
      { token: ownerToken, body: { role: 'editor' } },
    );
    const list = await t.api<{ invites: unknown[] }>(
      'GET',
      `/api/workspaces/${workspaceId}/invites`,
      { token: ownerToken },
    );
    expect(list.body.invites).toHaveLength(1);
    expect(
      (
        await t.api('DELETE', `/api/workspaces/${workspaceId}/invites/${created.body.invite.id}`, {
          token: ownerToken,
        })
      ).status,
    ).toBe(204);
    const account = await signUp(t, 'x@example.com');
    const revoked = await t.api<{ error: { code: string } }>(
      'POST',
      `/api/invites/${created.body.token}/accept`,
      {
        token: account.token,
      },
    );
    expect(revoked.body.error.code).toBe('invite_revoked');
    expect((await t.api('GET', '/api/invites/not-a-real-token')).status).toBe(404);
  });

  it('never downgrades an existing member', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const editor = await addMember(t, ownerToken, workspaceId, 'ed@example.com', 'editor');
    const viewerInvite = await t.api<{ token: string }>(
      'POST',
      `/api/workspaces/${workspaceId}/invites`,
      {
        token: ownerToken,
        body: { role: 'viewer' },
      },
    );
    const accepted = await t.api('POST', `/api/invites/${viewerInvite.body.token}/accept`, {
      token: editor.token,
    });
    expect(accepted.body).toMatchObject({ workspace: { role: 'editor' } });
  });
});
