import {
  normalizeDocJSON,
  type AnyNodeJSON,
  type AppContext,
  type DocJSON,
  type MarkdownSerializeOptions,
} from '@tessera/core';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { t } from '../i18n';

/** Wraps a node that can't stand alone in a document (list items, rows, cells, summaries). */
function standalone(node: PMNode, parentType: string | null): AnyNodeJSON {
  const json = node.toJSON() as AnyNodeJSON;
  switch (node.type.name) {
    case 'listItem':
      return { type: parentType === 'orderedList' ? 'orderedList' : 'bulletList', content: [json] };
    case 'taskItem':
      return { type: 'taskList', content: [json] };
    case 'tableRow':
      return { type: 'table', content: [json] };
    case 'tableCell':
    case 'tableHeader':
      return { type: 'table', content: [{ type: 'tableRow', content: [json] }] };
    case 'toggleSummary':
      return { type: 'paragraph', content: json.content };
    default:
      return json;
  }
}

/**
 * Turns editor nodes into a valid document: list items get a list around them, rows a table,
 * inline content a paragraph. `parentType` is the type of the nodes' original parent.
 */
export function nodesToDocJSON(
  nodes: readonly PMNode[] | Fragment,
  parentType: string | null = null,
): DocJSON {
  const list: PMNode[] = [];
  nodes.forEach((node: PMNode) => list.push(node));
  const inline = list.every((node) => node.isInline);
  const content = inline
    ? [{ type: 'paragraph', content: list.map((node) => node.toJSON() as AnyNodeJSON) }]
    : list.map((node) => standalone(node, parentType));
  return normalizeDocJSON({ type: 'doc', content });
}

/** Link titles and asset handling for the markdown codec, from the open workspace. */
export function serializeOptions(ctx: AppContext): MarkdownSerializeOptions {
  const snapshot = ctx.workspace.pages.getSnapshot();
  return {
    linkStyle: 'wikilink',
    resolvePage: (pageId) => {
      const page = snapshot.get(pageId);
      return page ? { title: page.title || t('untitled') } : null;
    },
  };
}

/** Markdown for a document, through the workspace's `MarkdownCodec`. */
export function toMarkdown(ctx: AppContext, doc: DocJSON): string {
  return ctx.services.markdownCodec.serialize(doc, serializeOptions(ctx));
}
