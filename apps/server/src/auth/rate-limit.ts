/**
 * A fixed-window rate limiter kept in memory (one server process). Keys are things like
 * `login:ip:203.0.113.7` or `login:email:ada@example.com`.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Counts one attempt. Returns 0 when allowed, or the seconds to wait when the key exceeded
   * `limit` attempts within `windowMs`.
   */
  hit(key: string, limit: number, windowMs: number): number {
    const now = this.now();
    this.sweep(now);
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return 0;
    }
    entry.count += 1;
    if (entry.count <= limit) return 0;
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  }

  /** Forgets a key (a successful login clears its failures). */
  reset(key: string): void {
    this.windows.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(key);
  }
}
