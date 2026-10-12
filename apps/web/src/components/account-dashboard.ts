import type { AccountRuntime } from '../types';

export type AccountFilter = 'all' | 'running' | 'stopped' | 'error';
export type AccountTab = 'overview' | 'map' | 'daily' | 'inventory' | 'auto' | 'logs' | 'account';
export const ACCOUNT_TABS: Array<{ id: AccountTab; label: string }> = [
  { id: 'overview', label: 'Tổng quan' }, { id: 'map', label: 'Bản đồ' }, { id: 'daily', label: 'Hằng ngày' },
  { id: 'inventory', label: 'Túi đồ' }, { id: 'auto', label: 'Auto' }, { id: 'logs', label: 'Nhật ký' }, { id: 'account', label: 'Tài khoản' },
];

export function vitalPercent(value: number | null | undefined, max: number | null | undefined, fresh = true): number | null {
  if (!fresh || typeof value !== 'number' || !Number.isFinite(value) || typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(value / max * 100)));
}

export function accountRowStatus(account: AccountRuntime): { key: string; label: string; className: string } {
  if (account.status === 'error') return { key: 'error', label: 'Lỗi', className: 'bg-rose-400' };
  if (account.downed === true) return { key: 'downed', label: 'Đang gục', className: 'bg-rose-300' };
  if (account.connection === 'RECONNECTING') return { key: 'reconnecting', label: 'Đang nối lại', className: 'bg-amber-300' };
  if (account.dataStale) return { key: 'stale', label: 'Dữ liệu cũ', className: 'bg-amber-300' };
  if (account.status === 'running') return { key: 'running', label: 'Đang chạy', className: 'bg-emerald-400' };
  return { key: 'stopped', label: 'Dừng', className: 'bg-slate-400' };
}

export function filterAccounts(accounts: AccountRuntime[], filter: AccountFilter, query: string): AccountRuntime[] {
  const normalized = query.trim().toLocaleLowerCase();
  return accounts.filter((account) => {
    if (filter !== 'all' && account.status !== filter) return false;
    return !normalized || `${account.characterName || ''} ${account.accountName}`.toLocaleLowerCase().includes(normalized);
  });
}

export function resolveSelectedAccountId(accounts: AccountRuntime[], selectedId: string | null, loaded = true): string | null {
  if (!loaded || !selectedId) return selectedId;
  return accounts.some((account) => account.id === selectedId) ? selectedId : null;
}
export function isAccountTabActive(active: AccountTab, candidate: AccountTab): boolean { return active === candidate; }
export function realmLabel(character: AccountRuntime['character']): string { return character?.realmName ?? '—'; }

export function readDashboardStorage(key: string, fallback: string): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writeDashboardStorage(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* Storage bị chặn không ảnh hưởng trạng thái trong phiên. */ }
}
