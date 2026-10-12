import { SupabaseAuth } from '@tutien2d/core-client';
import { db } from '../db/database.js';
import { wsHub } from '../ws/hub.js';
import { CONFIG } from '../config.js';
import { PUBLIC_CLIENT_MAP_CATALOG } from '../config/map-catalog.js';
import type { KhuInfo, VendorRunnerOptions, VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import { createInProcessRunnerHandle, type RunnerHandle, type RunnerHandleFactory } from './runner-handle.js';
import { shardManager } from './shard-manager.js';
import type { AutoAnchor } from '../headless/auto-supervisor.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';
import type { ReachableMap } from '../headless/map-route.js';
import type { RuntimeEngine } from '../headless/engine-selection.js';
import type { DailyOperation, DailyStatus } from '../headless/daily-quests.js';
import type { VendorInventorySnapshot } from '../headless/vendor-runner.js';
import { entitlement } from '../security/entitlement.js';
import { hasRunnerMemoryCapacity } from './capacity.js';
import { createProxyTransport, type ProxyTransport } from '../network/proxy-transport.js';
import { ProxyChecker } from '../network/proxy-checker.js';
import { parseProxyUrl } from '../network/proxy-url.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';

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
  ownerId: string | null;
  ownerUsername: string | null;
  accountName: string;
  engine: 'vendor';
  status: 'running' | 'stopped' | 'error';
  dataStale: boolean;
  connection: string;
  authError: string | null;
  hasProxy: boolean;
  proxy?: { id: string; label: string; status: 'unknown' | 'ok' | 'down'; endpoint: string; hasAuth: boolean } | null;
  hasPassword: boolean;
  tokenExpiresAt: number | null;
  characterName: string;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  vitals: VitalSnapshot;
  character: VendorRunnerSnapshot['character'];
  vitalsAgeMs: number | null;
  hurtCount: number;
  lastHurtAt: number | null;
  derivedMax: DerivedMaxSnapshot;
  downed: boolean | null;
  mapId: string | null;
  khu: number | null;
  x: number | null;
  y: number | null;
  moveTo: VendorRunnerSnapshot['moveTo'];
  daily: DailyOperation | null;
  dailyStatus: DailyStatus | null;
  latencyMs: number;
  activity: string;
  metrics: FrameMetricsSnapshot | null;
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
  private readonly activeVendors = new Map<string, RunnerHandle>();
  private readonly startingAccounts = new Set<string>();
  private runtimeBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  private readonly observedMaps = new Map<string, ObservedMap>();
  private readonly proxyChecker = new ProxyChecker();
  private readonly proxyCheckLastAt = new Map<string, number>();
  private proxyCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly auth = new SupabaseAuth({
    url: CONFIG.SUPABASE_URL,
    anonKey: CONFIG.SUPABASE_ANON_KEY,
    gameApiBase: CONFIG.GAME_SERVER_URL.replace(/^ws/i, 'http'),
  });

  public constructor(private readonly createRunnerHandle: RunnerHandleFactory = createInProcessRunnerHandle) {
    shardManager.setHooks({
      onExit: (accountId, shardId, details) => {
        this.activeVendors.delete(accountId);
        const account = db.getAccountById(accountId);
        db.updateAccount(accountId, { status: 'stopped' });
        const killedBy = details?.killReason ? `; killedBy=server:${details.killReason}` : details?.signal === 'SIGKILL' ? '; killedBy=external (có thể do bộ nhớ: kiểm tra `dmesg | grep -i killed`)' : '';
        const exitInfo = `exitCode=${details?.exitCode ?? 'unknown'} signal=${details?.signal ?? 'none'}${killedBy}`;
        const saved = db.addLog(accountId, 'error', 'Shard', `Shard exited; runner was stopped (${exitInfo}).${details?.stderr ? ` stderr: ${details.stderr}` : ''}`.slice(0, 5000));
        wsHub.broadcastLog(saved);
        const detail = `shard=${shardId}; ${exitInfo}${details?.stderr ? `; stderr=${details.stderr}` : ''}`.slice(0, 5000);
        db.addAuditLog({ actorId: null, action: 'shard_runner_stopped', targetType: 'account', targetId: accountId, detail });
        if (account?.ownerId) wsHub.broadcastSystemAlertToOwner(account.ownerId, { reason: 'shard_exit', message: 'Bot đã dừng do tiến trình shard bị lỗi.' });
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      },
    });
  }

  /** Verify credentials without starting a game session. */
  public async verifyLogin(accountName: string, password: string, transport?: ProxyTransport) {
    if (transport) {
      const auth = new SupabaseAuth({
        url: CONFIG.SUPABASE_URL,
        anonKey: CONFIG.SUPABASE_ANON_KEY,
        gameApiBase: CONFIG.GAME_SERVER_URL.replace(/^ws/i, 'http'),
        fetchImpl: transport.fetch,
      });
      return auth.signInWithPassword(accountName, password);
    }
    return this.auth.signInWithPassword(accountName, password);
  }

  /** Every account is started through the official headless client. */
  public async startAccount(accountId: string): Promise<boolean> {
    const account = db.getAccountById(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (this.activeVendors.has(accountId)) return true;
    if (this.startingAccounts.has(accountId)) throw new Error('START_IN_PROGRESS');
    this.startingAccounts.add(accountId);
    try {
      this.assertCanStart(account);
      const transport = await this.prepareProxyTransport(accountId);
      try {
        if (CONFIG.VENDOR_SHARDS > 0) {
          await transport?.close();
          return await this.startVendorAccount(accountId, account, undefined, db.getAccountProxy(accountId)?.url ?? null);
        }
        return await this.startVendorAccount(accountId, account, transport);
      } catch (error) {
        if (transport) await transport.close().catch(() => undefined);
        throw error;
      }
    } finally { this.startingAccounts.delete(accountId); }
  }

  private async prepareProxyTransport(accountId: string): Promise<ProxyTransport | undefined> {
    const assigned = db.getAccountProxy(accountId);
    if (!assigned) {
      if (CONFIG.REQUIRE_PROXY) throw new Error('PROXY_REQUIRED');
      return undefined;
    }
    if (!assigned.enabled) throw new Error('PROXY_DISABLED');
    if (assigned.status === 'down') throw new Error('PROXY_UNAVAILABLE');
    const checkAge = assigned.lastCheckAt === null ? Number.POSITIVE_INFINITY : Date.now() - assigned.lastCheckAt;
    if (assigned.status === 'unknown' || checkAge > 30_000) {
      const result = await this.checkProxy(assigned.id, true);
      if (result.status !== 'ok') throw new Error('PROXY_UNAVAILABLE');
    }
    const refreshed = db.getAccountProxy(accountId);
    if (!refreshed?.url) throw new Error('PROXY_UNAVAILABLE');
    return createProxyTransport(refreshed.url);
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
      const startingForOwner = Array.from(this.startingAccounts).filter((id) => id !== account.id && db.getOwnerId(id) === owner.id).length;
      if (runningForOwner + startingForOwner >= owner.maxBots) throw new Error('BOT_LIMIT_REACHED');
    }
    if (CONFIG.MAX_TOTAL_RUNNERS > 0 && this.activeVendors.size + this.startingAccounts.size - 1 >= CONFIG.MAX_TOTAL_RUNNERS) {
      throw new Error('SERVER_CAPACITY');
    }
    if (!hasRunnerMemoryCapacity()) {
      throw new Error('SERVER_CAPACITY_MEMORY');
    }
  }

  public async checkProxy(proxyId: string, force = false): Promise<{ status: 'ok' | 'down'; latencyMs: number | null; error: string | null }> {
    const proxy = db.getProxyById(proxyId);
    if (!proxy) throw new Error('PROXY_NOT_FOUND');
    const now = Date.now();
    const previousCheck = this.proxyCheckLastAt.get(proxyId) ?? 0;
    if (!force && now - previousCheck < 5_000) throw new Error('PROXY_CHECK_RATE_LIMITED');
    this.proxyCheckLastAt.set(proxyId, now);
    const secret = db.getProxySecret(proxyId);
    if (!secret) {
      const result = { status: 'down' as const, latencyMs: null, error: 'Proxy secret is unavailable.' };
      this.recordProxyCheck(proxyId, result);
      return result;
    }
    const result = await this.proxyChecker.check(secret);
    this.recordProxyCheck(proxyId, result);
    return result;
  }

  private recordProxyCheck(proxyId: string, result: { status: 'ok' | 'down'; latencyMs: number | null; error: string | null }): void {
    const updated = db.updateProxyCheck(proxyId, { ...result, checkedAt: Date.now() });
    if (!updated) return;
    if (updated.previousStatus !== updated.proxy.status) {
      db.addAuditLog({ actorId: null, action: 'proxy_status_changed', targetType: 'proxy', targetId: proxyId, detail: `status=${updated.proxy.status}` });
      for (const account of db.getProxyAccounts(proxyId)) {
        const saved = db.addLog(account.id, updated.proxy.status === 'down' ? 'warn' : 'info', 'Proxy', `Proxy status changed to ${updated.proxy.status}`);
        wsHub.broadcastLog(saved);
      }
    }
    if (updated.proxy.status === 'down' && updated.previousStatus !== 'down') {
      db.addAuditLog({ actorId: null, action: 'proxy_check_failed', targetType: 'proxy', targetId: proxyId, detail: result.error ?? 'Proxy check failed.' });
    }
  }

  public startProxyChecks(): void {
    if (this.proxyCheckTimer) return;
    this.proxyCheckTimer = setInterval(() => {
      const candidates = db.getProxies()
        .filter((proxy) => proxy.enabled && db.getProxyAssignedCount(proxy.id) > 0)
        .slice(0, 3);
      for (const proxy of candidates) void this.checkProxy(proxy.id).catch(() => undefined);
    }, CONFIG.PROXY_CHECK_INTERVAL_MS);
    this.proxyCheckTimer.unref?.();
  }

  public stopProxyChecks(): void {
    if (this.proxyCheckTimer) clearInterval(this.proxyCheckTimer);
    this.proxyCheckTimer = null;
  }

  public getRunningAccountIdsForProxy(proxyId: string): string[] {
    return db.getProxyAccounts(proxyId).filter((account) => this.activeVendors.has(account.id)).map((account) => account.id);
  }

  private async startVendorAccount(
    accountId: string,
    account: NonNullable<ReturnType<typeof db.getAccountById>>,
    transport?: ProxyTransport,
    proxyUrl?: string | null,
  ): Promise<boolean> {
    const creds = db.getCredentials(accountId);
    if (!creds.password && !creds.refreshToken && !creds.legacyToken) {
      const message = 'VENDOR_CREDENTIALS_MISSING: account has no password, refresh token, or legacy token.';
      db.updateAccount(accountId, { status: 'error', authError: message });
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      throw new Error(message);
    }

    const runnerOptions = {
      accountName: account.accountName,
      credentials: creds,
      gameServerUrl: CONFIG.GAME_SERVER_URL,
      allowedGameServerUrl: CONFIG.GAME_SERVER_URL,
      vendorClientDir: CONFIG.VENDOR_CLIENT_DIR,
      loopIntervalMs: CONFIG.VENDOR_LOOP_INTERVAL_MS,
      alwaysRun: CONFIG.VENDOR_ALWAYS_RUN,
      supervisor: { haltMode: CONFIG.VENDOR_HALT_MODE },
      reconnectMaxDelayMs: CONFIG.RECONNECT_MAX_DELAY_MS,
      reconnectGiveUpMs: CONFIG.RECONNECT_GIVE_UP_MS,
      supabaseUrl: CONFIG.SUPABASE_URL,
      supabaseAnonKey: CONFIG.SUPABASE_ANON_KEY,
      ...(transport ? { transport: transport as unknown as NonNullable<VendorRunnerOptions["transport"]> } : {}),
    };
    const handle = CONFIG.VENDOR_SHARDS > 0
      ? shardManager.factory(runnerOptions, { accountId, proxyUrl })
      : this.createRunnerHandle(runnerOptions);
    handle.onSessionUpdated((session) => {
      db.updateCredentials(accountId, { refreshToken: session.refreshToken });
    });
    handle.onLog((event) => {
        const level = event.code.includes('failed') || event.code.includes('error') || event.code.includes('halted') || event.code === 'reconnect_exhausted'
          ? 'error'
          : event.code.includes('warning') || event.code.includes('death') ? 'warn' : 'info';
        const message = `Vendor ${event.code}${event.reasonCode ? ` (${event.reasonCode})` : ''}${event.detail ? ` ${event.detail}` : ''}`;
        const saved = db.addLog(accountId, level, 'VendorRunner', message);
        wsHub.broadcastLog(saved);
        if (event.code === 'auth_failed') {
          const authError = event.reasonCode ?? 'AUTH_FAILED';
          db.updateAccount(accountId, { status: 'error', authError });
          const terminalHandle = this.activeVendors.get(accountId);
          if (terminalHandle) { this.activeVendors.delete(accountId); void terminalHandle.stop().catch(() => undefined); }
        } else if (event.code === 'reconnect_exhausted') {
          db.updateAccount(accountId, { status: 'error', authError: null });
          const account = db.getAccountById(accountId);
          db.addAuditLog({ actorId: null, action: 'runner_reconnect_exhausted', targetType: 'account', targetId: accountId, detail: event.detail ?? 'continuous_disconnect_timeout' });
          if (account?.ownerId) wsHub.broadcastSystemAlertToOwner(account.ownerId, { reason: 'reconnect_exhausted', message: 'Bot mất kết nối quá lâu và đã dừng.' });
          const terminalHandle = this.activeVendors.get(accountId);
          if (terminalHandle) { this.activeVendors.delete(accountId); void terminalHandle.stop().catch(() => undefined); }
        }
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    });
    this.activeVendors.set(accountId, handle);
    this.ensureRuntimeBroadcast();
    try {
      await handle.start();
      if (this.activeVendors.get(accountId) !== handle) {
        await handle.stop().catch(() => undefined);
        db.updateAccount(accountId, { status: 'stopped' });
        return false;
      }
      const owner = db.getUserById(account.ownerId);
      const afterStartEntitlement = owner?.role === 'user' ? entitlement(owner, Date.now()) : null;
      if (afterStartEntitlement && afterStartEntitlement.state !== 'active') {
        await handle.stop().catch(() => undefined);
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
      const explicitCode = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code : '';
      const rawCode = explicitCode || (error instanceof Error ? error.message.split(':', 1)[0].trim() : '');
      const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(rawCode) ? rawCode : 'UNKNOWN';
      if (code === 'SHARD_EXITED' || code === 'SHARD_DISCONNECTED') {
        db.updateAccount(accountId, { status: 'stopped' });
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
        throw error;
      }
      if (code === 'ENTITLEMENT_EXPIRED' || code === 'ENTITLEMENT_NONE' || code === 'USER_DISABLED') {
        db.updateAccount(accountId, { status: 'stopped' });
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
        throw error;
      }
      db.updateAccount(accountId, { status: 'error' });
      if (code === 'REFRESH_INVALID' || code === 'INVALID_CREDENTIALS') db.updateAccount(accountId, { authError: code });
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
      await active.stop();
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
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const stableCode = /^(PROXY_[A-Z_]+|NO_PROXY_AVAILABLE|SERVER_CAPACITY(?:_MEMORY)?|BOT_LIMIT_REACHED|ENTITLEMENT_[A-Z_]+|USER_DISABLED)$/.exec(message)?.[1] ?? 'START_FAILED';
        const saved = db.addLog(account.id, 'warn', 'Orchestrator', `Bỏ qua tài khoản khi khởi động: ${stableCode}`);
        wsHub.broadcastLog(saved);
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(account.id));
      }
    }
  }

  public async stopAll(ownerId?: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const ids = Array.from(this.activeVendors.keys()).filter((id) => !ownerId || db.getOwnerId(id) === ownerId);
    const timeoutMs = options.timeoutMs ?? Number.POSITIVE_INFINITY;
    const deadline = Date.now() + timeoutMs;
    for (const id of ids) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (!Number.isFinite(timeoutMs)) {
        await this.stopAccount(id);
      } else {
        await Promise.race([
          this.stopAccount(id),
          new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), remaining);
            timer.unref?.();
          }),
        ]);
      }
    }
  }

  public getShardHealth() { return CONFIG.VENDOR_SHARDS > 0 ? shardManager.health() : []; }
  public shutdownShards(timeoutMs?: number): Promise<void> { return shardManager.shutdown(timeoutMs); }

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

  private requireFresh<T>(cached: { value: T; stale: boolean }): T {
    if (cached.stale) throw new Error('VENDOR_DATA_STALE');
    return cached.value;
  }

  public async startVendorAuto(accountId: string, anchor?: AutoAnchor): Promise<VendorRunnerSnapshot> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('ENGINE_VENDOR_REQUIRED: start the vendor engine first');
    await active.startAuto(anchor);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return this.requireFresh(active.getSnapshot());
  }

  public async stopVendorAuto(accountId: string): Promise<VendorRunnerSnapshot> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    await active.stopAuto();
    const snapshot = this.requireFresh(active.getSnapshot());
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return snapshot;
  }

  public async moveTo(accountId: string, request: WalkRequest): Promise<WalkOperation> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('ENGINE_VENDOR_REQUIRED: start the vendor engine first');
    const operation = await active.walkTo(request);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public async cancelMoveTo(accountId: string, operationId: string): Promise<WalkOperation> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    if (!await active.cancelWalk(operationId)) throw new Error('OPERATION_NOT_FOUND');
    const operation = this.requireFresh(active.getSnapshot()).moveTo;
    if (!operation) throw new Error('OPERATION_NOT_FOUND');
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public getDaily(accountId: string): { status: DailyStatus; current: DailyOperation | null } {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const snapshot = this.requireFresh(active.getDailySnapshot(true));
    if (!snapshot.status) throw new Error('NOT_IN_GAME');
    return snapshot as { status: DailyStatus; current: DailyOperation | null };
  }

  public async getInventory(accountId: string): Promise<VendorInventorySnapshot> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    return active.getInventory();
  }

  public async startDailyCheckin(accountId: string): Promise<DailyOperation> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const operation = await active.startDailyCheckin();
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public async startDailySeed(accountId: string, taskId: string, runs = 1, options: { abortOnHurt?: boolean; maxHurt?: number } = {}): Promise<DailyOperation> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const operation = await active.startDailySeed(taskId, runs, options);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public async cancelDaily(accountId: string, operationId: string): Promise<DailyOperation> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const operation = await active.cancelDaily(operationId);
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
    return operation;
  }

  public async changeKhu(accountId: string, khu: number): Promise<AccountRuntimeInfo> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('VENDOR_NOT_RUNNING');
    await active.changeKhu(khu);
    const runtime = this.getRuntimeInfo(accountId);
    wsHub.broadcastAccountUpdate(runtime);
    return runtime;
  }

  public async getKhu(accountId: string, refresh = false): Promise<KhuInfo> {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    if (refresh) await active.requestKhuList();
    return await active.getKhuInfo() as KhuInfo;
  }

  /** THỬ NGHIỆM đo giao thức nhiệm vụ hàng ngày (docs/RESEARCH_DAILY_QUESTS.md). */
  public async questProbe(accountId: string, act: string, params: { taskId?: string; propId?: string }) {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return active.questProbe(act, params);
  }

  /** THỬ NGHIỆM đo giao thức đổi khu (docs/RESEARCH_KHU_CHANGE.md). */
  public async khuProbe(accountId: string, action: 'xem' | 'chon', khu?: number) {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return active.khuProbe(action, khu);
  }

  public getKhuProbe(accountId: string) {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    return this.requireFresh(active.getKhuProbe());
  }

  public getReachableMaps(accountId: string): { currentMapId: string; maps: ReachableMapInfo[] } {
    const active = this.activeVendors.get(accountId);
    if (!active) throw new Error('NOT_IN_GAME');
    const result = this.requireFresh(active.getReachableMaps());
    if (!result) throw new Error('VENDOR_MAP_NOT_READY');
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
      ? this.getVendorRuntimeInfo(accountId, account, active)
      : this.getStoppedRuntimeInfo(accountId, account);
  }

  private runtimeProxy(account: ReturnType<typeof db.getAccountById>): NonNullable<AccountRuntimeInfo['proxy']> | null {
    if (!account?.proxyId) return null;
    const proxy = db.getProxyById(account.proxyId);
    const secret = db.getProxySecret(account.proxyId);
    if (!proxy || !secret) return null;
    try {
      const parsed = parseProxyUrl(secret, true);
      return { id: proxy.id, label: proxy.label, status: proxy.status, endpoint: parsed.safeLabel, hasAuth: parsed.hasAuth };
    } catch {
      return null;
    }
  }

  private getStoppedRuntimeInfo(
    accountId: string,
    account: ReturnType<typeof db.getAccountById>,
  ): AccountRuntimeInfo {
    const owner = account?.ownerId ? db.getUserById(account.ownerId) : undefined;
    return {
      id: accountId,
      ownerId: account?.ownerId ?? null,
      ownerUsername: owner?.username ?? null,
      accountName: account?.accountName || 'Unknown',
      engine: 'vendor',
      // Không có runner thì không thể đang chạy; DB có thể kẹt 'running' sau khi server tắt đột ngột.
      status: account?.status === 'error' ? 'error' : 'stopped',
      dataStale: false,
      connection: 'DISCONNECTED',
      authError: account?.authError ?? null,
      hasProxy: !!account?.proxyId,
      proxy: this.runtimeProxy(account),
      hasPassword: !!account?.encryptedPassword,
      tokenExpiresAt: null,
      characterName: account?.characterName || account?.accountName || 'Unknown',
      hp: null,
      maxHp: null,
      mp: null,
      maxMp: null,
      vitals: emptyVitals(),
      character: null,
      vitalsAgeMs: null,
      hurtCount: 0,
      lastHurtAt: null,
      derivedMax: emptyDerivedMax(),
      downed: null,
      mapId: null,
      khu: null,
      x: null,
      y: null,
      moveTo: null,
      daily: null,
      dailyStatus: null,
      latencyMs: 0,
      activity: 'idle',
      metrics: null,
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
    runner: RunnerHandle,
  ): AccountRuntimeInfo {
    const owner = account?.ownerId ? db.getUserById(account.ownerId) : undefined;
    const cachedSnapshot = runner.getSnapshot();
    const stale = cachedSnapshot.stale;
    const snapshot = cachedSnapshot.value;
    const cachedMetrics = runner.getFrameMetrics();
    const positionKnown = !stale && snapshot.mapId !== null && snapshot.x !== null && snapshot.y !== null;
    const positionCurrent = !stale && snapshot.connection === 'IN_GAME' && positionKnown;
    const locationKnown = !stale && positionCurrent && snapshot.khu !== null;
    const vitalsFresh = snapshot.vitals.fresh;
    const character = !stale && snapshot.lifecycle !== 'stopped' && snapshot.lifecycle !== 'error'
      && snapshot.connection === 'IN_GAME' && snapshot.character?.fresh ? snapshot.character : null;
    const now = Date.now();

    if (!stale && snapshot.mapId) {
      this.observedMaps.set(snapshot.mapId, {
        mapId: snapshot.mapId,
        soKhu: snapshot.soKhu,
        lastSeenAt: now,
      });
    }

    const mapContext: MapDataContext = stale ? emptyMapContext() : {
      mapId: snapshot.mapId,
      khu: snapshot.khu,
      soKhu: snapshot.soKhu,
      observedAt: positionCurrent ? now : null,
      fresh: locationKnown,
    };
    const vitals: VitalSnapshot = {
      hp: stale ? null : snapshot.hp,
      maxHp: stale ? null : snapshot.maxHp,
      mp: stale ? null : snapshot.mp,
      maxMp: stale ? null : snapshot.maxMp,
      status: !stale && vitalsFresh ? 'fresh' : 'unknown',
      source: !stale && vitalsFresh ? 'client' : null,
      observedAt: stale ? null : snapshot.vitals.observedAt,
    };

    return {
      id: accountId,
      ownerId: account?.ownerId ?? null,
      ownerUsername: owner?.username ?? null,
      accountName: account?.accountName || 'Unknown',
      engine: 'vendor',
      status: snapshot.lifecycle === 'error' ? 'error' : 'running',
      dataStale: stale,
      connection: stale ? 'DISCONNECTED' : snapshot.connection,
      authError: account?.authError ?? null,
      hasProxy: !!account?.proxyId,
      proxy: this.runtimeProxy(account),
      hasPassword: !!account?.encryptedPassword,
      tokenExpiresAt: stale ? null : snapshot.tokenExpiresAt,
      characterName: account?.characterName || account?.accountName || 'Unknown',
      hp: !stale && vitalsFresh ? snapshot.hp : null,
      maxHp: !stale && vitalsFresh ? snapshot.maxHp : null,
      mp: !stale && vitalsFresh ? snapshot.mp : null,
      maxMp: !stale && vitalsFresh ? snapshot.maxMp : null,
      vitals,
      character,
      vitalsAgeMs: !stale && vitalsFresh && snapshot.vitals.observedAt !== null
        ? Math.max(0, now - snapshot.vitals.observedAt) : null,
      hurtCount: snapshot.hurtCount,
      lastHurtAt: snapshot.lastHurtAt,
      derivedMax: emptyDerivedMax(),
      downed: stale ? null : snapshot.downed,
      mapId: stale ? null : snapshot.mapId,
      khu: stale ? null : snapshot.khu,
      x: stale ? null : snapshot.x,
      y: stale ? null : snapshot.y,
      moveTo: stale ? null : snapshot.moveTo,
      daily: stale ? null : snapshot.daily,
      dailyStatus: stale ? null : snapshot.dailyStatus,
      latencyMs: 0,
      activity: stale ? 'unknown' : snapshot.lifecycle === 'farming' ? 'farming' : snapshot.lifecycle,
      metrics: cachedMetrics.stale ? null : cachedMetrics.value,
      soKhu: stale ? null : snapshot.soKhu,
      khuList: stale ? null : snapshot.khuList,
      mapContext,
      mapContextAgeMs: mapContext.observedAt === null ? null : Math.max(0, now - mapContext.observedAt),
      mapContextIsCurrent: positionCurrent,
      playersContext: stale ? emptyEntityContext() : snapshot.playersContext,
      monstersContext: stale ? emptyEntityContext() : snapshot.monstersContext,
      dataStatus: {
        hp: !stale && vitalsFresh && snapshot.hp !== null,
        maxHp: !stale && vitalsFresh && snapshot.maxHp !== null,
        mp: !stale && vitalsFresh && snapshot.mp !== null,
        maxMp: !stale && vitalsFresh && snapshot.maxMp !== null,
        location: !stale && positionCurrent,
        monsters: !stale && snapshot.monstersContext.fresh,
        players: !stale && snapshot.playersContext.fresh,
      },
      monsters: stale ? [] : snapshot.monsters,
      players: stale ? [] : snapshot.players,
      vendor: stale ? undefined : snapshot,
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
