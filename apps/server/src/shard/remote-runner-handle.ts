import type { AuthSession } from '@tutien2d/core-client';
import type { AutoAnchor, AutoSupervisorSnapshot } from '../headless/auto-supervisor.js';
import type { DailyOperation, DailyStatus } from '../headless/daily-quests.js';
import type { GardenOperation, GardenSnapshot } from '../headless/garden.js';
import type { CultivationOperation, CultivationState } from '../headless/cultivation.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';
import type { KhuChangeResult, KhuInfo, KhuList } from '../headless/khu-change.js';
import type { ReachableMap } from '../headless/map-route.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';
import type { VendorInventorySnapshot, VendorQuestSnapshot, VendorRunnerOptions, VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import type { CachedValue, RunnerHandle, RunnerHandleLog } from '../orchestrator/runner-handle.js';
import { SNAPSHOT_INTERVAL_MS } from './protocol.js';

export interface RemoteRunnerTransport {
  start(accountId: string, options: VendorRunnerOptions, proxyUrl?: string | null): Promise<void>;
  stop(accountId: string): Promise<void>;
  call<T>(accountId: string, method: string, args: unknown[]): Promise<T>;
}
export interface RemoteRunnerRecord {
  lifecycle: VendorRunnerSnapshot['lifecycle'];
  snapshot: VendorRunnerSnapshot;
  metrics: FrameMetricsSnapshot;
  reachableMaps: { currentMapId: string; maps: ReachableMap[] } | null;
  khuProbe: ReturnType<import('../headless/vendor-runner.js').VendorRunner['getKhuProbe']>;
  dailySnapshot: { status: DailyStatus | null; current: DailyOperation | null };
  at: number;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const blankSnapshot = (): VendorRunnerSnapshot => ({
  lifecycle: 'starting', connection: 'DISCONNECTED', autoRequested: false,
  autoResume: null,
  supervisor: { enabled: false, phase: 'idle', targetId: null, reason: null, lastTransitionAt: 0 } as unknown as AutoSupervisorSnapshot,
  packets: { incoming: {}, outgoing: {}, commands: {}, moves: 0, attacks: 0, skills: 0, cmds: 0 },
  hurtCount: 0, lastHurtAt: null, killsBySelf: 0, packetErrors: 0, updateErrors: 0, consoleErrors: [],
  frames: 0, fps: 0, uptimeMs: 0, memory: { rssBytes: 0, rssGrowthBytes: 0 }, tokenExpiresAt: null,
  mapId: null, khu: null, x: null, y: null, hp: null, maxHp: null, mp: null, maxMp: null, downed: null,
  vitalsProbeMoves: 0, soKhu: null, khuList: null, monsters: [], players: [],
  monstersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
  playersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
  vitals: { hp: null, maxHp: null, mp: null, maxMp: null, status: 'unknown', source: null, fresh: false, observedAt: null },
  character: null,
  moveTo: null, daily: null, dailyStatus: null, logs: [],
});

export class RemoteRunnerHandle implements RunnerHandle {
  private latest: RemoteRunnerRecord | null = null;
  private hasSnapshot = false;
  private readonly disconnectListeners = new Set<() => void>();
  private readonly logListeners = new Set<(event: RunnerHandleLog) => void>();
  private readonly sessionListeners = new Set<(session: AuthSession) => void>();
  public constructor(private readonly accountId: string, private readonly options: VendorRunnerOptions,
    private readonly transport: RemoteRunnerTransport, private readonly proxyUrl: string | null = null) {
    this.latest = { lifecycle: 'stopped', snapshot: blankSnapshot(), metrics: { frames: 0, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null }, reachableMaps: null,
      khuProbe: { events: [], mapId: null, khu: null, soKhu: null }, dailySnapshot: { status: null, current: null }, at: Date.now() };
  }
  public update(record: RemoteRunnerRecord): void {
    const previous = this.latest;
    this.latest = clone(record);
    this.hasSnapshot = true;
    if (record.snapshot.connection === 'DISCONNECTED' && previous?.snapshot.connection !== 'DISCONNECTED') {
      for (const listener of this.disconnectListeners) listener();
    }
  }
  public emitLog(event: RunnerHandleLog): void { for (const listener of this.logListeners) listener(clone(event)); }
  public emitSessionUpdated(refreshToken: string): void {
    // WorkerPool persists only refreshToken; never forward the shard's access token across IPC.
    const session = { accessToken: '', refreshToken, expiresAt: 0, ttlMs: 0, email: '' } as AuthSession;
    for (const listener of this.sessionListeners) listener(session);
  }
  private age(): number { return !this.hasSnapshot ? 0 : this.latest ? Math.max(0, Date.now() - this.latest.at) : Number.POSITIVE_INFINITY; }
  private isStale(): boolean { return this.age() > SNAPSHOT_INTERVAL_MS * 3; }
  public async start(): Promise<void> { await this.transport.start(this.accountId, this.options, this.proxyUrl); }
  public async stop(): Promise<void> { await this.transport.stop(this.accountId); }
  public getLifecycle(): VendorRunnerSnapshot['lifecycle'] { return this.isStale() ? 'stopped' : this.latest?.lifecycle ?? 'starting'; }
  private snapshot(): VendorRunnerSnapshot {
    const value = clone(this.latest?.snapshot ?? blankSnapshot());
    if (this.isStale()) {
      value.lifecycle = 'stopped'; value.autoRequested = false;
      value.autoResume = null;
      value.connection = 'DISCONNECTED'; value.mapId = null; value.khu = null; value.x = null; value.y = null;
      value.hp = null; value.maxHp = null; value.mp = null; value.maxMp = null; value.downed = null;
      value.vitals = { hp: null, maxHp: null, mp: null, maxMp: null, status: 'unknown', source: null, fresh: false, observedAt: null };
      value.character = null;
      value.monsters = []; value.players = []; value.monstersContext = { mapId: null, khu: null, observedAt: null, fresh: false };
      value.playersContext = { mapId: null, khu: null, observedAt: null, fresh: false }; value.khuList = null; value.soKhu = null;
    }
    return value;
  }
  private cached<T>(value: T): CachedValue<T> { return { value: clone(value), ageMs: Number.isFinite(this.age()) ? this.age() : 0, stale: this.isStale() }; }
  public getSnapshot() { return this.cached(this.snapshot()); }
  public getFrameMetrics(): CachedValue<FrameMetricsSnapshot> {
    const metrics = this.latest?.metrics ?? { frames: 0, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null };
    return this.cached(this.isStale() ? { frames: metrics.frames, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null } : metrics);
  }
  public getReachableMaps() { return this.cached(this.isStale() ? null : this.latest?.reachableMaps ?? null); }
  public getKhuProbe() { return this.cached(this.isStale() ? { events: [], mapId: null, khu: null, soKhu: null } : this.latest?.khuProbe ?? { events: [], mapId: null, khu: null, soKhu: null }); }
  public getDailySnapshot(_force = true) { return this.cached(this.isStale() ? { status: null, current: null } : this.latest?.dailySnapshot ?? { status: null, current: null }); }
  public getInventory(): Promise<VendorInventorySnapshot> {
    if (this.isStale()) return Promise.reject(new Error('VENDOR_DATA_STALE'));
    return this.call<VendorInventorySnapshot>('getInventory').then(clone);
  }
  public getQuest(): Promise<VendorQuestSnapshot> {
    if (this.isStale()) return Promise.reject(new Error('VENDOR_DATA_STALE'));
    return this.call<VendorQuestSnapshot>('getQuest').then(clone);
  }
  public getGarden(): Promise<GardenSnapshot> { if (this.isStale()) return Promise.reject(new Error('VENDOR_DATA_STALE')); return this.call<GardenSnapshot>('getGarden').then(clone); }
  public getGardenOperation() { if (this.isStale()) return Promise.reject(new Error('VENDOR_DATA_STALE')); return this.call<GardenOperation | null>('getGardenOperation').then(clone); }
  public startGardenBuyPack(packId: string, times = 1) { return this.call<GardenOperation>('startGardenBuyPack', packId, times); }
  public startGardenSow(seedId: string, plotIds?: string[] | 'all-empty', autoTravel = false) { return this.call<GardenOperation>('startGardenSow', seedId, plotIds, autoTravel); }
  public startGardenHarvest(plotIds?: string[] | 'all-ready', autoTravel = false) { return this.call<GardenOperation>('startGardenHarvest', plotIds, autoTravel); }
  public startGardenWater(plotIds?: string[] | 'all-watering-needed', autoTravel = false) { return this.call<GardenOperation>('startGardenWater', plotIds, autoTravel); }
  public startGardenScoop(autoTravel = false) { return this.call<GardenOperation>('startGardenScoop', autoTravel); }
  public cancelGarden(operationId?: string) { return this.call<GardenOperation>('cancelGarden', operationId); }
  public getCultivationOperation() { if (this.isStale()) return Promise.reject(new Error('VENDOR_DATA_STALE')); return this.call<CultivationOperation | null>('getCultivationOperation').then(clone); }
  public getCultivationState() { if (this.isStale()) return Promise.reject(new Error('VENDOR_DATA_STALE')); return this.call<CultivationState>('getCultivationState').then(clone); }
  public startBrew(recipeId: string, times = 1) { return this.call<CultivationOperation>('startBrew', recipeId, times); }
  public startMeditate(on: boolean, untilFull = false) { return this.call<CultivationOperation>('startMeditate', on, untilFull); }
  public startBreakthrough(useBaoMenh = false) { return this.call<CultivationOperation>('startBreakthrough', useBaoMenh); }
  public cancelCultivation(operationId?: string) { return this.call<CultivationOperation>('cancelCultivation', operationId); }
  private call<T>(method: string, ...args: unknown[]): Promise<T> { return this.transport.call<T>(this.accountId, method, args); }
  public startAuto(anchor?: AutoAnchor) { return this.call<AutoSupervisorSnapshot>('startAuto', anchor); }
  public stopAuto() { return this.call<AutoSupervisorSnapshot>('stopAuto'); }
  public walkTo(request: WalkRequest) { return this.call<WalkOperation>('walkTo', request); }
  public cancelWalk(operationId: string, reason?: string) { return this.call<boolean>('cancelWalk', operationId, reason); }
  public getKhuInfo() { return this.call<KhuInfo>('getKhuInfo'); }
  public requestKhuList() { return this.call<KhuList>('requestKhuList'); }
  public changeKhu(khu: number) { return this.call<KhuChangeResult>('changeKhu', khu); }
  public startDailyCheckin() { return this.call<DailyOperation>('startDailyCheckin'); }
  public startDailySeed(taskId: string, runs = 1, options: { abortOnHurt?: boolean; maxHurt?: number } = {}) { return this.call<DailyOperation>('startDailySeed', taskId, runs, options); }
  public cancelDaily(operationId: string) { return this.call<DailyOperation>('cancelDaily', operationId); }
  public questProbe(act: string, params: { taskId?: string; propId?: string }) { return this.call<ReturnType<import('../headless/vendor-runner.js').VendorRunner['questProbe']>>('questProbe', act, params); }
  public khuProbe(action: 'xem' | 'chon', khu?: number) { return this.call<ReturnType<import('../headless/vendor-runner.js').VendorRunner['khuProbe']>>('khuProbe', action, khu); }
  public onDisconnect(listener: () => void) { this.disconnectListeners.add(listener); return () => this.disconnectListeners.delete(listener); }
  public onLog(listener: (event: RunnerHandleLog) => void) { this.logListeners.add(listener); return () => this.logListeners.delete(listener); }
  public onSessionUpdated(listener: (session: AuthSession) => void) { this.sessionListeners.add(listener); return () => this.sessionListeners.delete(listener); }
}
