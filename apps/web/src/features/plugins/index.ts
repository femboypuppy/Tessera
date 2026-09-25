import { defineFeature } from '@tessera/core';
import { activatePlugins, PluginBlockEntry, PluginsSettingsEntry } from '@tessera/plugins/entry';
import { t } from '@tessera/plugins/i18n/registration';
import { Puzzle } from 'lucide-react';

/**
 * Plugins (Agent 06): Settings → Plugins, the `plugin:` block renderer, and the plugin host, which
 * starts in the background when a workspace opens and registers each plugin's commands, panels
 * and slash-menu blocks at runtime. Everything heavy lives in `@tessera/plugins` and loads lazily.
 */
export const pluginsFeature = defineFeature({
  id: 'plugins',
  settingsPanels: [
    {
      id: 'plugins',
      title: t('plugins'),
      description: t('pluginsDescription'),
      icon: Puzzle,
      order: 50,
      keywords: t('settingsKeywords').split(','),
      component: PluginsSettingsEntry,
    },
  ],
  blockRenderers: [{ kind: 'plugin:', label: t('pluginBlock'), component: PluginBlockEntry }],
  commands: [
    {
      id: 'plugins.openSettings',
      title: t('cmdOpenPlugins'),
      group: 'workspace',
      keywords: t('settingsKeywords').split(','),
      run: ({ app }) => app.navigateTo('/settings/plugins'),
    },
  ],
  activate: (ctx) => activatePlugins(ctx),
});
