import { describe, expect, it } from 'vitest';
import { LayoutEngine, type LayoutInput } from './layout-engine';
import { mix } from './theme';

/** Two tight cliques joined by one edge, starting from scrambled positions. */
function twoClusters(): LayoutInput {
  const count = 12;
  const positions = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    positions[i * 2] = Math.cos(i * 2.4) * 50;
    positions[i * 2 + 1] = Math.sin(i * 1.7) * 50;
  }
  const pairs: Array<[number, number]> = [];
  for (const offset of [0, 6]) {
    for (let i = 0; i < 6; i += 1)
      for (let j = i + 1; j < 6; j += 1) pairs.push([offset + i, offset + j]);
  }
  pairs.push([0, 6]);
  return {
    positions,
    sizes: new Float32Array(count).fill(4),
    edges: Uint32Array.from(pairs.flat()),
    weights: new Float32Array(pairs.length).fill(1),
  };
}

function distance(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    (positions[a * 2] ?? 0) - (positions[b * 2] ?? 0),
    (positions[a * 2 + 1] ?? 0) - (positions[b * 2 + 1] ?? 0),
  );
}

describe('LayoutEngine', () => {
  it('settles and stops, pulling linked pages together', () => {
    const engine = new LayoutEngine(twoClusters());
    let steps = 0;
    while (!engine.step(10)) steps += 1;
    expect(engine.done).toBe(true);
    expect(engine.iteration).toBeLessThanOrEqual(1200);
    expect(steps).toBeGreaterThan(0);
    const positions = engine.positions();
    expect([...positions].every(Number.isFinite)).toBe(true);
    const within = (distance(positions, 1, 2) + distance(positions, 7, 8)) / 2;
    const across = (distance(positions, 1, 7) + distance(positions, 2, 8)) / 2;
    expect(within).toBeLessThan(across);
    // Once done, it stays put.
    const settled = engine.positions();
    engine.step(50);
    expect([...engine.positions()]).toEqual([...settled]);
  });

  it('never moves fixed nodes and handles empty graphs', () => {
    const input = { ...twoClusters(), fixed: Uint32Array.from([3]) };
    const engine = new LayoutEngine(input, { maxIterations: 60 });
    engine.step(60);
    const positions = engine.positions();
    expect(positions[6]).toBeCloseTo(input.positions[6] ?? 0);
    expect(positions[7]).toBeCloseTo(input.positions[7] ?? 0);
    const empty = new LayoutEngine({
      positions: new Float32Array(0),
      sizes: new Float32Array(0),
      edges: new Uint32Array(0),
      weights: new Float32Array(0),
    });
    expect(empty.step(1)).toBe(true);
  });
});

describe('mix', () => {
  it('blends hex colors and leaves other formats alone', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#fff', '#000', 1)).toBe('#000000');
    expect(mix('rgb(1 2 3)', '#000000', 0.5)).toBe('rgb(1 2 3)');
  });
});
