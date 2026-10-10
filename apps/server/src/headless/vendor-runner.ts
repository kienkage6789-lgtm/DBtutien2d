import type { AuthSession } from '@tutien2d/core-client';
import { createVendorEnv, type VendorEnv, type VendorSocketEvent, type VendorSocketLike, type VendorWebSocketConstructor } from './vendor-env.js';
import {
  AutoSupervisor,
  DEFAULT_AUTO_SUPERVISOR_CONFIG,
  type AutoAnchor,
  type AutoClientPort,
  type AutoSupervisorConfig,
  type AutoSupervisorEvent,
  type AutoSupervisorSnapshot,
} from './auto-supervisor.js';
import {
  WalkNavigator,
  type WalkNavigatorClient,
  type WalkOperation,
  type WalkRequest,
} from './walk-navigator.js';
import {
  DailyError,
  DailyQuests,
  type DailyAck,
  type DailyClientState,
  type DailyClient,
  type DailyOperation,
  type DailyProp,
  type DailyStatus,
} from './daily-quests.js';
import { reachableMaps, type ReachableMap } from './map-route.js';
import { FrameMetrics, type FrameMetricsSnapshot } from './frame-metrics.js';
import {
  cooldownSecondsFromToast,
  KHU_CHANGE_TIMEOUT_MS,
  KHU_COOLDOWN_MS,
  KHU_LIST_TIMEOUT_MS,
  KhuError,
  type KhuChangeResult,
  type KhuInfo,
  type KhuList,
  toastText,
} from './khu-change.js';
export type { KhuChangeResult, KhuInfo, KhuList } from './khu-change.js';

export type VendorRunnerLifecycle =
  | 'starting'
  | 'connecting'
  | 'in_game'
  | 'farming'
  | 'recovering'
  | 'traveling'
  | 'halted'
  | 'stopped'
  | 'error';

export interface VendorCredentials {
  password?: string;
  refreshToken?: string;
  legacyToken?: string;
}

export interface VendorTokenManagerLike {
  getAccessToken(): Promise<string>;
  getSession?(): AuthSession | null;
  stop(): void;
  on(event: 'sessionUpdated', listener: (session: AuthSession) => void): unknown;
}

export interface VendorPacketCounts {
  incoming: Record<string, number>;
  outgoing: Record<string, number>;
  commands: Record<string, number>;
  moves: number;
  attacks: number;
  skills: number;
  cmds: number;
}

/** Thời gian tối đa (ms) Auto được chạy khi chưa có gói vitals chính thức. Di chuyển ~1 s đã kích ra gói you. */
export const VITALS_CONFIRM_MS = 10_000;
const WATCHDOG_LOG_INTERVAL_MS = 30_000;
const VITALS_PROBE_MAX_MOVES = 10;
const VITALS_PROBE_INTERVAL_MS = 300;
const VENDOR_MONSTER_LIMIT = 200;
const VENDOR_PLAYER_LIMIT = 100;

type VendorMonsterSnapshot = {
  id: string;
  name?: string;
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
};

type VendorPlayerSnapshot = {
  id: string;
  name?: string;
  x: number;
  y: number;
  realm?: string;
  /** Client-reported remote-player hp is a percentage; never use it as own vitals. */
  hp?: number;
};

type VendorEntityContext = {
  mapId: string | null;
  khu: number | null;
  observedAt: number | null;
  fresh: boolean;
};

export interface VendorRunnerSnapshot {
  lifecycle: VendorRunnerLifecycle;
  connection: 'DISCONNECTED' | 'CONNECTING' | 'IN_GAME' | 'RECONNECTING';
  autoRequested: boolean;
  supervisor: AutoSupervisorSnapshot;
  packets: VendorPacketCounts;
  hurtCount: number;
  lastHurtAt: number | null;
  killsBySelf: number;
  packetErrors: number;
  updateErrors: number;
  consoleErrors: string[];
  frames: number;
  fps: number;
  uptimeMs: number;
  memory: { rssBytes: number; rssGrowthBytes: number };
  tokenExpiresAt: number | null;
  mapId: string | null;
  khu: number | null;
  x: number | null;
  y: number | null;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  downed: boolean | null;
  vitalsProbeMoves: number;
  soKhu: number | null;
  khuList: KhuList | null;
  monsters: VendorMonsterSnapshot[];
  players: VendorPlayerSnapshot[];
  monstersContext: VendorEntityContext;
  playersContext: VendorEntityContext;
  vitals: {
    hp: number | null;
    maxHp: number | null;
    mp: number | null;
    maxMp: number | null;
    status: 'unknown' | 'client';
    source: 'client' | null;
    fresh: boolean;
    observedAt: number | null;
  };
  moveTo: WalkOperation | null;
  daily: DailyOperation | null;
  dailyStatus: DailyStatus | null;
  logs: Array<{ code: string; phase?: string; reasonCode?: string; detail?: string; at: number }>;
}

export interface VendorRunnerLogger {
  (event: { code: string; phase?: string; reasonCode?: string; detail?: string; at: number }): void;
}

export interface VendorRunnerOptions {
  accountName: string;
  credentials: VendorCredentials;
  gameServerUrl: string;
  allowedGameServerUrl?: string;
  vendorClientDir: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  tokenManager?: VendorTokenManagerLike;
  WebSocketImpl?: VendorWebSocketConstructor;
  /** When supplied, every auth request and every vendor socket uses this transport. */
  transport?: {
    fetch: typeof fetch;
    WebSocketImpl: VendorWebSocketConstructor;
    close(): Promise<void> | void;
  };
  envFactory?: typeof createVendorEnv;
  envOptions?: { nowStart?: number; randomSeed?: number; maxConsoleErrors?: number };
  reconnectMaxRetries?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  loginTimeoutMs?: number;
  loopIntervalMs?: number;
  watchdogMaxFrameDelayMs?: number;
  watchdogMaxRssGrowthBytes?: number;
  watchdogRestart?: boolean;
  /** Số ms tối đa Auto được chạy khi chưa có gói vitals chính thức (mặc định VITALS_CONFIRM_MS). */
  vitalsConfirmMs?: number;
  vitalsProbeIntervalMs?: number;
  khuChangeTimeoutMs?: number;
  khuListTimeoutMs?: number;
  supervisor?: Partial<AutoSupervisorConfig>;
  onSessionUpdated?: (session: AuthSession) => void;
  onLog?: VendorRunnerLogger;
}

const safeNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const safeBoolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

function normalizeGameUrl(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('VENDOR_GAME_URL_INVALID: game server URL is not a valid URL'); }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('VENDOR_GAME_URL_INVALID: only ws/wss URL without credentials, query or fragment is allowed');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

function assertAllowedGameUrl(url: string, configured: string): void {
  if (normalizeGameUrl(url) !== normalizeGameUrl(configured)) throw new Error('VENDOR_GAME_URL_NOT_ALLOWED');
}

function emptyPacketCounts(): VendorPacketCounts {
  return { incoming: {}, outgoing: {}, commands: {}, moves: 0, attacks: 0, skills: 0, cmds: 0 };
}

class CountingWebSocket implements VendorSocketLike {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public readyState: number;
  public onopen?: (event: unknown) => void;
  public onmessage?: (event: VendorSocketEvent) => void;
  public onerror?: (event: unknown) => void;
  public onclose?: (event: { code?: number; reason?: string }) => void;
  private readonly raw: VendorSocketLike;

  public constructor(
    url: string,
    implementation: VendorWebSocketConstructor,
    private readonly onIncoming: (packet: Record<string, unknown>) => void,
    private readonly onOutgoing: (packet: Record<string, unknown>) => void,
    private readonly onHandlerError: () => void,
    private readonly onClose: () => void,
  ) {
    this.raw = new implementation(url);
    this.readyState = this.raw.readyState;
    const raw = this.raw as VendorSocketLike & { on?: (name: string, listener: (...args: any[]) => void) => void };
    if (typeof raw.on === 'function') {
      raw.on('open', (event: unknown) => { this.readyState = CountingWebSocket.OPEN; this.onopen?.(event); });
      raw.on('message', (data: unknown) => this.handleMessage(data));
      raw.on('error', (error: unknown) => this.onerror?.(error));
      raw.on('close', (code?: number, reason?: Buffer | string) => this.handleClose(code, reason));
    } else {
      this.raw.onopen = (event) => { this.readyState = CountingWebSocket.OPEN; this.onopen?.(event); };
      this.raw.onmessage = (event) => this.handleMessage(event.data);
      this.raw.onerror = (event) => this.onerror?.(event);
      this.raw.onclose = (event) => this.handleClose(event.code, event.reason);
    }
  }

  public send(data: string): void {
    try {
      const packet = JSON.parse(data) as Record<string, unknown>;
      this.onOutgoing(packet);
    } catch {
      this.onHandlerError();
    }
    this.raw.send(data);
  }

  public close(): void {
    this.readyState = CountingWebSocket.CLOSING;
    this.raw.close();
  }

  private handleMessage(data: unknown): void {
    const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    try {
      const packet = JSON.parse(text) as Record<string, unknown>;
      this.onIncoming(packet);
      this.onmessage?.({ data: text });
    } catch {
      this.onHandlerError();
    }
  }

  private handleClose(code?: number, reason?: Buffer | string): void {
    this.readyState = CountingWebSocket.CLOSED;
    this.onclose?.({ code, reason: typeof reason === 'string' ? reason : reason?.toString('utf8') });
    this.onClose();
  }
}

