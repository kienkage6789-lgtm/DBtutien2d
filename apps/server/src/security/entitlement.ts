import type { DbUser } from '../db/database.js';

export type GrantDuration = '1d' | '7d' | '30d';
export type EntitlementState = 'admin' | 'active' | 'expired' | 'none' | 'disabled';

export interface EntitlementSnapshot {
  state: EntitlementState;
  expiresAt: number | null;
  remainingMs: number | null;
}

const GRANT_MS: Record<GrantDuration, number> = {
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export function computeGrant(
  currentExpiresAt: number | null,
  now: number,
  duration: GrantDuration,
): { from: number; to: number } {
  const from = Math.max(now, currentExpiresAt ?? 0);
  return { from, to: from + GRANT_MS[duration] };
}

export function entitlement(user: Pick<DbUser, 'role' | 'status' | 'expiresAt'>, now: number): EntitlementSnapshot {
  if (user.role === 'admin') return { state: 'admin', expiresAt: user.expiresAt, remainingMs: null };
  if (user.status === 'disabled') return { state: 'disabled', expiresAt: user.expiresAt, remainingMs: 0 };
  if (user.expiresAt === null) return { state: 'none', expiresAt: null, remainingMs: null };
  const remainingMs = Math.max(0, user.expiresAt - now);
  return remainingMs > 0
    ? { state: 'active', expiresAt: user.expiresAt, remainingMs }
    : { state: 'expired', expiresAt: user.expiresAt, remainingMs: 0 };
}
