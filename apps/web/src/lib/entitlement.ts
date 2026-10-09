import type { AuthUser } from '../types';

export function formatRemaining(expiresAt: number | null, now: number = Date.now()): string {
  if (expiresAt === null) return 'chưa được cấp';
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'đã hết hạn';
  const totalHours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days} ngày${hours > 0 ? ` ${hours} giờ` : ''}`;
  if (hours > 0) return `${hours} giờ`;
  return 'dưới 1 giờ';
}

export function entitlementLockReason(user: Pick<AuthUser, 'role' | 'entitlement'>, now: number = Date.now()): string | null {
  if (user.role === 'admin' || user.entitlement.state === 'admin') return null;
  if (user.entitlement.state === 'active' && user.entitlement.expiresAt !== null && user.entitlement.expiresAt <= now) {
    return 'Tài khoản đã hết hạn, liên hệ admin để gia hạn';
  }
  if (user.entitlement.state === 'active') return null;
  if (user.entitlement.state === 'disabled') return 'Tài khoản người dùng đã bị khóa';
  if (user.entitlement.state === 'none') return 'Tài khoản chưa được cấp hạn sử dụng';
  return 'Tài khoản đã hết hạn, liên hệ admin để gia hạn';
}

export function canAddAccount(user: Pick<AuthUser, 'role' | 'usage'>): boolean {
  return user.role === 'admin' || !user.usage || user.usage.accounts < user.usage.maxBots;
}
