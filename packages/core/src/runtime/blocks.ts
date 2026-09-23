import type { ComponentType } from 'react';
import type { JsonValue } from '../json';
import type { AppContext, IconComponent } from './app-context';

/** Props of a component that renders an `embed` block. */
export interface BlockRendererProps<TData extends JsonValue = JsonValue> {
  /** The embed kind (`database`, `web`, `plugin:mermaid/diagram`, …). */
  kind: string;
  ref: string | null;
  data: TData | null;
  blockId: string | null;
  /** The page that contains the block. */
  pageId: string;
  /** True when the block is selected in the editor (show focus chrome, handle keys). */
  selected: boolean;
  readOnly: boolean;
  /** Replaces `data` (one editor transaction; undoable). Keep it under 64 KB of JSON. */
  updateData(data: TData | null): void;
  /** Updates `ref` and/or `data` together. */
  updateAttrs(patch: { ref?: string | null; data?: TData | null }): void;
  /** Removes the block. */
  deleteBlock(): void;
}

/** The attributes of an embed to insert. */
export interface EmbedInsert {
  kind: string;
  ref?: string | null;
  data?: JsonValue | null;
}

/** What a slash-menu item's `create` receives. */
export interface BlockInsertContext {
  app: AppContext;
  pageId: string;
}

/** An entry in the editor's slash menu that inserts an embed. */
export interface SlashMenuItem {
  id: string;
  /** Translated. */
  title: string;
  description?: string;
  keywords?: readonly string[];
  /** A component (lucide icon) or an emoji. */
  icon?: IconComponent | string;
  /** Slash-menu section (`basic`, `media`, `database`, `advanced`, `plugins`, …). */
  group?: string;
  /**
   * Returns the embed to insert, or null to cancel. May be async (for example "Database – inline"
   * creates the database first).
   */
  create(context: BlockInsertContext): EmbedInsert | null | Promise<EmbedInsert | null>;
}

/**
 * Renders embeds of one kind, or of every kind under a prefix (a `kind` ending with `:` or `/`,
 * like `plugin:` or `plugin:mermaid/`). Exact kinds win over prefixes; longer prefixes win over
 * shorter ones.
 */
export interface BlockRendererRegistration {
  kind: string;
  component: ComponentType<BlockRendererProps>;
  /** Display name (block menu, accessibility), translated. */
  label?: string;
  slashMenu?: readonly SlashMenuItem[];
}

/**
 * Maps embed kinds to React components. The editor renders every `embed` node through it and
 * shows "This block needs a plugin" for unknown kinds (never crashing).
 *
 * @example
 * ctx.blocks.register({
 *   kind: 'database',
 *   component: InlineDatabase,
 *   slashMenu: [{ id: 'database-inline', title: t('inlineDatabase'), create: createInlineDatabase }],
 * });
 */
export interface BlockRendererRegistry {
  register(registration: BlockRendererRegistration): () => void;
  /** Adds slash-menu items without a renderer (for kinds rendered by a prefix registration). */
  registerSlashMenuItems(items: readonly SlashMenuItem[]): () => void;
  resolve(kind: string): BlockRendererRegistration | undefined;
  list(): BlockRendererRegistration[];
  slashMenuItems(): SlashMenuItem[];
  subscribe(listener: () => void): () => void;
}

function isPrefix(kind: string): boolean {
  return kind.endsWith(':') || kind.endsWith('/');
}

/** Creates a {@link BlockRendererRegistry}. */
export function createBlockRendererRegistry(): BlockRendererRegistry {
  const registrations: BlockRendererRegistration[] = [];
  const extraItems: Array<readonly SlashMenuItem[]> = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    register(registration) {
      if (!registration.kind) throw new TypeError('A block renderer needs a kind');
      if (registrations.some((r) => r.kind === registration.kind)) {
        console.warn(`[blocks] "${registration.kind}" was registered twice; the last one wins`);
      }
      registrations.push(registration);
      notify();
      return () => {
        const index = registrations.indexOf(registration);
        if (index >= 0) {
          registrations.splice(index, 1);
          notify();
        }
      };
    },
    registerSlashMenuItems(items) {
      extraItems.push(items);
      notify();
      return () => {
        const index = extraItems.indexOf(items);
        if (index >= 0) {
          extraItems.splice(index, 1);
          notify();
        }
      };
    },
    resolve(kind) {
      for (let i = registrations.length - 1; i >= 0; i -= 1) {
        const registration = registrations[i];
        if (registration && !isPrefix(registration.kind) && registration.kind === kind)
          return registration;
      }
      let best: BlockRendererRegistration | undefined;
      for (const registration of registrations) {
        if (
          isPrefix(registration.kind) &&
          kind.startsWith(registration.kind) &&
          (!best || registration.kind.length >= best.kind.length)
        ) {
          best = registration;
        }
      }
      return best;
    },
    list: () => [...registrations],
    slashMenuItems: () => [
      ...registrations.flatMap((r) => r.slashMenu ?? []),
      ...extraItems.flat(),
    ],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
