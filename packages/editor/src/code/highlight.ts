import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

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

function decorate(doc: PMNode): { set: DecorationSet; hasCode: boolean } {
  const decorations: Decoration[] = [];
  let hasCode = false;
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      hasCode = true;
      if (highlighter) {
        for (const token of tokensFor(node)) {
          decorations.push(
            Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, {
              class: token.className,
            }),
          );
        }
      }
      return false;
    }
    return !node.isTextblock;
  });
  return { set: DecorationSet.create(doc, decorations), hasCode };
}

/**
 * Syntax highlighting for code blocks with lowlight, loaded on first use. Results are cached per
 * code block node, so typing elsewhere never re-highlights anything.
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
            if (!tr.docChanged && tr.getMeta(codeHighlightKey) !== 'refresh') return previous;
            const { set, hasCode } = decorate(tr.doc);
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
