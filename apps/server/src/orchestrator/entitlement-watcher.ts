import type { DbUser } from '../db/database.js';
import { entitlement, type EntitlementState } from '../security/entitlement.js';

export interface StopAccountsResult {
  ok: boolean;
  accountIds: string[];
}

export interface EntitlementWatcherDeps {
  now: () => number;
  getUsers: () => DbUser[];
  getRunningAccountIdsForOwner?: (ownerId: string) => string[];
  stopAccountsForOwner: (ownerId: string) => Promise<boolean | StopAccountsResult>;
  audit: (input: { actorId: string | null; action: string; targetType: string; targetId: string | null; detail?: string; at?: number }) => void;
  log: (accountId: string, level: 'warn' | 'error', module: string, message: string) => void;
  notify: (ownerId: string, alert: { reason: string; message: string }) => void;
  intervalMs?: number;
}

const blockedStates = new Set<EntitlementState>(['expired', 'none', 'disabled']);

export class EntitlementWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private readonly deps: EntitlementWatcherDeps;

  public constructor(deps: EntitlementWatcherDeps) {
    this.deps = deps;
  }

  public start(): void {
    if (this.timer) return;
    void this.sweepNow();
    const configured = this.deps.intervalMs ?? 30_000;
    const intervalMs = Math.max(100, configured);
    this.timer = setInterval(() => { void this.sweepNow(); }, intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public async sweepNow(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = this.deps.now();
      for (const user of this.deps.getUsers()) {
        if (user.role === 'admin') continue;
        const state = entitlement(user, now);
        if (!blockedStates.has(state.state)) continue;
        const before = this.deps.getRunningAccountIdsForOwner?.(user.id) ?? [];
        if (this.deps.getRunningAccountIdsForOwner && before.length === 0) continue;
        try {
          const result = await this.deps.stopAccountsForOwner(user.id);
          const resultIds = typeof result === 'object' && result !== null ? result.accountIds : [];
          const stoppedIds = this.deps.getRunningAccountIdsForOwner
            ? before.filter((accountId) => !this.deps.getRunningAccountIdsForOwner!(user.id).includes(accountId))
            : resultIds.length > 0 ? resultIds : (result === true ? before : []);
          if (stoppedIds.length === 0) continue;
          const reason = state.state === 'disabled' ? 'disabled' : state.state === 'none' ? 'none' : 'expired';
          this.deps.audit({
            actorId: null,
            action: 'entitlement_stop',
            targetType: 'user',
            targetId: user.id,
            detail: `stopped=${stoppedIds.length}; reason=${reason}`,
            at: now,
          });
          for (const accountId of stoppedIds) {
            this.deps.log(accountId, 'warn', 'EntitlementWatcher', 'Dừng do hết hạn sử dụng');
          }
          this.deps.notify(user.id, {
            reason,
            message: state.state === 'disabled'
              ? 'Tài khoản người dùng đã bị khóa; toàn bộ bot đã dừng.'
              : state.state === 'none'
                ? 'Tài khoản chưa được cấp hạn sử dụng; toàn bộ bot đã dừng.'
                : 'Tài khoản đã hết hạn sử dụng; toàn bộ bot đã dừng.',
          });
        } catch (error) {
          const code = error instanceof Error ? error.message.split(':', 1)[0].trim() : 'UNKNOWN';
          this.deps.audit({ actorId: null, action: 'entitlement_stop_error', targetType: 'user', targetId: user.id, detail: `error=${code}`, at: now });
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
}
