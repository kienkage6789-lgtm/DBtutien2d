import type { AuthSession } from '@tutien2d/core-client';
import type { RunnerHandle, CachedValue, RunnerHandleLog } from './runner-handle.js';
import { registerRunnerHandleContract } from './runner-handle.contract.js';
import type { AutoAnchor, AutoSupervisorSnapshot } from '../headless/auto-supervisor.js';
import type { DailyOperation, DailyStatus } from '../headless/daily-quests.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';
import type { KhuChangeResult, KhuInfo, KhuList } from '../headless/khu-change.js';
import type { ReachableMap } from '../headless/map-route.js';
import type { VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';

const cache = <T>(value: T): CachedValue<T> => ({ value, ageMs: 0, stale: false });
const emptySnapshot = { lifecycle: 'stopped', connection: 'DISCONNECTED', hurtCount: 0, mapId: null, khu: null, x: null, y: null, hp: null, mp: null, downed: null, moveTo: null, daily: null, dailyStatus: null } as unknown as VendorRunnerSnapshot;
const emptyDaily = { status: { today: null, stage: null, checkin: { done: false, total: null }, seedTasks: [], activeSeedTask: null, stones: null, duocCong: null, canhKho: null, namLinhChi: null, fishInBag: null }, current: null } as { status: DailyStatus; current: DailyOperation | null };

/** Small contract double: it models only the public handle boundary, without any game transport. */
class FakeRunnerHandle implements RunnerHandle {
  private lifecycle: 'stopped' | 'in_game' = 'stopped';
  private down: boolean | null = null;
  private operation: WalkOperation | null = null;
  private disconnect = new Set<() => void>();
  private sessions = new Set<(session: AuthSession) => void>();
  private logs = new Set<(event: RunnerHandleLog) => void>();
  public starts = 0;
  public stops = 0;
  public start(): Promise<void> { if (this.lifecycle === 'stopped') { this.starts += 1; this.lifecycle = 'in_game'; } return Promise.resolve(); }
  public stop(): Promise<void> { this.stops += this.lifecycle === 'in_game' ? 1 : 0; this.lifecycle = 'stopped'; return Promise.resolve(); }
  public getLifecycle() { return this.lifecycle; }
  public getSnapshot() { return cache(JSON.parse(JSON.stringify({ ...emptySnapshot, lifecycle: this.lifecycle, downed: this.down, moveTo: this.operation })) as VendorRunnerSnapshot); }
  public getFrameMetrics() { return cache({ frames: 0, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null } as FrameMetricsSnapshot); }
  public getReachableMaps() { return cache({ currentMapId: 'tan_vien', maps: [] as ReachableMap[] }); }
  public getKhuProbe() { return cache({ events: [], mapId: null, khu: null, soKhu: null }); }
  public getDailySnapshot() { return cache(emptyDaily); }
  public startAuto(): Promise<AutoSupervisorSnapshot> { return this.down ? Promise.reject(new Error('VENDOR_CHARACTER_DOWN')) : Promise.resolve({ phase: 'farming' } as AutoSupervisorSnapshot); }
  public stopAuto(): Promise<AutoSupervisorSnapshot> { return Promise.resolve({ phase: 'idle' } as AutoSupervisorSnapshot); }
  public walkTo(request: WalkRequest): Promise<WalkOperation> {
    if (this.down) return Promise.reject(Object.assign(new Error('CHARACTER_DOWN'), { code: 'CHARACTER_DOWN' }));
    this.operation = { operationId: 'walk-1', target: request.target ?? null, resolvedTarget: request.target ?? null, status: 'accepted', requester: request.requester, startedAt: 1, updatedAt: 1 };
    return Promise.resolve(this.operation);
  }
  public cancelWalk(operationId: string): Promise<boolean> { if (this.operation?.operationId !== operationId) return Promise.resolve(false); this.operation = { ...this.operation, status: 'cancelled' }; return Promise.resolve(true); }
  public getKhuInfo(): Promise<KhuInfo> { return Promise.resolve({ mapId: null, khu: null, soKhu: null, list: null }); }
  public requestKhuList(): Promise<KhuList> { return Promise.resolve({ mapId: 'tan_vien', khu: 1, dem: [], toiDa: 1, tran: [], observedAt: 0 }); }
  public changeKhu(_khu: number): Promise<KhuChangeResult> { return Promise.resolve({ mapId: 'tan_vien', khu: 1, soKhu: null, list: null }); }
  public startDailyCheckin(): Promise<DailyOperation> { return Promise.resolve({ operationId: 'daily', kind: 'checkin', status: 'accepted', step: 'checkin_ack', runIndex: 1, runsTotal: 1, startedAt: 1, updatedAt: 1 }); }
  public startDailySeed(_taskId?: string, _runs?: number, _options?: { abortOnHurt?: boolean; maxHurt?: number }): Promise<DailyOperation> { return this.startDailyCheckin(); }
  public cancelDaily(_operationId: string): Promise<DailyOperation> { return this.startDailyCheckin(); }
  public questProbe(act: string, _params?: { taskId?: string; propId?: string }) { return Promise.resolve({ act, at: 1, result: null }); }
  public khuProbe(action: 'xem' | 'chon') { return Promise.resolve({ sent: true, at: 1, x: null, y: null, mapId: null, khu: action === 'chon' ? 1 : null }); }
  public onDisconnect(listener: () => void) { this.disconnect.add(listener); return () => this.disconnect.delete(listener); }
  public onLog(listener: (event: RunnerHandleLog) => void) { this.logs.add(listener); return () => this.logs.delete(listener); }
  public onSessionUpdated(listener: (session: AuthSession) => void) { this.sessions.add(listener); return () => this.sessions.delete(listener); }
  public setDown(value: boolean) { this.down = value; }
  public emitDisconnect() { for (const listener of this.disconnect) listener(); }
  public emitSession(session: AuthSession) { for (const listener of this.sessions) listener(session); }
  public emitLog(event: RunnerHandleLog) { for (const listener of this.logs) listener(event); }
  public sessionCount() { return this.starts; }
  public isSocketClosed() { return this.lifecycle === 'stopped'; }
}

registerRunnerHandleContract('FakeRunnerHandle', async () => {
  const handle = new FakeRunnerHandle();
  return {
    handle,
    setDown: (value) => handle.setDown(value),
    emitDisconnect: () => handle.emitDisconnect(),
    emitSession: (session) => handle.emitSession(session),
    emitLog: (event) => handle.emitLog(event),
    sessionCount: () => handle.sessionCount(),
    isSocketClosed: () => handle.isSocketClosed(),
    waitReady: async () => {},
  };
});
