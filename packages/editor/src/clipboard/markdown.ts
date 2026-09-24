import {
  normalizeDocJSON,
  type AnyNodeJSON,
  type AppContext,
  type DocJSON,
  type MarkdownSerializeOptions,
} from '@tessera/core';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { t } from '../i18n';

/** The wrapper a node needs to stand alone in a document, or null when it can. */
function wrapperFor(node: PMNode, parentType: string | null): string | null {
  switch (node.type.name) {
    case 'listItem':
      return parentType === 'orderedList' ? 'orderedList' : 'bulletList';
    case 'taskItem':
      return 'taskList';
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return 'table';
    default:
      return null;
  }
}

/**
 * Turns editor nodes into a valid document: consecutive list items get one list around them,
 * rows and cells a table, summaries and inline content a paragraph. `parentType` is the type of
 * the nodes' original parent (it tells bulleted and numbered items apart).
 */
export function nodesToDocJSON(
  nodes: readonly PMNode[] | Fragment,
  parentType: string | null = null,
): DocJSON {
  const list: PMNode[] = [];
  nodes.forEach((node: PMNode) => list.push(node));
  if (list.every((node) => node.isInline)) {
    return normalizeDocJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: list.map((node) => node.toJSON() as AnyNodeJSON) }],
    });
  }
  const content: AnyNodeJSON[] = [];
  let group: { type: string; items: AnyNodeJSON[] } | null = null;
  for (const node of list) {
    const wrapper = wrapperFor(node, parentType);
    const json = node.toJSON() as AnyNodeJSON;
    if (!wrapper) {
      group = null;
      content.push(
        node.type.name === 'toggleSummary' ? { type: 'paragraph', content: json.content } : json,
      );
      continue;
    }
    // Cells become a one-row table; rows and items join the group of their kind.
    const item =
      node.type.name === 'tableCell' || node.type.name === 'tableHeader'
        ? { type: 'tableRow', content: [json] }
        : json;
    if (group && group.type === wrapper) group.items.push(item);
    else {
      group = { type: wrapper, items: [item] };
      content.push({ type: wrapper, content: group.items });
    }
  }
  return normalizeDocJSON({ type: 'doc', content });
}

/** Link titles and asset handling for the markdown codec, from the open workspace. */
export function serializeOptions(ctx: AppContext): MarkdownSerializeOptions {
  const snapshot = ctx.workspace.pages.getSnapshot();
  return {
    linkStyle: 'wikilink',
    // Copied text is for other apps: block IDs (` ^id` on almost every block) are noise there, and
    // pasting back into Tessera uses the HTML flavor, which keeps everything.
    keepBlockId: () => false,
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
