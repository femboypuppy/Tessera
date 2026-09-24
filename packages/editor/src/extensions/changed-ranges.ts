import type { Transaction } from '@tiptap/pm/state';

/** A range in the final document. */
export interface ChangedRange {
  from: number;
  to: number;
}

/**
 * The ranges of the final document touched by a batch of transactions (each step's new range,
 * mapped through every later step). Used by plugins that only look at what changed.
 */
export function changedRanges(transactions: readonly Transaction[]): ChangedRange[] {
  const maps = transactions.flatMap((tr) => tr.mapping.maps);
  const ranges: ChangedRange[] = [];
  maps.forEach((stepMap, index) => {
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      let from = newStart;
      let to = newEnd;
      for (let later = index + 1; later < maps.length; later += 1) {
        const map = maps[later];
        if (!map) continue;
        from = map.map(from, -1);
        to = map.map(to, 1);
      }
      ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
    });
  });
  ranges.sort((a, b) => a.from - b.from);
  const merged: ChangedRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}
