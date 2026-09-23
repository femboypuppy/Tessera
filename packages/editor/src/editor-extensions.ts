import type { AnyExtension, NodeViewRenderer } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Dropcursor, Gapcursor, UndoRedo } from '@tiptap/extensions';
import type * as Y from 'yjs';
import { BlockIds } from './extensions/block-ids';
import { Placeholder } from './extensions/placeholder';
import { TitleNavigation } from './extensions/title-navigation';
import { schemaExtensions } from './schema';

/** Options of {@link editorExtensions}. */
export interface EditorExtensionsOptions {
  /** The page doc's `content` fragment. Without it the editor keeps its own (unsynced) state. */
  fragment?: Y.XmlFragment | null;
  /** Moves focus to the page title (ArrowUp at the start of the page). */
  focusTitle?: ((position: 'start' | 'end') => void) | null;
  /** Node views by node name (callout, toggle, codeBlock, image, embed, pageLink, tag, …). */
  nodeViews?: Partial<Record<string, NodeViewRenderer>>;
  /** Behavior-only extensions (menus, keymaps, clipboard, contributions from other features). */
  extra?: readonly AnyExtension[];
  /** Resizable table columns (on in the page editor). */
  resizableTables?: boolean;
}

/**
 * Everything the page editor runs: the canonical schema (with node views), Yjs collaboration
 * (undo through the Yjs undo manager, so undo only reverts this user's edits), block IDs,
 * placeholders and title navigation, plus `extra`.
 */
export function editorExtensions(options: EditorExtensionsOptions = {}): AnyExtension[] {
  const nodeViews = options.nodeViews ?? {};
  const schema = schemaExtensions({ resizableTables: options.resizableTables ?? false }).map(
    (extension) => {
      const view = nodeViews[extension.name];
      if (!view || extension.type !== 'node') return extension;
      return extension.extend({ addNodeView: () => view });
    },
  );
  const extensions: AnyExtension[] = [
    ...schema,
    BlockIds,
    Placeholder,
    TitleNavigation.configure({ focusTitle: options.focusTitle ?? null }),
    Gapcursor,
    Dropcursor.configure({ color: 'var(--tess-accent)', width: 2, class: 'tess-dropcursor' }),
    ...(options.extra ?? []),
  ];
  // With a fragment, Yjs owns undo and redo; without one (previews, tests) ProseMirror's history does.
  extensions.push(
    options.fragment ? Collaboration.configure({ fragment: options.fragment }) : UndoRedo,
  );
  return extensions;
}
