import type { AdminUser, AuditLogEntry } from '../types';

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
