import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tessera/ui';
import { ChevronDown, Code2, FileArchive, FolderOpen, Link, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { t } from '../../i18n';
import { useHostVersion, useInstalledPlugins, usePluginHost, usePluginManager } from '../hooks';
import { useInstaller, type Installer } from './InstallFlow';
import { InstalledList } from './InstalledList';
import { PluginDetails } from './PluginDetails';
import { RegistryBrowser } from './RegistryBrowser';

function InstallMenu({ installer }: { installer: Installer }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary">
          <Plus aria-hidden="true" />
          {t('installPlugin')}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem icon={<FileArchive />} onSelect={() => installer.fromFile()}>
          {t('installFromFile')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<FolderOpen />} onSelect={() => installer.fromFolder()}>
          {t('installFromFolder')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Link />} onSelect={() => installer.openUrlDialog()}>
          {t('installFromUrl')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Code2 />} onSelect={() => installer.openDevDialog()}>
          {t('loadDevPlugin')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Settings → Plugins: installed plugins with their details, the registry browser and every way to
 * install. Deep links: `?plugin=<id>` opens a plugin (and `&tab=console|permissions|settings`),
 * `?tab=browse&q=<query>` opens the registry.
 */
export default function PluginsSettings() {
  const manager = usePluginManager();
  const host = usePluginHost();
  useHostVersion(host);
  const plugins = useInstalledPlugins(manager);
  const [params, setParams] = useSearchParams();
  const selected = params.get('plugin');
  const tab = params.get('tab');
  const query = params.get('q') ?? '';
  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  };
  const installer = useInstaller(manager, (id) => update({ plugin: id, tab: null, q: null }));

  if (!manager) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  const plugin = selected ? plugins.find((candidate) => candidate.id === selected) : undefined;
  if (plugin) {
    return (
      <>
        <PluginDetails
          key={plugin.id}
          plugin={plugin}
          manager={manager}
          host={host}
          initialTab={tab ?? undefined}
          onBack={() => update({ plugin: null, tab: null })}
        />
        {installer.element}
      </>
    );
  }
  const listTab = tab === 'browse' ? 'browse' : 'installed';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-ui text-fg-muted">{t('pluginsDescription')}</p>
        <InstallMenu installer={installer} />
      </div>
      <Tabs
        value={listTab}
        onValueChange={(value) => update({ tab: value === 'browse' ? 'browse' : null })}
      >
        <TabsList>
          <TabsTrigger value="installed">
            {t('tabInstalled')}
            {plugins.length ? <Badge>{plugins.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="browse">{t('tabBrowse')}</TabsTrigger>
        </TabsList>
        <TabsContent value="installed" className="pt-5">
          <InstalledList
            plugins={plugins}
            manager={manager}
            host={host}
            onOpen={(id) => update({ plugin: id, tab: null })}
            onBrowse={() => update({ tab: 'browse' })}
            onInstallFile={() => installer.fromFile()}
          />
        </TabsContent>
        <TabsContent value="browse" className="pt-5">
          <RegistryBrowser
            installed={plugins}
            query={query}
            onQueryChange={(value) => update({ q: value })}
            pendingId={installer.pendingId}
            onInstall={(entry, registryUrl) => installer.fromRegistry(entry, registryUrl)}
            onOpen={(id) => update({ plugin: id, tab: null, q: null })}
          />
        </TabsContent>
      </Tabs>
      {installer.element}
    </div>
  );
}
