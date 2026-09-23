/** Small statistics helpers for benchmark samples. */

/** The p-th percentile (0–100) by linear interpolation between closest ranks. */
export function percentile(samples: readonly number[], p: number): number {
  if (!samples.length) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lower = sorted[low] ?? Number.NaN;
  const upper = sorted[high] ?? lower;
  return lower + (upper - lower) * (rank - low);
}

export function median(samples: readonly number[]): number {
  return percentile(samples, 50);
}

export function mean(samples: readonly number[]): number {
  if (!samples.length) return Number.NaN;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

export interface Summary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export function summarize(samples: readonly number[]): Summary {
  return {
    count: samples.length,
    min: samples.length ? Math.min(...samples) : Number.NaN,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples.length ? Math.max(...samples) : Number.NaN,
    mean: mean(samples),
  };
}

/** `1,234 ms`, `12.3 ms`, `0.42 ms`: fewer decimals as values grow. */
export function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ms`;
}
