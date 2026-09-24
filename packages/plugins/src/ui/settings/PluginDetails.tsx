import {
  pluginBlockKind,
  type DocJSON,
  type JsonValue,
  type PluginPermission,
} from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Badge,
  Button,
  Callout,
  KeyCombo,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tessera/ui';
import { formatShortcut } from '@tessera/core';
import { ArrowLeft, ExternalLink, Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { pluginCommandId } from '../../constants';
import type { PluginInstance } from '../../host/instance';
import type { PluginHost } from '../../host/plugin-host';
import { pluginConsoles } from '../../host/registry';
import { t } from '../../i18n';
import type { PluginManager } from '../../manager';
import { describePermission, sortPermissionsByRisk } from '../../manifest';
import type { InstalledPlugin } from '../../store/types';
import { SurfaceFrame } from '../SurfaceFrame';
import { usePluginConsoleVersion } from './console-hooks';
import { ConsoleView } from './ConsoleView';
import { PermissionSummary, PluginIcon, StatusLabel } from './parts';
import { ReadmeView } from './ReadmeView';
import { SettingsForm } from './SettingsForm';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function sourceText(plugin: InstalledPlugin): string {
  const { source } = plugin;
  switch (source.kind) {
    case 'file':
      return t('sourceFile', { name: source.name ?? '' });
    case 'folder':
      return t('sourceFolder', { name: source.name ?? '' });
    case 'registry':
      return t('sourceRegistry');
    case 'dev':
      return t('sourceDev', { url: source.url ?? '' });
    case 'url':
      return t('sourceUrl', { url: source.url ?? '' });
  }
}

/** A live preview of a plugin block, created the way the slash menu creates it. */
function BlockPreview({
  instance,
  pluginId,
  type,
  fallbackData,
  title,
}: {
  instance: PluginInstance;
  pluginId: string;
  type: string;
  fallbackData: JsonValue | undefined;
  title: string;
}) {
  const ctx = useAppContext();
  const [data, setData] = useState<JsonValue | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const kind = pluginBlockKind(pluginId, type);
    const item = ctx.blocks.slashMenuItems().find((candidate) => candidate.id === kind);
    void Promise.resolve(
      item?.create({ app: ctx, pageId: ctx.getCurrentPageId() ?? '' }) ?? null,
    ).then((embed) => {
      if (active) setData(embed?.data ?? fallbackData ?? null);
    });
    return () => {
      active = false;
    };
  }, [ctx, pluginId, type, fallbackData]);
  if (data === undefined) return null;
  return (
    <div className="mt-3" data-block-preview={`${pluginId}/${type}`}>
      <SurfaceFrame
        instance={instance}
        generation={instance.generation}
        surface={{
          kind: 'block',
          type,
          pageId: ctx.getCurrentPageId() ?? '',
          blockId: null,
          data,
          readOnly: false,
          selected: false,
        }}
        title={title}
        heightKey={`preview:${pluginId}/${type}`}
        onSetData={(next) => setData(next)}
      />
    </div>
  );
}

