import type { NextFunction, Request, Response } from 'express';

export const STATIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const HTML_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

export function createSecurityHeaders(options: { trustProxy: boolean } = { trustProxy: false }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    if (options.trustProxy && req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    }

    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "connect-src 'self' ws: wss:",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'self'",
      ].join('; '));
    }
    next();
  };
}

export const securityHeaders = createSecurityHeaders();

interface RateBucket {
  startedAt: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

export class ApiRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly windowMs: number;
  private readonly now: () => number;

  public constructor(options: { now?: () => number; windowMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.windowMs = options.windowMs ?? 60_000;
  }

  public check(keys: string[], limits: number[]): RateLimitDecision {
    const now = this.now();
    const unique = Array.from(new Set(keys)).map((key, index) => ({ key, limit: limits[index] ?? 0 }));
    let retryAfterSec = 0;
    for (const entry of unique) {
      if (entry.limit <= 0) continue;
      const bucket = this.buckets.get(entry.key);
      if (bucket && now - bucket.startedAt < this.windowMs && bucket.count >= entry.limit) {
        retryAfterSec = Math.max(retryAfterSec, Math.ceil((bucket.startedAt + this.windowMs - now) / 1000));
      }
    }
    if (retryAfterSec > 0) return { allowed: false, retryAfterSec };

    for (const entry of unique) {
      if (entry.limit <= 0) continue;
      const bucket = this.buckets.get(entry.key);
      if (!bucket || now - bucket.startedAt >= this.windowMs) {
        this.buckets.set(entry.key, { startedAt: now, count: 1 });
      } else {
        bucket.count += 1;
      }
    }
    this.prune(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  private prune(now: number): void {
    if (this.buckets.size < 2048) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
  }
}
