import { Button, Field, Input } from '@tessera/ui';
import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { t } from '../i18n';
import { LogoMark } from './LogoMark';
import { useWorkspaceControl } from './WorkspaceRoot';

/**
 * First run: create an empty workspace, or start with an action a feature contributes (import
 * from Notion, open the demo workspace). Actions that are not registered simply do not appear.
 */
export function Onboarding() {
  const control = useWorkspaceControl();
  const [name, setName] = useState(() => t('defaultWorkspaceName'));
  const [busy, setBusy] = useState<string | null>(null);
  const actions = control.runtime.features
    .flatMap((feature) => feature.onboardingActions ?? [])
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const createEmpty = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('empty');
    try {
      await control.create(name.trim() || t('defaultWorkspaceName'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg-subtle px-4 py-10">
      <div className="w-full max-w-md animate-pop-in">
        <LogoMark className="size-11" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-fg">{t('welcomeTitle')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t('welcomeBody')}</p>
        <form
          onSubmit={(event) => void createEmpty(event)}
          className="mt-8 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-subtle"
        >
          <Field label={t('workspaceNameLabel')}>
            {(props) => (
              <Input
                {...props}
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy === 'empty'}
            disabled={busy !== null}
          >
            {t('createEmptyWorkspace')}
            <ArrowRight aria-hidden="true" />
          </Button>
        </form>
        {actions.length > 0 ? (
          <section className="mt-6" aria-labelledby="onboarding-actions">
            <h2 id="onboarding-actions" className="mb-2 text-xs font-medium text-fg-subtle">
              {t('orStartWith')}
            </h2>
            <div className="flex flex-col gap-2">
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(action.id);
                      void control
                        .create(action.workspaceName, action)
                        .finally(() => setBusy(null));
                    }}
                    className="duration-fast flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left shadow-subtle transition-colors hover:bg-hover disabled:opacity-60"
                  >
                    {Icon ? <Icon className="size-5 text-fg-muted" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{action.title}</span>
                      {action.description ? (
                        <span className="block text-ui text-fg-muted">{action.description}</span>
                      ) : null}
                    </span>
                    <ArrowRight className="size-4 text-fg-subtle" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
