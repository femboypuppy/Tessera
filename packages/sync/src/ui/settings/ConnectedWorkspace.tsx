import { colorForId } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { Avatar, Badge, Button, Callout, IconButton, Input, Select, getLocale } from '@tessera/ui';
import {
  CloudAlert,
  CloudCheck,
  CloudOff,
  Copy,
  Laptop,
  LogOut,
  Monitor,
  RefreshCw,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useId, useState } from 'react';
import type { Invite, Me, Role, ServerSession } from '../../client/schemas';
import { displayServerUrl } from '../../client/server-url';
import { t } from '../../i18n';
import {
  formatRelativeTime,
  useAsync,
  useNow,
  useWorkspaceSyncStatus,
  type ServerLink,
} from '../hooks';
import { SignInForm } from './AccountForms';
import { adoptAccount, disconnectWorkspace, openServerWorkspace } from './actions';
import { Card, errorMessage, LoadError, LoadingRows, Section } from './parts';

/** A short description of a browser from its user agent ("Firefox on Windows"). */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os;
}

function StatusCard({
  link,
  me,
  memberRole: role,
}: {
  link: ServerLink;
  me: Me | null;
  memberRole: Role | null;
}) {
  const status = useWorkspaceSyncStatus();
  const now = useNow();
  const server = displayServerUrl(link.serverUrl);
  const Icon =
    status.status === 'error' ? CloudAlert : status.status === 'offline' ? CloudOff : CloudCheck;
  const tone =
    status.status === 'error'
      ? 'bg-danger-subtle text-danger-text'
      : status.status === 'offline'
        ? 'bg-warning-subtle text-warning-text'
        : 'bg-success-subtle text-success-text';
  const line =
    status.status === 'error'
      ? (status.error?.message ?? t('statusError'))
      : status.status === 'offline'
        ? t('statusOfflineDetail')
        : status.status === 'synced'
          ? status.lastSyncedAt
            ? t('lastSynced', { time: formatRelativeTime(status.lastSyncedAt, now) })
            : t('statusSynced')
          : t('statusSyncing');
  return (
    <Card className="flex items-start gap-3">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5 ${tone}`}
      >
        <Icon aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-fg">{t('syncedWith', { server })}</h3>
        <p className="mt-0.5 text-ui text-fg-muted">{line}</p>
        {me ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-ui text-fg-muted">
            {t('signedInAs', { name: me.user.name, email: me.user.email })}
            {role ? (
              <Badge tone={role === 'owner' ? 'accent' : 'neutral'}>{t(`role_${role}`)}</Badge>
            ) : null}
          </p>
        ) : null}
      </div>
      {status.status === 'offline' ||
      (status.status === 'error' && status.error?.code !== 'unauthenticated') ? (
        <Button size="sm" onClick={() => link.provider?.retry()}>
          <RefreshCw aria-hidden="true" />
          {t('retryNow')}
        </Button>
      ) : null}
    </Card>
  );
}

function PeopleSection({ link, me, role }: { link: ServerLink; me: Me; role: Role | null }) {
  const ctx = useAppContext();
  const id = useId();
  const workspaceId = ctx.workspace.info.id;
  const members = useAsync(() => link.api.members(workspaceId), [link.api, workspaceId]);
  const [error, setError] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      members.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };
  return (
    <Section title={t('people')} description={t('peopleHint')} labelledBy={`${id}-people`}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {members.status === 'loading' && !members.data ? <LoadingRows /> : null}
      {members.status === 'error' ? (
        <LoadError error={members.error} onRetry={members.reload} />
      ) : null}
      {members.data ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {members.data.map((member) => {
            const self = member.userId === me.user.id;
            return (
              <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={member.name} color={colorForId(member.userId)} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    {member.name}
                    {self ? <span className="text-fg-muted"> ({t('you')})</span> : null}
                  </p>
                  {member.email ? (
                    <p className="truncate text-xs text-fg-muted">{member.email}</p>
                  ) : null}
                </div>
                {isOwner && !self ? (
                  <>
                    <Select
                      size="sm"
                      aria-label={`${t('changeRole')}: ${member.name}`}
                      value={member.role}
                      onValueChange={(value) =>
                        void run(() => link.api.setRole(workspaceId, member.userId, value as Role))
                      }
                      options={(['owner', 'editor', 'viewer'] as const).map((value) => ({
                        value,
                        label: t(`role_${value}`),
                      }))}
                      className="w-28"
                    />
                    <IconButton
                      label={`${t('removeMember')}: ${member.name}`}
                      icon={<Trash2 />}
                      onClick={() =>
                        void ctx
                          .confirm({
                            title: t('removeMemberConfirm', { name: member.name }),
                            description: t('removeMemberHint'),
                            confirmLabel: t('removeMember'),
                            destructive: true,
                          })
                          .then((confirmed) => {
                            if (confirmed)
                              void run(() => link.api.removeMember(workspaceId, member.userId));
                          })
                      }
                    />
                  </>
                ) : (
                  <Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>
                    {t(`role_${member.role}`)}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

function inviteSummary(invite: Invite): string {
  const uses =
    invite.maxUses === null
      ? t('inviteUsesUnlimited')
      : t('inviteUsesLeft', { count: Math.max(0, invite.maxUses - invite.uses) });
  const expiry =
    invite.expiresAt === null
      ? t('inviteNeverExpires')
      : t('inviteExpires', {
          date: new Intl.DateTimeFormat(getLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(invite.expiresAt),
        });
  return t('inviteSummary', { role: t(`role_${invite.role}`), uses, expiry });
}

function InviteSection({ link }: { link: ServerLink }) {
  const ctx = useAppContext();
  const id = useId();
  const workspaceId = ctx.workspace.info.id;
  const invites = useAsync(() => link.api.invites(workspaceId), [link.api, workspaceId]);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [expiry, setExpiry] = useState('7');
  const [uses, setUses] = useState('once');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await link.api.createInvite(workspaceId, {
        role,
        expiresInHours: expiry === 'never' ? null : Number(expiry) * 24,
        maxUses: uses === 'once' ? 1 : null,
      });
      setCreated(result.url ?? `${link.serverUrl}/?invite=${encodeURIComponent(result.token)}`);
      invites.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('inviteTitle')} description={t('inviteHint')} labelledBy={`${id}-invite`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-ui font-medium text-fg">
          {t('inviteRole')}
          <Select
            aria-label={t('inviteRole')}
            value={role}
            onValueChange={(value) => setRole(value === 'viewer' ? 'viewer' : 'editor')}
            options={[
              { value: 'editor', label: t('role_editor') },
              { value: 'viewer', label: t('role_viewer') },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-ui font-medium text-fg">
          {t('inviteExpiry')}
          <Select
            aria-label={t('inviteExpiry')}
            value={expiry}
            onValueChange={setExpiry}
            options={[
              { value: '1', label: t('expiry_1') },
              { value: '7', label: t('expiry_7') },
              { value: '30', label: t('expiry_30') },
              { value: 'never', label: t('expiry_never') },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-ui font-medium text-fg">
          {t('inviteUses')}
          <Select
            aria-label={t('inviteUses')}
            value={uses}
            onValueChange={setUses}
            options={[
              { value: 'once', label: t('usesOnce') },
              { value: 'unlimited', label: t('usesUnlimited') },
            ]}
          />
        </label>
      </div>
      <Button variant="primary" className="self-start" loading={busy} onClick={() => void create()}>
        {t('createInvite')}
      </Button>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {created ? (
        <div className="flex gap-2">
          <Input
            readOnly
            value={created}
            aria-label={t('inviteLink')}
            onFocus={(event) => event.target.select()}
          />
          <Button
            onClick={() =>
              void navigator.clipboard
                ?.writeText(created)
                .then(() => ctx.toast({ title: t('linkCopied') }))
            }
          >
            <Copy aria-hidden="true" />
            {t('copyLink')}
          </Button>
        </div>
      ) : null}
      {invites.status === 'error' ? (
        <LoadError error={invites.error} onRetry={invites.reload} />
      ) : null}
      {invites.data && invites.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-fg-subtle">{t('activeInvites')}</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {invites.data.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 px-3 py-2 text-ui">
                <span className="min-w-0 flex-1 text-fg-muted">{inviteSummary(invite)}</span>
                <IconButton
                  label={t('revokeInvite')}
                  icon={<Trash2 />}
                  onClick={() =>
                    void link.api
                      .revokeInvite(workspaceId, invite.id)
                      .then(() => {
                        ctx.toast({ title: t('inviteRevoked') });
                        invites.reload();
                      })
                      .catch((caught: unknown) => setError(errorMessage(caught)))
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function sessionLabel(session: ServerSession): string {
  return (
    session.deviceName ??
    describeUserAgent(session.userAgent) ??
    (session.kind === 'bearer' ? t('desktopApp') : t('webBrowser'))
  );
}

function DevicesSection({ link }: { link: ServerLink }) {
  const ctx = useAppContext();
  const id = useId();
  const now = useNow();
  const sessions = useAsync(() => link.api.sessions(), [link.api]);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title={t('devices')} description={t('devicesHint')} labelledBy={`${id}-devices`}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {sessions.status === 'loading' && !sessions.data ? <LoadingRows /> : null}
      {sessions.status === 'error' ? (
        <LoadError error={sessions.error} onRetry={sessions.reload} />
      ) : null}
      {sessions.data ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {sessions.data.map((session) => {
            const Icon = session.kind === 'bearer' ? Laptop : Monitor;
            const label = sessionLabel(session);
            return (
              <li key={session.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm text-fg">
                    {label}
                    {session.current ? <Badge tone="success">{t('thisDevice')}</Badge> : null}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {t('lastActive', { time: formatRelativeTime(session.lastSeenAt, now) })}
                  </p>
                </div>
                {!session.current ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void ctx
                        .confirm({
                          title: t('signOutDeviceConfirm'),
                          description: label,
                          confirmLabel: t('signOutDevice'),
                          destructive: true,
                        })
                        .then(async (confirmed) => {
                          if (!confirmed) return;
                          try {
                            await link.api.revokeSession(session.id);
                            ctx.toast({ title: t('signedOutDevice') });
                            sessions.reload();
                          } catch (caught) {
                            setError(errorMessage(caught));
                          }
                        })
                    }
                  >
                    {t('signOutDevice')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

function OtherWorkspaces({ link }: { link: ServerLink }) {
  const ctx = useAppContext();
  const id = useId();
  const list = useAsync(() => link.api.workspaces(), [link.api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = (list.data ?? []).filter((workspace) => workspace.id !== ctx.workspace.info.id);
  if (list.status === 'ready' && others.length === 0) return null;
  return (
    <Section title={t('otherWorkspaces')} labelledBy={`${id}-others`}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {list.status === 'loading' && !list.data ? <LoadingRows rows={1} /> : null}
      {list.status === 'error' ? <LoadError error={list.error} onRetry={list.reload} /> : null}
      {others.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {others.map((workspace) => (
            <li key={workspace.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{workspace.name}</span>
              <Badge tone={workspace.role === 'owner' ? 'accent' : 'neutral'}>
                {t(`role_${workspace.role}`)}
              </Badge>
              <Button
                size="sm"
                loading={busy === workspace.id}
                disabled={busy !== null}
                onClick={() => {
                  setBusy(workspace.id);
                  openServerWorkspace(ctx, link.api, workspace).catch((caught: unknown) => {
                    setError(errorMessage(caught));
                    setBusy(null);
                  });
                }}
              >
                {t('openAction')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function DangerZone({
  link,
  signedIn,
  onSignedOut,
}: {
  link: ServerLink;
  signedIn: boolean;
  onSignedOut(): void;
}) {
  const ctx = useAppContext();
  const id = useId();
  const server = displayServerUrl(link.serverUrl);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title={t('workspaceSection')} labelledBy={`${id}-danger`}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {signedIn ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-ui text-fg-muted">{t('signOutHint', { server })}</p>
          <Button
            onClick={() =>
              void ctx
                .confirm({
                  title: t('signOutConfirm', { server }),
                  description: t('signOutHint', { server }),
                  confirmLabel: t('signOut'),
                })
                .then(async (confirmed) => {
                  if (!confirmed) return;
                  try {
                    await link.api.logout();
                    onSignedOut();
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                })
            }
          >
            <LogOut aria-hidden="true" />
            {t('signOut')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-ui text-fg-muted">{t('disconnectHint')}</p>
        <Button
          variant="danger"
          onClick={() =>
            void ctx
              .confirm({
                title: t('disconnectConfirm', { server }),
                description: t('disconnectHint'),
                confirmLabel: t('disconnect'),
                destructive: true,
              })
              .then(async (confirmed) => {
                if (!confirmed) return;
                try {
                  await disconnectWorkspace(ctx);
                  ctx.toast({ title: t('disconnected') });
                } catch (caught) {
                  setError(errorMessage(caught));
                }
              })
          }
        >
          <Unplug aria-hidden="true" />
          {t('disconnect')}
        </Button>
      </div>
    </Section>
  );
}

/** A workspace that syncs with a server: status, account, people, invites and devices. */
export function ConnectedWorkspace({ link }: { link: ServerLink }) {
  const ctx = useAppContext();
  const [key, setKey] = useState(0);
  const me = useAsync(() => link.api.me(), [link.api, key]);
  const workspace = useAsync(
    () => (me.data ? link.api.workspace(ctx.workspace.info.id) : Promise.resolve(null)),
    [link.api, me.data, ctx.workspace.info.id],
  );
  const role = workspace.data?.role ?? null;
  const refresh = () => setKey((value) => value + 1);

  if (me.status === 'loading' && me.data === null && key === 0) {
    return (
      <div className="flex flex-col gap-8">
        <StatusCard link={link} me={null} memberRole={null} />
        <LoadingRows rows={3} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <StatusCard link={link} me={me.data} memberRole={role} />
      {me.status === 'error' ? <LoadError error={me.error} onRetry={me.reload} /> : null}
      {me.status === 'ready' && me.data === null ? (
        <Card className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">{t('signedOutTitle')}</h3>
            <p className="mt-0.5 text-ui text-fg-muted">{t('signedOutBody')}</p>
          </div>
          <SignInForm
            api={link.api}
            onSignedIn={(account) => {
              adoptAccount(ctx, account);
              link.provider?.retry();
              refresh();
            }}
          />
        </Card>
      ) : null}
      {me.data ? (
        <>
          <PeopleSection link={link} me={me.data} role={role} />
          {role === 'owner' ? <InviteSection link={link} /> : null}
          <DevicesSection link={link} />
          <OtherWorkspaces link={link} />
        </>
      ) : null}
      <DangerZone link={link} signedIn={me.data !== null} onSignedOut={refresh} />
    </div>
  );
}