export class VendorRunner {
  private lifecycle: VendorRunnerLifecycle = 'stopped';
  private env: VendorEnv | null = null;
  private P: Record<string, any> | null = null;
  private tokenManager: VendorTokenManagerLike | null = null;
  private supervisor: AutoSupervisor | null = null;
  private readonly walkNavigator: WalkNavigator;
  private readonly dailyQuests: DailyQuests;
  public readonly dailyClient: DailyClient;
  private readonly disconnectListeners = new Set<() => void>();
  private supervisorUnsubscribe: (() => void) | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private readonly frameMetrics = new FrameMetrics(() => performance.now());
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private startedAt = 0;
  private baseRss = 0;
  private frames = 0;
  private frameTimeMs = 0;
  private updateErrors = 0;
  private packetErrors = 0;
  private hurtCount = 0;
  private lastHurtAt: number | null = null;
  private lastVitalsAt: number | null = null;
  private lastOutgoingMoveAt: number | null = null;
  private vitalsProbe: { startedAt: number; movesSent: number; hurtCount: number } | null = null;
  private vitalsProbeExhausted = false;
  private vitalsProbeMoves = 0;
  private observedMapId: string | null = null;
  private observedKhu: number | null = null;
  private observedSoKhu: number | null = null;
  private khuList: KhuList | null = null;
  private lastKhuChangeAt: number | null = null;
  private khuChangeWaiter: {
    mapId: string;
    target: number;
    resolve: (result: KhuChangeResult) => void;
    reject: (error: KhuError) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private khuListWaiter: {
    mapId: string;
    resolve: (list: KhuList) => void;
    reject: (error: KhuError) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private khuListRequestPromise: Promise<KhuList> | null = null;
  /** THỬ NGHIỆM (đo giao thức đổi khu, xem docs/RESEARCH_KHU_CHANGE.md): các gói liên quan sau khi gửi khu-probe. */
  private khuProbeActive = false;
  private khuProbeEvents: Array<{ at: number; op: string; data?: unknown }> = [];
  /** Thời điểm bật Auto; dùng để dừng Auto nếu quá lâu chưa có gói vitals chính thức. */
  private autoStartedAt: number | null = null;
  private killsBySelf = 0;
  private reconnectAttempts = 0;
  private stopRequested = false;
  private watchdogRestarting = false;
  private autoRequested = false;
  private currentSocket: CountingWebSocket | null = null;
  private readonly packets = emptyPacketCounts();
  private readonly logs: Array<{ code: string; phase?: string; reasonCode?: string; detail?: string; at: number }> = [];
  private dailyStatusCache: { status: DailyStatus; at: number } | null = null;
  private dailyAckWaiter: { command: string; resolve: (ack: DailyAck) => void; timer: ReturnType<typeof setTimeout> | null } | null = null;
  /** Thời điểm ghi cảnh báo watchdog gần nhất theo lý do, để không ghi mỗi khung hình khi vượt ngưỡng kéo dài. */
  private readonly watchdogLoggedAt = new Map<string, number>();
  private readonly options: Required<Pick<VendorRunnerOptions, 'reconnectMaxRetries' | 'reconnectBaseDelayMs' | 'reconnectMaxDelayMs' | 'loginTimeoutMs' | 'loopIntervalMs' | 'watchdogMaxFrameDelayMs' | 'watchdogMaxRssGrowthBytes' | 'watchdogRestart' | 'vitalsConfirmMs' | 'vitalsProbeIntervalMs' | 'khuChangeTimeoutMs' | 'khuListTimeoutMs'>>;
  private transportClosed = false;

  public constructor(private readonly input: VendorRunnerOptions) {
    assertAllowedGameUrl(input.gameServerUrl, input.allowedGameServerUrl ?? input.gameServerUrl);
    this.options = {
      reconnectMaxRetries: input.reconnectMaxRetries ?? 5,
      reconnectBaseDelayMs: input.reconnectBaseDelayMs ?? 1_000,
      reconnectMaxDelayMs: input.reconnectMaxDelayMs ?? 30_000,
      loginTimeoutMs: input.loginTimeoutMs ?? 10_000,
      loopIntervalMs: input.loopIntervalMs ?? 16,
      vitalsConfirmMs: input.vitalsConfirmMs ?? VITALS_CONFIRM_MS,
      vitalsProbeIntervalMs: input.vitalsProbeIntervalMs ?? VITALS_PROBE_INTERVAL_MS,
      khuChangeTimeoutMs: input.khuChangeTimeoutMs ?? KHU_CHANGE_TIMEOUT_MS,
      khuListTimeoutMs: input.khuListTimeoutMs ?? KHU_LIST_TIMEOUT_MS,
      watchdogMaxFrameDelayMs: input.watchdogMaxFrameDelayMs ?? 250,
      watchdogMaxRssGrowthBytes: input.watchdogMaxRssGrowthBytes ?? 256 * 1024 * 1024,
      watchdogRestart: input.watchdogRestart ?? false,
    };
    this.walkNavigator = new WalkNavigator(this.createWalkClient());
    this.dailyClient = this.createDailyClient();
    this.dailyQuests = new DailyQuests(this.dailyClient);
  }

  public getLifecycle(): VendorRunnerLifecycle { return this.lifecycle; }
  public getFrameMetrics(): FrameMetricsSnapshot { return this.frameMetrics.snapshot(); }
  public onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  public async start(): Promise<void> {
    if (this.lifecycle !== 'stopped' && this.lifecycle !== 'error') return;
    this.frameMetrics.reset();
    this.stopRequested = false;
    this.transportClosed = false;
    this.lifecycle = 'starting';
    this.startedAt = Date.now();
    this.baseRss = process.memoryUsage().rss;
    try {
      this.tokenManager = this.input.tokenManager ?? await this.createTokenManager();
      this.tokenManager.on('sessionUpdated', (session) => {
        this.input.onSessionUpdated?.(session);
      });
      this.env = await this.createEnvironment();
      this.P = this.env.P;
      this.lastVitalsAt = null;
      this.lastOutgoingMoveAt = null;
      this.vitalsProbe = null;
      this.vitalsProbeExhausted = false;
      this.vitalsProbeMoves = 0;
      this.observedMapId = null;
      this.observedKhu = null;
      this.observedSoKhu = null;
      this.khuList = null;
      this.lastKhuChangeAt = null;
      this.dailyStatusCache = null;
      this.startLoop();
      await this.connectAndBuild(false);
    } catch (error) {
      this.lifecycle = 'error';
      this.recordLog('runner_start_failed', { reasonCode: this.errorCode(error) });
      this.cleanupTransport();
      this.tokenManager?.stop();
      this.tokenManager = null;
      await this.closeTransport();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.cancelDailyForReason('runner_stopped');
    this.cancelMoveTo('runner_stopped');
    this.failKhuWaiters(new KhuError('KHU_TIMEOUT'));
    this.finishVitalsProbe('runner_stop');
    this.autoRequested = false;
    this.stopRequested = true;
    const supervisor = this.supervisor;
    supervisor?.stop('runner_stop');
    const P = this.P;
    if (!supervisor && P) {
      const player = P.SceneWorld?.player;
      if (player && P.Player?.stop) P.Player.stop(player);
      if (P.SceneWorld?.autoOn && !P.Input?._autoToggle) P.Input?.pressAutoToggle?.();
    }
    this.supervisorUnsubscribe?.();
    this.supervisorUnsubscribe = null;
    this.supervisor = null;
    this.clearReconnectTimer();
    this.cleanupTransport();
    this.tokenManager?.stop();
    this.tokenManager = null;
    await this.closeTransport();
    this.lifecycle = 'stopped';
  }

  public async startAuto(anchor?: AutoAnchor): Promise<AutoSupervisorSnapshot> {
    if (this.lifecycle === 'stopped' || this.lifecycle === 'error' || !this.P || !this.env) throw new Error('VENDOR_NOT_RUNNING');
    this.cancelDailyForReason('auto_started');
    const player = this.getPlayer();
    if (!player) throw new Error('VENDOR_NOT_IN_GAME');
    if (!this.isMapReady()) throw new Error('VENDOR_MAP_NOT_READY');
    if (this.isDown(player)) throw new Error('VENDOR_CHARACTER_DOWN');
    // Gói vitals chính thức (you/hurt/revived) chỉ đến SAU khi nhân vật bắt đầu di chuyển, nên không đòi nó
    // trước khi bật Auto (sẽ không bao giờ bật được khi đứng yên). Mô hình HP của client (đầy lúc đăng nhập,
    // được gói chính thức sửa sau) đủ để bắt đầu; tick() dừng Auto nếu quá lâu vẫn chưa có xác nhận.
    if (!this.hasPlayerVitalsModel(player)) throw new Error('VENDOR_VITALS_UNKNOWN');
    if (anchor) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(anchor.mapId)
        || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
        || (anchor.khu != null && (!Number.isInteger(anchor.khu) || anchor.khu < 1))) {
        throw new Error('AUTO_ANCHOR_INVALID');
      }
      if (anchor.mapId !== this.observedMapId) throw new Error('AUTO_ANCHOR_MAP_MISMATCH');
      const mapData = this.P.MapData?.get ? this.P.MapData.get(anchor.mapId) : this.P.MapData?.[anchor.mapId];
      if (!mapData) throw new Error('AUTO_ANCHOR_MAP_UNKNOWN');
    }
    const currentMove = this.walkNavigator.getOperation();
    if (currentMove && (currentMove.status === 'accepted' || currentMove.status === 'running')) {
      this.walkNavigator.cancel(currentMove.operationId, 'auto_started');
    }
    const supervisor = this.supervisor ?? this.createSupervisor();
    this.autoRequested = true;
    this.vitalsProbe = null;
    this.vitalsProbeExhausted = false;
    this.vitalsProbeMoves = 0;
    supervisor.start(anchor);
    this.autoStartedAt = Date.now();
    this.lifecycle = supervisor.getPhase() === 'farming' ? 'farming' : 'traveling';
    this.recordLog('auto_started');
    return this.supervisor!.getSnapshot();
  }

  public stopAuto(): AutoSupervisorSnapshot {
    this.finishVitalsProbe('auto_stopped');
    this.autoRequested = false;
    this.autoStartedAt = null;
    this.supervisor?.stop('manual_auto_stop');
    if (this.lifecycle !== 'stopped' && this.lifecycle !== 'error') this.lifecycle = 'in_game';
    this.recordLog('auto_stopped');
    return this.supervisor?.getSnapshot() ?? this.emptySupervisorSnapshot();
  }

  public getSnapshot(): VendorRunnerSnapshot {
    const player = this.getPlayer();
    const supervisor = this.supervisor?.getSnapshot() ?? this.emptySupervisorSnapshot();
    const now = Date.now();
    const rss = process.memoryUsage().rss;
    const elapsed = this.startedAt > 0 ? Math.max(0, now - this.startedAt) : 0;
    const fps = elapsed > 0 ? this.frames / (elapsed / 1000) : 0;
    const vitals = this.getVitals(player);
    const mapReady = this.isMapReady();
    const mapId = mapReady ? this.getMapId() : null;
    const khu = mapReady ? this.getKhu() : null;
    const world = this.getWorldEntities(mapId, khu, now, player);
    return {
      lifecycle: this.lifecycle,
      connection: this.connectionState(),
      autoRequested: this.autoRequested,
      supervisor,
      packets: {
        incoming: { ...this.packets.incoming },
        outgoing: { ...this.packets.outgoing },
        commands: { ...this.packets.commands },
        moves: this.packets.moves,
        attacks: this.packets.attacks,
        skills: this.packets.skills,
        cmds: this.packets.cmds,
      },
      hurtCount: this.hurtCount,
      lastHurtAt: this.lastHurtAt,
      killsBySelf: this.killsBySelf,
      packetErrors: this.packetErrors,
      updateErrors: this.updateErrors,
      consoleErrors: [...(this.env?.consoleErrors ?? [])],
      frames: this.frames,
      fps,
      uptimeMs: elapsed,
      memory: { rssBytes: rss, rssGrowthBytes: Math.max(0, rss - this.baseRss) },
      tokenExpiresAt: this.tokenManager?.getSession?.()?.expiresAt ?? null,
      mapId,
      khu,
      x: mapReady && player ? safeNumber(player.x) : null,
      y: mapReady && player ? safeNumber(player.y) : null,
      hp: player ? safeNumber(player.hp) : null,
      maxHp: player ? safeNumber(player.hpMax) : null,
      mp: player ? safeNumber(player.mp) : null,
      maxMp: player ? safeNumber(player.mpMax) : null,
      downed: player ? this.isDown(player) : null,
      vitalsProbeMoves: this.vitalsProbeMoves,
      soKhu: mapReady ? this.getSoKhu() : null,
      khuList: mapReady ? this.getKhuListForMap(mapId) : null,
      monsters: world.monsters,
      players: world.players,
      monstersContext: world.monstersContext,
      playersContext: world.playersContext,
      vitals,
      moveTo: this.walkNavigator.getOperation(),
      daily: this.dailyQuests.getOperation(),
      dailyStatus: this.getDailyStatusSnapshot(),
      logs: this.logs.map((entry) => ({ ...entry })),
    };
  }

  public moveTo(request: WalkRequest): WalkOperation {
    if (request.requester === 'user' && this.dailyQuests.isActive()) throw new DailyError('OPERATION_IN_PROGRESS');
    return this.walkNavigator.walkTo(request);
  }

  public cancelMoveTo(reason = 'user_cancelled', operationId?: string): boolean {
    const current = this.walkNavigator.getOperation();
    if (!current || (current.status !== 'accepted' && current.status !== 'running')) return false;
    if (operationId !== undefined && current.operationId !== operationId) return false;
    return this.walkNavigator.cancel(current.operationId, reason);
  }

  public getKhuInfo(): KhuInfo {
    const mapId = this.isMapReady() ? this.getMapId() : null;
    return {
      mapId,
      khu: mapId ? this.getKhu() : null,
      soKhu: mapId ? this.getSoKhu() : null,
      list: this.getKhuListForMap(mapId),
    };
  }

  public async requestKhuList(): Promise<KhuList> {
    if (this.connectionState() !== 'IN_GAME' || !this.getPlayer()) throw new KhuError('NOT_IN_GAME');
    if (!this.isMapReady()) throw new KhuError('VENDOR_MAP_NOT_READY');
    if (this.khuListRequestPromise) return this.khuListRequestPromise;
    const mapId = this.getMapId();
    const gateway = this.P?.Gateway;
    if (!mapId || !gateway?.connected || typeof gateway.send !== 'function') throw new KhuError('NOT_IN_GAME');

    const promise = new Promise<KhuList>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.khuListWaiter?.mapId !== mapId) return;
        this.khuListWaiter = null;
        this.khuListRequestPromise = null;
        this.recordLog('khu_list_timeout');
        reject(new KhuError('KHU_TIMEOUT'));
      }, this.options.khuListTimeoutMs);
      this.khuListWaiter = { mapId, resolve, reject, timer };
    });
    this.khuListRequestPromise = promise;
    try {
      const sent = gateway.send({ op: 'khu', act: 'xem' });
      if (sent === false) this.failKhuListWaiter(new KhuError('KHU_TIMEOUT'));
    } catch {
      this.failKhuListWaiter(new KhuError('KHU_TIMEOUT'));
    }
    return promise;
  }

  public async changeKhu(khu: number): Promise<KhuChangeResult> {
    if (this.connectionState() !== 'IN_GAME' || !this.getPlayer()) throw new KhuError('NOT_IN_GAME');
    if (!this.isMapReady()) throw new KhuError('VENDOR_MAP_NOT_READY');
    const player = this.getPlayer();
    if (this.isDown(player)) throw new KhuError('CHARACTER_DOWN');
    if (this.autoRequested || (this.supervisor?.getPhase() ?? 'idle') !== 'idle') throw new KhuError('AUTO_ACTIVE');
    if (this.dailyQuests.isActive()) throw new KhuError('OPERATION_IN_PROGRESS');
    const currentMove = this.walkNavigator.getOperation();
    if (currentMove && (currentMove.status === 'accepted' || currentMove.status === 'running')) {
      throw new KhuError('OPERATION_IN_PROGRESS');
    }
    if (this.khuChangeWaiter) throw new KhuError('KHU_IN_PROGRESS');
    const soKhu = this.getSoKhu();
    if (soKhu === null || soKhu <= 1) throw new KhuError('MAP_NOT_SPLIT');
    if (!Number.isInteger(khu) || khu < 1 || khu > soKhu) throw new KhuError('TARGET_INVALID');
    const currentKhu = this.getKhu();
    if (currentKhu !== null && khu === currentKhu) throw new KhuError('KHU_ALREADY_HERE');
    const now = Date.now();
    if (this.lastKhuChangeAt !== null && now - this.lastKhuChangeAt < KHU_COOLDOWN_MS) {
      const retryAfterSec = Math.max(1, Math.ceil((KHU_COOLDOWN_MS - (now - this.lastKhuChangeAt)) / 1000));
      throw new KhuError('KHU_COOLDOWN', 'KHU_COOLDOWN', retryAfterSec);
    }
    const mapId = this.getMapId();
    const gateway = this.P?.Gateway;
    if (!mapId || !gateway?.connected || typeof gateway.send !== 'function') throw new KhuError('NOT_IN_GAME');

    const result = new Promise<KhuChangeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.khuChangeWaiter || this.khuChangeWaiter.mapId !== mapId || this.khuChangeWaiter.target !== khu) return;
        this.khuChangeWaiter = null;
        this.recordLog('khu_timeout');
        reject(new KhuError('KHU_TIMEOUT'));
      }, this.options.khuChangeTimeoutMs);
      this.khuChangeWaiter = { mapId, target: khu, resolve, reject, timer };
    });
    try {
      const sent = gateway.send({ op: 'khu', act: 'chon', khu });
      if (sent === false) this.failKhuChangeWaiter(new KhuError('KHU_TIMEOUT'));
    } catch {
      this.failKhuChangeWaiter(new KhuError('KHU_TIMEOUT'));
    }
    return result;
  }

  /** Map graph read directly from the official client's MapData instance. */
  public getReachableMaps(): { currentMapId: string; maps: ReachableMap[] } {
    if (!this.isMapReady()) throw new Error('VENDOR_MAP_NOT_READY');
    const currentMapId = this.getMapId();
    if (!currentMapId) throw new Error('VENDOR_MAP_NOT_READY');
    const mapIds = this.getMapIdsFromClient();
    return {
      currentMapId,
      maps: reachableMaps((mapId) => this.getPortalsFromClient(mapId), mapIds, currentMapId),
    };
  }

  private async createTokenManager(): Promise<VendorTokenManagerLike> {
    const { SupabaseAuth, TokenManager } = await import('@tutien2d/core-client');
    if (this.input.transport && typeof this.input.transport.fetch !== 'function') throw new Error('PROXY_TRANSPORT_INVALID');
    const auth = new SupabaseAuth({
      url: this.input.supabaseUrl,
      anonKey: this.input.supabaseAnonKey,
      gameApiBase: this.input.gameServerUrl.replace(/^ws/i, 'http'),
      ...(this.input.transport ? { fetchImpl: this.input.transport.fetch } : {}),
    });
    return new TokenManager({
      auth,
      identifier: this.input.accountName,
      password: this.input.credentials.password,
      refreshToken: this.input.credentials.refreshToken,
      staticToken: this.input.credentials.password ? undefined : this.input.credentials.legacyToken,
    });
  }

  private async createEnvironment(): Promise<VendorEnv> {
    const EnvFactory = this.input.envFactory ?? createVendorEnv;
    const implementation = this.input.transport
      ? this.input.transport.WebSocketImpl
      : this.input.WebSocketImpl ?? ((await import('ws')).default as unknown as VendorWebSocketConstructor);
    if (typeof implementation !== 'function') throw new Error('PROXY_TRANSPORT_INVALID');
    const runner = this;
    class CountedWebSocket extends CountingWebSocket {
      public constructor(url: string) {
        super(
          url,
          implementation,
          (packet) => runner.recordIncoming(packet),
          (packet) => runner.recordOutgoing(packet),
          () => { runner.packetErrors += 1; },
          () => runner.handleSocketClosed(),
        );
      }
    }
    const env = EnvFactory({
      vendorClientDir: this.input.vendorClientDir,
      WebSocketImpl: CountedWebSocket as unknown as VendorWebSocketConstructor,
      ...this.input.envOptions,
    });
    (env.win as Record<string, any>).PNTT_RUNTIME_CONFIG = { serverUrl: this.input.gameServerUrl };
    return env;
  }

  private async connectAndBuild(reconnect: boolean): Promise<void> {
    if (!this.P || !this.env || !this.tokenManager) throw new Error('VENDOR_NOT_INITIALIZED');
    this.lifecycle = reconnect ? 'connecting' : 'connecting';
    const P = this.P;
    P.Net.online = true;
    P.Net.client = { auth: { getSession: async () => ({ data: { session: { access_token: await this.tokenManager!.getAccessToken() } } }) } };
    if (!reconnect) P.Game.init();
    const loggedIn = await P.Gateway.login(this.options.loginTimeoutMs);
    // Gateway.login resolves on the welcome response. The subsequent state
    // packet is what marks Gateway.ready and can arrive after scene setup.
    if (!loggedIn) throw new Error('VENDOR_LOGIN_TIMEOUT');
    if (!P.SceneWorld.player) {
      const mapData = P.SceneWorld.startMapData();
      P.SceneWorld.nuongNenDau(mapData);
      P.Game.changeScene(P.SceneWorld, null, true);
    }
    await this.waitForScene();
    this.reconnectAttempts = 0;
    const supervisor = this.supervisor ?? this.createSupervisor();
    if (reconnect && this.autoRequested) {
      const anchor = supervisor.getSnapshot().anchor;
      if (anchor) {
        await this.waitForMapReady();
        if (this.autoRequested && !this.stopRequested) {
          supervisor.start(anchor, true);
          this.autoStartedAt = Date.now();
        }
      }
    }
    // `lifecycle` có thể đã đổi trong lúc await (ví dụ supervisor dừng khẩn): đọc lại qua hàm để TypeScript không thu hẹp kiểu cũ.
    if (this.currentLifecycle() !== 'halted') this.lifecycle = this.autoRequested ? 'farming' : 'in_game';
    this.recordLog(reconnect ? 'runner_reconnected' : 'runner_in_game');
  }

  private async waitForScene(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (this.getPlayer()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('VENDOR_SCENE_NOT_READY');
  }

  private async waitForMapReady(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (this.isMapReady()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('VENDOR_MAP_NOT_READY');
  }

  private currentLifecycle(): VendorRunnerSnapshot['lifecycle'] {
    return this.lifecycle;
  }

  private createSupervisor(): AutoSupervisor {
    const port = this.createClientPort();
    const supervisor = new AutoSupervisor(port, { ...DEFAULT_AUTO_SUPERVISOR_CONFIG, ...(this.input.supervisor ?? {}) });
    this.supervisor = supervisor;
    this.supervisorUnsubscribe = supervisor.on((event) => this.handleSupervisorEvent(event));
    return supervisor;
  }

  private createClientPort(): AutoClientPort {
    const getP = () => this.P!;
    return {
      nowSec: () => Number(getP().Game.time) || 0,
      getPlayer: () => this.getPlayer(),
      getMapId: () => this.getMapId(),
      getKhu: () => this.getKhu(),
      isTransitioning: () => !!getP().SceneWorld.transitioning,
      getAutoOn: () => !!getP().SceneWorld.autoOn,
      isAutoToggleQueued: () => !!getP().Input._autoToggle,
      pressAutoToggle: () => getP().Input.pressAutoToggle(),
      reviveAtHome: () => !!getP().SceneWorld.reviveAtHome(),
      reviveOnSpot: () => !!getP().SceneWorld.reviveOnSpot(),
      pressMeditate: () => getP().Input.pressMeditate(),
      stand: () => {
        const player = this.getPlayer();
        if (player && getP().Player.stand) getP().Player.stand(player);
      },
      cancelApproach: () => getP().SceneWorld.cancelApproach?.(),
      portalsOf: (mapId) => {
        const map = getP().MapData.get ? getP().MapData.get(mapId) : getP().MapData[mapId];
        return (map?.portals ?? []).map((portal: Record<string, unknown>) => ({
          tx: Number(portal.tx),
          ty: Number(portal.ty),
          toMapId: String(portal.toMap || portal.to),
        })).filter((portal: { tx: number; ty: number; toMapId: string }) => Number.isFinite(portal.tx) && Number.isFinite(portal.ty) && portal.toMapId);
      },
      walkTo: (x, y) => {
        const player = this.getPlayer();
        const world = getP().SceneWorld;
        if (!player || !world.map || !getP().Pathfinder?.route) return false;
        const route = getP().Pathfinder.route(world.map, player.x, player.y, x, y,
          (getP().CONFIG?.PLAYER?.HITBOX_W ?? 16) / 2, getP().CONFIG?.PLAYER?.HITBOX_H ?? 12);
        if (!route || !route.length) return false;
        player.setPath(route);
        return true;
      },
    };
  }

  private createWalkClient(): WalkNavigatorClient {
    return {
      nowMs: () => Date.now(),
      isInGame: () => this.connectionState() === 'IN_GAME',
      isMapReady: () => this.isMapReady(),
      isTransitioning: () => !!this.P?.SceneWorld?.transitioning,
      getMapId: () => this.getMapId(),
      getMap: () => this.P?.SceneWorld?.map ?? null,
      getPlayer: () => this.getPlayer(),
      isDown: (player) => this.isDown(player),
      isAutoRequested: () => this.autoRequested,
      getSupervisorPhase: () => this.supervisor?.getPhase() ?? 'idle',
      getPathfinder: () => this.P?.Pathfinder?.route ? this.P.Pathfinder : null,
      getHitbox: () => ({
        width: Number(this.P?.CONFIG?.PLAYER?.HITBOX_W) || 16,
        height: Number(this.P?.CONFIG?.PLAYER?.HITBOX_H) || 12,
      }),
      getPortals: (mapId) => this.getPortalsFromClient(mapId),
      getMapIds: () => this.getMapIdsFromClient(),
      getHurtCount: () => this.hurtCount,
      recordLog: (event) => this.recordLog(event.code, { reasonCode: event.reasonCode, detail: event.detail, at: event.at }),
    };
  }

  private createDailyClient() {
    return {
      nowMs: () => Date.now(),
      isInGame: () => this.connectionState() === 'IN_GAME',
      isMapReady: () => this.isMapReady(),
      isDown: () => this.isDown(this.getPlayer()),
      isAutoActive: () => this.autoRequested || !!this.P?.SceneWorld?.autoOn,
      getSupervisorPhase: () => this.supervisor?.getPhase() ?? 'idle',
      getHurtCount: () => this.hurtCount,
      getWalkOperation: () => this.walkNavigator.getOperation(),
      walkTo: (request: WalkRequest) => this.walkNavigator.walkTo(request),
      cancelWalk: (operationId: string, reason: string) => { this.walkNavigator.cancel(operationId, reason); },
      readDailyState: () => this.readDailyState(),
      getProp: (mapId: string, propId: string) => this.getDailyProp(mapId, propId),
      listProps: (mapId: string, type: string) => this.getDailyProps(mapId, type),
      getPosition: () => {
        const player = this.getPlayer();
        const mapId = this.getMapId();
        return player && mapId && Number.isFinite(player.x) && Number.isFinite(player.y)
          ? { mapId, x: Number(player.x), y: Number(player.y) } : null;
      },
      startChopping: (prop: DailyProp, mapId?: string) => this.startDailyChopping(prop, mapId),
      startFishing: (propId: string) => this.startDailyFishing(propId),
      isFishing: () => !!this.P?.SceneWorld?.fishing,
      fishInBag: () => this.fishInBag(),
      getFishingApproach: (prop: DailyProp) => this.getDailyFishingApproach(prop),
      stopFishing: () => { if (this.P?.SceneWorld) this.P.SceneWorld.fishing = null; },
      invokeCheckin: () => this.P?.Gateway?.cmd?.('diemdanh', {}, () => undefined),
      startSeedQuest: (taskId: string) => this.P?.Quest?.startSeedQuest?.(taskId),
      completeSeedQuest: () => this.P?.Quest?.completeSeedQuest?.(),
      completeEscortSeedQuest: () => this.P?.Quest?.completeEscortSeedQuest?.(),
      issueCommand: (command: string, action: () => unknown) => this.issueDailyCommand(command, action),
      harvestResource: (propId: string) => this.P?.Gateway?.cmd?.('resource.harvest', { propId }, () => undefined),
      watchCommand: (command: string) => this.watchDailyCommand(command),
      cancelPendingCommand: (command: string) => this.cancelDailyAck(command),
      collectSeedMaterial: (taskId: string, propId: string) => this.P?.Quest?.collectSeedMaterial?.(taskId, propId),
      cancelSeedQuest: () => this.P?.Quest?.cancelSeedQuest?.(),
      recordLog: (event: { code: string; reasonCode?: string; detail?: string; at: number }) => this.recordLog(event.code, event),
    };
  }

  private assertDailyRuntimeReady(): void {
    if (this.connectionState() !== 'IN_GAME' || !this.getPlayer()) throw new DailyError('NOT_IN_GAME');
    if (!this.isMapReady()) throw new DailyError('VENDOR_MAP_NOT_READY');
  }

  private getDailyStatusSnapshot(): DailyStatus | null {
    if (this.connectionState() !== 'IN_GAME' || !this.isMapReady()) return this.dailyStatusCache?.status ?? null;
    if (!this.dailyStatusCache || Date.now() - this.dailyStatusCache.at >= 1_000) {
      try { this.dailyStatusCache = { status: this.dailyQuests.getStatus(), at: Date.now() }; } catch { return this.dailyStatusCache?.status ?? null; }
    }
    return this.dailyStatusCache.status;
  }

  private readDailyState(): DailyClientState {
    const P = this.P;
    const quest = P?.Quest;
    const seed = quest?.seedQuest;
    const todayValue = typeof quest?.today === 'function' ? quest.today() : null;
    const today = typeof todayValue === 'string' ? todayValue : null;
    const checkinDone = !!(P?.DiemDanh && typeof P.DiemDanh.daNhan === 'function' && P.DiemDanh.daNhan(P));
    const totalValue = P?.DiemDanh && typeof P.DiemDanh.tong === 'function' ? P.DiemDanh.tong(P) : null;
    const rawList = typeof quest?.seedTaskList === 'function' ? quest.seedTaskList() : [];
    const rawEntries = Array.isArray(rawList) ? rawList.flatMap((entry: unknown) => {
      if (typeof entry === 'string') return [{ id: entry, definition: null as Record<string, unknown> | null, raw: null as Record<string, unknown> | null }];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const raw = entry as Record<string, unknown>;
      const definition = raw.def && typeof raw.def === 'object' && !Array.isArray(raw.def)
        ? raw.def as Record<string, unknown> : raw;
      const id = typeof definition.id === 'string' ? definition.id : null;
      return id ? [{ id, definition, raw }] : [];
    }) : [];
    const taskIds = rawEntries.map((entry) => entry.id);
    const daily = seed?.daily && typeof seed.daily === 'object' ? seed.daily as Record<string, unknown> : {};
    for (const id of Object.keys(daily)) if (!taskIds.includes(id)) taskIds.push(id);
    const tasks = taskIds.map((id): DailyStatus['seedTasks'][number] => {
      const rawEntry = rawEntries.find((entry) => entry.id === id);
      const infoRaw = seed?.active && seed.task === id && typeof quest?.seedTaskInfo === 'function'
        ? quest.seedTaskInfo() : rawEntry?.definition ?? null;
      const info = infoRaw && typeof infoRaw === 'object' ? infoRaw as Record<string, unknown> : {};
      const countRaw = daily[id];
      const countValue = rawEntry?.raw && Number.isInteger(rawEntry.raw.runsToday) ? Number(rawEntry.raw.runsToday)
        : countRaw && typeof countRaw === 'object' && Number.isInteger((countRaw as Record<string, unknown>).n)
        && typeof (countRaw as Record<string, unknown>).day === 'string'
        && today !== null && (countRaw as Record<string, unknown>).day === today ? Number((countRaw as Record<string, unknown>).n) : null;
      const count = today === null ? null : countValue ?? 0;
      const rawLimit = rawEntry?.raw?.dailyLimit;
      const limitValue = Number.isInteger(rawLimit) ? Number(rawLimit)
        : Number.isInteger(info.limit) ? Number(info.limit)
        : Number.isInteger(info.dailyLimit) ? Number(info.dailyLimit)
        : id === 'duoc_moc' || id === 'linh_chi' || id === 'truc_gia' || id === 'cau_ca' || id === 'ho_tong_chau' ? 3 : null;
      const runsLeftValue = rawEntry?.raw && Number.isInteger(rawEntry.raw.runsLeft) ? Number(rawEntry.raw.runsLeft)
        : typeof quest?.seedTaskRunsLeft === 'function' ? quest.seedTaskRunsLeft(id) : null;
      const runsLeft = Number.isInteger(runsLeftValue)
        ? Math.max(0, Number(runsLeftValue))
        : limitValue === null || count === null ? null : Math.max(0, limitValue - count);
      const name = typeof info.name === 'string' ? info.name : id;
      const kind = typeof info.kind === 'string' ? info.kind : 'collect';
      return {
        id,
        name,
        kind,
        limit: limitValue,
        runsToday: count,
        runsLeft,
        supported: id === 'duoc_moc' || id === 'linh_chi' || id === 'truc_gia' || id === 'cau_ca' || id === 'ho_tong_chau',
        active: !!seed?.active && seed.task === id,
      };
    });
    const collectedValue = seed?.collected;
    const activeCollectedIds = collectedValue && typeof collectedValue === 'object' && !Array.isArray(collectedValue)
      ? Object.entries(collectedValue as Record<string, unknown>).filter(([, value]) => Boolean(value)).map(([id]) => id).sort()
      : [];
    const activeCollected = typeof collectedValue === 'number' && Number.isFinite(collectedValue)
      ? collectedValue
      : collectedValue && typeof collectedValue === 'object' && !Array.isArray(collectedValue)
        ? activeCollectedIds.length : null;
    const drops = Array.isArray(P?.SceneWorld?.drops) ? P.SceneWorld.drops.flatMap((drop: unknown) => {
      if (!drop || typeof drop !== 'object' || Array.isArray(drop)) return [];
      const value = drop as Record<string, unknown>;
      const x = Number(value.x);
      const y = Number(value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [{
        ...(typeof value.task === 'string' ? { task: value.task } : {}),
        ...(typeof value.materialId === 'string' ? { materialId: value.materialId } : {}),
        ...(typeof value.state === 'string' ? { state: value.state } : {}),
        x,
        y,
      }];
    }) : [];
    const countInventory = (id: string): number | null => {
      const value = P?.Inventory?.count?.(id);
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    const fishInBag = [countInventory('ca_song'), countInventory('linh_ngu')].every((value) => value !== null)
      ? (countInventory('ca_song') ?? 0) + (countInventory('linh_ngu') ?? 0) : null;
    const stones = typeof P?.Progress?.stones === 'number' && Number.isFinite(P.Progress.stones) ? P.Progress.stones : null;
    const duocCong = typeof P?.Progress?.duocCong === 'number' && Number.isFinite(P.Progress.duocCong) ? P.Progress.duocCong : null;
    return {
      today,
      stage: typeof quest?.stage === 'number' && Number.isFinite(quest.stage) ? quest.stage : null,
      checkin: { done: checkinDone, total: typeof totalValue === 'number' && Number.isFinite(totalValue) ? totalValue : null },
      seedTasks: tasks,
      activeSeedTask: typeof seed?.task === 'string' && seed.active ? seed.task : null,
      stones,
      duocCong,
      canhKho: countInventory('canh_kho'),
      namLinhChi: countInventory('nam_linh_chi'),
      fishInBag,
      activeCollected,
      activeCollectedIds,
      activeRequired: seed?.active && seed.task === 'duoc_moc' ? 5 : seed?.active && seed.task === 'linh_chi' ? 3 : seed?.active && seed.task === 'truc_gia' ? 4 : seed?.active && seed.task === 'cau_ca' ? 3 : seed?.active && seed.task === 'ho_tong_chau' ? 0 : null,
      drops,
    };
  }

  private getDailyProp(mapId: string, propId: string): DailyProp | null {
    const P = this.P;
    const map = mapId === this.getMapId() ? P?.SceneWorld?.map : P?.MapData?.get ? P.MapData.get(mapId) : P?.MapData?.[mapId];
    const interactables = Array.isArray(map?.interactables) ? map.interactables : [];
    const candidates = [...(Array.isArray(map?.props) ? map.props : []), ...(Array.isArray(map?.flatProps) ? map.flatProps : []), ...interactables];
    const found = candidates.find((candidate: unknown) => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === propId) as Record<string, unknown> | undefined;
    if (!found || typeof found.id !== 'string') return null;
    const isInteractable = interactables.includes(found);
    // Prop thường của MapData dùng đáy ô; interactable (như điểm câu) dùng tâm ô.
    // Map đang tải thường đã có x/y nên giữ nguyên toạ độ client đã tính.
    let x = Number(found.x);
    let y = Number(found.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const tx = Number(found.tx);
      const ty = Number(found.ty);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const tile = Number(P?.CONFIG?.TILE) || 32;
      x = tx * tile + tile / 2;
      y = isInteractable ? ty * tile + tile / 2 : (ty + 1) * tile;
    }
    return {
      id: found.id,
      x,
      y,
      ...(Number.isFinite(Number(found.r)) ? { r: Number(found.r) } : {}),
      ...(typeof found.chopTask === 'string' ? { chopTask: found.chopTask } : {}),
      ...(typeof found.seedTask === 'string' ? { seedTask: found.seedTask } : {}),
      ...(typeof found.type === 'string' ? { type: found.type } : {}),
      ...(typeof found.hidden === 'boolean' ? { hidden: found.hidden } : {}),
    };
  }

  private getDailyProps(mapId: string, type: string): DailyProp[] {
    const P = this.P;
    // Vị trí và trạng thái ẩn của cây Linh Chi đổi theo ngày (client chạy applyLinhChi trên map đã tải); dữ liệu tĩnh
    // của map khác không đúng, nên chỉ liệt kê khi nhân vật đang đứng trong map đó.
    if ((type === 'ling_chi_prop' || type === 'seed_bamboo_prop') && mapId !== this.getMapId()) return [];
    const map = mapId === this.getMapId() ? P?.SceneWorld?.map : P?.MapData?.get ? P.MapData.get(mapId) : P?.MapData?.[mapId];
    const interactables = Array.isArray(map?.interactables) ? map.interactables : [];
    const candidates = [...(Array.isArray(map?.props) ? map.props : []), ...(Array.isArray(map?.flatProps) ? map.flatProps : []), ...interactables];
    const seen = new Set<string>();
    const props: DailyProp[] = [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const raw = candidate as Record<string, unknown>;
      const matchesType = type === 'interactable' || type === 'interactables' || type === 'fishing' || type === 'water'
        ? interactables.includes(candidate)
        : raw.type === type;
      if (!matchesType || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
      const prop = this.getDailyProp(mapId, raw.id);
      if (prop) { seen.add(prop.id); props.push(prop); }
    }
    return props;
  }

  private startDailyChopping(prop: DailyProp, mapId: string = 'duoc_vien'): boolean {
    const actual = this.getDailyProp(mapId, prop.id);
    if (!actual || !this.P?.SceneWorld) return false;
    this.P.SceneWorld.chopping = { prop: actual, swing: 0, t: 10 };
    return true;
  }

  private fishInBag(): number | null {
    const count = (id: string): number | null => {
      const value = this.P?.Inventory?.count?.(id);
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
    };
    const caSong = count('ca_song');
    const linhNgu = count('linh_ngu');
    return caSong === null || linhNgu === null ? null : caSong + linhNgu;
  }

  private getDailyFishingApproach(prop: DailyProp): { x: number; y: number } | null {
    const P = this.P;
    const world = P?.SceneWorld;
    const player = this.getPlayer();
    const map = world?.map;
    if (!world || !player || !map) return null;
    const tile = Number(P.CONFIG?.TILE) || 32;
    if (!Array.isArray(map.groundName) || !Number.isInteger(map.width) || !Number.isInteger(map.height)) return { x: prop.x, y: prop.y };
    const cx = Math.floor(Number(player.x) / tile);
    const cy = Math.floor(Number(player.y) / tile);
    let bestPoint: { x: number; y: number } | null = null;
    let best = Infinity;
    for (let ty = Math.max(0, cy - 3); ty <= Math.min(Number(map.height) - 1, cy + 3); ty += 1) {
      for (let tx = Math.max(0, cx - 3); tx <= Math.min(Number(map.width) - 1, cx + 3); tx += 1) {
        if (map.groundName[ty * Number(map.width) + tx] !== 'water') continue;
        const point = { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
        const distance = Math.hypot(prop.x - point.x, prop.y - point.y) + 0.25 * Math.hypot(Number(player.x) - point.x, Number(player.y) - point.y);
        if (distance < best) { best = distance; bestPoint = point; }
      }
    }
    return bestPoint ?? { x: prop.x, y: prop.y };
  }

  /** Bắt chước In(prop) của client: dừng nhân vật, đặt phao ở ô nước gần nhất và để vòng update tự gửi fishing.catch. */
  private startDailyFishing(propId: string): { started: boolean; durationMs?: number; waterNear?: boolean } {
    const P = this.P;
    const world = P?.SceneWorld;
    const player = this.getPlayer();
    const map = world?.map;
    const candidates = [...(Array.isArray(map?.props) ? map.props : []), ...(Array.isArray(map?.flatProps) ? map.flatProps : []), ...(Array.isArray(map?.interactables) ? map.interactables : [])];
    const prop = candidates.find((candidate: unknown) => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === propId) as Record<string, unknown> | undefined;
    if (!world || !player || !map || !prop || !P?.Fishing || world.fishing) return { started: false, waterNear: false };
    player.stop?.();
    P.Player?.stand?.(player);
    player.state = 'idle';
    const tile = Number(P.CONFIG?.TILE) || 32;
    let bob: { x: number; y: number } | null = null;
    let best = Infinity;
    if (Array.isArray(map.groundName) && Number.isInteger(map.width) && Number.isInteger(map.height)) {
      const cx = Math.floor(Number(player.x) / tile);
      const cy = Math.floor(Number(player.y) / tile);
      for (let ty = Math.max(0, cy - 3); ty <= Math.min(Number(map.height) - 1, cy + 3); ty += 1) {
        for (let tx = Math.max(0, cx - 3); tx <= Math.min(Number(map.width) - 1, cx + 3); tx += 1) {
          if (map.groundName[ty * Number(map.width) + tx] !== 'water') continue;
          const gx = tx * tile + tile / 2;
          const gy = ty * tile + tile / 2;
          const d = Math.hypot(Number(prop.x) - gx, Number(prop.y) - gy) + 0.25 * Math.hypot(Number(player.x) - gx, Number(player.y) - gy);
          if (d < best) { best = d; bob = { x: gx, y: gy }; }
        }
      }
    }
    const duration = P.Fishing.waitTime();
    world.fishing = {
      t: 0,
      duration,
      bobX: bob?.x ?? Number(player.x),
      bobY: bob?.y ?? Number(player.y),
      waterName: String(prop.title ?? prop.name ?? 'Bờ Nước'),
      prop,
      auto: false,
    };
    return { started: true, durationMs: typeof duration === 'number' && Number.isFinite(duration) ? Math.max(0, duration) * 1_000 : undefined, waterNear: bob !== null };
  }

  private issueDailyCommand(command: string, action: () => unknown): Promise<DailyAck> {
    if (this.dailyAckWaiter) return Promise.resolve({ cmd: command, ok: false, why: 'OPERATION_IN_PROGRESS' });
    return new Promise<DailyAck>((resolve) => {
      const timer = setTimeout(() => {
        if (this.dailyAckWaiter?.command !== command) return;
        this.dailyAckWaiter = null;
        resolve({ cmd: command, ok: false, why: 'ACK_TIMEOUT' });
      }, 5_000);
      this.dailyAckWaiter = { command, resolve, timer };
      try {
        const result = action();
        if (result === false) this.settleDailyAck({ op: 'ack', cmd: command, ok: false, why: 'CLIENT_REFUSED' });
      } catch {
        this.settleDailyAck({ op: 'ack', cmd: command, ok: false, why: 'COMMAND_FAILED' });
      }
    });
  }

  private watchDailyCommand(command: string): Promise<DailyAck> {
    if (this.dailyAckWaiter) return Promise.resolve({ cmd: command, ok: false, why: 'OPERATION_IN_PROGRESS' });
    return new Promise<DailyAck>((resolve) => {
      this.dailyAckWaiter = { command, resolve, timer: null };
    });
  }

  private cancelDailyAck(command: string): void {
    if (!this.dailyAckWaiter || this.dailyAckWaiter.command !== command) return;
    const waiter = this.dailyAckWaiter;
    if (waiter.timer) clearTimeout(waiter.timer);
    this.dailyAckWaiter = null;
    waiter.resolve({ cmd: command, ok: false, why: 'CANCELLED' });
  }

  private settleDailyAck(packet: Record<string, unknown>): void {
    const waiter = this.dailyAckWaiter;
    if (!waiter || packet.cmd !== waiter.command) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    this.dailyAckWaiter = null;
    waiter.resolve({
      cmd: waiter.command,
       ...(typeof packet.rid === 'string' || typeof packet.rid === 'number' ? { rid: packet.rid } : {}),
      ok: packet.ok === true,
      ...(typeof packet.why === 'string' ? { why: packet.why } : {}),
      ...(typeof packet.toast === 'string' ? { toast: packet.toast } : {}),
      ...(typeof packet.stones === 'number' && Number.isFinite(packet.stones) ? { stones: packet.stones } : {}),
      ...(typeof packet.duocCong === 'number' && Number.isFinite(packet.duocCong) ? { duocCong: packet.duocCong } : {}),
      ...(typeof packet.du === 'boolean' ? { du: packet.du } : {}),
      ...(typeof packet.retryAfter === 'number' && Number.isFinite(packet.retryAfter) ? { retryAfter: packet.retryAfter } : {}),
      ...(typeof packet.regrowAfter === 'number' && Number.isFinite(packet.regrowAfter) ? { regrowAfter: packet.regrowAfter } : {}),
      ...(typeof packet.itemId === 'string' ? { itemId: packet.itemId } : {}),
      ...(typeof packet.propId === 'string' ? { propId: packet.propId } : {}),
      ...(typeof packet.missed === 'boolean' ? { missed: packet.missed } : {}),
    });
  }

  private getMapIdsFromClient(): string[] {
    const mapData = this.P?.MapData;
    if (!mapData || typeof mapData !== 'object') return [];
    const ids = new Set<string>();
    for (const value of Object.values(mapData as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const id = (value as Record<string, unknown>).id;
      if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id)) ids.add(id);
    }
    return [...ids].sort();
  }

  private getPortalsFromClient(mapId: string): Array<{
    tx: number;
    ty: number;
    toMapId?: string;
    byHand?: boolean;
    cooldownSec?: number;
    cooldownGroup?: string;
  }> {
    const map = this.P?.MapData?.get ? this.P.MapData.get(mapId) : this.P?.MapData?.[mapId];
    if (!map || !Array.isArray(map.portals)) return [];
    return map.portals.flatMap((portal: unknown) => {
      if (!portal || typeof portal !== 'object' || Array.isArray(portal)) return [];
      const entry = portal as Record<string, unknown>;
      const tx = Number(entry.tx);
      const ty = Number(entry.ty);
      const toMapId = typeof entry.toMap === 'string' ? entry.toMap
        : typeof entry.to === 'string' ? entry.to : undefined;
      if (!Number.isInteger(tx) || !Number.isInteger(ty) || !toMapId) return [];
      return [{
        tx,
        ty,
        toMapId,
        ...(typeof entry.byHand === 'boolean' ? { byHand: entry.byHand } : {}),
        ...(typeof entry.cooldownSec === 'number' && Number.isFinite(entry.cooldownSec) ? { cooldownSec: entry.cooldownSec } : {}),
        ...(typeof entry.cooldownGroup === 'string' ? { cooldownGroup: entry.cooldownGroup } : {}),
      }];
    });
  }

  private handleSupervisorEvent(event: AutoSupervisorEvent): void {
    const at = Date.now();
    if (event.type === 'phase_changed') {
      if (event.to === 'farming') this.lifecycle = 'farming';
      else if (event.to === 'recovering') this.lifecycle = 'recovering';
      else if (event.to === 'traveling') this.lifecycle = 'traveling';
      this.recordLog('supervisor_phase', { phase: event.to, reasonCode: event.reasonCode ?? undefined, at });
    } else if (event.type === 'halted') {
      this.lifecycle = 'halted';
      this.autoRequested = false;
      this.finishVitalsProbe('supervisor_halted');
      this.recordLog('auto_halted', { reasonCode: event.reasonCode, at });
      if (event.haltMode === 'disconnect') this.disconnectTransportOnly();
    } else if (event.type === 'death') {
      this.recordLog('auto_death', { at });
    } else if (event.type === 'revive_requested') {
      this.recordLog('auto_revive_requested', { reasonCode: event.mode, at });
    } else if (event.type === 'anchor_reached') {
      this.recordLog('auto_anchor_reached', { at });
    }
  }

  private startLoop(): void {
    if (this.loopTimer) return;
    this.lastFrameAt = Date.now();
    this.loopTimer = setInterval(() => this.runMeasuredFrame(), this.options.loopIntervalMs);
    (this.loopTimer as NodeJS.Timeout).unref?.();
  }

  private runMeasuredFrame(): void {
    this.frameMetrics.begin();
    try {
      this.frame();
    } finally {
      this.frameMetrics.end();
    }
  }

  private frame(): void {
    if (this.stopRequested || !this.P || !this.env) return;
    const now = Date.now();
    const rawDt = Math.max(0, (now - this.lastFrameAt) / 1000);
    const dt = Math.min(0.05, rawDt);
    this.lastFrameAt = now;
    if (rawDt * 1000 > this.options.watchdogMaxFrameDelayMs) this.handleWatchdog('frame_delay', rawDt * 1000);
    this.P.Game.time += dt;
    this.env.flushRaf();
    this.frames += 1;
    this.frameTimeMs += rawDt * 1000;
    try {
      if (this.P.Game.scene?.update) this.P.Game.scene.update(dt);
      this.walkNavigator.tick();
      this.dailyQuests.tick();
      this.supervisor?.tick();
      this.probeVitals(now);
      this.checkVitalsConfirmation(now);
    } catch {
      this.updateErrors += 1;
      this.recordLog('vendor_update_error');
    }
    const rssGrowth = process.memoryUsage().rss - this.baseRss;
    if (rssGrowth > this.options.watchdogMaxRssGrowthBytes) this.handleWatchdog('rss_growth', rssGrowth);
  }

  /** Auto đang bật mà quá VITALS_CONFIRM_MS vẫn chưa có you/hurt/revived thì dừng Auto (HP chưa được xác nhận). */
  private probeVitals(now: number): void {
    if (this.vitalsProbeExhausted) return;
    if (!this.autoRequested || this.lastVitalsAt !== null) {
      if (this.vitalsProbe && this.lastVitalsAt !== null) this.finishVitalsProbe('vitals_confirmed');
      return;
    }
    const player = this.getPlayer();
    if (!player || this.connectionState() !== 'IN_GAME' || this.isDown(player)) return;
    if (this.vitalsProbe && this.hurtCount > this.vitalsProbe.hurtCount) {
      this.finishVitalsProbe('hurt');
      return;
    }
    if (!this.isStationaryPlayer(player)) return;
    if (this.lastOutgoingMoveAt !== null && now - this.lastOutgoingMoveAt < this.options.vitalsProbeIntervalMs) return;

    if (!this.vitalsProbe) {
      this.vitalsProbe = { startedAt: now, movesSent: 0, hurtCount: this.hurtCount };
      this.recordLog('vitals_probe_started');
    }
    if (this.vitalsProbe.movesSent >= VITALS_PROBE_MAX_MOVES) {
      this.vitalsProbeExhausted = true;
      this.finishVitalsProbe('max_moves');
      return;
    }

    const gateway = this.P?.Gateway;
    if (typeof gateway?.reset !== 'function' || typeof gateway?.update !== 'function') {
      this.vitalsProbeExhausted = true;
      this.finishVitalsProbe('gateway_unavailable');
      return;
    }
    const beforeMoves = this.packets.moves;
    try {
      // gateway.js owns the move sequence. reset() only invalidates its last
      // sent state; update() then emits the current player state at the same
      // rounded position/direction, so this is an official idle move, not a
      // hand-built packet. The 0.1s argument advances Gateway's 10Hz send
      // budget without advancing the headless Game clock.
      gateway.reset();
      gateway.update(0.1, player);
    } catch {
      this.vitalsProbeExhausted = true;
      this.finishVitalsProbe('gateway_error');
      return;
    }
    if (this.packets.moves === beforeMoves) return;
    this.vitalsProbe.movesSent += 1;
    this.vitalsProbeMoves = this.vitalsProbe.movesSent;
    if (this.vitalsProbe.movesSent >= VITALS_PROBE_MAX_MOVES) {
      this.vitalsProbeExhausted = true;
      this.finishVitalsProbe('max_moves');
    }
  }

  private isStationaryPlayer(player: any): boolean {
    if (player?.state !== 'idle') return false;
    if (player?.moving === true || player?.isMoving === true) return false;
    if (Array.isArray(player?.path) && player.path.length > 0) return false;
    if (typeof this.P?.Input?.hasManualMove === 'function' && this.P.Input.hasManualMove()) return false;
    return true;
  }

  private finishVitalsProbe(reasonCode: string): void {
    if (!this.vitalsProbe) return;
    this.recordLog('vitals_probe_done', { reasonCode });
    this.vitalsProbe = null;
  }

  private checkVitalsConfirmation(now: number): void {
    if (!this.autoRequested || this.autoStartedAt === null || this.lastVitalsAt !== null) return;
    if (now - this.autoStartedAt <= this.options.vitalsConfirmMs) return;
    this.finishVitalsProbe('confirmation_timeout');
    this.autoStartedAt = null;
    this.recordLog('auto_stopped_vitals_unconfirmed');
    this.stopAuto();
  }

  private handleWatchdog(reasonCode: string, value: number): void {
    // Vượt ngưỡng kéo dài làm hàm này chạy mỗi khung hình; mỗi dòng nhật ký lại ghi DB và phát runtime, nên
    // ngập hàng trăm dòng mỗi giây và đẩy mất nhật ký cũ. Mỗi lý do chỉ ghi tối đa một dòng mỗi 30 s.
    const nowMs = Date.now();
    const previous = this.watchdogLoggedAt.get(reasonCode);
    if (previous === undefined || nowMs - previous >= WATCHDOG_LOG_INTERVAL_MS) {
      this.watchdogLoggedAt.set(reasonCode, nowMs);
      this.recordLog('watchdog_warning', {
        reasonCode,
        detail: reasonCode === 'rss_growth' ? `growthMB=${Math.round(value / 1048576)}` : `delayMs=${Math.round(value)}`,
      });
    }
    if (!this.options.watchdogRestart || this.watchdogRestarting || this.lifecycle === 'stopped' || this.lifecycle === 'error') return;
    this.watchdogRestarting = true;
    const anchor = this.supervisor?.getSnapshot().anchor;
    const resumeAuto = this.autoRequested && anchor !== null;
    void value;
    void (async () => {
      try {
        this.recordLog('watchdog_restart_started', { reasonCode });
        await this.stop();
        await this.start();
        if (resumeAuto && anchor) await this.startAuto(anchor);
        this.recordLog('watchdog_restart_completed');
      } catch (error) {
        this.lifecycle = 'error';
        this.recordLog('watchdog_restart_failed', { reasonCode: this.errorCode(error) });
      } finally {
        this.watchdogRestarting = false;
      }
    })();
  }

  private handleSocketClosed(): void {
    if (this.stopRequested || this.lifecycle === 'halted') return;
    for (const listener of this.disconnectListeners) {
      try { listener(); } catch { /* observer failures must not change reconnect behavior */ }
    }
    this.cancelDailyForReason('reconnecting');
    this.cancelMoveTo('reconnecting');
    this.failKhuWaiters(new KhuError('KHU_TIMEOUT'));
    this.finishVitalsProbe('connection_closed');
    this.lastVitalsAt = null;
    this.vitalsProbeExhausted = false;
    this.vitalsProbeMoves = 0;
    this.observedMapId = null;
    this.observedKhu = null;
    this.observedSoKhu = null;
    this.khuList = null;
    if (this.reconnectAttempts >= this.options.reconnectMaxRetries) {
      this.lifecycle = 'error';
      this.recordLog('reconnect_exhausted');
      return;
    }
    const delay = Math.min(this.options.reconnectBaseDelayMs * (2 ** this.reconnectAttempts), this.options.reconnectMaxDelayMs);
    this.reconnectAttempts += 1;
    this.lifecycle = 'connecting';
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectAndBuild(true).catch(() => {
        this.handleSocketClosed();
      });
    }, delay);
    this.reconnectTimer.unref?.();
    this.recordLog('reconnect_scheduled');
  }

  private failKhuWaiters(error: KhuError): void {
    this.failKhuChangeWaiter(error);
    this.failKhuListWaiter(error);
  }

  private failKhuChangeWaiter(error: KhuError): void {
    const waiter = this.khuChangeWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.khuChangeWaiter = null;
    this.recordLog(error.code === 'KHU_TIMEOUT' ? 'khu_timeout' : 'khu_rejected', { reasonCode: error.code });
    waiter.reject(error);
  }

  private failKhuListWaiter(error: KhuError): void {
    const waiter = this.khuListWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.khuListWaiter = null;
    this.khuListRequestPromise = null;
    waiter.reject(error);
  }

  private settleKhuChangeSuccess(): void {
    const waiter = this.khuChangeWaiter;
    if (!waiter || this.observedMapId !== waiter.mapId || this.observedKhu !== waiter.target) return;
    clearTimeout(waiter.timer);
    this.khuChangeWaiter = null;
    this.lastKhuChangeAt = Date.now();
    this.cancelMoveTo('khu_changed');
    this.recordLog('khu_changed');
    waiter.resolve({
      mapId: waiter.mapId,
      khu: waiter.target,
      soKhu: this.getSoKhu(),
      list: this.getKhuListForMap(waiter.mapId),
    });
  }

  private settleKhuToast(packet: Record<string, unknown>): void {
    if (!this.khuChangeWaiter) return;
    const message = toastText(packet);
    if (!message) return;
    const retryAfterSec = cooldownSecondsFromToast(message);
    if (retryAfterSec !== null) {
      this.failKhuChangeWaiter(new KhuError('KHU_COOLDOWN', message, retryAfterSec));
    } else if (message === 'Đang ở khu này rồi.') {
      this.failKhuChangeWaiter(new KhuError('KHU_ALREADY_HERE', message));
    } else if (message !== 'Đã sang khu ' + this.khuChangeWaiter.target + '.') {
      this.failKhuChangeWaiter(new KhuError('KHU_REJECTED', message));
    }
  }

  private sanitizeKhuList(packet: Record<string, unknown>): KhuList | null {
    const mapId = typeof packet.mapId === 'string' && packet.mapId.trim() ? packet.mapId : null;
    const khu = Number.isInteger(packet.khu) && Number(packet.khu) > 0 ? Number(packet.khu) : null;
    const toiDa = Number.isInteger(packet.toiDa) && Number(packet.toiDa) >= 0 ? Number(packet.toiDa) : null;
    const readArray = (value: unknown): number[] | null => {
      if (!Array.isArray(value) || value.length > 100) return null;
      return value.every((item) => typeof item === 'number' && Number.isFinite(item) && Number.isInteger(item) && item >= 0)
        ? [...value] as number[] : null;
    };
    const dem = readArray(packet.dem);
    const tran = readArray(packet.tran);
    if (!mapId || khu === null || toiDa === null || !dem || !tran) return null;
    return { mapId, khu, dem, toiDa, tran, observedAt: Date.now() };
  }

  private getKhuListForMap(mapId: string | null): KhuList | null {
    if (!mapId || !this.khuList || this.khuList.mapId !== mapId) return null;
    return { ...this.khuList, dem: [...this.khuList.dem], tran: [...this.khuList.tran] };
  }

  private recordKhuProbeEvent(op: string, packet: Record<string, unknown>): void {
    const noisy = new Set(['snap2', 'you', 'act', 'pf', 'pong', 'join', 'leave', 'hon', 'mach', 'khoiloi', 'world_chat', 'p']);
    if (noisy.has(op)) return;
    let data: unknown;
    const pick = (keys: string[]) => Object.fromEntries(keys.filter((key) => key in packet).map((key) => [key, packet[key]]));
    if (op === 'khu') data = pick(['mapId', 'khu', 'soKhu', 'dem', 'toiDa', 'tran']);
    else if (op === 'map') data = pick(['mapId', 'khu', 'soKhu', 'x', 'y', 'ep']);
    else if (op === 'ack') data = { keys: Object.keys(packet).slice(0, 14), ...pick(['rid', 'ok', 'why', 'toast', 'retryAfter', 'regrowAfter', 'du', 'stones', 'tong', 'duocCong']) };
    else data = { keys: Object.keys(packet).slice(0, 12), ...pick(['toast', 'text', 'kind', 'ok', 'err', 'error', 'msg', 'code', 'reason']) };
    this.khuProbeEvents.push({ at: Date.now(), op, data });
    if (this.khuProbeEvents.length > 80) this.khuProbeEvents.shift();
  }

  /** THỬ NGHIỆM: gửi gói khu chưa qua kiểm tra an toàn nào ngoài việc đang trong game. */
  public khuProbe(action: 'xem' | 'chon', khu?: number): { sent: boolean; at: number; x: number | null; y: number | null; mapId: string | null; khu: number | null } {
    const player = this.getPlayer();
    const gateway = this.P?.Gateway;
    if (this.connectionState() !== 'IN_GAME' || !player || typeof gateway?.send !== 'function') throw new Error('NOT_IN_GAME');
    if (action === 'chon' && (!Number.isInteger(khu) || Number(khu) < 1 || Number(khu) > 99)) throw new Error('TARGET_INVALID');
    this.khuProbeActive = true;
    const at = Date.now();
    const x = Number.isFinite(player.x) ? player.x : null;
    const y = Number.isFinite(player.y) ? player.y : null;
    this.khuProbeEvents.push({ at, op: '_sent', data: { act: action, khu: khu ?? null, x, y, mapId: this.getMapId(), curKhu: this.observedKhu } });
    const packet = action === 'xem' ? { op: 'khu', act: 'xem' } : { op: 'khu', act: 'chon', khu };
    const sent = gateway.send(packet) !== false;
    this.recordOutgoing(packet);
    return { sent, at, x, y, mapId: this.getMapId(), khu: this.observedKhu };
  }

  /**
   * THỬ NGHIỆM đo giao thức nhiệm vụ hàng ngày (docs/RESEARCH_DAILY_QUESTS.md). Chỉ gọi các hàm/đường lệnh của chính client:
   * status (chỉ đọc), diemdanh (Gateway.cmd), seed.start/seed.complete/seed.escortComplete/seed.cancel (Quest.* của client, bindIntents phát lệnh),
   * harvest (Gateway.cmd resource.harvest như client). Không có kiểm tra an toàn nào ngoài đang trong game.
   */
  public questProbe(act: string, params: { taskId?: string; propId?: string } = {}): { act: string; at: number; result: unknown } {
    const P = this.P;
    const player = this.getPlayer();
    if (this.connectionState() !== 'IN_GAME' || !player || !P?.Gateway) throw new Error('NOT_IN_GAME');
    this.khuProbeActive = true;
    const at = Date.now();
    const safeId = (value: unknown): string => {
      if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(value)) throw new Error('TARGET_INVALID');
      return value;
    };
    const read = (): Record<string, unknown> => {
      const Quest = P.Quest;
      const seed = Quest?.seedQuest;
      return {
        mapId: this.getMapId(),
        x: Number.isFinite(player.x) ? Math.round(player.x) : null,
        y: Number.isFinite(player.y) ? Math.round(player.y) : null,
        stage: typeof Quest?.stage === 'number' ? Quest.stage : null,
        today: typeof Quest?.today === 'function' ? Quest.today() : null,
        diemDanh: P.DiemDanh ? { daNhan: !!P.DiemDanh.daNhan(P), tong: P.DiemDanh.tong(P) } : null,
        seedQuest: seed ? { active: !!seed.active, task: seed.task ?? null, collected: seed.collected ? Object.keys(seed.collected).length : 0, daily: seed.daily ?? {} } : null,
        stones: typeof P.Progress?.stones === 'number' ? P.Progress.stones : null,
        duocCong: typeof P.Progress?.duocCong === 'number' ? P.Progress.duocCong : null,
        namLinhChi: typeof P.Inventory?.count === 'function' ? P.Inventory.count('nam_linh_chi') : null,
        canhKho: typeof P.Inventory?.count === 'function' ? P.Inventory.count('canh_kho') : null,
        ca: typeof P.Inventory?.count === 'function' ? P.Inventory.count('ca_song') + P.Inventory.count('linh_ngu') : null,
        fishing: !!P.SceneWorld?.fishing,
        chopping: !!P.SceneWorld?.chopping,
        drops: Array.isArray(P.SceneWorld?.drops)
          ? P.SceneWorld.drops.slice(0, 12).map((drop: Record<string, unknown>) => ({
            kind: drop.kind ?? null, task: drop.task ?? null, materialId: drop.materialId ?? null, itemId: drop.itemId ?? null,
            state: drop.state ?? null, x: Number.isFinite(drop.x) ? Math.round(Number(drop.x)) : null, y: Number.isFinite(drop.y) ? Math.round(Number(drop.y)) : null,
          })) : null,
      };
    };
    this.khuProbeEvents.push({ at, op: '_sent', data: { quest: act, ...params, before: read() } });
    const cb = (name: string) => (response: Record<string, unknown> | undefined) => {
      this.khuProbeEvents.push({ at: Date.now(), op: '_cb', data: { cmd: name, ok: response?.ok ?? null, why: response?.why ?? null, toast: response?.toast ?? null, keys: response ? Object.keys(response).slice(0, 14) : [] } });
    };
    let result: unknown = null;
    switch (act) {
      case 'status': result = read(); break;
      case 'diemdanh': P.Gateway.cmd('diemdanh', {}, cb('diemdanh')); result = { sent: true }; break;
      case 'seed.start': {
        const taskId = safeId(params.taskId);
        const outBefore = this.packets.commands['seed.start'] ?? 0;
        const started = P.Quest?.startSeedQuest?.(taskId);
        result = { local: started ? 'started' : 'refused', cmdSent: (this.packets.commands['seed.start'] ?? 0) > outBefore };
        break;
      }
      case 'seed.complete': {
        const outBefore = this.packets.commands['seed.complete'] ?? 0;
        const done = P.Quest?.completeSeedQuest?.();
        result = { local: done ? 'completed' : 'refused', cmdSent: (this.packets.commands['seed.complete'] ?? 0) > outBefore };
        break;
      }
      case 'seed.escortComplete': {
        const outBefore = this.packets.commands['seed.escortComplete'] ?? 0;
        const done = P.Quest?.completeEscortSeedQuest?.();
        result = { local: done ? 'completed' : 'refused', cmdSent: (this.packets.commands['seed.escortComplete'] ?? 0) > outBefore };
        break;
      }
      case 'seed.cancel': {
        const outBefore = this.packets.commands['seed.cancel'] ?? 0;
        const cancelled = P.Quest?.cancelSeedQuest?.();
        result = { local: cancelled ? 'cancelled' : 'refused', cmdSent: (this.packets.commands['seed.cancel'] ?? 0) > outBefore };
        break;
      }
      case 'harvest': P.Gateway.cmd('resource.harvest', { propId: safeId(params.propId) }, cb('resource.harvest')); result = { sent: true }; break;
      case 'props': {
        const map = P.SceneWorld?.map;
        const all = [...(map?.props ?? []), ...(map?.flatProps ?? []), ...(map?.interactables ?? [])];
        result = all.filter((prop: Record<string, unknown>) => prop.chopTask || prop.seedTask || prop.type === 'khu_board' || prop.type === 'npc' || prop.type === 'ling_chi_prop' || prop.id === 'ho_bich_thuy_cong' || prop.id === 'suoi_duoc_coc')
          .slice(0, 120).map((prop: Record<string, unknown>) => ({
            id: prop.id, type: prop.type, title: prop.title ?? null, task: prop.chopTask ?? prop.seedTask ?? null, hidden: !!prop.hidden,
            x: Number.isFinite(prop.x) ? Math.round(Number(prop.x)) : null, y: Number.isFinite(prop.y) ? Math.round(Number(prop.y)) : null, r: prop.r ?? null,
          }));
        break;
      }
      case 'chop': {
        // Giống ea() của client: đặt trạng thái đang chặt; vòng cập nhật của client lo nhịp chặt, rơi cành và kiểm tra khoảng cách.
        const id = safeId(params.propId);
        const map = P.SceneWorld?.map;
        const prop = [...(map?.props ?? []), ...(map?.flatProps ?? [])].find((candidate: Record<string, unknown>) => candidate.id === id);
        if (!prop) { result = { started: false, why: 'prop_not_found' }; break; }
        if (!P.SceneWorld.chopping || P.SceneWorld.chopping.prop !== prop) P.SceneWorld.chopping = { prop, swing: 0, t: 10 };
        result = { started: true };
        break;
      }
      case 'fish': {
        const id = safeId(params.propId);
        const started = this.startDailyFishing(id);
        result = started.started ? { started: true, duration: started.durationMs === undefined ? null : Math.round(started.durationMs / 100) / 10, waterNear: started.waterNear === true } : { started: false, why: P.SceneWorld?.fishing ? 'already_fishing' : 'prop_not_found' };
        break;
      }
      case 'seed.collect': {
        const outBefore = this.packets.commands['seed.collect'] ?? 0;
        const ok = P.Quest?.collectSeedMaterial?.(safeId(params.taskId), safeId(params.propId));
        result = { local: ok ? 'collected' : 'refused', cmdSent: (this.packets.commands['seed.collect'] ?? 0) > outBefore };
        break;
      }
      default: throw new Error('TARGET_INVALID');
    }
    return { act, at, result };
  }

  public getDailyStatus(force = true): DailyStatus {
    this.assertDailyRuntimeReady();
    if (force || !this.dailyStatusCache || Date.now() - this.dailyStatusCache.at >= 1_000) {
      this.dailyStatusCache = { status: this.dailyQuests.getStatus(), at: Date.now() };
    }
    return this.dailyStatusCache.status;
  }

  public getDailySnapshot(force = true): { status: DailyStatus; current: DailyOperation | null } {
    return { status: this.getDailyStatus(force), current: this.dailyQuests.getOperation() };
  }

  public startDailyCheckin(): DailyOperation {
    this.assertDailyRuntimeReady();
    const operation = this.dailyQuests.startCheckin();
    this.dailyStatusCache = null;
    return operation;
  }

  public startDailySeed(taskId: string, runs = 1, options: { abortOnHurt?: boolean; maxHurt?: number } = {}): DailyOperation {
    this.assertDailyRuntimeReady();
    const operation = this.dailyQuests.startSeedTask(taskId, runs, options);
    this.dailyStatusCache = null;
    return operation;
  }

  public cancelDaily(operationId: string, reason = 'user_cancelled'): DailyOperation {
    if (!this.dailyQuests.cancel(operationId, reason)) throw new DailyError('OPERATION_NOT_FOUND');
    const operation = this.dailyQuests.getOperation();
    if (!operation) throw new DailyError('OPERATION_NOT_FOUND');
    this.dailyStatusCache = null;
    return operation;
  }

  private cancelDailyForReason(reason: string): void {
    const operation = this.dailyQuests.getOperation();
    if (!operation || !['accepted', 'running'].includes(operation.status)) return;
    this.dailyQuests.cancel(operation.operationId, reason);
    this.dailyStatusCache = null;
  }

  public getKhuProbe(): { events: Array<{ at: number; op: string; data?: unknown }>; mapId: string | null; khu: number | null; soKhu: number | null } {
    return { events: this.khuProbeEvents.map((event) => ({ ...event })), mapId: this.getMapId(), khu: this.observedKhu, soKhu: this.observedSoKhu };
  }

  private recordIncoming(packet: Record<string, unknown>): void {
    const op = typeof packet.op === 'string' ? packet.op : 'unknown';
    this.packets.incoming[op] = (this.packets.incoming[op] ?? 0) + 1;
    if (op === 'ack') this.settleDailyAck(packet);
    if (op === 'state' && typeof packet.reason === 'string' && /^(diemdanh|seed\.(start|collect|complete|escortComplete)|resource\.harvest|fishing\.catch)(?::refused)?$/.test(packet.reason)) {
      this.recordLog('daily_state_observed', { reasonCode: packet.reason });
    }
    if (this.khuProbeActive) this.recordKhuProbeEvent(op, packet);
    if (op === 'map') {
      const previousMapId = this.observedMapId;
      const previousKhu = this.observedKhu;
      const nextMapId = typeof packet.mapId === 'string' && packet.mapId.trim() ? packet.mapId : null;
      const nextKhu = Number.isInteger(packet.khu) && Number(packet.khu) > 0 ? Number(packet.khu) : null;
      this.observedMapId = nextMapId;
      this.observedKhu = nextKhu;
      this.observedSoKhu = Number.isInteger(packet.soKhu) && Number(packet.soKhu) > 0 ? Number(packet.soKhu) : null;
      if (previousMapId !== nextMapId || (previousKhu !== null && nextKhu !== null && previousKhu !== nextKhu)) {
        this.khuList = null;
      }
      if (previousMapId === nextMapId && previousKhu !== null && nextKhu !== null && previousKhu !== nextKhu) {
        this.lastKhuChangeAt = Date.now();
        this.cancelMoveTo('khu_changed');
      }
      this.settleKhuChangeSuccess();
    } else if (op === 'khu') {
      const list = this.sanitizeKhuList(packet);
      if (list && list.mapId === this.observedMapId) {
        this.observedKhu = list.khu;
        this.khuList = list;
        if (this.khuListWaiter?.mapId === list.mapId) {
          const waiter = this.khuListWaiter;
          clearTimeout(waiter.timer);
          this.khuListWaiter = null;
          this.khuListRequestPromise = null;
          waiter.resolve(this.getKhuListForMap(list.mapId)!);
        }
      }
    } else if (op === 'toast') {
      this.settleKhuToast(packet);
    }
    if (op === 'hurt') { this.hurtCount += 1; this.lastHurtAt = Date.now(); this.lastVitalsAt = this.lastHurtAt; }
    if (op === 'you' || op === 'revived') this.lastVitalsAt = Date.now();
    if ((op === 'hurt' || op === 'you' || op === 'revived') && this.vitalsProbe) {
      this.finishVitalsProbe(op === 'hurt' ? 'hurt' : 'vitals_confirmed');
    }
    if (op === 'kill' && packet.by !== undefined && packet.by !== null && this.P?.Gateway?.selfId
      && String(packet.by) === String(this.P.Gateway.selfId)) this.killsBySelf += 1;
  }

  private recordOutgoing(packet: Record<string, unknown>): void {
    const op = typeof packet.op === 'string' ? packet.op : 'unknown';
    this.packets.outgoing[op] = (this.packets.outgoing[op] ?? 0) + 1;
    if (op === 'move') {
      this.packets.moves += 1;
      this.lastOutgoingMoveAt = Date.now();
    }
    if (op === 'attack') this.packets.attacks += 1;
    if (op === 'skill') this.packets.skills += 1;
    if (op === 'cmd') {
      this.packets.cmds += 1;
      const command = typeof packet.cmd === 'string' ? packet.cmd : 'unknown';
      this.packets.commands[command] = (this.packets.commands[command] ?? 0) + 1;
    }
  }

  private connectionState(): VendorRunnerSnapshot['connection'] {
    if (this.P?.Gateway?.ready && this.P?.Gateway?.connected) return 'IN_GAME';
    if (this.lifecycle === 'connecting') return this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING';
    return 'DISCONNECTED';
  }

  private getPlayer(): any | null { return this.P?.SceneWorld?.player ?? null; }
  private getMapId(): string | null {
    const transitioning = !!this.P?.SceneWorld?.transitioning;
    if (this.observedMapId !== null) {
      if (transitioning) return null;
      const sceneMapId = this.P?.SceneWorld?.map?.data?.id;
      if (typeof sceneMapId === 'string' && sceneMapId.trim() && sceneMapId !== this.observedMapId) return null;
      return this.observedMapId;
    }
    if (transitioning) return null;
    const value = this.P?.SceneWorld?.map?.data?.id ?? this.P?.Gateway?.mapId;
    return typeof value === 'string' && value.trim() ? value : null;
  }
  private isMapReady(): boolean {
    return this.observedMapId !== null && !this.P?.SceneWorld?.transitioning && this.getMapId() === this.observedMapId;
  }
  /**
   * The map packet is the authoritative source: gateway.js forwards its
   * `t.khu` to KhuUI.setMap(), while KhuUI.khu defaults to 1 when the field is
   * absent. Keep null when the packet did not carry khu instead of mistaking
   * that UI default for an observed khu.
   */
  private getKhu(): number | null { return this.observedKhu; }
  private getSoKhu(): number | null { return this.observedSoKhu; }

  private getWorldEntities(
    mapId: string | null,
    khu: number | null,
    observedAt: number,
    player: any | null,
  ): {
    monsters: VendorMonsterSnapshot[];
    players: VendorPlayerSnapshot[];
    monstersContext: VendorEntityContext;
    playersContext: VendorEntityContext;
  } {
    const world = this.P?.SceneWorld;
    const remotes = this.P?.Gateway?.remotes;
    const positionFresh = this.connectionState() === 'IN_GAME' && !!world && !!player && mapId !== null;
    const monstersFresh = positionFresh && Array.isArray(world?.enemies);
    const playersFresh = positionFresh && !!remotes && typeof remotes === 'object';
    const monsters: VendorMonsterSnapshot[] = [];
    if (monstersFresh) {
      for (const enemy of world.enemies) {
        if (monsters.length >= VENDOR_MONSTER_LIMIT || !enemy || enemy.dead === true) continue;
        const id = typeof enemy.id === 'string' && enemy.id.trim() ? enemy.id : null;
        const x = safeNumber(enemy.x);
        const y = safeNumber(enemy.y);
        if (!id || x === null || y === null) continue;
        const name = typeof enemy.def?.name === 'string' && enemy.def.name.trim()
          ? enemy.def.name : typeof enemy.type === 'string' && enemy.type.trim() ? enemy.type : undefined;
        const hp = safeNumber(enemy.hp);
        const maxHp = safeNumber(enemy.hpMax);
        monsters.push({
          id,
          ...(name ? { name } : {}),
          x,
          y,
          ...(hp !== null ? { hp } : {}),
          ...(maxHp !== null ? { maxHp } : {}),
        });
      }
    }
    const players: VendorPlayerSnapshot[] = [];
    if (playersFresh) {
      const selfId = this.P?.Gateway?.selfId;
      for (const [key, remote] of Object.entries(remotes as Record<string, any>)) {
        if (players.length >= VENDOR_PLAYER_LIMIT || !remote || remote.seen === false) continue;
        const id = typeof remote.id === 'string' && remote.id.trim() ? remote.id : key;
        if (!id || (selfId !== null && selfId !== undefined && String(selfId) === id)) continue;
        const x = safeNumber(remote.x);
        const y = safeNumber(remote.y);
        if (x === null || y === null) continue;
        const name = typeof remote.name === 'string' && remote.name.trim() ? remote.name : undefined;
        const realm = typeof remote.realm === 'string' && remote.realm.trim() ? remote.realm : undefined;
        // RemotePlayer normalizes the wire percentage to 0..1; AccountRuntime
        // keeps the dashboard-facing remote hp as a percentage, never as own vitals.
        const hp = safeNumber(remote.hp);
        const hpPercent = hp === null ? null : Math.max(0, Math.min(100, hp * 100));
        players.push({ id, ...(name ? { name } : {}), x, y, ...(realm ? { realm } : {}), ...(hpPercent !== null ? { hp: hpPercent } : {}) });
      }
    }
    const context: VendorEntityContext = {
      mapId,
      khu,
      observedAt: monstersFresh ? observedAt : null,
      fresh: monstersFresh,
    };
    const playersContext: VendorEntityContext = {
      mapId,
      khu,
      observedAt: playersFresh ? observedAt : null,
      fresh: playersFresh,
    };
    return {
      monsters,
      players,
      monstersContext: { ...context },
      playersContext,
    };
  }
  private isDown(player: any): boolean { return player?.downed === true || player?.state === 'down'; }
  /** Mô hình HP/MP của client có số hữu hạn (chưa chắc đã được server xác nhận). */
  private hasPlayerVitalsModel(player: any): boolean {
    return safeNumber(player?.hp) !== null && safeNumber(player?.hpMax) !== null && Number(player.hpMax) > 0
      && safeNumber(player?.mp) !== null && safeNumber(player?.mpMax) !== null && Number(player.mpMax) >= 0;
  }

  private hasKnownVitals(player: any): boolean {
    return this.lastVitalsAt !== null
      && safeNumber(player?.hp) !== null && safeNumber(player?.hpMax) !== null && Number(player.hpMax) > 0
      && safeNumber(player?.mp) !== null && safeNumber(player?.mpMax) !== null && Number(player.mpMax) >= 0;
  }
  private getVitals(player: any): VendorRunnerSnapshot['vitals'] {
    const hp = safeNumber(player?.hp);
    const maxHp = safeNumber(player?.hpMax);
    const mp = safeNumber(player?.mp);
    const maxMp = safeNumber(player?.mpMax);
    const fresh = this.lastVitalsAt !== null && hp !== null && maxHp !== null && mp !== null && maxMp !== null;
    return { hp, maxHp, mp, maxMp, status: fresh ? 'client' : 'unknown', source: fresh ? 'client' : null, fresh, observedAt: fresh ? this.lastVitalsAt : null };
  }

  private cleanupTransport(): void {
    this.failKhuWaiters(new KhuError('KHU_TIMEOUT'));
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
    this.frameMetrics.reset();
    this.clearReconnectTimer();
    this.disconnectTransportOnly();
    this.env?.dispose();
    this.env = null;
    this.P = null;
    this.currentSocket = null;
    this.observedMapId = null;
    this.observedKhu = null;
    this.observedSoKhu = null;
    this.khuList = null;
  }

  private async closeTransport(): Promise<void> {
    if (!this.input.transport || this.transportClosed) return;
    this.transportClosed = true;
    try { await this.input.transport.close(); } catch { /* transport shutdown is best effort */ }
  }

  private disconnectTransportOnly(): void {
    this.failKhuWaiters(new KhuError('KHU_TIMEOUT'));
    this.observedMapId = null;
    this.observedKhu = null;
    this.observedSoKhu = null;
    this.khuList = null;
    try { this.currentSocket?.close(); } catch { /* already closed */ }
    try { this.P?.Gateway?.socket?.close?.(); } catch { /* already closed */ }
    if (this.P?.Gateway) {
      this.P.Gateway.connected = false;
      this.P.Gateway.ready = false;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private emptySupervisorSnapshot(): AutoSupervisorSnapshot {
    return { phase: 'idle', anchor: null, reasonCode: null, phaseSince: 0, deathTimes: [], stats: { deaths: 0, revives: 0, trips: 0, resumed: 0 }, noPath: 0, autoRequested: false };
  }

  private recordLog(code: string, extra: { phase?: string; reasonCode?: string; detail?: string; at?: number } = {}): void {
    const detail = typeof extra.detail === 'string' ? extra.detail.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    const entry = { code, ...(extra.phase ? { phase: extra.phase } : {}), ...(extra.reasonCode ? { reasonCode: extra.reasonCode } : {}), ...(detail ? { detail } : {}), at: extra.at ?? Date.now() };
    this.logs.push(entry);
    if (this.logs.length > 50) this.logs.splice(0, this.logs.length - 50);
    this.input.onLog?.(entry);
  }

  private errorCode(error: unknown): string {
    if (error instanceof Error) {
      const candidate = error.message.split(':', 1)[0].trim();
      return /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : 'UNKNOWN';
    }
    return 'UNKNOWN';
  }
}

export { assertAllowedGameUrl };
