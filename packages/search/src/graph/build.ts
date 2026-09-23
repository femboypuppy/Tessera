import type { LinkEdge } from '@tessera/core';
import Graph from 'graphology';
import type { GraphNode, GraphSnapshot } from '../engine/types';
import type { LayoutInput } from './layout-engine';
import { mix, type GraphTheme } from './theme';

export type ColorBy = 'tag' | 'parent';

/** What the graph shows. */
export interface GraphFilters {
  /** Tag keys: when set, only pages with one of them. */
  tags: string[];
  showOrphans: boolean;
  showRows: boolean;
  /** Links around `focus` to include (null = everything). */
  depth: number | null;
  focus: string | null;
}

export const DEFAULT_FILTERS: GraphFilters = {
  tags: [],
  showOrphans: true,
  showRows: false,
  depth: null,
  focus: null,
};

export interface NodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  group: string | null;
  kind: GraphNode['kind'];
  isRow: boolean;
  degree: number;
  /** Local graphs mark the page they are about. */
  center?: boolean;
  /** Always show the label (sigma reads it). */
  forceLabel?: boolean;
}

export interface EdgeAttributes {
  size: number;
  color: string;
  weight: number;
}

export type TesseraGraph = Graph<NodeAttributes, EdgeAttributes>;

/** A color group, for the legend. */
export interface GroupInfo {
  key: string;
  label: string;
  color: string;
  count: number;
}

/** A stable pseudo-random number in [0, 1) for a string (FNV-1a). */
function hash(text: string, salt = 0): number {
  let value = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value / 4_294_967_296;
}

