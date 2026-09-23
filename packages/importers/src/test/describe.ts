import {
  getCellValue,
  resolveRows,
  type AnyNodeJSON,
  type AppContext,
  type JsonValue,
} from '@tessera/core';
import { databaseOf, docOf, propsOf } from './helpers';

/**
 * A comparable description of an imported tree: every page by its title path, with its kind,
 * icon, properties and content (page links as the target's title path), and every database's
 * columns and rows by name. IDs and timestamps are left out, so two imports of the same data
 * compare equal.
 */
export async function describeTree(
  ctx: AppContext,
  rootId: string,
): Promise<Record<string, unknown>> {
  const snapshot = ctx.workspace.pages.getSnapshot();
  const titlePath = (pageId: string): string => {
    const names: string[] = [];
    let current = snapshot.get(pageId);
    while (current && current.id !== rootId) {
      names.unshift(current.title);
      current = current.parentId ? snapshot.get(current.parentId) : undefined;
    }
    return current ? names.join('/') : `(outside)/${snapshot.get(pageId)?.title ?? pageId}`;
  };
  const replaceIds = (node: AnyNodeJSON): AnyNodeJSON => {
    const attrs = node.attrs ? { ...node.attrs } : undefined;
    if (attrs && node.type === 'pageLink') attrs.pageId = titlePath(String(attrs.pageId));
    if (attrs && node.type === 'embed' && attrs.kind === 'database')
      attrs.ref = titlePath(String(attrs.ref));
    const next: AnyNodeJSON = { ...node, ...(attrs ? { attrs } : {}) };
    if (node.content) next.content = node.content.map(replaceIds);
    return next;
  };
  const pages: Record<string, unknown> = {};
  for (const page of snapshot.descendants(rootId)) {
    const key = titlePath(page.id);
    if (page.kind === 'database') {
      const { properties, rows } = await databaseOf(ctx, page.id);
      pages[key] = {
        kind: 'database',
        properties: properties.map((property) => ({
          name: property.name,
          type: property.type,
          options: property.options?.map((option) => option.name) ?? null,
          format: property.number?.format ?? null,
        })),
        rows: resolveRows(rows, snapshot).map((row) =>
          Object.fromEntries(
            properties.map((property) => {
              const value = getCellValue(row, property);
              const named = (id: JsonValue) =>
                property.options?.find((option) => option.id === id)?.name ?? id;
              if (property.type === 'select')
                return [property.name, value === null ? null : named(value)];
              if (property.type === 'multiSelect')
                return [property.name, Array.isArray(value) ? value.map(named) : null];
              if (property.type === 'relation')
                return [
                  property.name,
                  Array.isArray(value) ? value.map((id) => titlePath(String(id))) : null,
                ];
              if (property.type === 'createdTime' || property.type === 'updatedTime')
                return [property.name, 'time'];
              return [property.name, value];
            }),
          ),
        ),
      };
      continue;
    }
    const doc = await docOf(ctx, page.id);
    pages[key] = {
      kind: page.kind,
      icon: page.icon ?? null,
      props: await propsOf(ctx, page.id),
      content: (doc.content as AnyNodeJSON[]).map(replaceIds),
    };
  }
  return pages;
}