function Contributions({
  plugin,
  instance,
}: {
  plugin: InstalledPlugin;
  instance: PluginInstance | undefined;
}) {
  const ctx = useAppContext();
  const [preview, setPreview] = useState<string | null>(null);
  if (!instance || instance.status !== 'running') return null;
  const commands = instance.registeredCommands;
  const panels = instance.registeredPanels;
  const blocks = instance.registeredBlocks;
  if (!commands.length && !panels.length && !blocks.length)
    return <p className="text-ui text-fg-muted">{t('nothingContributed')}</p>;
  return (
    <div className="flex flex-col gap-5">
      {blocks.length ? (
        <section>
          <h4 className="mb-2 text-ui font-medium text-fg-muted">{t('blocksTitle')}</h4>
          <ul className="flex flex-col gap-2">
            {blocks.map((block) => (
              <li
                key={block.type}
                className="rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <PluginIcon icon={block.icon ?? plugin.manifest.icon} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{block.title}</p>
                    <p className="text-xs text-fg-muted">
                      {block.description ?? t('blockPreviewHint')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    aria-expanded={preview === block.type}
                    onClick={() => setPreview(preview === block.type ? null : block.type)}
                  >
                    {preview === block.type ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                    {preview === block.type ? t('hidePreview') : t('previewBlock')}
                  </Button>
                </div>
                {preview === block.type ? (
                  <BlockPreview
                    instance={instance}
                    pluginId={plugin.id}
                    type={block.type}
                    fallbackData={block.initialData}
                    title={t('blockFrameTitle', {
                      title: block.title,
                      plugin: plugin.manifest.name,
                    })}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {panels.length ? (
        <section>
          <h4 className="mb-2 text-ui font-medium text-fg-muted">{t('panelsTitle')}</h4>
          <ul className="flex flex-col gap-1.5">
            {panels.map((panel) => (
              <li key={panel.id} className="flex items-center gap-2 text-sm">
                <span aria-hidden="true">{panel.icon ?? plugin.manifest.icon ?? '🧩'}</span>
                {panel.title}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {commands.length ? (
        <section>
          <h4 className="mb-2 text-ui font-medium text-fg-muted">{t('commandsTitle')}</h4>
          <ul className="flex flex-col gap-1.5">
            {commands.map((id) => {
              const command = ctx.commands.get(pluginCommandId(plugin.id, id));
              if (!command) return null;
              const shortcut =
                typeof command.shortcut === 'string' ? command.shortcut : command.shortcut?.[0];
              return (
                <li key={id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{command.title}</span>
                  {shortcut ? (
                    <KeyCombo keys={formatShortcut(shortcut, ctx.platform.isApple)} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function About({ plugin, manager }: { plugin: InstalledPlugin; manager: PluginManager }) {
  const ctx = useAppContext();
  const [usage, setUsage] = useState<{ keys: number; bytes: number } | null>(null);
  const [readme, setReadme] = useState<DocJSON | null>(null);
  useEffect(() => {
    let active = true;
    void manager.storageUsage(plugin.id).then((value) => {
      if (active) setUsage(value);
    });
    void manager.getCode(plugin.id).then((code) => {
      if (!active || !code?.readme) return;
      try {
        setReadme(ctx.services.markdownCodec.parse(code.readme).doc);
      } catch {
        // A README the codec can't read is left out; the plugin itself is fine.
        setReadme(null);
      }
    });
    return () => {
      active = false;
    };
  }, [ctx, manager, plugin.id, plugin.updatedAt]);
  const { manifest } = plugin;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-ui">
        <Row label={t('aboutId')}>
          <code className="font-mono text-xs">{plugin.id}</code>
        </Row>
        <Row label={t('aboutSource')}>{sourceText(plugin)}</Row>
        <Row label={t('aboutInstalled')}>{dateFormat.format(plugin.installedAt)}</Row>
        {plugin.updatedAt !== plugin.installedAt ? (
          <Row label={t('aboutUpdated')}>{dateFormat.format(plugin.updatedAt)}</Row>
        ) : null}
        <Row label={t('aboutApi')}>{manifest.apiVersion}</Row>
        {usage ? <Row label={t('aboutStorage')}>{formatBytes(usage.bytes)}</Row> : null}
      </dl>
      {manifest.homepage || manifest.repository ? (
        <div className="flex flex-wrap gap-2">
          {manifest.homepage ? (
            <Button asChild size="sm">
              <a href={manifest.homepage} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {t('homepage')}
              </a>
            </Button>
          ) : null}
          {manifest.repository ? (
            <Button asChild size="sm">
              <a href={manifest.repository} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {t('repository')}
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
      {readme ? (
        <section className="border-t border-border pt-4">
          <h4 className="mb-2 text-ui font-medium text-fg-muted">{t('aboutReadme')}</h4>
          <ReadmeView doc={readme} pluginName={manifest.name} />
        </section>
      ) : null}
    </div>
  );
}

function Permissions({ plugin, manager }: { plugin: InstalledPlugin; manager: PluginManager }) {
  const permissions = sortPermissionsByRisk(plugin.manifest.permissions);
  if (!permissions.length)
    return (
      <p className="text-ui text-fg-muted">
        {t('noPermissions', { plugin: plugin.manifest.name })}
      </p>
    );
  const toggle = (permission: PluginPermission, granted: boolean) =>
    void manager.setPermission(plugin.id, permission, granted);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui text-fg-muted">
        {t('permissionsIntro', { plugin: plugin.manifest.name })}
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {permissions.map((permission) => (
          <li
            key={permission}
            className="flex items-start gap-4 px-3 py-3"
            data-permission={permission}
          >
            <div className="min-w-0 flex-1">
              <PermissionSummary permission={permission} />
            </div>
            <Switch
              className="mt-1"
              checked={plugin.granted.includes(permission)}
              aria-label={describePermission(permission).title}
              onCheckedChange={(checked) => toggle(permission, checked)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One installed plugin: status, what it adds, settings, permissions, console, uninstall. */
export function PluginDetails({
  plugin,
  manager,
  host,
  onBack,
  initialTab,
}: {
  plugin: InstalledPlugin;
  manager: PluginManager;
  host: PluginHost | undefined;
  onBack(): void;
  initialTab?: string;
}) {
  const ctx = useAppContext();
  usePluginConsoleVersion();
  const instance = host?.instance(plugin.id);
  const problems = pluginConsoles.problems(plugin.id);
  const dev = plugin.source.kind === 'dev' ? host?.devStatus(plugin.id) : undefined;
  const [tab, setTab] = useState(initialTab ?? 'overview');
  const { manifest } = plugin;

  const uninstall = async () => {
    const confirmed = await ctx.confirm({
      title: t('uninstallConfirmTitle', { plugin: manifest.name }),
      description: t('uninstallConfirmText'),
      confirmLabel: t('uninstall'),
      destructive: true,
    });
    if (!confirmed) return;
    await manager.uninstall(plugin.id);
    ctx.toast({ title: t('uninstalled', { plugin: manifest.name }) });
    onBack();
  };

  return (
    <div className="flex flex-col gap-6" data-plugin-details={plugin.id}>
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t('allPlugins')}
        </Button>
      </div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <PluginIcon icon={manifest.icon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-lg font-semibold text-fg">{manifest.name}</h3>
            <span className="text-ui text-fg-subtle">
              {t('version', { version: manifest.version })}
            </span>
            {plugin.source.kind === 'dev' ? <Badge tone="purple">{t('devBadge')}</Badge> : null}
          </div>
          <p className="text-ui text-fg-muted">{t('byAuthor', { author: manifest.author })}</p>
          {manifest.description ? (
            <p className="mt-2 max-w-prose text-sm text-fg">{manifest.description}</p>
          ) : null}
          <StatusLabel status={instance?.status} enabled={plugin.enabled} className="mt-2" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={plugin.enabled}
            aria-label={t('enablePlugin', { plugin: manifest.name })}
            onCheckedChange={(checked) => void manager.setEnabled(plugin.id, checked)}
          />
          {plugin.enabled ? (
            <Button size="sm" onClick={() => void host?.restart(plugin.id)}>
              <RotateCcw aria-hidden="true" />
              {t('restart')}
            </Button>
          ) : null}
          <Button size="sm" variant="danger" onClick={() => void uninstall()}>
            <Trash2 aria-hidden="true" />
            {t('uninstall')}
          </Button>
        </div>
      </header>
      {instance?.error && (instance.status === 'crashed' || instance.status === 'error') ? (
        <Callout tone="danger" title={t('pluginStopped', { plugin: manifest.name })}>
          {instance.error}
        </Callout>
      ) : null}
      {dev ? (
        <Callout tone={dev.state === 'unreachable' ? 'warning' : 'info'}>
          {dev.state === 'unreachable'
            ? t('devUnreachable', { message: dev.message })
            : dev.state === 'reloaded'
              ? `${t('devWatching')} ${t('devReloaded', { time: new Date(dev.reloadedAt).toLocaleTimeString() })}`
              : t('devWatching')}
        </Callout>
      ) : null}
      <Separator />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="overview">{t('contributesTitle')}</TabsTrigger>
          <TabsTrigger value="settings">{t('tabSettings')}</TabsTrigger>
          <TabsTrigger value="permissions">{t('tabPermissions')}</TabsTrigger>
          <TabsTrigger value="console">
            {t('tabConsole')}
            {problems ? <Badge tone="warning">{problems}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="about">{t('tabAbout')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-5">
          <Contributions plugin={plugin} instance={instance} />
          {!instance || instance.status !== 'running' ? (
            <p className="text-ui text-fg-muted">{t('nothingContributed')}</p>
          ) : null}
        </TabsContent>
        <TabsContent value="settings" className="pt-5">
          <SettingsForm plugin={plugin} manager={manager} />
        </TabsContent>
        <TabsContent value="permissions" className="pt-5">
          <Permissions plugin={plugin} manager={manager} />
        </TabsContent>
        <TabsContent value="console" className="pt-5">
          <ConsoleView pluginId={plugin.id} pluginName={manifest.name} />
        </TabsContent>
        <TabsContent value="about" className="pt-5">
          <About plugin={plugin} manager={manager} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
