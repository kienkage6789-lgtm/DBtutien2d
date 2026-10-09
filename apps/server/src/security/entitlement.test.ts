import assert from 'node:assert/strict';
import test from 'node:test';
import { computeGrant, entitlement } from './entitlement.js';

const day = 86_400_000;
const user = (overrides: Partial<{ role: 'admin' | 'user'; status: 'active' | 'disabled'; expiresAt: number | null }> = {}) => ({
  role: 'user' as const,
  status: 'active' as const,
  expiresAt: null as number | null,
  ...overrides,
});

test('computeGrant handles null, expired, active, and exact-expiry grants', () => {
  assert.deepEqual(computeGrant(null, 1_000, '1d'), { from: 1_000, to: 1_000 + day });
  assert.deepEqual(computeGrant(500, 1_000, '7d'), { from: 1_000, to: 1_000 + 7 * day });
  assert.deepEqual(computeGrant(2_000, 1_000, '30d'), { from: 2_000, to: 2_000 + 30 * day });
  assert.deepEqual(computeGrant(1_000, 1_000, '1d'), { from: 1_000, to: 1_000 + day });
});

test('entitlement is deterministic and keeps admin unrestricted', () => {
  assert.deepEqual(entitlement(user(), 1_000), { state: 'none', expiresAt: null, remainingMs: null });
  assert.deepEqual(entitlement(user({ expiresAt: 1_000 }), 1_000), { state: 'expired', expiresAt: 1_000, remainingMs: 0 });
  assert.deepEqual(entitlement(user({ expiresAt: 2_000 }), 1_000), { state: 'active', expiresAt: 2_000, remainingMs: 1_000 });
  assert.deepEqual(entitlement(user({ status: 'disabled', expiresAt: 2_000 }), 1_000), { state: 'disabled', expiresAt: 2_000, remainingMs: 0 });
  assert.deepEqual(entitlement(user({ role: 'admin', status: 'disabled', expiresAt: null }), 1_000), { state: 'admin', expiresAt: null, remainingMs: null });
});
