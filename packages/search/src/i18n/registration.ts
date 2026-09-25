import { createTranslator } from '@tessera/ui';

/**
 * The `search` strings the feature registration needs at startup (command, panel and settings
 * titles). The whole namespace (`./en.ts`) loads with the lazy UI, which keeps the startup bundle
 * small; the keys are also in `en.ts`, so translations cover both (`registration.test.ts`).
 */
export const registration = {
  cmdOpenPalette: 'Search or run a command…',
  cmdRebuildIndex: 'Rebuild search index',
  cmdSearchPage: 'Search in workspace',
  rebuildDone: 'Search index rebuilt',
  rebuildFailed: 'Could not rebuild the search index',
  rebuildStarted: 'Rebuilding the search index…',
  cmdOpenGraph: 'Open graph view',
  cmdShowLocalGraph: 'Show local graph',
  localGraph: 'Local graph',
  backlinks: 'Backlinks',
  cmdShowBacklinks: 'Show backlinks',
  settingsDescription: 'Linked references and unlinked mentions.',
  settingsTitle: 'Backlinks',
  graphTitle: 'Graph view',
} as const;

export const t = createTranslator('search', registration);
