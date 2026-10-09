import { describe, expect, it } from 'vitest';
import { canAddAccount, entitlementLockReason, formatRemaining } from './entitlement';

describe('entitlement display helpers', () => {
  it('formats server expiry in days and hours', () => {
    expect(formatRemaining(3 * 86_400_000 + 3 * 3_600_000, 0)).toBe('3 ngày 3 giờ');
    expect(formatRemaining(3 * 3_600_000, 0)).toBe('3 giờ');
    expect(formatRemaining(null, 0)).toBe('chưa được cấp');
    expect(formatRemaining(0, 0)).toBe('đã hết hạn');
  });

  it('locks only regular users without active entitlement', () => {
    expect(entitlementLockReason({ role: 'admin', entitlement: { state: 'admin', expiresAt: null, remainingMs: null } })).toBeNull();
    expect(entitlementLockReason({ role: 'user', entitlement: { state: 'active', expiresAt: 2, remainingMs: 1 } }, 1)).toBeNull();
    expect(entitlementLockReason({ role: 'user', entitlement: { state: 'active', expiresAt: 2, remainingMs: 1 } }, 2)).toContain('hết hạn');
    expect(entitlementLockReason({ role: 'user', entitlement: { state: 'expired', expiresAt: 1, remainingMs: 0 } })).toContain('hết hạn');
    expect(entitlementLockReason({ role: 'user', entitlement: { state: 'none', expiresAt: null, remainingMs: null } })).toContain('chưa được cấp');
  });

  it('locks add-account at quota but not for admin', () => {
    expect(canAddAccount({ role: 'user', usage: { accounts: 3, running: 1, maxBots: 3 } })).toBe(false);
    expect(canAddAccount({ role: 'user', usage: { accounts: 2, running: 1, maxBots: 3 } })).toBe(true);
    expect(canAddAccount({ role: 'admin' })).toBe(true);
  });
});