/** Applies the filters: which nodes and edges are visible, and their degrees. */
export function selectVisible(
  snapshot: GraphSnapshot,
  filters: GraphFilters,
): { nodes: GraphNode[]; edges: LinkEdge[]; degree: Map<string, number> } {
  const wantedTags = filters.tags.length ? new Set(filters.tags) : null;
  let nodes = snapshot.nodes.filter(
    (node) =>
      (filters.showRows || !node.isRow) &&
      (!wantedTags || node.tags.some((tag) => wantedTags.has(tag)) || node.id === filters.focus),
  );
  let ids = new Set(nodes.map((node) => node.id));
  let edges = snapshot.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  if (filters.focus && filters.depth !== null && ids.has(filters.focus)) {
    const adjacency = new Map<string, string[]>();
    const connect = (from: string, to: string) => {
      const list = adjacency.get(from);
      if (list) list.push(to);
      else adjacency.set(from, [to]);
    };
    for (const edge of edges) {
      connect(edge.source, edge.target);
      connect(edge.target, edge.source);
    }
    const reached = new Set([filters.focus]);
    let frontier = [filters.focus];
    for (let level = 0; level < filters.depth && frontier.length; level += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!reached.has(neighbor)) {
            reached.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    nodes = nodes.filter((node) => reached.has(node.id));
    ids = reached;
    edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  if (!filters.showOrphans) {
    nodes = nodes.filter((node) => (degree.get(node.id) ?? 0) > 0 || node.id === filters.focus);
  }
  return { nodes, edges, degree };
}

/** Node size from its degree (screen pixels at zoom 1). */
export function nodeSize(degree: number, order: number): number {
  const base = order > 3000 ? 1.6 : order > 800 ? 2.2 : 2.6;
  const scale = order > 3000 ? 1.1 : 1.9;
  return Math.min(order > 3000 ? 12 : 20, base + scale * Math.sqrt(degree));
}

/**
 * Starting positions: each top-level page's pages form a disc around a point on a circle, so the
 * layout converges quickly and communities stay together. Deterministic per page ID.
 */
function seeder(nodes: readonly GraphNode[]): (node: GraphNode) => { x: number; y: number } {
  const clusters = new Map<string, number>();
  for (const node of nodes) clusters.set(node.rootId, (clusters.get(node.rootId) ?? 0) + 1);
  const roots = [...clusters.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rootIndex = new Map(roots.map(([root], index) => [root, index]));
  const spread = roots.length > 1 ? Math.sqrt(Math.max(1, nodes.length)) * 12 : 0;
  return (node) => {
    const index = rootIndex.get(node.rootId) ?? 0;
    const angle = (index / Math.max(1, roots.length)) * Math.PI * 2 + hash(node.rootId) * 0.3;
    const radius = Math.sqrt(clusters.get(node.rootId) ?? 1) * 6 * Math.sqrt(hash(node.id, 1));
    const theta = hash(node.id, 2) * Math.PI * 2;
    return {
      x: Math.cos(angle) * spread + Math.cos(theta) * radius,
      y: Math.sin(angle) * spread + Math.sin(theta) * radius,
    };
  };
}

/** Puts every node back at its starting position (before a fresh layout). */
export function reseed(graph: TesseraGraph, snapshot: GraphSnapshot): void {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const visible: GraphNode[] = [];
  graph.forEachNode((id) => {
    const node = byId.get(id);
    if (node) visible.push(node);
  });
  const seed = seeder(visible);
  graph.updateEachNodeAttributes(
    (id, attributes) => {
      const node = byId.get(id);
      if (!node) return attributes;
      const { x, y } = seed(node);
      attributes.x = x;
      attributes.y = y;
      return attributes;
    },
    { attributes: ['x', 'y'] },
  );
}

/**
 * Builds the graphology graph for a snapshot. Nodes keep `previous` positions when known;
 * new ones start near their top-level page's cluster, so the layout converges quickly and
 * communities stay together.
 */
export function buildGraph(
  snapshot: GraphSnapshot,
  filters: GraphFilters,
  previous?: ReadonlyMap<string, { x: number; y: number }>,
): TesseraGraph {
  const { nodes, edges, degree } = selectVisible(snapshot, filters);
  const graph: TesseraGraph = new Graph<NodeAttributes, EdgeAttributes>({
    type: 'directed',
    multi: false,
    allowSelfLoops: false,
  });
  const seed = seeder(nodes);
  for (const node of nodes) {
    const { x, y } = previous?.get(node.id) ?? seed(node);
    const nodeDegree = degree.get(node.id) ?? 0;
    graph.addNode(node.id, {
      x,
      y,
      size: nodeSize(nodeDegree, nodes.length),
      color: '#888888',
      label: node.title,
      group: null,
      kind: node.kind,
      isRow: node.isRow,
      degree: nodeDegree,
    });
  }
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    if (graph.hasEdge(key)) continue;
    graph.addDirectedEdgeWithKey(key, edge.source, edge.target, {
      size: Math.min(3, 0.6 + Math.log2(edge.count) * 0.5),
      color: '#cccccc',
      weight: edge.count,
    });
  }
  return graph;
}

/**
 * Colors the graph in place (by the most common tag of each page, or by top-level page) and
 * returns the legend. Groups beyond the palette share the neutral color.
 */
export function colorGraph(
  graph: TesseraGraph,
  snapshot: GraphSnapshot,
  colorBy: ColorBy,
  theme: GraphTheme,
  labels: { other: string; none: string; untitled: string },
  options: { reserveAccent?: boolean } = {},
): GroupInfo[] {
  const palette = options.reserveAccent
    ? theme.groups.filter((color) => color !== theme.accent)
    : theme.groups;
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const groupOf = new Map<string, string | null>();
  const counts = new Map<string, number>();
  if (colorBy === 'tag') {
    const frequency = new Map<string, number>();
    graph.forEachNode((id) => {
      for (const tag of byId.get(id)?.tags ?? []) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
    });
    graph.forEachNode((id) => {
      const tags = byId.get(id)?.tags ?? [];
      let best: string | null = null;
      for (const tag of tags) {
        if (best === null || (frequency.get(tag) ?? 0) > (frequency.get(best) ?? 0)) best = tag;
      }
      groupOf.set(id, best);
      if (best) counts.set(best, (counts.get(best) ?? 0) + 1);
    });
  } else {
    graph.forEachNode((id) => {
      const root = byId.get(id)?.rootId ?? id;
      groupOf.set(id, root);
      counts.set(root, (counts.get(root) ?? 0) + 1);
    });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const colors = new Map<string, string>();
  ranked.slice(0, palette.length).forEach(([key], index) => {
    colors.set(key, palette[index] ?? theme.neutral);
  });
  const edgeColor = mix(theme.edge, theme.background, theme.dark ? 0.25 : 0.2);
  graph.updateEachNodeAttributes(
    (id, attributes) => {
      const group = groupOf.get(id) ?? null;
      return {
        ...attributes,
        group,
        color: attributes.center ? theme.accent : ((group && colors.get(group)) ?? theme.neutral),
      };
    },
    { attributes: ['group', 'color'] },
  );
  graph.updateEachEdgeAttributes((_, attributes) => ({ ...attributes, color: edgeColor }), {
    attributes: ['color'],
  });
  const legend: GroupInfo[] = ranked.slice(0, palette.length).map(([key, count]) => ({
    key,
    count,
    color: colors.get(key) ?? theme.neutral,
    label: colorBy === 'tag' ? `#${key}` : byId.get(key)?.title.trim() || labels.untitled,
  }));
  const rest = ranked.slice(palette.length).reduce((sum, [, count]) => sum + count, 0);
  let none = 0;
  graph.forEachNode((id) => {
    if (groupOf.get(id) === null) none += 1;
  });
  if (rest > 0)
    legend.push({ key: '__other', label: labels.other, color: theme.neutral, count: rest });
  if (none > 0 && colorBy === 'tag')
    legend.push({ key: '__none', label: labels.none, color: theme.neutral, count: none });
  return legend;
}

/** The layout input for a graph (node order = `graph.nodes()`). */
export function layoutInput(graph: TesseraGraph, fixed: readonly string[] = []): LayoutInput {
  const ids = graph.nodes();
  const index = new Map(ids.map((id, i) => [id, i]));
  const positions = new Float32Array(ids.length * 2);
  const sizes = new Float32Array(ids.length);
  ids.forEach((id, i) => {
    const attributes = graph.getNodeAttributes(id);
    positions[i * 2] = attributes.x;
    positions[i * 2 + 1] = attributes.y;
    sizes[i] = attributes.size;
  });
  const edges = new Uint32Array(graph.size * 2);
  const weights = new Float32Array(graph.size);
  let e = 0;
  graph.forEachEdge((_, attributes, source, target) => {
    edges[e * 2] = index.get(source) ?? 0;
    edges[e * 2 + 1] = index.get(target) ?? 0;
    weights[e] = attributes.weight;
    e += 1;
  });
  const input: LayoutInput = { positions, sizes, edges, weights };
  const pinned = fixed.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
  if (pinned.length) input.fixed = Uint32Array.from(pinned);
  return input;
}

/** Writes layout positions back into the graph (one batched update). */
export function applyPositions(graph: TesseraGraph, positions: Float32Array): void {
  let i = 0;
  graph.updateEachNodeAttributes(
    (_, attributes) => {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      i += 1;
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
        return attributes;
      // In place: this runs for every node on every layout tick.
      attributes.x = x;
      attributes.y = y;
      return attributes;
    },
    { attributes: ['x', 'y'] },
  );
}
