import type { CommandDefinition, PluginApi } from '@tessera/plugin-api';
import type { RuntimeDefinition, RuntimeInit, RuntimeKit, RuntimePort } from './runtime-kit';

/** What the worker runtime needs from its environment (the worker global in the sandbox). */
export interface WorkerEnv {
  port: RuntimePort;
  /** The plugin module's source. */
  code: string;
  init: RuntimeInit;
  /** Imports a module from source (a blob URL in the sandbox). */
  importPlugin(code: string): Promise<unknown>;
  console: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;
  global: { addEventListener(type: string, listener: (event: unknown) => void): void };
}

/**
 * The plugin's background worker: loads the module, reports what it defines (`ready`), then runs
 * `activate`, `deactivate` and commands when the host asks, and answers heartbeats.
 * Self-contained: shipped into the sandbox as source text.
 */
export function runWorker(env: WorkerEnv, kit: RuntimeKit): Promise<void> {
  const rpc = kit.createRpc(env.port);
  kit.captureConsole(env.console, rpc);
  kit.captureErrors(env.global, rpc);
  const commands = new Map<string, CommandDefinition['run']>();
  let definition: RuntimeDefinition | null = null;
  let api: PluginApi | null = null;
  let activated = false;

  rpc.onRequest(async (method, params) => {
    if (method === 'ping') return 'pong';
    if (!definition || !api) throw new Error('The plugin is not loaded.');
    if (method === 'activate') {
      if (definition.activate) await definition.activate(api);
      activated = true;
      return true;
    }
    if (method === 'deactivate') {
      if (activated && definition.deactivate) await definition.deactivate();
      activated = false;
      return true;
    }
    if (method === 'command.run') {
      const { id, pageId } = (params || {}) as { id?: string; pageId?: string | null };
      const run = id ? commands.get(id) : undefined;
      if (!run) throw new Error(`The plugin has no command "${String(id)}".`);
      await run({ pageId: pageId ?? null });
      return true;
    }
    throw new Error(`Unknown request "${method}".`);
  });

  return env.importPlugin(env.code).then(
    (module) => {
      let loaded: RuntimeDefinition;
      try {
        loaded = kit.readDefinition(module);
      } catch (error) {
        rpc.notify('error', { message: (error as Error).message, fatal: true });
        return;
      }
      definition = loaded;
      api = kit.createApi({
        rpc,
        surface: 'worker',
        init: env.init,
        definition: loaded,
        commands,
      }).api;
      let settings: unknown;
      try {
        settings = loaded.settings ? JSON.parse(JSON.stringify(loaded.settings)) : undefined;
      } catch {
        settings = undefined;
      }
      const ready: Record<string, unknown> = {
        panels: Object.keys(loaded.panels || {}),
        blocks: Object.keys(loaded.blocks || {}),
        activate: typeof loaded.activate === 'function',
      };
      if (settings) ready.settings = settings;
      rpc.notify('ready', ready);
    },
    (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      const params: Record<string, unknown> = {
        message: `The plugin's code failed to load: ${failure.message}`,
        fatal: true,
      };
      if (failure.stack) params.stack = failure.stack;
      rpc.notify('error', params);
    },
  );
}
