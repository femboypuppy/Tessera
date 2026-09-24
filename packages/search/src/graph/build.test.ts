import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphSnapshot } from '../engine/types';
import {
  applyPositions,
  buildGraph,
  colorGraph,
  DEFAULT_FILTERS,
  layoutInput,
  nodeSize,
  reseed,
  selectVisible,
} from './build';
import { readGraphTheme } from './theme';

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    title: id.toUpperCase(),
    kind: 'page',
    icon: null,
    isRow: false,
    rootId: id,
    tags: [],
    updatedAt: 0,
    ...extra,
  };
}

/** hub ← a, b, c; c → d; row r under db; lonely page o. */
const snapshot: GraphSnapshot = {
  nodes: [
    node('hub', { tags: ['space'] }),
    node('a', { rootId: 'hub', tags: ['space', 'moon'] }),
    node('b', { rootId: 'hub', tags: ['moon'] }),
    node('c', { rootId: 'hub' }),
    node('d', { rootId: 'x', tags: ['space'] }),
    node('db', { kind: 'database' }),
    node('r', { rootId: 'db', isRow: true }),
    node('o'),
  ],
  edges: [
    { source: 'a', target: 'hub', count: 1 },
    { source: 'b', target: 'hub', count: 2 },
    { source: 'c', target: 'hub', count: 1 },
    { source: 'c', target: 'd', count: 1 },
    { source: 'r', target: 'hub', count: 1 },
  ],
  tags: [
    { key: 'space', name: 'space', count: 3 },
    { key: 'moon', name: 'moon', count: 2 },
  ],
};

const ids = (list: Array<{ id: string }>) => list.map((item) => item.id).sort();

describe('selectVisible', () => {
  it('hides rows by default and counts degrees over visible edges', () => {
    const { nodes, degree } = selectVisible(snapshot, DEFAULT_FILTERS);
    expect(ids(nodes)).toEqual(['a', 'b', 'c', 'd', 'db', 'hub', 'o']);
    expect(degree.get('hub')).toBe(3);
    const withRows = selectVisible(snapshot, { ...DEFAULT_FILTERS, showRows: true });
    expect(withRows.degree.get('hub')).toBe(4);
  });

  it('filters by tag and hides orphans', () => {
    expect(ids(selectVisible(snapshot, { ...DEFAULT_FILTERS, tags: ['moon'] }).nodes)).toEqual([
      'a',
      'b',
    ]);
    expect(ids(selectVisible(snapshot, { ...DEFAULT_FILTERS, showOrphans: false }).nodes)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'hub',
    ]);
  });

  it('limits to a depth around the focused page', () => {
    const one = selectVisible(snapshot, { ...DEFAULT_FILTERS, focus: 'd', depth: 1 });
    expect(ids(one.nodes)).toEqual(['c', 'd']);
    const two = selectVisible(snapshot, { ...DEFAULT_FILTERS, focus: 'd', depth: 2 });
    expect(ids(two.nodes)).toEqual(['c', 'd', 'hub']);
    const all = selectVisible(snapshot, { ...DEFAULT_FILTERS, focus: 'd', depth: null });
    expect(all.nodes).toHaveLength(7);
  });
});

describe('buildGraph', () => {
  it('sizes nodes by degree and keeps known positions', () => {
    const graph = buildGraph(snapshot, DEFAULT_FILTERS, new Map([['a', { x: 5, y: 7 }]]));
    expect(graph.order).toBe(7);
    expect(graph.size).toBe(4);
    expect(graph.getNodeAttribute('hub', 'size')).toBeGreaterThan(
      graph.getNodeAttribute('a', 'size'),
    );
    expect(graph.getNodeAttribute('o', 'size')).toBe(nodeSize(0, 7));
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 5, y: 7 });
    expect(graph.getEdgeAttribute('b->hub', 'weight')).toBe(2);
  });

  it('seeds positions deterministically, clustered by top-level page', () => {
    const first = buildGraph(snapshot, DEFAULT_FILTERS);
    const second = buildGraph(snapshot, DEFAULT_FILTERS);
    expect(first.getNodeAttributes('c')).toEqual(second.getNodeAttributes('c'));
    const distance = (p: string, q: string) =>
      Math.hypot(
        first.getNodeAttribute(p, 'x') - first.getNodeAttribute(q, 'x'),
        first.getNodeAttribute(p, 'y') - first.getNodeAttribute(q, 'y'),
      );
    // Same cluster (hub's pages) are closer than pages of other clusters.
    expect(distance('a', 'b')).toBeLessThan(distance('a', 'o'));
    first.setNodeAttribute('a', 'x', 999);
    reseed(first, snapshot);
    expect(first.getNodeAttribute('a', 'x')).toBe(second.getNodeAttribute('a', 'x'));
  });

  it('round-trips positions through the layout input', () => {
    const graph = buildGraph(snapshot, DEFAULT_FILTERS);
    const input = layoutInput(graph, ['hub']);
    expect(input.positions).toHaveLength(graph.order * 2);
    expect(input.edges).toHaveLength(graph.size * 2);
    expect([...(input.fixed ?? [])]).toEqual([graph.nodes().indexOf('hub')]);
    const moved = input.positions.map((value) => value + 1);
    applyPositions(graph, moved);
    expect(graph.getNodeAttribute(graph.nodes()[0] ?? '', 'x')).toBeCloseTo(
      (input.positions[0] ?? 0) + 1,
    );
  });
});

describe('colorGraph', () => {
  const theme = { ...readGraphTheme(null), groups: ['#111111', '#222222'] };
  const labels = { other: 'Other', none: 'No tag', untitled: 'Untitled' };

  it('colors by the most common tag and builds a legend', () => {
    const graph = buildGraph(snapshot, DEFAULT_FILTERS);
    const legend = colorGraph(graph, snapshot, 'tag', theme, labels);
    expect(graph.getNodeAttribute('a', 'group')).toBe('space');
    expect(graph.getNodeAttribute('b', 'group')).toBe('moon');
    expect(graph.getNodeAttribute('a', 'color')).toBe('#111111');
    expect(graph.getNodeAttribute('c', 'color')).toBe(theme.neutral);
    expect(legend.map((group) => [group.label, group.count])).toEqual([
      ['#space', 3],
      ['#moon', 1],
      ['No tag', 3],
    ]);
  });

  it('colors by top-level page, puts the rest in Other, and can reserve the accent', () => {
    const graph = buildGraph(snapshot, DEFAULT_FILTERS);
    const legend = colorGraph(graph, snapshot, 'parent', theme, labels);
    expect(legend[0]).toMatchObject({ key: 'hub', label: 'HUB', count: 4, color: '#111111' });
    expect(legend.at(-1)).toMatchObject({ label: 'Other', color: theme.neutral });
    const accented = { ...theme, accent: '#111111' };
    graph.setNodeAttribute('hub', 'center', true);
    colorGraph(graph, snapshot, 'parent', accented, labels, { reserveAccent: true });
    expect(graph.getNodeAttribute('hub', 'color')).toBe('#111111');
    expect(graph.getNodeAttribute('a', 'color')).toBe('#222222');
  });
});
