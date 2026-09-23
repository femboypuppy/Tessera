import { useAppContext } from '@tessera/core/react';
import { Badge, Button, Callout, EmptyState, Field, Input } from '@tessera/ui';
import {
  ArrowLeft,
  ArrowRight,
  CloudUpload,
  FolderOpen,
  HardDrive,
  Mail,
  Server,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { InvitePreview, Me, ServerWorkspace } from '../../client/schemas';
import { displayServerUrl } from '../../client/server-url';
import {
  clearPendingInvite,
  inviteServer,
  inviteTokenFrom,
  pendingInvite,
} from '../../feature/invite-link';
import { healthSchema } from '../../client/schemas';
import { t } from '../../i18n';
import { useAsync } from '../hooks';
import { AccountTabs } from './AccountForms';
import {
  adoptAccount,
  checkServer,
  openServerWorkspace,
  uploadWorkspace,
  type ServerCheck,
} from './actions';
import { Card, errorMessage, LoadError, LoadingRows } from './parts';

type Connected = Extract<ServerCheck, { ok: true }>;

type Step =
  | { kind: 'intro' }
  | { kind: 'server' }
  | { kind: 'account'; server: Connected }
  | { kind: 'choose'; server: Connected; me: Me; invited: ServerWorkspace | null };

/** Whether the app itself is served by a Tessera server (then its address is the default). */
function useServedByServer(): string | null {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/health', { credentials: 'omit' })
      .then((response) => response.json())
      .then((json: unknown) => {
        if (active && healthSchema.safeParse(json).success) setOrigin(window.location.origin);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return origin;
}

function ServerStep({
  onBack,
  onConnected,
}: {
  onBack(): void;
  onConnected(server: Connected): Promise<void>;
}) {
  const ctx = useAppContext();
  const served = useServedByServer();
  const invite = pendingInvite();
  const [address, setAddress] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!touched && served) setAddress(displayServerUrl(served));
  }, [served, touched]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await checkServer(ctx, inviteServer(address) ?? address);
      if (result.ok) await onConnected(result);
      else setError(result.message);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={t('connectToServer')}
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
    >
      <Field label={t('serverAddress')} description={t('serverAddressHint')}>
        {(props) => (
          <Input
            {...props}
            value={address}
            onChange={(event) => {
              setTouched(true);
              setAddress(event.target.value);
            }}
            placeholder="notes.example.com"
            autoComplete="url"
            inputMode="url"
            spellCheck={false}
            required
          />
        )}
      </Field>
      {served && !touched ? <Callout tone="info">{t('servedHere')}</Callout> : null}
      {invite && !served ? <Callout tone="info">{t('inviteLinkHint')}</Callout> : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {t('continue')}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

function InviteCard({ preview }: { preview: InvitePreview }) {
  const role = t(`roleWord_${preview.role}`);
  return (
    <div className="flex gap-3 rounded-lg bg-accent-subtle px-3 py-2.5 text-ui">
      <Mail className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden="true" />
      <div>
        <p className="font-medium text-fg">
          {t('invitedTitle', { workspace: preview.workspace.name })}
        </p>
        <p className="text-fg-muted">
          {preview.invitedBy
            ? t('invitedBody', { inviter: preview.invitedBy, role })
            : t('invitedBodyAnonymous', { role })}
        </p>
      </div>
    </div>
  );
}

function AccountStep({
  server,
  onBack,
  onSignedIn,
}: {
  server: Connected;
  onBack(): void;
  onSignedIn(me: Me, invited: ServerWorkspace | null): void;
}) {
  const ctx = useAppContext();
  const invite = pendingInvite();
  const preview = useAsync(
    () => (invite ? server.api.previewInvite(invite) : Promise.resolve(null)),
    [server.api, invite],
  );
  const [error, setError] = useState<string | null>(null);

  const signedIn = async (me: Me) => {
    adoptAccount(ctx, me);
    let invited: ServerWorkspace | null = null;
    const token = invite ? inviteTokenFrom(invite) : null;
    if (token) {
      try {
        invited = await server.api.acceptInvite(token);
      } catch (caught) {
        setError(errorMessage(caught));
      }
      clearPendingInvite();
    }
    onSignedIn(me, invited);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1.5 text-ui text-fg-muted">
        <Server className="size-3.5" aria-hidden="true" />
        {t('connectedTo', { server: displayServerUrl(server.serverUrl) })}
      </p>
      {preview.status === 'ready' && preview.data ? <InviteCard preview={preview.data} /> : null}
      {error ? <Callout tone="warning">{error}</Callout> : null}
      <AccountTabs
        api={server.api}
        health={server.health}
        invite={invite}
        onSignedIn={(me) => void signedIn(me)}
      />
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {t('back')}
      </Button>
    </div>
  );
}

function ChooseStep({
  server,
  me,
  invited,
  onBack,
}: {
  server: Connected;
  me: Me;
  invited: ServerWorkspace | null;
  onBack(): void;
}) {
  const ctx = useAppContext();
  const list = useAsync(() => server.api.workspaces(), [server.api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  };
  const others = (list.data ?? [])
    .filter((workspace) => workspace.id !== ctx.workspace.info.id)
    .sort((a, b) =>
      a.id === invited?.id ? -1 : b.id === invited?.id ? 1 : a.name.localeCompare(b.name),
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui text-fg-muted">
        {t('signedInAs', { name: me.user.name, email: me.user.email })}
      </p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!invited ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
          <CloudUpload className="size-5 shrink-0 text-accent-text" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              {t('uploadTitle', { name: ctx.workspace.info.name })}
            </p>
            <p className="text-ui text-fg-muted">{t('uploadBody')}</p>
          </div>
          <Button
            variant="primary"
            loading={busy === 'upload'}
            disabled={busy !== null}
            onClick={() => void run('upload', () => uploadWorkspace(ctx, server.api))}
          >
            {t('uploadAction')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-medium text-fg">{t('openTitle')}</p>
          <p className="text-ui text-fg-muted">{t('openBody')}</p>
        </div>
        {list.status === 'loading' && !list.data ? <LoadingRows /> : null}
        {list.status === 'error' ? <LoadError error={list.error} onRetry={list.reload} /> : null}
        {list.data && others.length === 0 ? (
          <EmptyState icon={<FolderOpen />} title={t('noServerWorkspaces')} className="py-6" />
        ) : null}
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
                  variant={workspace.id === invited?.id ? 'primary' : 'secondary'}
                  loading={busy === workspace.id}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(workspace.id, () => openServerWorkspace(ctx, server.api, workspace))
                  }
                >
                  {workspace.id === invited?.id ? t('openInvited') : t('openAction')}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {t('back')}
      </Button>
    </div>
  );
}

/** A local workspace: explains where it lives and connects it to a server. */
export function ConnectFlow({ autoStart = false }: { autoStart?: boolean }) {
  const ctx = useAppContext();
  const [step, setStep] = useState<Step>(() =>
    autoStart || pendingInvite() ? { kind: 'server' } : { kind: 'intro' },
  );
  const connected = async (server: Connected) => {
    if (!server.me) {
      setStep({ kind: 'account', server });
      return;
    }
    // Already signed in there: use a pending invite right away.
    adoptAccount(ctx, server.me);
    let invited: ServerWorkspace | null = null;
    const token = pendingInvite();
    if (token) {
      invited = await server.api.acceptInvite(token).catch(() => null);
      clearPendingInvite();
    }
    setStep({ kind: 'choose', server, me: server.me, invited });
  };
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-fg-muted [&_svg]:size-5">
          <HardDrive aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{t('localTitle')}</h3>
          <p className="mt-0.5 text-ui text-fg-muted">{t('localBody')}</p>
        </div>
      </div>
      {step.kind === 'intro' ? (
        <Button
          variant="primary"
          className="self-start"
          onClick={() => setStep({ kind: 'server' })}
        >
          {t('connectToServer')}
        </Button>
      ) : null}
      {step.kind === 'server' ? (
        <ServerStep onBack={() => setStep({ kind: 'intro' })} onConnected={connected} />
      ) : null}
      {step.kind === 'account' ? (
        <AccountStep
          server={step.server}
          onBack={() => setStep({ kind: 'server' })}
          onSignedIn={(me, invited) =>
            setStep({ kind: 'choose', server: step.server, me, invited })
          }
        />
      ) : null}
      {step.kind === 'choose' ? (
        <ChooseStep
          server={step.server}
          me={step.me}
          invited={step.invited}
          onBack={() => setStep({ kind: 'server' })}
        />
      ) : null}
    </Card>
  );
}
