import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiRateLimiter, createSecurityHeaders } from './http-hardening.js';

test('API rate limiter uses separate IP and user windows with injected time', () => {
  let now = 1_000;
  const limiter = new ApiRateLimiter({ now: () => now, windowMs: 60_000 });
  assert.equal(limiter.check(['ip:1', 'user:a'], [2, 3]).allowed, true);
  assert.equal(limiter.check(['ip:1', 'user:a'], [2, 3]).allowed, true);
  const blocked = limiter.check(['ip:1', 'user:a'], [2, 3]);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 60);
  now += 60_000;
  assert.equal(limiter.check(['ip:1', 'user:a'], [2, 3]).allowed, true);
});

test('disabled rate limit does not create a bucket', () => {
  const limiter = new ApiRateLimiter({ now: () => 1_000 });
  for (let i = 0; i < 3_000; i += 1) assert.equal(limiter.check(['ip:1', 'user:a'], [0, 0]).allowed, true);
});

test('security headers distinguish API and static responses', () => {
  const headers = new Map<string, string>();
  const res = { setHeader: (name: string, value: string) => headers.set(name, value) } as any;
  const next = () => undefined;
  createSecurityHeaders({ trustProxy: false })({ path: '/api/auth/me', secure: false } as any, res, next);
  assert.equal(headers.get('Cache-Control'), 'no-store');
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  headers.clear();
  createSecurityHeaders({ trustProxy: true })({ path: '/', secure: true } as any, res, next);
  assert.match(headers.get('Content-Security-Policy') ?? '', /script-src 'self'/);
  assert.equal(headers.get('Strict-Transport-Security'), 'max-age=15552000');
});
