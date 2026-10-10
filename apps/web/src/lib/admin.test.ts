import { describe, expect, it } from 'vitest';
import type { AdminUser } from '../types';
import { auditActionLabel, filterAdminUsers, filterAuditLogs, formatAdminExpiry, formatFrameMetrics, generateRandomPassword, getAdminActionPolicy } from './admin';

const user = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'user-1', username: 'alice', role: 'user', status: 'active', expiresAt: 10_000,
  maxBots: 3, mustChangePassword: false, entitlement: { state: 'active', expiresAt: 10_000, remainingMs: 10_000 },
  usage: { accounts: 1, running: 0, maxBots: 3 }, createdAt: new Date(1).toISOString(), lastLoginAt: null,
  createdBy: null, activeSessions: 1, ...overrides,
});

describe('admin dashboard helpers', () => {
  it('formats frame metrics and shows unknown when any displayed value is missing', () => {
    expect(formatFrameMetrics({ frames: 10, avgMs: 1.24, p95Ms: 2.34, maxMs: 3, busyRatio: 0.125, windowMs: 100 })).toBe('Khung: 1.2 ms (p95 2.3) · chiếm 12.5%');
    expect(formatFrameMetrics(null)).toBe('Khung: chưa biết');
    expect(formatFrameMetrics({ frames: 10, avgMs: null, p95Ms: 2, maxMs: 3, busyRatio: 0.2, windowMs: 100 })).toBe('Khung: chưa biết');
  });
  it('formats admin, missing and expired entitlement without inventing a date', () => {
    expect(formatAdminExpiry(user({ role: 'admin', expiresAt: null })).label).toBe('Admin — không hết hạn');
    expect(formatAdminExpiry(user({ expiresAt: null, entitlement: { state: 'none', expiresAt: null, remainingMs: null } })).label).toBe('Chưa cấp');
    expect(formatAdminExpiry(user({ expiresAt: 1, entitlement: { state: 'expired', expiresAt: 1, remainingMs: 0 } }), 2_000).label).toBe('Hết hạn');
    expect(formatAdminExpiry(user(), 0).label).toContain('Còn');
  });

  it('filters users and audit entries by the requested fields', () => {
    const bob = user({ id: 'user-2', username: 'bob' });
    expect(filterAdminUsers([user(), bob], 'ALI')).toHaveLength(1);
    const logs = [
      { id: '1', at: 1, action: 'user_created', actor: { id: 'a', username: 'admin' }, targetType: 'user', targetId: 'user-1', targetName: 'alice', detail: '' },
      { id: '2', at: 2, action: 'user_deleted', actor: null, targetType: 'user', targetId: 'user-2', detail: '' },
    ];
    expect(filterAuditLogs(logs, 'user_created', '', '')).toHaveLength(1);
    expect(filterAuditLogs(logs, '', 'ali', '')).toHaveLength(1);
    expect(filterAuditLogs(logs, '', '', 'user-2')).toHaveLength(1);
  });

  it('enforces self/last-admin action policy and keeps unknown audit actions readable', () => {
    const admin = user({ id: 'admin-1', username: 'admin', role: 'admin', expiresAt: null, entitlement: { state: 'admin', expiresAt: null, remainingMs: null } });
    const self = getAdminActionPolicy('admin-1', admin, 1);
    expect(self.canLock).toBe(false);
    expect(self.canDelete).toBe(false);
    expect(self.canGrant).toBe(false);
    const regular = getAdminActionPolicy('admin-1', user(), 1);
    expect(regular.canGrant).toBe(true);
    expect(auditActionLabel('new_future_action')).toBe('new_future_action');
  });

  it('generates a bounded password from the approved character set', () => {
    const password = generateRandomPassword(24);
    expect(password).toHaveLength(24);
    expect(password).toMatch(/^[A-Za-z0-9!@#$%^&*]+$/);
  });
});

import { parseProxyLine } from './admin';

describe('parseProxyLine', () => {
  it('đọc host:port:user:pass theo droplist', () => {
    expect(parseProxyLine('23.95.45.30:12581:abc:d:ef', 'socks5')).toEqual({ url: 'socks5://abc:d%3Aef@23.95.45.30:12581', label: '23.95.45.30:12581' });
  });
  it('đọc user:pass@host:port, host:port và URL đầy đủ', () => {
    expect(parseProxyLine('u:p@1.2.3.4:80', 'http')?.url).toBe('http://u:p@1.2.3.4:80');
    expect(parseProxyLine('1.2.3.4:80', 'http')?.url).toBe('http://1.2.3.4:80');
    expect(parseProxyLine('socks5h://u:p@1.2.3.4:80', 'http')?.url).toBe('socks5h://u:p@1.2.3.4:80');
  });
  it('từ chối định dạng sai', () => {
    for (const bad of ['', 'abc', '1.2.3.4', '1.2.3.4:99999', '1.2.3.4:80:u', 'ftp://1.2.3.4:80']) expect(parseProxyLine(bad, 'http')).toBeNull();
  });
});
