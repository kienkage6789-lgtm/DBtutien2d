import type { AuthSession } from '@tutien2d/core-client';
import type { AutoAnchor, AutoSupervisorSnapshot } from '../headless/auto-supervisor.js';
import type { DailyOperation, DailyStatus } from '../headless/daily-quests.js';
import type { GardenOperation, GardenSnapshot } from '../headless/garden.js';
import type { CultivationOperation, CultivationState } from '../headless/cultivation.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';
import type { KhuChangeResult, KhuInfo, KhuList } from '../headless/khu-change.js';
import type { ReachableMap } from '../headless/map-route.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';
import { VendorRunner, type VendorInventorySnapshot, type VendorQuestSnapshot, type VendorRunnerOptions, type VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import { VendorGateway } from '../gateway/vendor-gateway.js';
import type { GameGateway } from '../gateway/game-gateway.js';

export interface CachedValue<T> { value: T; ageMs: number; stale: boolean }
export type RunnerHandleLog = Parameters<NonNullable<VendorRunnerOptions['onLog']>>[0];
const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** IPC-ready operations used by WorkerPool. Snapshots are cached; commands are async RPC-safe calls. */
export interface RunnerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  getLifecycle(): ReturnType<VendorRunner['getLifecycle']>;
  getSnapshot(): CachedValue<VendorRunnerSnapshot>;
  getFrameMetrics(): CachedValue<FrameMetricsSnapshot>;
  getReachableMaps(): CachedValue<{ currentMapId: string; maps: ReachableMap[] } | null>;
  getKhuProbe(): CachedValue<ReturnType<VendorRunner['getKhuProbe']>>;
  getDailySnapshot(force?: boolean): CachedValue<{ status: DailyStatus | null; current: DailyOperation | null }>;
  getInventory(): Promise<VendorInventorySnapshot>;
  getQuest(): Promise<VendorQuestSnapshot>;
  getGarden(): Promise<GardenSnapshot>;
  getGardenOperation(): Promise<GardenOperation | null>;
  startGardenBuyPack(packId: string, times?: number): Promise<GardenOperation>;
  startGardenSow(seedId: string, plotIds?: string[] | 'all-empty'): Promise<GardenOperation>;
  startGardenHarvest(plotIds?: string[] | 'all-ready'): Promise<GardenOperation>;
  startGardenWater(plotIds?: string[] | 'all-watering-needed'): Promise<GardenOperation>;
  startGardenScoop(): Promise<GardenOperation>;
  cancelGarden(operationId?: string): Promise<GardenOperation>;
  getCultivationOperation(): Promise<CultivationOperation | null>;
  getCultivationState(): Promise<CultivationState>;
  startBrew(recipeId: string, times?: number): Promise<CultivationOperation>;
  startMeditate(on: boolean, untilFull?: boolean): Promise<CultivationOperation>;
  startBreakthrough(useBaoMenh?: boolean): Promise<CultivationOperation>;
  cancelCultivation(operationId?: string): Promise<CultivationOperation>;
  startAuto(anchor?: AutoAnchor): Promise<AutoSupervisorSnapshot>;
  stopAuto(): Promise<AutoSupervisorSnapshot>;
  walkTo(request: WalkRequest): Promise<WalkOperation>;
  cancelWalk(operationId: string, reason?: string): Promise<boolean>;
  getKhuInfo(): Promise<KhuInfo>;
  requestKhuList(): Promise<KhuList>;
  changeKhu(khu: number): Promise<KhuChangeResult>;
  startDailyCheckin(): Promise<DailyOperation>;
  startDailySeed(taskId: string, runs?: number, options?: { abortOnHurt?: boolean; maxHurt?: number }): Promise<DailyOperation>;
  cancelDaily(operationId: string): Promise<DailyOperation>;
  questProbe(act: string, params: { taskId?: string; propId?: string }): Promise<ReturnType<VendorRunner['questProbe']>>;
  khuProbe(action: 'xem' | 'chon', khu?: number): Promise<ReturnType<VendorRunner['khuProbe']>>;
  onDisconnect(listener: () => void): () => void;
  onLog(listener: (event: RunnerHandleLog) => void): () => void;
  onSessionUpdated(listener: (session: AuthSession) => void): () => void;
}

/** Thin adapter; safety gates and protocol behavior remain in VendorRunner/VendorGateway. */
export class InProcessRunnerHandle implements RunnerHandle {
  private readonly gateway: GameGateway;
  private readonly logListeners = new Set<(event: RunnerHandleLog) => void>();
  private readonly sessionListeners = new Set<(session: AuthSession) => void>();
  public readonly runner: VendorRunner;

  public constructor(options: VendorRunnerOptions) {
    const suppliedLog = options.onLog;
    const suppliedSession = options.onSessionUpdated;
    this.runner = new VendorRunner({
      ...options,
      onLog: (event) => { suppliedLog?.(event); for (const listener of this.logListeners) listener(event); },
      onSessionUpdated: (session) => { suppliedSession?.(session); for (const listener of this.sessionListeners) listener(session); },
    });
    this.gateway = new VendorGateway(this.runner);
  }

