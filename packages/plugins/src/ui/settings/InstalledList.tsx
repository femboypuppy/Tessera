import { Badge, Button, EmptyState, Switch } from '@tessera/ui';
import { ChevronRight, Puzzle } from 'lucide-react';
import type { PluginHost } from '../../host/plugin-host';
import { pluginConsoles } from '../../host/registry';
import { t } from '../../i18n';
import type { PluginManager } from '../../manager';
import type { InstalledPlugin } from '../../store/types';
import { usePluginConsoleVersion } from './console-hooks';
import { PluginIcon, StatusLabel } from './parts';

/** What a running plugin adds, as a short line ("1 panel · 2 commands"). */
export function contributionSummary(host: PluginHost | undefined, id: string): string {
  const instance = host?.instance(id);
  if (!instance || instance.status !== 'running') return '';
  const parts: string[] = [];
  if (instance.registeredPanels.length)
    parts.push(t('panelsCount', { count: instance.registeredPanels.length }));
  if (instance.registeredBlocks.length)
    parts.push(t('blocksCount', { count: instance.registeredBlocks.length }));
  if (instance.registeredCommands.length)
    parts.push(t('commandsCount', { count: instance.registeredCommands.length }));
  return parts.join(' · ');
}

/** The installed plugins, each with its status and an on/off switch. */
export function InstalledList({
  plugins,
  manager,
  host,
  onOpen,
  onBrowse,
  onInstallFile,
}: {
  plugins: readonly InstalledPlugin[];
  manager: PluginManager;
  host: PluginHost | undefined;
  onOpen(id: string): void;
  onBrowse(): void;
  onInstallFile(): void;
}) {
  usePluginConsoleVersion();
  if (!plugins.length) {
    return (
      <EmptyState
        icon={<Puzzle />}
        title={t('noPluginsTitle')}
        description={t('noPluginsText')}
        actions={
          <>
            <Button variant="primary" onClick={onBrowse}>
              {t('browsePlugins')}
            </Button>
            <Button onClick={onInstallFile}>{t('installFromFile')}</Button>
          </>
        }
      />
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
      {plugins.map((plugin) => {
        const instance = host?.instance(plugin.id);
        const problems = pluginConsoles.problems(plugin.id);
        const summary = contributionSummary(host, plugin.id);
        return (
          <li
            key={plugin.id}
            className="flex items-center gap-3 px-3 py-3 sm:px-4"
            data-plugin-id={plugin.id}
          >
            <button
              type="button"
              onClick={() => onOpen(plugin.id)}
              aria-label={t('openDetails', { plugin: plugin.manifest.name })}
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <PluginIcon icon={plugin.manifest.icon} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-medium text-fg">
                    {plugin.manifest.name}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {t('version', { version: plugin.manifest.version })}
                  </span>
                  {plugin.source.kind === 'dev' ? (
                    <Badge tone="purple">{t('devBadge')}</Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-ui text-fg-muted">
                  {plugin.manifest.description || t('byAuthor', { author: plugin.manifest.author })}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  <StatusLabel status={instance?.status} enabled={plugin.enabled} />
                  {summary ? <span className="text-xs text-fg-subtle">{summary}</span> : null}
                  {problems ? (
                    <Badge tone="warning">{t('problems', { count: problems })}</Badge>
                  ) : null}
                </span>
              </span>
              <ChevronRight
                className="duration-fast size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
            <Switch
              checked={plugin.enabled}
              aria-label={t('enablePlugin', { plugin: plugin.manifest.name })}
              onCheckedChange={(checked) => void manager.setEnabled(plugin.id, checked)}
            />
          </li>
        );
      })}
    </ul>
  );
}
