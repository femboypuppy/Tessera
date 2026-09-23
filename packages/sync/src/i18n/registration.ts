import { createTranslator } from '@tessera/ui';

/**
 * The few `sync` strings the feature registration needs at startup (panel and settings titles).
 * The rest of the namespace (`./index.ts`) loads with the lazy UI, keeping the startup bundle
 * small. The keys are also in `en.ts`, so translations cover both.
 */
const registration = {
  historyTitle: 'Version history',
  settingsTitle: 'Sync & account',
  settingsDescription: 'Connect to a Tessera server to sync this workspace and share it.',
  joinServerTitle: 'Join a workspace on a server',
  joinServerDescription: 'Sign in to your Tessera server or accept an invite.',
  joinServerWorkspaceName: 'My workspace',
} as const;

export const t = createTranslator('sync', registration);
