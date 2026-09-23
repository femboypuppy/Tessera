import { toError } from '../errors';
import type { AppContext, IconComponent } from './app-context';
import {
  isEditableTarget,
  matchesShortcut,
  normalizeShortcut,
  parseShortcut,
  type ShortcutEvent,
} from './keyboard';

/**
 * IDs of commands other features call, so integration never depends on guessing names. The
 * feature that owns each command registers it; callers check `commands.has(id)` or use the
 * boolean from `execute`.
 */
export const COMMANDS = {
  /** Shell. Create a page (args: `{ parentId?: string | null }`). Mod+N, Mod+Alt+N. */
  newPage: 'shell.newPage',
  /** Shell. Mod+\ */
  toggleSidebar: 'shell.toggleSidebar',
  /** Shell. Mod+Shift+L */
  toggleTheme: 'shell.toggleTheme',
  /** Shell. `?` and Mod+/ */
  showShortcuts: 'shell.showShortcuts',
  /** Shell. Mod+, */
  openSettings: 'shell.openSettings',
  /** Shell. */
  openTrash: 'shell.openTrash',
  /** Shell. Focus the current page's title. */
  focusTitle: 'shell.focusTitle',
  /** Search feature. Mod+K (reserved). */
  openPalette: 'search.openPalette',
  /** Search feature. Open search with a query (args: `{ query: string }`, e.g. `#tag` from a tag click). */
  search: 'search.open',
  /** Graph feature. */
  openGraph: 'graph.open',
  /** Import/export feature (args: `{ importerId?: string }`). */
  openImport: 'importExport.openImport',
  /** Import/export feature (args: `{ pageId?: string }`). */
  openExport: 'importExport.openExport',
} as const;

/** Shortcuts reserved for a specific command; the registry warns when another command claims one. */
export const RESERVED_SHORTCUTS: Readonly<Record<string, string>> = {
  'Mod+K': COMMANDS.openPalette,
};

/** Palette groups (the search feature translates them). */
export const COMMAND_GROUPS = [
  'navigation',
  'page',
  'editor',
  'view',
  'workspace',
  'help',
] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number] | (string & {});

/** What a command receives when it runs. */
export interface CommandContext {
  app: AppContext;
  /** The page open in the main view, if any. */
  pageId: string | null;
  args?: unknown;
  source: 'palette' | 'shortcut' | 'menu' | 'api';
}

/**
 * A command: shown in the palette (Mod+K), bound to shortcuts, runnable by ID.
 *
 * @example
 * ctx.commands.register({
 *   id: 'editor.wordCount',
 *   title: t('wordCount'),
 *   group: 'editor',
 *   when: ({ pageId }) => pageId !== null,
 *   run: ({ app, pageId }) => app.toast({ title: t('words', { count: countWords(pageId) }) }),
 * });
 */
export interface Command {
  /** `<featureId>.<name>`. */
  id: string;
  /** Translated title. */
  title: string;
  keywords?: readonly string[];
  /** One shortcut or several (the first is shown). */
  shortcut?: string | readonly string[];
  group?: CommandGroup;
  icon?: IconComponent;
  /** Hide from the palette (still runs by ID and shortcut). */
  hidden?: boolean;
  /**
   * Let the shortcut fire while typing in a text field or the editor. Defaults to true for
   * shortcuts with Mod/Ctrl/Alt/Meta and false for single keys like `?`.
   */
  allowInEditable?: boolean;
  when?(context: CommandContext): boolean;
  run(context: CommandContext): void | Promise<void>;
}

/** The command registry (`AppContext.commands`). */
export interface CommandRegistry {
  register(command: Command): () => void;
  registerMany(commands: readonly Command[]): () => void;
  get(id: string): Command | undefined;
  has(id: string): boolean;
  /** Every command, sorted by group then title. */
  list(): Command[];
  /** Commands whose `when` passes right now and that are not hidden (the palette's list). */
  available(): Command[];
  /** Runs a command. Resolves to false when it is missing, unavailable or throws. */
  execute(
    id: string,
    options?: { args?: unknown; source?: CommandContext['source'] },
  ): Promise<boolean>;
  /** The command a keyboard event triggers, if any. */
  findForEvent(event: ShortcutEvent & { target?: EventTarget | null }): Command | undefined;
  subscribe(listener: () => void): () => void;
}

/** The shortcuts of a command, as an array. */
export function commandShortcuts(command: Pick<Command, 'shortcut'>): string[] {
  if (!command.shortcut) return [];
  return typeof command.shortcut === 'string' ? [command.shortcut] : [...command.shortcut];
}

/** Creates a {@link CommandRegistry}. */
export function createCommandRegistry(options: {
  getContext: () => Omit<CommandContext, 'args' | 'source'>;
  isApple: boolean;
  onError?: (error: Error, command: Command) => void;
}): CommandRegistry {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const contextFor = (source: CommandContext['source'], args?: unknown): CommandContext => {
    const context: CommandContext = { ...options.getContext(), source };
    if (args !== undefined) context.args = args;
    return context;
  };
  const isAvailable = (command: Command, context: CommandContext): boolean => {
    try {
      return command.when ? command.when(context) : true;
    } catch {
      return false;
    }
  };

  const registry: CommandRegistry = {
    register(command) {
      for (const shortcut of commandShortcuts(command)) {
        const normalized = normalizeShortcut(shortcut);
        const owner = RESERVED_SHORTCUTS[normalized];
        if (owner && owner !== command.id) {
          console.warn(
            `[commands] "${command.id}" uses ${normalized}, which is reserved for "${owner}"`,
          );
        }
        for (const other of commands.values()) {
          if (
            other.id !== command.id &&
            commandShortcuts(other).some((s) => normalizeShortcut(s) === normalized)
          ) {
            console.warn(`[commands] "${command.id}" and "${other.id}" share ${normalized}`);
          }
        }
      }
      if (commands.has(command.id))
        console.warn(`[commands] "${command.id}" was registered twice; the last one wins`);
      commands.set(command.id, command);
      notify();
      return () => {
        if (commands.get(command.id) === command) {
          commands.delete(command.id);
          notify();
        }
      };
    },
    registerMany(list) {
      const offs = list.map((command) => registry.register(command));
      return () => offs.forEach((off) => off());
    },
    get: (id) => commands.get(id),
    has: (id) => commands.has(id),
    list: () =>
      [...commands.values()].sort(
        (a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.title.localeCompare(b.title),
      ),
    available() {
      const context = contextFor('palette');
      return registry.list().filter((command) => !command.hidden && isAvailable(command, context));
    },
    async execute(id, { args, source = 'api' } = {}) {
      const command = commands.get(id);
      if (!command) return false;
      const context = contextFor(source, args);
      if (!isAvailable(command, context)) return false;
      try {
        await command.run(context);
        return true;
      } catch (error) {
        if (options.onError) options.onError(toError(error), command);
        else console.error(`[commands] "${id}" failed`, error);
        return false;
      }
    },
    findForEvent(event) {
      const editable = isEditableTarget(event.target ?? null);
      const context = contextFor('shortcut');
      for (const command of commands.values()) {
        for (const shortcut of commandShortcuts(command)) {
          if (!matchesShortcut(event, shortcut, options.isApple)) continue;
          const modified = [...parseShortcut(shortcut).modifiers].some((m) => m !== 'Shift');
          if (editable && !(command.allowInEditable ?? modified)) continue;
          if (isAvailable(command, context)) return command;
        }
      }
      return undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return registry;
}
