/**
 * A small, fast, seeded pseudo-random generator (sfc32, seeded through cyrb128). The same seed
 * always yields the same sequence on every platform, which is what makes generated workspaces
 * reproducible. `fork(label)` derives an independent stream, so a page's content depends only on
 * the seed and the page, never on what was generated before it.
 */

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Cumulative Zipf tables by `n:s`, shared by every generator (they only depend on n and s). */
const zipfTables = new Map<string, Float64Array>();

/** Hashes a string into four 32-bit seeds (cyrb128). */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private readonly seedText: string;

  constructor(seed: number | string) {
    this.seedText = String(seed);
    const [a, b, c, d] = cyrb128(this.seedText);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // Warm up so similar seeds diverge.
    for (let i = 0; i < 12; i += 1) this.uint32();
  }

  /** A 32-bit unsigned integer. */
  uint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    return this.uint32() / 4294967296;
  }

  /** An integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A random element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new RangeError('pick() from an empty list');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** `count` distinct elements (or all of them, shuffled, when there are fewer). */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }

  /** An element picked with probability proportional to its weight. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let target = this.next() * total;
    for (const [item, weight] of items) {
      target -= weight;
      if (target < 0) return item;
    }
    const last = items.at(-1);
    if (!last) throw new RangeError('weighted() from an empty list');
    return last[0];
  }

  /**
   * An index in [0, n) with P(k) ∝ 1 / (k + 1)^s: a Zipf (power-law) distribution, so a few
   * indexes are picked very often and most rarely. Cumulative tables are cached per (n, s).
   */
  zipf(n: number, s = 1.1): number {
    if (n <= 1) return 0;
    const key = `${n}:${s}`;
    let table = zipfTables.get(key);
    if (!table) {
      table = new Float64Array(n);
      let sum = 0;
      for (let k = 0; k < n; k += 1) {
        sum += 1 / (k + 1) ** s;
        table[k] = sum;
      }
      for (let k = 0; k < n; k += 1) table[k] = (table[k] ?? 0) / sum;
      zipfTables.set(key, table);
    }
    const target = this.next();
    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((table[mid] ?? 1) < target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** A geometric count with the given mean (≥ 0). */
  geometric(mean: number): number {
    if (mean <= 0) return 0;
    const p = 1 / (mean + 1);
    return Math.floor(Math.log(1 - this.next()) / Math.log(1 - p));
  }

  /** An ID matching core's `ID_PATTERN` (21 URL-safe characters, like nanoid). */
  id(length = 21): string {
    let id = '';
    for (let i = 0; i < length; i += 1) id += ID_ALPHABET[this.uint32() & 63];
    return id;
  }

  /** An independent stream derived from this generator's seed and `label`. */
  fork(label: string | number): Random {
    return new Random(`${this.seedText}/${String(label)}`);
  }
}
