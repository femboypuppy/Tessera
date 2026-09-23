import { ID_PATTERN } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { Random } from './random';

describe('Random', () => {
  it('repeats the same sequence for the same seed and differs across seeds', () => {
    const sequence = (seed: number | string) => {
      const rng = new Random(seed);
      return Array.from({ length: 8 }, () => rng.uint32());
    };
    expect(sequence(42)).toEqual(sequence(42));
    expect(sequence('42')).toEqual(sequence(42));
    expect(sequence(42)).not.toEqual(sequence(43));
  });

  it('forks independent, reproducible streams', () => {
    const a = new Random(1).fork('page:7');
    const b = new Random(1).fork('page:7');
    const parent = new Random(1);
    parent.uint32();
    expect(parent.fork('page:7').next()).toBe(a.next());
    expect(b.next()).toBe(new Random(1).fork('page:7').next());
    expect(new Random(1).fork('page:8').next()).not.toBe(new Random(1).fork('page:7').next());
  });

  it('stays within bounds', () => {
    const rng = new Random('bounds');
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const int = rng.int(3, 7);
      expect(int).toBeGreaterThanOrEqual(3);
      expect(int).toBeLessThanOrEqual(7);
    }
  });

  it('makes valid, distinct IDs', () => {
    const rng = new Random('ids');
    const ids = Array.from({ length: 1000 }, () => rng.id());
    expect(ids.every((id) => ID_PATTERN.test(id) && id.length === 21)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws a power law from zipf(): rank 0 dominates, the tail is long', () => {
    const rng = new Random('zipf');
    const counts = new Array<number>(100).fill(0);
    for (let i = 0; i < 20_000; i += 1) {
      const rank = rng.zipf(100, 1.1);
      counts[rank] = (counts[rank] ?? 0) + 1;
    }
    expect(counts[0] ?? 0).toBeGreaterThan(5 * (counts[10] ?? 0));
    expect(counts[10] ?? 0).toBeGreaterThan(counts[90] ?? 0);
    expect(counts.filter((count) => count > 0).length).toBeGreaterThan(90);
  });

  it('samples, shuffles and weighs without losing items', () => {
    const rng = new Random('lists');
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(rng.sample([1, 2, 3, 4, 5], 3)).size).toBe(3);
    expect(rng.sample([1, 2], 5)).toHaveLength(2);
    const picks = Array.from({ length: 1000 }, () =>
      rng.weighted([
        ['a', 9],
        ['b', 1],
      ] as const),
    );
    expect(picks.filter((pick) => pick === 'a').length).toBeGreaterThan(800);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(rng.geometric(0)).toBe(0);
  });
});
