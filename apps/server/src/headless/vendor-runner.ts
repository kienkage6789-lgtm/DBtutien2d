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
import { reachableMaps, type ReachableMap } from './map-route.js';

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
  logs: Array<{ code: string; phase?: string; reasonCode?: string; at: number }>;
}

export interface VendorRunnerLogger {
  (event: { code: string; phase?: string; reasonCode?: string; at: number }): void;
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
  private supervisorUnsubscribe: (() => void) | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
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
  /** Thời điểm bật Auto; dùng để dừng Auto nếu quá lâu chưa có gói vitals chính thức. */
  private autoStartedAt: number | null = null;
  private killsBySelf = 0;
  private reconnectAttempts = 0;
  private stopRequested = false;
  private watchdogRestarting = false;
  private autoRequested = false;
  private currentSocket: CountingWebSocket | null = null;
  private readonly packets = emptyPacketCounts();
  private readonly logs: Array<{ code: string; phase?: string; reasonCode?: string; at: number }> = [];
  private readonly options: Required<Pick<VendorRunnerOptions, 'reconnectMaxRetries' | 'reconnectBaseDelayMs' | 'reconnectMaxDelayMs' | 'loginTimeoutMs' | 'loopIntervalMs' | 'watchdogMaxFrameDelayMs' | 'watchdogMaxRssGrowthBytes' | 'watchdogRestart' | 'vitalsConfirmMs' | 'vitalsProbeIntervalMs'>>;

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
      watchdogMaxFrameDelayMs: input.watchdogMaxFrameDelayMs ?? 250,
      watchdogMaxRssGrowthBytes: input.watchdogMaxRssGrowthBytes ?? 256 * 1024 * 1024,
      watchdogRestart: input.watchdogRestart ?? false,
    };
    this.walkNavigator = new WalkNavigator(this.createWalkClient());
  }

  public getLifecycle(): VendorRunnerLifecycle { return this.lifecycle; }

  public async start(): Promise<void> {
    if (this.lifecycle !== 'stopped' && this.lifecycle !== 'error') return;
    this.stopRequested = false;
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
      this.startLoop();
      await this.connectAndBuild(false);
    } catch (error) {
      this.lifecycle = 'error';
      this.recordLog('runner_start_failed', { reasonCode: this.errorCode(error) });
      this.cleanupTransport();
      this.tokenManager?.stop();
      this.tokenManager = null;
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.cancelMoveTo('runner_stopped');
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
    this.lifecycle = 'stopped';
  }

  public async startAuto(anchor?: AutoAnchor): Promise<AutoSupervisorSnapshot> {
    if (this.lifecycle === 'stopped' || this.lifecycle === 'error' || !this.P || !this.env) throw new Error('VENDOR_NOT_RUNNING');
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
      monsters: world.monsters,
      players: world.players,
      monstersContext: world.monstersContext,
      playersContext: world.playersContext,
      vitals,
      moveTo: this.walkNavigator.getOperation(),
      logs: this.logs.map((entry) => ({ ...entry })),
    };
  }

  public moveTo(request: WalkRequest): WalkOperation {
    return this.walkNavigator.walkTo(request);
  }

  public cancelMoveTo(reason = 'user_cancelled', operationId?: string): boolean {
    const current = this.walkNavigator.getOperation();
    if (!current || (current.status !== 'accepted' && current.status !== 'running')) return false;
    if (operationId !== undefined && current.operationId !== operationId) return false;
    return this.walkNavigator.cancel(current.operationId, reason);
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
    const auth = new SupabaseAuth({
      url: this.input.supabaseUrl,
      anonKey: this.input.supabaseAnonKey,
      gameApiBase: this.input.gameServerUrl.replace(/^ws/i, 'http'),
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
    const implementation = this.input.WebSocketImpl
      ?? ((await import('ws')).default as unknown as VendorWebSocketConstructor);
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
      recordLog: (event) => this.recordLog(event.code, { reasonCode: event.reasonCode, at: event.at }),
    };
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
    this.loopTimer = setInterval(() => this.frame(), this.options.loopIntervalMs);
    (this.loopTimer as NodeJS.Timeout).unref?.();
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
    this.recordLog('watchdog_warning', { reasonCode });
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
    this.cancelMoveTo('reconnecting');
    this.finishVitalsProbe('connection_closed');
    this.lastVitalsAt = null;
    this.vitalsProbeExhausted = false;
    this.vitalsProbeMoves = 0;
    this.observedMapId = null;
    this.observedKhu = null;
    this.observedSoKhu = null;
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

  private recordIncoming(packet: Record<string, unknown>): void {
    const op = typeof packet.op === 'string' ? packet.op : 'unknown';
    this.packets.incoming[op] = (this.packets.incoming[op] ?? 0) + 1;
    if (op === 'map') {
      this.observedMapId = typeof packet.mapId === 'string' && packet.mapId.trim() ? packet.mapId : null;
      this.observedKhu = Number.isInteger(packet.khu) && Number(packet.khu) > 0 ? Number(packet.khu) : null;
      this.observedSoKhu = typeof packet.soKhu === 'number' && Number.isFinite(packet.soKhu) && packet.soKhu > 0
        ? packet.soKhu : null;
    } else if (op === 'khu' && Number.isInteger(packet.khu) && Number(packet.khu) > 0) {
      this.observedKhu = Number(packet.khu);
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
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
    this.clearReconnectTimer();
    this.disconnectTransportOnly();
    this.env?.dispose();
    this.env = null;
    this.P = null;
    this.currentSocket = null;
    this.observedMapId = null;
    this.observedKhu = null;
    this.observedSoKhu = null;
  }

  private disconnectTransportOnly(): void {
    this.observedMapId = null;
    this.observedKhu = null;
    this.observedSoKhu = null;
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

  private recordLog(code: string, extra: { phase?: string; reasonCode?: string; at?: number } = {}): void {
    const entry = { code, ...(extra.phase ? { phase: extra.phase } : {}), ...(extra.reasonCode ? { reasonCode: extra.reasonCode } : {}), at: extra.at ?? Date.now() };
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