  private cached<T>(value: T): CachedValue<T> { return { value: jsonClone(value), ageMs: 0, stale: false }; }
  public start() { return this.gateway.start(); }
  public stop() { return this.gateway.stop(); }
  public getLifecycle() { return this.gateway.getLifecycle(); }
  public getSnapshot() { return this.cached(this.runner.getSnapshot()); }
  public getFrameMetrics() { return this.cached(this.runner.getFrameMetrics()); }
  public getReachableMaps() {
    try { return this.cached(this.runner.getReachableMaps()); }
    catch (error) {
      if (error instanceof Error && error.message === 'VENDOR_MAP_NOT_READY') return this.cached(null);
      throw error;
    }
  }
  public getKhuProbe() { return this.cached(this.runner.getKhuProbe()); }
  public getDailySnapshot(force = true) {
    try { return this.cached(this.runner.getDailySnapshot(force)); }
    catch (error) {
      if (error instanceof Error && error.message === 'NOT_IN_GAME') return this.cached({ status: null, current: null });
      throw error;
    }
  }
  public getInventory() { return Promise.resolve().then(() => this.runner.getInventory()).then(jsonClone); }
  public getQuest() { return Promise.resolve().then(() => this.runner.getQuest()).then(jsonClone); }
  public getGarden() { return Promise.resolve().then(() => this.runner.getGarden()).then(jsonClone); }
  public getGardenOperation() { return Promise.resolve().then(() => this.runner.getGardenOperation()).then(jsonClone); }
  public startGardenBuyPack(packId: string, times = 1) { return Promise.resolve().then(() => this.runner.startGardenBuyPack(packId, times)).then(jsonClone); }
  public startGardenSow(seedId: string, plotIds?: string[] | 'all-empty') { return Promise.resolve().then(() => this.runner.startGardenSow(seedId, plotIds)).then(jsonClone); }
  public startGardenHarvest(plotIds?: string[] | 'all-ready') { return Promise.resolve().then(() => this.runner.startGardenHarvest(plotIds)).then(jsonClone); }
  public startGardenWater(plotIds?: string[] | 'all-watering-needed') { return Promise.resolve().then(() => this.runner.startGardenWater(plotIds)).then(jsonClone); }
  public startGardenScoop() { return Promise.resolve().then(() => this.runner.startGardenScoop()).then(jsonClone); }
  public cancelGarden(operationId?: string) { return Promise.resolve().then(() => this.runner.cancelGarden(operationId)).then(jsonClone); }
  public getCultivationOperation() { return Promise.resolve().then(() => this.runner.getCultivationOperation()).then(jsonClone); }
  public getCultivationState() { return Promise.resolve().then(() => this.runner.getCultivationState()).then(jsonClone); }
  public startBrew(recipeId: string, times = 1) { return Promise.resolve().then(() => this.runner.startBrew(recipeId, times)).then(jsonClone); }
  public startMeditate(on: boolean, untilFull = false) { return Promise.resolve().then(() => this.runner.startMeditate(on, untilFull)).then(jsonClone); }
  public startBreakthrough(useBaoMenh = false) { return Promise.resolve().then(() => this.runner.startBreakthrough(useBaoMenh)).then(jsonClone); }
  public cancelCultivation(operationId?: string) { return Promise.resolve().then(() => this.runner.cancelCultivation(operationId)).then(jsonClone); }
  public startAuto(anchor?: AutoAnchor) { return this.gateway.startAuto(anchor).then(jsonClone); }
  public stopAuto() { return Promise.resolve().then(() => this.gateway.stopAuto()).then(jsonClone); }
  public walkTo(request: WalkRequest) { return Promise.resolve().then(() => this.gateway.walkTo(request)).then(jsonClone); }
  public cancelWalk(operationId: string, reason?: string) { return Promise.resolve().then(() => this.gateway.cancelWalk(operationId, reason)); }
  public getKhuInfo() { return Promise.resolve().then(() => this.gateway.getKhuInfo()).then(jsonClone); }
  public requestKhuList() { return this.gateway.requestKhuList().then(jsonClone); }
  public changeKhu(khu: number) { return this.gateway.changeKhu(khu).then(jsonClone); }
  public startDailyCheckin() { return Promise.resolve().then(() => this.runner.startDailyCheckin()).then(jsonClone); }
  public startDailySeed(taskId: string, runs = 1, options: { abortOnHurt?: boolean; maxHurt?: number } = {}) { return Promise.resolve().then(() => this.runner.startDailySeed(taskId, runs, options)).then(jsonClone); }
  public cancelDaily(operationId: string) { return Promise.resolve().then(() => this.runner.cancelDaily(operationId)).then(jsonClone); }
  public questProbe(act: string, params: { taskId?: string; propId?: string }) { return Promise.resolve().then(() => this.runner.questProbe(act, params)).then(jsonClone); }
  public khuProbe(action: 'xem' | 'chon', khu?: number) { return Promise.resolve().then(() => this.runner.khuProbe(action, khu)).then(jsonClone); }
  public onDisconnect(listener: () => void) { return this.gateway.onDisconnect(listener); }
  public onLog(listener: (event: RunnerHandleLog) => void) { this.logListeners.add(listener); return () => this.logListeners.delete(listener); }
  public onSessionUpdated(listener: (session: AuthSession) => void) { this.sessionListeners.add(listener); return () => this.sessionListeners.delete(listener); }
}

export interface RunnerHandleContext { accountId: string; proxyUrl?: string | null }
export type RunnerHandleFactory = (options: VendorRunnerOptions, context?: RunnerHandleContext) => RunnerHandle;
export const createInProcessRunnerHandle: RunnerHandleFactory = (options) => new InProcessRunnerHandle(options);
