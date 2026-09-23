/**
 * Which features the running app has, from `window.__tessera.diagnostics()`. End-to-end journeys
 * declare the features they need and skip with a clear message until those are merged.
 */
import { COMMANDS, PANELS } from '@tessera/core';
import type { Page } from '@playwright/test';

/** What `window.__tessera.diagnostics()` returns (apps/web/src/app/diagnostics.ts). */
export interface Diagnostics {
  version: number;
  workspaceId: string;
  features: string[];
  failedFeatures: string[];
  services: Record<string, string>;
  contributions: Record<string, string[]>;
  commands: string[];
  blockKinds: string[];
}

/** Reads the diagnostics of the open workspace, or null when no workspace is open. */
export async function readDiagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(() => {
    const api = (window as unknown as { __tessera?: { diagnostics(): Diagnostics } }).__tessera;
    return api ? api.diagnostics() : null;
  });
}

interface FeatureCheck {
  /** Who builds it (for the skip message). */
  owner: string;
  /** What is missing, in words. */
  label: string;
  present(diagnostics: Diagnostics): boolean;
}

const has = (list: readonly string[] | undefined, value: string) => (list ?? []).includes(value);

/** Every feature a journey can require. */
export const FEATURE_CHECKS = {
  editor: {
    owner: 'Agent 02 (editor)',
    label: 'the page editor (pageBodies.page)',
    present: (d) => has(d.contributions.pageBodies, 'page'),
  },
  databases: {
    owner: 'Agent 04 (databases)',
    label: 'database views (pageBodies.database)',
    present: (d) => has(d.contributions.pageBodies, 'database'),
  },
  search: {
    owner: 'Agent 05 (search)',
    label: `the command palette (${COMMANDS.openPalette})`,
    present: (d) => has(d.commands, COMMANDS.openPalette),
  },
  graph: {
    owner: 'Agent 05 (graph)',
    label: 'the graph view (/graph)',
    present: (d) => has(d.contributions.routes, '/graph'),
  },
  backlinks: {
    owner: 'Agent 05 (backlinks)',
    label: `the backlinks panel (${PANELS.backlinks})`,
    present: (d) => has(d.contributions.pageSidePanels, PANELS.backlinks),
  },
  import: {
    owner: 'Agent 08 (import)',
    label: `the import dialog (${COMMANDS.openImport})`,
    present: (d) => has(d.commands, COMMANDS.openImport),
  },
  export: {
    owner: 'Agent 08 (export)',
    label: `the export dialog (${COMMANDS.openExport})`,
    present: (d) => has(d.commands, COMMANDS.openExport),
  },
  persistence: {
    owner: 'Agent 03 (storage)',
    label: 'persistent storage (a docStore other than the in-memory stub)',
    present: (d) => d.services.docStore !== undefined && d.services.docStore !== 'memory',
  },
  sync: {
    owner: 'Agent 03 (sync)',
    label: 'the sync feature (persistent stores and a server connection)',
    present: (d) =>
      has(d.features, 'sync') &&
      d.services.docStore !== 'memory' &&
      d.services.workspaceRegistry !== 'memory',
  },
  plugins: {
    owner: 'Agent 06 (plugins)',
    label: 'plugin settings (settingsPanels.plugins)',
    present: (d) => has(d.contributions.settingsPanels, 'plugins'),
  },
} satisfies Record<string, FeatureCheck>;

export type FeatureName = keyof typeof FEATURE_CHECKS;

/** The required features the app doesn't have yet. */
export function missingFeatures(
  diagnostics: Diagnostics,
  required: readonly FeatureName[],
): FeatureName[] {
  return required.filter((name) => !FEATURE_CHECKS[name].present(diagnostics));
}

/** The skip message for missing features: what is missing and who builds it. */
export function describeMissing(missing: readonly FeatureName[]): string {
  const parts = missing.map(
    (name) => `${FEATURE_CHECKS[name].label}, from ${FEATURE_CHECKS[name].owner}`,
  );
  return `Needs ${parts.join('; ')}. Not registered in this build yet: runs once the feature is merged.`;
}
