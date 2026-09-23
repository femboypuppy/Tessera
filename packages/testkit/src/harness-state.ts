import type { AppContext } from '@tessera/core';
import type { GeneratedFile, PageRole, ResolvedOptions } from './generator';

/** A page of the seeded workspace, as the harness describes it. */
export interface HarnessPage {
  id: string;
  title: string;
  role: PageRole;
  parentId: string | null;
  depth: number;
  trashed: boolean;
}

/**
 * What the seeded harness app (`packages/testkit/harness`) publishes as `window.__tesseraHarness`
 * for Playwright fixtures and benchmarks.
 */
export interface HarnessState {
  /** True once the sidebar tree has rendered and the main thread is free again. */
  ready: boolean;
  /** The boot failed (the message), for fixtures to report. */
  error: string | null;
  options: ResolvedOptions;
  workspaceId: string;
  pages: HarnessPage[];
  databases: Array<{
    id: string;
    title: string;
    views: Array<{ id: string; name: string; type: string }>;
  }>;
  largePages: Array<{ id: string; title: string; blocks: number; marker: string }>;
  /** Milliseconds since navigation start (`performance.now()`). */
  timings: {
    /** The harness script started (the JS has loaded). */
    start: number;
    /** The workspace was generated and stored; the app boots from here. */
    seeded: number;
    /** The sidebar tree is interactive. */
    sidebarReady: number | null;
  };
  /** The open workspace's context (set when the workspace opens). */
  ctx: AppContext | null;
  /** The markdown export of the seeded workspace (built on demand). */
  markdownFiles(): GeneratedFile[];
}

declare global {
  interface Window {
    __tesseraHarness?: HarnessState;
  }
}
