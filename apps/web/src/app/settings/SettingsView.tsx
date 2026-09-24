import { SERVICE_PHASES, SETTING_KEYS, USER_COLORS, type ServiceKey } from '@tessera/core';
import { useAppContext, useContributions, useCurrentUser, useSetting } from '@tessera/core/react';
import {
  Button,
  cn,
  ColorSwatches,
  EmptyState,
  FeatureBoundary,
  Field,
  Input,
  Label,
  RadioCard,
  RadioGroup,
  Select,
  Separator,
} from '@tessera/ui';
import {
  FolderMinus,
  Info,
  Keyboard,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { availableLocales, localeName, t } from '../../i18n';
import { ShortcutList } from '../shortcuts/ShortcutsDialog';
import { getThemePreference } from '../theme';
import { useWorkspaceControl } from '../WorkspaceRoot';

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-ui text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function GeneralSettings() {
  const ctx = useAppContext();
  const control = useWorkspaceControl();
  const user = useCurrentUser();
  const [theme, setTheme] = useSetting<string>(
    ctx.settings.device,
    SETTING_KEYS.theme,
    getThemePreference(ctx.settings.device),
  );
  const [name, setName] = useState(user.name);
  const [workspaceName, setWorkspaceName] = useState(control.current?.name ?? '');
  const locales = availableLocales();
  const [language] = useSetting<string>(
    ctx.settings.device,
    SETTING_KEYS.language,
    locales.includes(document.documentElement.lang) ? document.documentElement.lang : 'en',
  );

  const currentWorkspaceName = control.current?.name ?? '';
  useEffect(() => setWorkspaceName(currentWorkspaceName), [currentWorkspaceName]);

  const commitWorkspaceName = () => {
    const current = control.current;
    if (current && workspaceName.trim() && workspaceName.trim() !== current.name)
      void control.rename(current.id, workspaceName.trim());
  };

  // A folder workspace (the desktop app) is only forgotten: the registry never deletes a folder.
  const inFolder = Boolean(control.current?.path);
  const removeWorkspace = async () => {
    const current = control.current;
    if (!current) return;
    const confirmed = await ctx.confirm(
      inFolder
        ? {
            title: t('removeFolderWorkspaceConfirm', { name: current.name }),
            description: t('removeFolderWorkspaceHint'),
            confirmLabel: t('removeFolderWorkspace'),
          }
        : {
            title: t('deleteWorkspaceConfirm', { name: current.name }),
            description: t('deleteWorkspaceHint'),
            confirmLabel: t('deleteWorkspace'),
            destructive: true,
          },
    );
    if (confirmed) await control.remove(current.id);
  };

  return (
    <div className="flex flex-col gap-10">
      <Section title={t('appearance')}>
        <div className="flex flex-col gap-2">
          <Label id="theme-label">{t('theme')}</Label>
          <RadioGroup
            aria-labelledby="theme-label"
            value={theme}
            onValueChange={(value) => setTheme(value)}
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            <RadioCard value="light" label={t('themeLight')} icon={<Sun />} />
            <RadioCard value="dark" label={t('themeDark')} icon={<Moon />} />
            <RadioCard
              value="system"
              label={t('themeSystem')}
              description={t('themeSystemHint')}
              icon={<Monitor />}
            />
          </RadioGroup>
        </div>
        <Field label={t('language')} description={t('languageHint')}>
          {(props) => (
            <Select
              id={props.id}
              aria-describedby={props['aria-describedby']}
              value={language}
              disabled={locales.length < 2}
              onValueChange={(value) => {
                ctx.settings.device.set(SETTING_KEYS.language, value);
                window.location.reload();
              }}
              options={locales.map((locale) => ({ value: locale, label: localeName(locale) }))}
              className="max-w-xs"
            />
          )}
        </Field>
      </Section>
      <Separator />
      <Section title={t('profile')}>
        <Field label={t('displayName')} description={t('displayNameHint')}>
          {(props) => (
            <Input
              {...props}
              value={name}
              maxLength={80}
              className="max-w-xs"
              onChange={(event) => setName(event.target.value)}
              onBlur={() => control.runtime.updateCurrentUser({ name })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') control.runtime.updateCurrentUser({ name });
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <Label id="color-label">{t('presenceColor')}</Label>
          <ColorSwatches
            label={t('presenceColor')}
            colors={USER_COLORS}
            value={user.color}
            onChange={(color) => control.runtime.updateCurrentUser({ color })}
          />
        </div>
      </Section>
      <Separator />
      <Section title={t('workspace')}>
        <Field label={t('workspaceName')}>
          {(props) => (
            <Input
              {...props}
              value={workspaceName}
              maxLength={100}
              className="max-w-xs"
              onChange={(event) => setWorkspaceName(event.target.value)}
              onBlur={commitWorkspaceName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitWorkspaceName();
              }}
            />
          )}
        </Field>
        <div>
          <Button
            variant={inFolder ? 'secondary' : 'danger'}
            onClick={() => void removeWorkspace()}
          >
            {inFolder ? <FolderMinus aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {t(inFolder ? 'removeFolderWorkspace' : 'deleteWorkspace')}
          </Button>
          <p className="mt-2 text-xs text-fg-muted">
            {t(inFolder ? 'removeFolderWorkspaceHint' : 'deleteWorkspaceHint')}
          </p>
        </div>
      </Section>
      <Separator />
      <Section title={t('about')}>
        <div>
          <h3 className="mb-2 text-ui font-medium text-fg">{t('aboutServices')}</h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-ui">
            {(Object.keys(SERVICE_PHASES) as ServiceKey[]).map((key) => (
              <div key={key} className="contents">
                <dt className="font-mono text-fg-muted">{key}</dt>
                <dd className="font-mono text-fg">{ctx.serviceSources[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>
    </div>
  );
}

/** `/settings/*`: the General section, feature settings panels and keyboard shortcuts. */
export function SettingsView() {
  const params = useParams();
  const navigate = useNavigate();
  const section = params['*'] || 'general';
  const panels = useContributions('settingsPanels');
  const nav = [
    {
      id: 'general',
      title: t('general'),
      icon: SlidersHorizontal,
      featureId: null as string | null,
    },
    ...panels.map((panel) => ({
      id: panel.id,
      title: panel.title,
      icon: panel.icon ?? Info,
      featureId: panel.featureId,
    })),
    { id: 'shortcuts', title: t('keyboardShortcuts'), icon: Keyboard, featureId: null },
  ];
  const panel = panels.find((candidate) => candidate.id === section);
  let content: ReactNode;
  if (section === 'general') content = <GeneralSettings />;
  else if (section === 'shortcuts') content = <ShortcutList />;
  else if (panel) {
    const Panel = panel.component;
    content = (
      <FeatureBoundary featureId={panel.featureId} resetKeys={[panel.id]}>
        <Panel />
      </FeatureBoundary>
    );
  } else {
    content = <EmptyState icon={<Info />} title={t('settingsNotFound')} />;
  }
  const current = nav.find((item) => item.id === section);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:flex-row md:gap-10 md:px-8">
      <nav aria-label={t('settingsTitle')} className="shrink-0 md:w-52">
        <h1 className="mb-3 px-2 text-2xl font-semibold tracking-tight">{t('settingsTitle')}</h1>
        <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() =>
                    void navigate(item.id === 'general' ? '/settings' : `/settings/${item.id}`)
                  }
                  className={cn(
                    'duration-fast flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap transition-colors',
                    active
                      ? 'bg-active font-medium text-fg'
                      : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        {current && current.id !== 'general' ? (
          <h2 className="mb-6 text-lg font-semibold">{current.title}</h2>
        ) : null}
        {content}
      </div>
    </div>
  );
}
