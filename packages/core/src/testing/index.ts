/**
 * Test helpers for every package. Import from `@tessera/core/testing` in tests only.
 *
 * @example
 * const { ctx, shell, dispose } = await createTestAppContext({ features: [myFeature] });
 * const page = ctx.workspace.createPage({ title: 'Hello' });
 * await ctx.commands.execute('my.command');
 * expect(shell.toasts).toHaveLength(1);
 * await dispose();
 */
import type {
  AppContext,
  ConfirmOptions,
  NavigateOptions,
  ShellBridge,
  ToastOptions,
} from '../runtime/app-context';
import type { FeatureModule } from '../runtime/feature';
import { detectPlatform } from '../runtime/platform';
import {
  createAppRuntime,
  type AppRuntime,
  type AppRuntimeOptions,
  type WorkspaceSession,
} from '../runtime/runtime';
import { MemorySettingsStore } from '../runtime/settings';
import type { WorkspaceInfo } from '../services/workspace-registry';

export { FIXTURE_IDS, kitchenSinkDoc } from '../schema/fixtures';

/** A {@link ShellBridge} that records every call, for assertions. */
export interface RecordingShell extends ShellBridge {
  readonly navigations: Array<{
    pageId?: string;
    path?: string;
    options?: NavigateOptions | { replace?: boolean };
  }>;
  readonly toasts: ToastOptions[];
  readonly confirms: ConfirmOptions[];
  /** Workspace IDs passed to `switchWorkspace`. */
  readonly workspaceSwitches: string[];
  /** Side panel requests (null = closed). */
  readonly panels: Array<string | null>;
  /** What `getCurrentPageId` returns (navigate updates it). */
  currentPageId: string | null;
  /** What `confirm` resolves to. Default true. */
  confirmAnswer: boolean;
}

/** Creates a {@link RecordingShell}. */
export function createRecordingShell(): RecordingShell {
  const shell: RecordingShell = {
    navigations: [],
    toasts: [],
    confirms: [],
    workspaceSwitches: [],
    panels: [],
    currentPageId: null,
    confirmAnswer: true,
    navigate(pageId, options) {
      shell.navigations.push(options ? { pageId, options } : { pageId });
      shell.currentPageId = pageId;
    },
    navigateTo(path, options) {
      shell.navigations.push(options ? { path, options } : { path });
      shell.currentPageId = null;
    },
    switchWorkspace(workspaceId) {
      shell.workspaceSwitches.push(workspaceId);
    },
    getCurrentPageId: () => shell.currentPageId,
    openSidePanel(id) {
      shell.panels.push(id);
    },
    closeSidePanel() {
      shell.panels.push(null);
    },
    toast(options) {
      shell.toasts.push(options);
      return { dismiss: () => undefined };
    },
    async confirm(options) {
      shell.confirms.push(options);
      return shell.confirmAnswer;
    },
  };
  return shell;
}

/** What {@link createTestAppContext} returns. */
export interface TestAppContext {
  ctx: AppContext;
  session: WorkspaceSession;
  runtime: AppRuntime;
  shell: RecordingShell;
  workspace: WorkspaceInfo;
  /** Runs pending events and waits for doc writes. */
  flush(): Promise<void>;
  /** Closes the session and the runtime. */
  dispose(): Promise<void>;
}

/**
 * An in-memory workspace session with every stub service, events delivered immediately
 * (no debounce) and docs closed as soon as they are released.
 */
export async function createTestAppContext(
  options: {
    features?: FeatureModule[];
    workspaceName?: string;
    runtime?: Partial<Omit<AppRuntimeOptions, 'features'>>;
  } = {},
): Promise<TestAppContext> {
  const runtime = await createAppRuntime({
    features: options.features ?? [],
    platform: detectPlatform({
      navigator: { userAgent: 'vitest' },
      tauri: false,
      matchMedia: () => ({ matches: false }),
    }),
    deviceSettings: new MemorySettingsStore(),
    defaultUserName: 'Test user',
    releaseDelayMs: 0,
    docChangeDebounceMs: 0,
    touchDebounceMs: 0,
    ...options.runtime,
  });
  const workspace = await runtime.workspaceRegistry.create({
    name: options.workspaceName ?? 'Test workspace',
  });
  await runtime.workspaceRegistry.open(workspace.id);
  const shell = createRecordingShell();
  const session = await runtime.openWorkspace(workspace, shell);
  return {
    ctx: session.ctx,
    session,
    runtime,
    shell,
    workspace,
    flush: () => session.flush(),
    dispose: async () => {
      await session.close();
      await runtime.dispose();
    },
  };
}
