/** In-memory fixed-window limiter for failed authentication attempts, keyed by client address. */
export interface FailureLimiterOptions {
  /** Failures allowed per window before the key is blocked. */
  max: number;
  windowMs: number;
}

export class FailureLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: FailureLimiterOptions) {}

  /** Seconds until the key may try again, or 0 if it is not blocked. */
  retryAfterSeconds(key: string, nowMs: number): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    if (e.resetAt <= nowMs) {
      this.entries.delete(key);
      return 0;
    }
    return e.count >= this.options.max ? Math.ceil((e.resetAt - nowMs) / 1000) : 0;
  }

  recordFailure(key: string, nowMs: number): void {
    const e = this.entries.get(key);
    if (!e || e.resetAt <= nowMs) {
      this.sweep(nowMs);
      this.entries.set(key, { count: 1, resetAt: nowMs + this.options.windowMs });
    } else {
      e.count += 1;
    }
  }

  /** Bounds memory: drops expired windows. */
  private sweep(nowMs: number): void {
    if (this.entries.size < 1000) return;
    for (const [k, v] of this.entries) if (v.resetAt <= nowMs) this.entries.delete(k);
  }
}
