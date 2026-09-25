import { createTranslator } from '@tessera/ui';

/**
 * The `plugins` strings the feature registration needs at startup (command, panel and settings
 * titles). The whole namespace (`./en.ts`) loads with the lazy UI, which keeps the startup bundle
 * small; the keys are also in `en.ts`, so translations cover both (`registration.test.ts`).
 */
export const registration = {
  plugins: 'Plugins',
  pluginsDescription: 'Extend Tessera with commands, panels and blocks. Plugins run in a sandbox.',
  settingsKeywords: 'plugins,extensions,add-ons,registry,install',
  pluginBlock: 'Plugin block',
  cmdOpenPlugins: 'Open plugin settings',
} as const;

export const t = createTranslator('plugins', registration);
