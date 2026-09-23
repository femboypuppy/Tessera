import type { AppContext, LinkEdge } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { useCallback, useEffect, useState } from 'react';
import type { GraphNode, GraphSnapshot } from '../engine/types';
import { isGraphLinkIndex } from '../services/guards';

/**
 * A graph snapshot from any link index: ours gives tags and top-level pages directly; for others
 * (the core stub) it is derived from `edges()` and the page tree, without tags.
 */
export async function loadGraph(ctx: AppContext): Promise<GraphSnapshot> {
  const index = ctx.services.linkIndex;
  if (isGraphLinkIndex(index)) return index.graph();
  return fromEdges(ctx, await index.edges());
}

/** The neighborhood of a page (`depth` links in either direction). */
export async function loadNeighborhood(
  ctx: AppContext,
  pageId: string,
  depth: number,
): Promise<GraphSnapshot> {
  const index = ctx.services.linkIndex;
  if (isGraphLinkIndex(index)) return index.neighborhood(pageId, depth);
  const full = fromEdges(ctx, await index.edges());
  const reached = new Set([pageId]);
  let frontier = [pageId];
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next: string[] = [];
    for (const edge of full.edges) {
      for (const [from, to] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ] as const) {
        if (frontier.includes(from) && !reached.has(to)) {
          reached.add(to);
          next.push(to);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: full.nodes.filter((node) => reached.has(node.id)),
    edges: full.edges.filter((edge) => reached.has(edge.source) && reached.has(edge.target)),
    tags: [],
  };
}

function fromEdges(ctx: AppContext, edges: LinkEdge[]): GraphSnapshot {
  const snapshot = ctx.workspace.pages.getSnapshot();
  const nodes: GraphNode[] = snapshot
    .all()
    .filter((page) => !snapshot.isTrashed(page.id))
    .map((page) => ({
      id: page.id,
      title: page.title,
      kind: page.kind,
      icon: page.icon ?? null,
      isRow: snapshot.isRow(page.id),
      rootId: snapshot.ancestors(page.id)[0]?.id ?? page.id,
      tags: [],
      updatedAt: page.updatedAt,
    }));
  return { nodes, edges, tags: [] };
}

export interface GraphData {
  status: 'loading' | 'ready' | 'error';
  snapshot: GraphSnapshot | null;
  retry(): void;
}

/**
 * Loads a graph snapshot and reloads it when links change. The previous snapshot stays until the
 * next one arrives, so the graph never blinks.
 */
export function useGraphData(
  load: (ctx: AppContext) => Promise<GraphSnapshot>,
  key: string,
): GraphData {
  const ctx = useAppContext();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    status: GraphData['status'];
    snapshot: GraphSnapshot | null;
    key: string;
  }>({ status: 'loading', snapshot: null, key });
  useEffect(() => ctx.services.linkIndex.subscribe(() => setVersion((value) => value + 1)), [ctx]);
  useEffect(() => {
    let active = true;
    load(ctx).then(
      (snapshot) => {
        if (active) setState({ status: 'ready', snapshot, key });
      },
      (error: unknown) => {
        console.warn('[graph] loading the graph failed', error);
        if (active) setState((previous) => ({ ...previous, status: 'error', key }));
      },
    );
    return () => {
      active = false;
    };
  }, [ctx, load, key, version]);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  const snapshot = state.key === key ? state.snapshot : null;
  return { status: state.key === key ? state.status : 'loading', snapshot, retry };
}
