import type { AdminUser, AuditLogEntry, FrameMetricsSnapshot } from '../types';

export type AdminAction = 'grant' | 'expiry' | 'lock' | 'delete' | 'maxBots' | 'resetPassword' | 'stopBots' | 'revokeSessions';

export interface AdminActionPolicy {
  canGrant: boolean;
  canSetExpiry: boolean;
  canLock: boolean;
  canDelete: boolean;
  canEditMaxBots: boolean;
  canResetPassword: boolean;
  canStopBots: boolean;
  canRevokeSessions: boolean;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';

export function cleanAdminText(value: unknown, maxLength = 240): string {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function formatFrameMetrics(metrics: FrameMetricsSnapshot | null | undefined): string {
  if (!metrics || metrics.avgMs === null || metrics.p95Ms === null || metrics.busyRatio === null) return 'Khung: chưa biết';
  return `Khung: ${metrics.avgMs.toFixed(1)} ms (p95 ${metrics.p95Ms.toFixed(1)}) · chiếm ${(metrics.busyRatio * 100).toFixed(1)}%`;
}

export function formatCountdown(remainingMs: number | null): string {
  if (remainingMs === null) return 'chưa được cấp';
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'đã hết hạn';
  const remaining = Math.ceil(remainingMs);
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days} ngày${hours > 0 ? ` ${hours} giờ` : ''}`;
  if (hours > 0) return `${hours} giờ${minutes > 0 ? ` ${minutes} phút` : ''}`;
  if (minutes > 0) return `${minutes} phút`;
  return `${Math.max(1, Math.ceil(remaining / 1000))} giây`;
}

export function formatAdminExpiry(user: Pick<AdminUser, 'role' | 'expiresAt' | 'entitlement'>, now = Date.now()): { label: string; title: string | undefined } {
  if (user.role === 'admin') return { label: 'Admin — không hết hạn', title: undefined };
  if (user.expiresAt === null) return { label: 'Chưa cấp', title: undefined };
  const remainingMs = user.expiresAt - now;
  if (remainingMs <= 0) return { label: 'Hết hạn', title: new Date(user.expiresAt).toLocaleString() };
  return { label: `Còn ${formatCountdown(remainingMs)}`, title: new Date(user.expiresAt).toLocaleString() };
}

export function filterAdminUsers(users: AdminUser[], query: string): AdminUser[] {
  const needle = cleanAdminText(query, 64).toLocaleLowerCase();
  return needle ? users.filter((user) => user.username.toLocaleLowerCase().includes(needle)) : users;
}

export function getAdminActionPolicy(currentUserId: string, target: AdminUser, activeAdminCount: number): AdminActionPolicy {
  const isSelf = currentUserId === target.id;
  const isAdmin = target.role === 'admin';
  const lastAdmin = isAdmin && activeAdminCount <= 1;
  return {
    canGrant: !isAdmin,
    canSetExpiry: !isAdmin,
    canLock: !isSelf && !lastAdmin,
    canDelete: !isSelf && !lastAdmin,
    canEditMaxBots: true,
    canResetPassword: true,
    canStopBots: true,
    canRevokeSessions: true,
  };
}

export function isAdminActionAllowed(action: AdminAction, currentUserId: string, target: AdminUser, activeAdminCount: number): boolean {
  const policy = getAdminActionPolicy(currentUserId, target, activeAdminCount);
  const field: Record<AdminAction, keyof AdminActionPolicy> = {
    grant: 'canGrant', expiry: 'canSetExpiry', lock: 'canLock', delete: 'canDelete', maxBots: 'canEditMaxBots',
    resetPassword: 'canResetPassword', stopBots: 'canStopBots', revokeSessions: 'canRevokeSessions',
  };
  return policy[field[action]];
}

export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    user_created: 'Tạo người dùng',
    user_disabled: 'Khóa người dùng',
    user_enabled: 'Mở khóa người dùng',
    user_deleted: 'Xóa người dùng',
    user_password_reset: 'Đặt lại mật khẩu',
    user_max_bots_updated: 'Đổi hạn mức bot',
    user_granted: 'Cấp thời hạn',
    user_expiry_set: 'Đặt thời hạn',
    admin_stop_bots: 'Dừng toàn bộ bot',
    admin_revoke_sessions: 'Buộc đăng xuất',
    admin_login_success: 'Admin đăng nhập thành công',
    admin_login_failed: 'Admin đăng nhập thất bại',
  };
  return labels[action] ?? (cleanAdminText(action, 80) || 'Không rõ');
}

export function filterAuditLogs(logs: AuditLogEntry[], action: string, userQuery: string, targetId = ''): AuditLogEntry[] {
  const actionNeedle = cleanAdminText(action, 80).toLocaleLowerCase();
  const userNeedle = cleanAdminText(userQuery, 64).toLocaleLowerCase();
  const targetNeedle = cleanAdminText(targetId, 128).toLocaleLowerCase();
  return logs.filter((log) => {
    if (actionNeedle && log.action.toLocaleLowerCase() !== actionNeedle) return false;
    if (targetNeedle && log.targetId?.toLocaleLowerCase() !== targetNeedle) return false;
    if (!userNeedle) return true;
    return log.actor?.username.toLocaleLowerCase().includes(userNeedle)
      || log.targetName?.toLocaleLowerCase().includes(userNeedle)
      || log.targetId?.toLocaleLowerCase().includes(userNeedle);
  });
}

export function generateRandomPassword(length: number = 16): string {
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error('Độ dài mật khẩu phải trong khoảng 8..128.');
  const values = new Uint32Array(length);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_CHARS[value % PASSWORD_CHARS.length]).join('');
}

export type ProxyKind = 'http' | 'https' | 'socks5' | 'socks5h';
export const PROXY_KINDS: ProxyKind[] = ['http', 'https', 'socks5', 'socks5h'];

export interface ParsedProxyLine { url: string; label: string }

/**
 * Chấp nhận một dòng proxy ở các dạng: `host:port`, `host:port:user:pass`, `user:pass@host:port`,
 * hoặc URL đầy đủ `scheme://...`. Nếu dòng có scheme thì dùng scheme đó, ngược lại dùng `kind` từ droplist.
 * Trả null khi không nhận ra định dạng.
 */
export function parseProxyLine(raw: string, kind: ProxyKind): ParsedProxyLine | null {
  let text = raw.trim();
  if (!text) return null;
  let scheme: ProxyKind = kind;
  const explicit = /^([a-z0-9]+):\/\//i.exec(text);
  if (explicit) {
    const found = explicit[1].toLowerCase();
    if (!PROXY_KINDS.includes(found as ProxyKind)) return null;
    scheme = found as ProxyKind;
    text = text.slice(explicit[0].length);
  }
  let host = '';
  let port = '';
  let user = '';
  let pass = '';
  const at = text.lastIndexOf('@');
  if (at >= 0) {
    const cred = text.slice(0, at);
    const colon = cred.indexOf(':');
    user = colon >= 0 ? cred.slice(0, colon) : cred;
    pass = colon >= 0 ? cred.slice(colon + 1) : '';
    const hp = text.slice(at + 1).split(':');
    if (hp.length !== 2) return null;
    [host, port] = hp;
  } else {
    const parts = text.split(':');
    if (parts.length === 2) [host, port] = parts;
    else if (parts.length >= 4) { host = parts[0]; port = parts[1]; user = parts[2]; pass = parts.slice(3).join(':'); }
    else return null;
  }
  if (!host || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
  if (/[\s/?#]/.test(host)) return null;
  const auth = user ? `${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ''}@` : '';
  return { url: `${scheme}://${auth}${host}:${port}`, label: `${host}:${port}` };
}
