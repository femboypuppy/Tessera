import {
  defineFeature,
  defineService,
  MemoryDocStore,
  MemoryDocStoreBackend,
  MemoryWorkspaceRegistry,
  type AppContext,
  type FeatureModule,
} from '@tessera/core';
import type { GeneratedWorkspace } from '../generator';
import { GeneratedDocStore } from './generated-doc-store';

/** Above every real implementation (browser 50, desktop 100), so seeded services always win. */
export const SEED_PRIORITY = 1000;

/** Feature ID of {@link seedFeature} (it shows up in diagnostics). */
export const SEED_FEATURE_ID = 'testkit-seed';

export interface SeedFeatureOptions {
  /** ID of the seeded workspace. Default `seeded`. */
  workspaceId?: string;
  /** Default "Seeded workspace". */
  workspaceName?: string;
  /** Called with each session's context (the harness exposes it to benchmarks). */
  onActivate?: (ctx: AppContext) => void | (() => void);
  /**
   * Doc names to build right away instead of on first load (`ws:` names use `workspaceId`), so
   * timing a cold start measures loading, not generating.
   */
  preload?: string[];
}

/**
 * A feature that makes any runtime open a generated workspace: a workspace registry that already
 * lists it (most recently opened, so the shell opens it) and a doc store that serves its docs. It
 * plugs in through ordinary service registrations, like any feature.
 *
 * @example
 * const runtime = await createAppRuntime({ features: [...features, seedFeature(generateWorkspace({ pages: 5000 }))] });
 */
export function seedFeature(
  generated: GeneratedWorkspace,
  options: SeedFeatureOptions = {},
): FeatureModule {
  const workspaceId = options.workspaceId ?? 'seeded';
  const workspaceName = options.workspaceName ?? 'Seeded workspace';
  // Per workspace, shared by every session, so reopening a workspace keeps its edits.
  const backends = new Map<string, { backend: MemoryDocStoreBackend; settled: Set<string> }>();
  const backendFor = (id: string) => {
    let entry = backends.get(id);
    if (!entry) {
      entry = { backend: new MemoryDocStoreBackend(), settled: new Set() };
      backends.set(id, entry);
    }
    return entry;
  };
  if (options.preload?.length) {
    const { backend, settled } = backendFor(workspaceId);
    for (const name of options.preload) {
      const update = generated.docUpdate(name, workspaceId);
      if (update) backend.docs.set(name, [update]);
      settled.add(name);
    }
  }
  return defineFeature({
    id: SEED_FEATURE_ID,
    services: [
      defineService({
        provides: 'workspaceRegistry',
        id: SEED_FEATURE_ID,
        priority: SEED_PRIORITY,
        create: async () => {
          const registry = new MemoryWorkspaceRegistry({ onRemove: (id) => backends.delete(id) });
          await registry.create({ id: workspaceId, name: workspaceName });
          await registry.open(workspaceId);
          return registry;
        },
      }),
      defineService({
        provides: 'docStore',
        id: SEED_FEATURE_ID,
        priority: SEED_PRIORITY,
        create: ({ workspace }) => {
          const { backend, settled } = backendFor(workspace.id);
          return workspace.id === workspaceId
            ? new GeneratedDocStore(generated, workspaceId, backend, settled)
            : new MemoryDocStore(backend);
        },
      }),
    ],
    ...(options.onActivate ? { activate: options.onActivate } : {}),
  });
}
