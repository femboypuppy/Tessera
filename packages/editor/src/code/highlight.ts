import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { changedRanges } from '../extensions/changed-ranges';

/** The parts of a lowlight instance the plugin uses. */
interface Highlighter {
  highlight(language: string, value: string): HastNode;
  registered(language: string): boolean;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

interface Token {
  from: number;
  to: number;
  className: string;
}

let highlighter: Highlighter | null = null;
let loading: Promise<void> | null = null;
const views = new Set<EditorView>();

export const codeHighlightKey = new PluginKey<DecorationSet>('tesseraCodeHighlight');

/**
 * Loads lowlight with the common grammars (a separate chunk), then re-highlights every open
 * editor. Code blocks render as plain text until then.
 */
export function loadHighlighter(): Promise<void> {
  loading ??= import('lowlight')
    .then(({ createLowlight, common }) => {
      highlighter = createLowlight(common) as unknown as Highlighter;
      for (const view of views) {
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(codeHighlightKey, 'refresh'));
      }
    })
    .catch((error: unknown) => {
      loading = null;
      console.warn('[editor] Syntax highlighting is unavailable', error);
    });
  return loading;
}

function classNames(node: HastNode): string[] {
  const value = node.properties?.className;
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : [];
}

/** Flattens a highlight tree into class ranges (offsets into the code text). */
function tokenize(tree: HastNode): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  const visit = (node: HastNode, inherited: string[]) => {
    if (node.type === 'text') {
      const length = node.value?.length ?? 0;
      if (inherited.length && length) {
        tokens.push({ from: offset, to: offset + length, className: inherited.join(' ') });
      }
      offset += length;
      return;
    }
    const names = node.type === 'element' ? [...inherited, ...classNames(node)] : inherited;
    for (const child of node.children ?? []) visit(child, names);
  };
  visit(tree, []);
  return tokens;
}

const tokenCache = new WeakMap<PMNode, Token[]>();

function tokensFor(node: PMNode): Token[] {
  const cached = tokenCache.get(node);
  if (cached) return cached;
  const language = typeof node.attrs.language === 'string' ? node.attrs.language : null;
  let tokens: Token[] = [];
  if (highlighter && language && highlighter.registered(language)) {
    try {
      tokens = tokenize(highlighter.highlight(language, node.textContent));
    } catch {
      tokens = [];
    }
  }
  tokenCache.set(node, tokens);
  return tokens;
}

function blockDecorations(node: PMNode, pos: number): Decoration[] {
  if (!highlighter) return [];
  return tokensFor(node).map((token) =>
    Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }),
  );
}

function decorate(doc: PMNode): { set: DecorationSet; hasCode: boolean } {
  const decorations: Decoration[] = [];
  let hasCode = false;
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      hasCode = true;
      decorations.push(...blockDecorations(node, pos));
      return false;
    }
    return !node.isTextblock;
  });
  return { set: DecorationSet.create(doc, decorations), hasCode };
}

/**
 * Updates the decorations for a change: the previous ones are mapped, and only code blocks the
 * change touched are highlighted again, so typing costs the same on a page of any length.
 */
function redecorate(
  tr: Transaction,
  previous: DecorationSet,
): { set: DecorationSet; hasCode: boolean } {
  let set = previous.map(tr.mapping, tr.doc);
  let hasCode = false;
  const size = tr.doc.content.size;
  for (const range of changedRanges([tr])) {
    tr.doc.nodesBetween(Math.min(range.from, size), Math.min(range.to, size), (node, pos) => {
      if (node.type.name === 'codeBlock') {
        hasCode = true;
        set = set.remove(set.find(pos, pos + node.nodeSize));
        set = set.add(tr.doc, blockDecorations(node, pos));
        return false;
      }
      return !node.isTextblock;
    });
  }
  return { set, hasCode };
}

/**
 * Syntax highlighting for code blocks with lowlight, loaded on first use. Results are cached per
 * code block node, and decorations are updated only where the document changed.
 */
export const CodeHighlight = Extension.create({
  name: 'codeHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: codeHighlightKey,
        state: {
          init: (_config, state) => {
            const { set, hasCode } = decorate(state.doc);
            if (hasCode && !highlighter) void loadHighlighter();
            return set;
          },
          apply(tr, previous) {
            const refresh = tr.getMeta(codeHighlightKey) === 'refresh';
            if (!tr.docChanged && !refresh) return previous;
            const { set, hasCode } = refresh ? decorate(tr.doc) : redecorate(tr, previous);
            if (hasCode && !highlighter) void loadHighlighter();
            return set;
          },
        },
        props: {
          decorations: (state) => codeHighlightKey.getState(state) ?? DecorationSet.empty,
        },
        view(view) {
          views.add(view);
          return { destroy: () => views.delete(view) };
        },
      }),
    ];
  },
});
