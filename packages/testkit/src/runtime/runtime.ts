import {
  createAppRuntime,
  detectPlatform,
  MemorySettingsStore,
  type AppRuntime,
  type AppRuntimeOptions,
  type FeatureModule,
  type WorkspaceInfo,
} from '@tessera/core';
import { createRecordingShell, type TestAppContext } from '@tessera/core/testing';
import { generateWorkspace, type GeneratedWorkspace, type GenerateOptions } from '../generator';
import { seedFeature } from './seed';

/** Test defaults: memory settings, no debouncing, docs closed as soon as they are released. */
export const TEST_RUNTIME_DEFAULTS = {
  defaultUserName: 'Test user',
  releaseDelayMs: 0,
  docChangeDebounceMs: 0,
  touchDebounceMs: 0,
} as const;

/**
 * An in-memory {@link AppRuntime} with test defaults (the same ones `createTestAppContext` uses).
 * Use it when a test needs several workspaces or sessions; `createTestAppContext` from
 * `@tessera/core/testing` is simpler for one.
 *
 * @example
 * const runtime = await createTestRuntime({ features: [searchFeature] });
 * const info = await runtime.workspaceRegistry.create({ name: 'A' });
 * const session = await runtime.openWorkspace(info, createRecordingShell());
 */
export async function createTestRuntime(
  options: Partial<AppRuntimeOptions> = {},
): Promise<AppRuntime> {
  return createAppRuntime({
    platform: detectPlatform({
      navigator: { userAgent: 'vitest' },
      tauri: false,
      matchMedia: () => ({ matches: false }),
    }),
    deviceSettings: new MemorySettingsStore(),
    ...TEST_RUNTIME_DEFAULTS,
    ...options,
    features: options.features ?? [],
  });
}

export interface SeededAppContext extends TestAppContext {
  generated: GeneratedWorkspace;
}

export interface SeededAppContextOptions extends GenerateOptions {
  /** A workspace generated earlier (then the generator options are ignored). */
  generated?: GeneratedWorkspace;
  /** Features under test (their services resolve as usual, below the seeded ones). */
  features?: FeatureModule[];
  workspaceName?: string;
  runtime?: Partial<Omit<AppRuntimeOptions, 'features'>>;
}

/**
 * Like `createTestAppContext`, with a generated workspace already open: every page, database and
 * row of `generateWorkspace(options)`, loaded through the runtime like real stored data.
 *
 * @example
 * const { ctx, generated, dispose } = await createSeededAppContext({ seed: 1, pages: 500 });
 * const { hits } = await ctx.services.searchIndex.query(generated.pages[0].title);
 * await dispose();
 */
export async function createSeededAppContext(
  options: SeededAppContextOptions = {},
): Promise<SeededAppContext> {
  const {
    generated: given,
    features = [],
    workspaceName,
    runtime: runtimeOptions,
    ...generate
  } = options;
  const generated = given ?? generateWorkspace(generate);
  const workspaceId = 'seeded';
  const runtime = await createTestRuntime({
    ...runtimeOptions,
    features: [
      ...features,
      seedFeature(generated, { workspaceId, workspaceName: workspaceName ?? 'Seeded workspace' }),
    ],
  });
  const workspace: WorkspaceInfo | null = await runtime.workspaceRegistry.get(workspaceId);
  if (!workspace) throw new Error('The seeded workspace is missing from the registry');
  const shell = createRecordingShell();
  const session = await runtime.openWorkspace(workspace, shell);
  return {
    ctx: session.ctx,
    session,
    runtime,
    shell,
    workspace,
    generated,
    flush: () => session.flush(),
    dispose: async () => {
      await session.close();
      await runtime.dispose();
    },
  };
}
