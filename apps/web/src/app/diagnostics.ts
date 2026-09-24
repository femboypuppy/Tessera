import type { AppRuntime, ContributionKind, ServiceKey, WorkspaceSession } from '@tessera/core';

/**
 * A read-only snapshot of what is running, for end-to-end tests and bug reports:
 * `await page.evaluate(() => window.__tessera?.diagnostics())`. It holds names only, never
 * document data or capabilities.
 */
export interface TesseraDiagnostics {
  version: 1;
  workspaceId: string;
  /** Loaded feature modules, in load order. */
  features: string[];
  /** Features whose `activate` threw (their contributions were removed). */
  failedFeatures: string[];
  /** The implementation each service resolved to (`memory`, `indexeddb`, `hocuspocus`, …). */
  services: Record<ServiceKey, string>;
  /** Contributions per kind: route paths, page kinds for `pageBodies`, IDs for the rest. */
  contributions: Record<ContributionKind, string[]>;
  /** Registered command IDs. */
  commands: string[];
  /** Embed kinds with a registered renderer. */
  blockKinds: string[];
}

declare global {
  interface Window {
    /** Set while a workspace is open (see {@link installDiagnostics}). */
    __tessera?: { diagnostics(): TesseraDiagnostics };
  }
}

// Every contribution kind; `satisfies` makes the compiler flag a kind added to core but not here.
const KINDS = {
  routes: true,
  sidebarSections: true,
  pageBodies: true,
  pageTopSections: true,
  pageFooterSections: true,
  pageHeaderActions: true,
  pageSidePanels: true,
  topBarItems: true,
  settingsPanels: true,
  onboardingActions: true,
  editorExtensions: true,
  overlays: true,
  workspaceMenuItems: true,
  docViewers: true,
} satisfies Record<ContributionKind, true>;

function contributionName(item: { id?: string; path?: string; kind?: string }): string {
  return item.id ?? item.path ?? item.kind ?? '';
}

/** Describes an open session. */
export function describeSession(
  runtime: AppRuntime,
  session: WorkspaceSession,
): TesseraDiagnostics {
  const { ctx } = session;
  const contributions = {} as Record<ContributionKind, string[]>;
  for (const kind of Object.keys(KINDS) as ContributionKind[]) {
    contributions[kind] = ctx.contributions.list(kind).map((item) => contributionName(item));
  }
  return {
    version: 1,
    workspaceId: session.workspace.id,
    features: runtime.features.map((feature) => feature.id),
    failedFeatures: [...session.featureErrors.keys()],
    services: { ...ctx.serviceSources },
    contributions,
    commands: ctx.commands.list().map((command) => command.id),
    blockKinds: ctx.blocks.list().map((registration) => registration.kind),
  };
}

/** Publishes `window.__tessera` for a session. Returns a function that removes it. */
export function installDiagnostics(runtime: AppRuntime, session: WorkspaceSession): () => void {
  const value = { diagnostics: () => describeSession(runtime, session) };
  window.__tessera = value;
  return () => {
    if (window.__tessera === value) delete window.__tessera;
  };
}
