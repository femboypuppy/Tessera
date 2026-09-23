import {
  Button,
  Callout,
  Field,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tessera/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { ServerApi } from '../../client/api';
import type { Health, Me } from '../../client/schemas';
import { inviteTokenFrom } from '../../feature/invite-link';
import { t } from '../../i18n';
import { errorMessage } from './parts';

/** Runs a form submission with a busy state and an inline error. */
function useSubmit(run: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function FormError({ error }: { error: string | null }) {
  return error ? <Callout tone="danger">{error}</Callout> : null;
}

function Form({
  onSubmit,
  children,
  label,
}: {
  onSubmit: (event: FormEvent) => void | Promise<void>;
  children: ReactNode;
  label: string;
}) {
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      {children}
    </form>
  );
}

/** First run: create the owner account with the setup code from the server log. */
export function SetupForm({ api, onSignedIn }: { api: ServerApi; onSignedIn(me: Me): void }) {
  const [setupCode, setSetupCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const result = await api.setup({ setupCode, name, email, password });
    onSignedIn(result);
  });
  return (
    <Form label={t('setupTitle')} onSubmit={submit}>
      <div>
        <h4 className="text-sm font-semibold text-fg">{t('setupTitle')}</h4>
        <p className="mt-0.5 text-ui text-fg-muted">{t('setupBody')}</p>
      </div>
      <Field label={t('setupCode')} description={t('setupCodeHint')}>
        {(props) => (
          <Input
            {...props}
            value={setupCode}
            onChange={(event) => setSetupCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            className="font-mono uppercase"
          />
        )}
      </Field>
      <Field label={t('name')}>
        {(props) => (
          <Input
            {...props}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            maxLength={80}
          />
        )}
      </Field>
      <Field label={t('email')}>
        {(props) => (
          <Input
            {...props}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        )}
      </Field>
      <Field label={t('password')} description={t('passwordHint')}>
        {(props) => (
          <Input
            {...props}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="primary" loading={busy} className="self-start">
        {t('createOwner')}
      </Button>
    </Form>
  );
}

export function SignInForm({ api, onSignedIn }: { api: ServerApi; onSignedIn(me: Me): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    onSignedIn(await api.login({ email, password }));
  });
  return (
    <Form label={t('signIn')} onSubmit={submit}>
      <Field label={t('email')}>
        {(props) => (
          <Input
            {...props}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        )}
      </Field>
      <Field label={t('password')}>
        {(props) => (
          <Input
            {...props}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="primary" loading={busy} className="self-start">
        {t('signIn')}
      </Button>
    </Form>
  );
}

export function SignUpForm({
  api,
  health,
  invite,
  onSignedIn,
}: {
  api: ServerApi;
  health: Health;
  invite: string | null;
  onSignedIn(me: Me): void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteLink, setInviteLink] = useState(invite ?? '');
  const needsInvite = health.signupMode === 'invite';
  const { busy, error, submit } = useSubmit(async () => {
    const inviteToken = inviteLink ? inviteTokenFrom(inviteLink) : null;
    if (inviteLink && !inviteToken) throw new Error(t('inviteInvalid'));
    const result = await api.signup({
      name,
      email,
      password,
      ...(inviteToken ? { inviteToken } : {}),
    });
    onSignedIn(result);
  });
  if (health.signupMode === 'closed') return <Callout tone="info">{t('signupClosed')}</Callout>;
  return (
    <Form label={t('createAccount')} onSubmit={submit}>
      <Field label={t('name')}>
        {(props) => (
          <Input
            {...props}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            maxLength={80}
          />
        )}
      </Field>
      <Field label={t('email')}>
        {(props) => (
          <Input
            {...props}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        )}
      </Field>
      <Field label={t('password')} description={t('passwordHint')}>
        {(props) => (
          <Input
            {...props}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>
      {needsInvite && !invite ? (
        <Field label={t('inviteLink')} description={t('inviteLinkHint')}>
          {(props) => (
            <Input
              {...props}
              value={inviteLink}
              onChange={(event) => setInviteLink(event.target.value)}
              autoComplete="off"
              required
            />
          )}
        </Field>
      ) : null}
      <FormError error={error} />
      <Button type="submit" variant="primary" loading={busy} className="self-start">
        {t('createAccount')}
      </Button>
    </Form>
  );
}

/** Sign in or create an account (per the server's sign-up mode). */
export function AccountTabs({
  api,
  health,
  invite,
  onSignedIn,
}: {
  api: ServerApi;
  health: Health;
  invite: string | null;
  onSignedIn(me: Me): void;
}) {
  if (health.setupRequired) return <SetupForm api={api} onSignedIn={onSignedIn} />;
  return (
    <Tabs defaultValue={invite && health.signupMode !== 'closed' ? 'signup' : 'signin'}>
      <TabsList>
        <TabsTrigger value="signin">{t('signInTab')}</TabsTrigger>
        {health.signupMode !== 'closed' ? (
          <TabsTrigger value="signup">{t('signUpTab')}</TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="signin" className="pt-4">
        <SignInForm api={api} onSignedIn={onSignedIn} />
      </TabsContent>
      <TabsContent value="signup" className="pt-4">
        <SignUpForm api={api} health={health} invite={invite} onSignedIn={onSignedIn} />
      </TabsContent>
    </Tabs>
  );
}
