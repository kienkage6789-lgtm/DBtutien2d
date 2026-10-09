import { SupabaseAuth } from '@tutien2d/core-client';
import { db } from '../db/database.js';
import { wsHub } from '../ws/hub.js';
import { CONFIG } from '../config.js';
import { PUBLIC_CLIENT_MAP_CATALOG } from '../config/map-catalog.js';
import { VendorRunner, type KhuInfo, type VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import type { AutoAnchor } from '../headless/auto-supervisor.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';
import type { ReachableMap } from '../headless/map-route.js';
import type { RuntimeEngine } from '../headless/engine-selection.js';
import type { DailyOperation, DailyStatus } from '../headless/daily-quests.js';
import { entitlement } from '../security/entitlement.js';

export type { RuntimeEngine } from '../headless/engine-selection.js';

export interface VitalSnapshot {
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  status: 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
  source: 'client' | null;
  observedAt: number | null;
}

export interface DerivedMaxSnapshot {
  maxHp: number | null;
  maxMp: number | null;
  complete: boolean;
  source: 'derived';
  observedAt: number | null;
}

export interface MapDataContext {
  mapId: string | null;
  khu: number | null;
  soKhu: number | null;
  observedAt: number | null;
  fresh: boolean;
}

export interface MapEntityContext {
  mapId: string | null;
  khu: number | null;
  observedAt: number | null;
  fresh: boolean;
}

export interface AccountRuntimeInfo {
  id: string;
  accountName: string;
  engine: 'vendor';
  status: 'running' | 'stopped' | 'error';
  connection: string;
  authError: string | null;
  hasPassword: boolean;
  tokenExpiresAt: number | null;
  characterName: string;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  vitals: VitalSnapshot;
  vitalsAgeMs: number | null;
  hurtCount: number;
  lastHurtAt: number | null;
  derivedMax: DerivedMaxSnapshot;
  downed: boolean | null;
  mapId: string;
  khu: number | null;
  x: number | null;
  y: number | null;
  moveTo: VendorRunnerSnapshot['moveTo'];
  daily: DailyOperation | null;
  dailyStatus: DailyStatus | null;
  latencyMs: number;
  activity: string;
  soKhu: number | null;
  khuList: VendorRunnerSnapshot['khuList'];
  mapContext: MapDataContext;
  mapContextAgeMs: number | null;
  mapContextIsCurrent: boolean;
  playersContext: MapEntityContext;
  monstersContext: MapEntityContext;
  dataStatus: {
    hp: boolean;
    maxHp: boolean;
    mp: boolean;
    maxMp: boolean;
    location: boolean;
    monsters: boolean;
    players: boolean;
  };
  monsters: VendorRunnerSnapshot['monsters'];
  players: VendorRunnerSnapshot['players'];
  vendor?: VendorRunnerSnapshot;
}

export interface ObservedMap {
  mapId: string;
  soKhu: number | null;
  lastSeenAt: number;
}

export interface MapCatalogItem {
  mapId: string;
  name: string;
  scope: 'shared' | 'personal' | null;
  soKhu: number | null;
  lastSeenAt: number | null;
  observed: boolean;
  catalogSource: 'public_client' | 'observed_packet';
}

export interface ReachableMapInfo extends ReachableMap {
  name?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const emptyVitals = (): VitalSnapshot => ({
  hp: null,
  maxHp: null,
  mp: null,
  maxMp: null,
  status: 'unknown',
  source: null,
  observedAt: null,
});

const emptyDerivedMax = (): DerivedMaxSnapshot => ({
  maxHp: null,
  maxMp: null,
  complete: false,
  source: 'derived',
  observedAt: null,
});

const emptyMapContext = (): MapDataContext => ({
  mapId: null,
  khu: null,
  soKhu: null,
  observedAt: null,
  fresh: false,
});

const emptyEntityContext = (): MapEntityContext => ({
  mapId: null,
  khu: null,
  observedAt: null,
  fresh: false,
});

export class WorkerPool {
  private readonly activeVendors = new Map<string, { runner: VendorRunner }>();
  private runtimeBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private readonly observedMaps = new Map<string, ObservedMap>();
  private readonly auth = new SupabaseAuth({
    url: CONFIG.SUPABASE_URL,
    anonKey: CONFIG.SUPABASE_ANON_KEY,
    gameApiBase: CONFIG.GAME_SERVER_URL.replace(/^ws/i, 'http'),
  });

  /** Verify credentials without starting a game session. */
  public async verifyLogin(accountName: string, password: string) {
    return this.auth.signInWithPassword(accountName, password);
  }

  /** Every account is started through the official headless client. */
  public async startAccount(accountId: string): Promise<boolean> {
    const account = db.getAccountById(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (this.activeVendors.has(accountId)) return true;
    this.assertCanStart(account);
    return this.startVendorAccount(accountId, account);
  }

  private assertCanStart(account: NonNullable<ReturnType<typeof db.getAccountById>>): void {
    const owner = db.getUserById(account.ownerId);
    if (owner?.role === 'user') {
      const current = entitlement(owner, Date.now());
      if (current.state !== 'active') {
        const code = current.state === 'disabled' ? 'USER_DISABLED' : current.state === 'none' ? 'ENTITLEMENT_NONE' : 'ENTITLEMENT_EXPIRED';
        throw new Error(code);
      }
      const runningForOwner = this.getRunningAccountIdsForOwner(owner.id).filter((id) => id !== account.id).length;
      if (runningForOwner >= owner.maxBots) throw new Error('BOT_LIMIT_REACHED');
    }
    if (CONFIG.MAX_TOTAL_RUNNERS > 0 && this.activeVendors.size >= CONFIG.MAX_TOTAL_RUNNERS) {
      throw new Error('SERVER_CAPACITY');
    }
  }

  private async startVendorAccount(
    accountId: string,
    account: NonNullable<ReturnType<typeof db.getAccountById>>,
  ): Promise<boolean> {
    const creds = db.getCredentials(accountId);
    if (!creds.password && !creds.refreshToken && !creds.legacyToken) {
      const message = 'VENDOR_CREDENTIALS_MISSING: account has no password, refresh token, or legacy token.';
      db.updateAccount(accountId, { status: 'error', authError: message });
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      throw new Error(message);
    }

    const runner = new VendorRunner({
      accountName: account.accountName,
      credentials: creds,
      gameServerUrl: CONFIG.GAME_SERVER_URL,
      allowedGameServerUrl: CONFIG.GAME_SERVER_URL,
      vendorClientDir: CONFIG.VENDOR_CLIENT_DIR,
      supabaseUrl: CONFIG.SUPABASE_URL,
      supabaseAnonKey: CONFIG.SUPABASE_ANON_KEY,
      onSessionUpdated: (session) => {
        db.updateCredentials(accountId, { refreshToken: session.refreshToken });
      },
      onLog: (event) => {
        const level = event.code.includes('failed') || event.code.includes('error') || event.code.includes('halted')
          ? 'error'
          : event.code.includes('warning') || event.code.includes('death') ? 'warn' : 'info';
        const message = `Vendor ${event.code}${event.reasonCode ? ` (${event.reasonCode})` : ''}${event.detail ? ` ${event.detail}` : ''}`;
        const saved = db.addLog(accountId, level, 'VendorRunner', message);
        wsHub.broadcastLog(saved);
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      },
    });

    this.activeVendors.set(accountId, { runner });
    this.ensureRuntimeBroadcast();
    try {
      await runner.start();
      if (this.activeVendors.get(accountId)?.runner !== runner) {
        await runner.stop().catch(() => undefined);
        db.updateAccount(accountId, { status: 'stopped' });
        return false;
      }
      const owner = db.getUserById(account.ownerId);
      const afterStartEntitlement = owner?.role === 'user' ? entitlement(owner, Date.now()) : null;
      if (afterStartEntitlement && afterStartEntitlement.state !== 'active') {
        await runner.stop().catch(() => undefined);
        this.activeVendors.delete(accountId);
        db.updateAccount(accountId, { status: 'stopped' });
        const code = afterStartEntitlement.state === 'disabled'
          ? 'USER_DISABLED'
          : afterStartEntitlement.state === 'none' ? 'ENTITLEMENT_NONE' : 'ENTITLEMENT_EXPIRED';
        throw new Error(code);
      }
      db.updateAccount(accountId, { status: 'running', authError: null });
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      return true;
    } catch (error) {
      this.activeVendors.delete(accountId);
      const rawCode = error instanceof Error ? error.message.split(':', 1)[0].trim() : '';
      const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(rawCode) ? rawCode : 'UNKNOWN';
      if (code === 'ENTITLEMENT_EXPIRED' || code === 'ENTITLEMENT_NONE' || code === 'USER_DISABLED') {
        db.updateAccount(accountId, { status: 'stopped' });
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
        throw error;
      }
      db.updateAccount(accountId, { status: 'error' });
      const saved = db.addLog(accountId, 'error', 'VendorRunner', `Vendor runner start failed (${code})`);
      wsHub.broadcastLog(saved);
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      throw error;
    }
  }

  /**
   * Vị trí, quái và người chơi của engine vendor chỉ đổi trong runner, không có sự kiện đẩy ra ngoài.
   * Không phát định kỳ thì dashboard chỉ nhận snapshot khi có log, và TTL của context (map 15 s, quái 5 s)
   * làm marker biến mất sau vài giây.
   */
  private ensureRuntimeBroadcast(): void {
    if (this.runtimeBroadcastTimer) return;
    this.runtimeBroadcastTimer = setInterval(() => {
      if (this.activeVendors.size === 0) {
        if (this.runtimeBroadcastTimer) clearInterval(this.runtimeBroadcastTimer);
        this.runtimeBroadcastTimer = null;
        return;
      }
      for (const accountId of this.activeVendors.keys()) {
        try { wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId)); } catch { /* một tài khoản lỗi không làm dừng vòng phát */ }
      }
    }, 1000);
    this.runtimeBroadcastTimer.unref?.();
  }

  public async stopAccount(accountId: string, opts: { keepStatus?: boolean } = {}): Promise<boolean> {
    const active = this.activeVendors.get(accountId);
    if (!active) {
      if (!opts.keepStatus) db.updateAccount(accountId, { status: 'stopped' });
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      return false;
    }

    try {
      await active.runner.stop();
      this.activeVendors.delete(accountId);
      if (!opts.keepStatus) db.updateAccount(accountId, { status: 'stopped' });
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown stop error';
      db.addLog(accountId, 'error', 'Orchestrator', `Error stopping vendor runner: ${message}`);
      return false;
    }
  }

  public async restartAccount(accountId: string): Promise<boolean> {
    await this.stopAccount(accountId);
    await sleep(1000);
    return this.startAccount(accountId);
  }

  public async startAll(ownerId?: string): Promise<void> {
    let first = true;
    for (const account of db.getAccounts(ownerId)) {
      if (this.activeVendors.has(account.id)) continue;
      const owner = db.getUserById(account.ownerId);
      if (owner?.role === 'user' && entitlement(owner, Date.now()).state !== 'active') {
        db.addLog(account.id, 'warn', 'Orchestrator', 'Bỏ qua do người dùng không còn quyền sử dụng');
        continue;
      }
      try {
        if (!first) {
          const { min, max } = CONFIG.LOGIN_STAGGER_MS;
          await sleep(min + Math.floor(Math.random() * (max - min)));
        }
        first = false;
        await this.startAccount(account.id);
      } catch {
        // Individual account failures are already reflected in account status/logs.
      }
    }
  }

  public async stopAll(ownerId?: string): Promise<void> {
    const ids = Array.from(this.activeVendors.keys()).filter((id) => !ownerId || db.getOwnerId(id) === ownerId);
    for (const id of ids) await this.stopAccount(id);
  }

  public async stopAccountsForOwner(ownerId: string): Promise<boolean> {
    const accountIds = db.getAccounts(ownerId).map((account) => account.id);
    let ok = true;
    for (const accountId of accountIds) {
      if (this.activeVendors.has(accountId) && !(await this.stopAccount(accountId))) ok = false;
    }
    return ok && accountIds.every((accountId) => !this.activeVendors.has(accountId));
  }

  public getRunningAccountIdsForOwner(ownerId: string): string[] {
    return Array.from(this.activeVendors.keys()).filter((accountId) => db.getOwnerId(accountId) === ownerId);
  }

  public getActiveAccountCount(): number {
    return this.activeVendors.size;
  }

  public getActiveEngine(accountId: string): RuntimeEngine | null {
    return this.activeVendors.has(accountId) ? 'vendor' : null;
  }

  public async startVendorAuto(accountId: string, anchor?: AutoAnchor): Promise<VendorRunnerSnapshot> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('ENGINE_VENDOR_REQUIRED: start the vendor engine first');
    await active.runner.startAuto(anchor);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return active.runner.getSnapshot();
  }

  public stopVendorAuto(accountId: string): VendorRunnerSnapshot {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    active.runner.stopAuto();
    const snapshot = active.runner.getSnapshot();
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return snapshot;
  }

  public moveTo(accountId: string, request: WalkRequest): WalkOperation {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('ENGINE_VENDOR_REQUIRED: start the vendor engine first');
    const operation = active.runner.moveTo(request);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public cancelMoveTo(accountId: string, operationId: string): WalkOperation {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    if (!active.runner.cancelMoveTo('user_cancelled', operationId)) throw new Error('OPERATION_NOT_FOUND');
    const operation = active.runner.getSnapshot().moveTo;
    if (!operation) throw new Error('OPERATION_NOT_FOUND');
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public getDaily(accountId: string): { status: DailyStatus; current: DailyOperation | null } {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return active.runner.getDailySnapshot(true);
  }

  public startDailyCheckin(accountId: string): DailyOperation {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const operation = active.runner.startDailyCheckin();
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public startDailySeed(accountId: string, taskId: string, runs = 1, options: { abortOnHurt?: boolean; maxHurt?: number } = {}): DailyOperation {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const operation = active.runner.startDailySeed(taskId, runs, options);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public cancelDaily(accountId: string, operationId: string): DailyOperation {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const operation = active.runner.cancelDaily(operationId);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public async changeKhu(accountId: string, khu: number): Promise<AccountRuntimeInfo> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    await active.runner.changeKhu(khu);
    const runtime = this.getRuntimeInfo(accountId);
    wsHub.broadcastAccountUpdate(runtime);
    return runtime;
  }

  public async getKhu(accountId: string, refresh = false): Promise<KhuInfo> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    if (refresh) await active.runner.requestKhuList();
    return active.runner.getKhuInfo();
  }

  /** THỬ NGHIỆM đo giao thức nhiệm vụ hàng ngày (docs/RESEARCH_DAILY_QUESTS.md). */
  public questProbe(accountId: string, act: string, params: { taskId?: string; propId?: string }) {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return active.runner.questProbe(act, params);
  }

  /** THỬ NGHIỆM đo giao thức đổi khu (docs/RESEARCH_KHU_CHANGE.md). */
  public khuProbe(accountId: string, action: 'xem' | 'chon', khu?: number) {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return active.runner.khuProbe(action, khu);
  }

  public getKhuProbe(accountId: string) {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return active.runner.getKhuProbe();
  }

  public getReachableMaps(accountId: string): { currentMapId: string; maps: ReachableMapInfo[] } {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const result = active.runner.getReachableMaps();
    const names = new Map(PUBLIC_CLIENT_MAP_CATALOG.map((map) => [map.mapId, map.name] as const));
    return {
      currentMapId: result.currentMapId,
      maps: result.maps.map((map) => ({
        ...map,
        ...(names.get(map.mapId) ? { name: names.get(map.mapId) } : {}),
      })),
    };
  }

  public getRuntimeInfo(accountId: string): AccountRuntimeInfo {
    const account = db.getAccountById(accountId);
    const active = this.activeVendors.get(accountId);
    return active
      ? this.getVendorRuntimeInfo(accountId, account, active.runner)
      : this.getStoppedRuntimeInfo(accountId, account);
  }

  private getStoppedRuntimeInfo(
    accountId: string,
    account: ReturnType<typeof db.getAccountById>,
  ): AccountRuntimeInfo {
    return {
      id: accountId,
      accountName: account?.accountName || 'Unknown',
      engine: 'vendor',
      // Không có runner thì không thể đang chạy; DB có thể kẹt 'running' sau khi server tắt đột ngột.
      status: account?.status === 'error' ? 'error' : 'stopped',
      connection: 'DISCONNECTED',
      authError: account?.authError ?? null,
      hasPassword: !!account?.encryptedPassword,
      tokenExpiresAt: null,
      characterName: account?.characterName || account?.accountName || 'Unknown',
      hp: null,
      maxHp: null,
      mp: null,
      maxMp: null,
      vitals: emptyVitals(),
      vitalsAgeMs: null,
      hurtCount: 0,
      lastHurtAt: null,
      derivedMax: emptyDerivedMax(),
      downed: null,
      mapId: '',
      khu: null,
      x: null,
      y: null,
      moveTo: null,
      daily: null,
      dailyStatus: null,
      latencyMs: 0,
      activity: 'idle',
      soKhu: null,
      khuList: null,
      mapContext: emptyMapContext(),
      mapContextAgeMs: null,
      mapContextIsCurrent: false,
      playersContext: emptyEntityContext(),
      monstersContext: emptyEntityContext(),
      dataStatus: {
        hp: false,
        maxHp: false,
        mp: false,
        maxMp: false,
        location: false,
        monsters: false,
        players: false,
      },
      monsters: [],
      players: [],
    };
  }

  private getVendorRuntimeInfo(
    accountId: string,
    account: ReturnType<typeof db.getAccountById>,
    runner: VendorRunner,
  ): AccountRuntimeInfo {
    const snapshot = runner.getSnapshot();
    const positionKnown = snapshot.mapId !== null && snapshot.x !== null && snapshot.y !== null;
    const positionCurrent = snapshot.connection === 'IN_GAME' && positionKnown;
    const locationKnown = positionCurrent && snapshot.khu !== null;
    const vitalsFresh = snapshot.vitals.fresh;
    const now = Date.now();

    if (snapshot.mapId) {
      this.observedMaps.set(snapshot.mapId, {
        mapId: snapshot.mapId,
        soKhu: snapshot.soKhu,
        lastSeenAt: now,
      });
    }

    const mapContext: MapDataContext = {
      mapId: snapshot.mapId,
      khu: snapshot.khu,
      soKhu: snapshot.soKhu,
      observedAt: positionCurrent ? now : null,
      fresh: locationKnown,
    };
    const vitals: VitalSnapshot = {
      hp: snapshot.hp,
      maxHp: snapshot.maxHp,
      mp: snapshot.mp,
      maxMp: snapshot.maxMp,
      status: vitalsFresh ? 'fresh' : 'unknown',
      source: vitalsFresh ? 'client' : null,
      observedAt: snapshot.vitals.observedAt,
    };

    return {
      id: accountId,
      accountName: account?.accountName || 'Unknown',
      engine: 'vendor',
      status: snapshot.lifecycle === 'error' ? 'error' : 'running',
      connection: snapshot.connection,
      authError: account?.authError ?? null,
      hasPassword: !!account?.encryptedPassword,
      tokenExpiresAt: snapshot.tokenExpiresAt,
      characterName: account?.characterName || account?.accountName || 'Unknown',
      hp: vitalsFresh ? snapshot.hp : null,
      maxHp: vitalsFresh ? snapshot.maxHp : null,
      mp: vitalsFresh ? snapshot.mp : null,
      maxMp: vitalsFresh ? snapshot.maxMp : null,
      vitals,
      vitalsAgeMs: vitalsFresh && snapshot.vitals.observedAt !== null
        ? Math.max(0, now - snapshot.vitals.observedAt) : null,
      hurtCount: snapshot.hurtCount,
      lastHurtAt: snapshot.lastHurtAt,
      derivedMax: emptyDerivedMax(),
      downed: snapshot.downed,
      mapId: snapshot.mapId ?? '',
      khu: snapshot.khu,
      x: snapshot.x,
      y: snapshot.y,
      moveTo: snapshot.moveTo,
      daily: snapshot.daily,
      dailyStatus: snapshot.dailyStatus,
      latencyMs: 0,
      activity: snapshot.lifecycle === 'farming' ? 'farming' : snapshot.lifecycle,
      soKhu: snapshot.soKhu,
      khuList: snapshot.khuList,
      mapContext,
      mapContextAgeMs: mapContext.observedAt === null ? null : Math.max(0, now - mapContext.observedAt),
      mapContextIsCurrent: positionCurrent,
      playersContext: snapshot.playersContext,
      monstersContext: snapshot.monstersContext,
      dataStatus: {
        hp: vitalsFresh && snapshot.hp !== null,
        maxHp: vitalsFresh && snapshot.maxHp !== null,
        mp: vitalsFresh && snapshot.mp !== null,
        maxMp: vitalsFresh && snapshot.maxMp !== null,
        location: positionCurrent,
        monsters: snapshot.monstersContext.fresh,
        players: snapshot.playersContext.fresh,
      },
      monsters: snapshot.monsters,
      players: snapshot.players,
      vendor: snapshot,
    };
  }

  public getAllRuntimes(ownerId?: string): AccountRuntimeInfo[] {
    return db.getAccounts(ownerId).map((account) => this.getRuntimeInfo(account.id));
  }

  public getObservedMaps(): ObservedMap[] {
    return Array.from(this.observedMaps.values())
      .sort((a, b) => a.mapId.localeCompare(b.mapId))
      .map((map) => ({ ...map }));
  }

  public getMapCatalog(): MapCatalogItem[] {
    const observed = new Map(this.getObservedMaps().map((map) => [map.mapId, map] as const));
    const catalog = PUBLIC_CLIENT_MAP_CATALOG.map((map): MapCatalogItem => {
      const packet = observed.get(map.mapId);
      return {
        ...map,
        soKhu: packet?.soKhu ?? null,
        lastSeenAt: packet?.lastSeenAt ?? null,
        observed: !!packet,
        catalogSource: packet ? 'observed_packet' : 'public_client',
      };
    });
    const knownIds = new Set(PUBLIC_CLIENT_MAP_CATALOG.map((map) => map.mapId));
    for (const packet of observed.values()) {
      if (knownIds.has(packet.mapId)) continue;
      catalog.push({
        mapId: packet.mapId,
        name: packet.mapId,
        scope: null,
        soKhu: packet.soKhu,
        lastSeenAt: packet.lastSeenAt,
        observed: true,
        catalogSource: 'observed_packet',
      });
    }
    return catalog.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }
}

export const workerPool = new WorkerPool();
