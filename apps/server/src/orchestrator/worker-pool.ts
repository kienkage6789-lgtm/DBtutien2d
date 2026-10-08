import { AuthError, SupabaseAuth, TuTienClient, VITALS_ATTACK_MAX_AGE_MS } from '@tutien2d/core-client';
import type { MapPacket } from '@tutien2d/core-client';
import type { Snap2RuntimeStats } from '@tutien2d/core-client';
import type { DerivedMaxSnapshot, StonesSnapshot, VitalSnapshot } from '@tutien2d/core-client';
import { BotController, BotLogMessage } from '@tutien2d/automation-engine';
import { db } from '../db/database.js';
import { wsHub } from '../ws/hub.js';
import { CONFIG } from '../config.js';
import { PUBLIC_CLIENT_MAP_CATALOG } from '../config/map-catalog.js';
import type { TrainingMachineState } from '@tutien2d/automation-engine';
import {
  confirmObservedMap,
  createNavigationState,
  expireMapConfirmation,
  markWaitingForMapConfirmation,
  planNavigation,
  type PortalNavigationState,
} from './portal-navigation.js';
import type { PortalEdge } from '../config/portal-catalog.js';
import { randomUUID } from 'node:crypto';
import { findNearestWalkableTarget, findWalkPath, isWalkSegmentClear } from './walk-path.js';
import { getWalkGrid, isWalkableTile, WALK_TILE_SIZE } from '../config/walk-grid.js';
import { StationaryProbe, type StationaryProbeSnapshot } from '../debug/stationary-probe.js';
import { ApproachProbe } from '../debug/approach-probe.js';
import type { ApproachSnapshot } from './approach-runner.js';
import { refreshVitals as runVitalsRefresh, type VitalsRefreshResult } from './vitals-refresh.js';

export interface TrainingRuntimeInfo {
  enabled: boolean;
  phase: TrainingMachineState['phase'];
  sessionId: string | null;
  reason: string | null;
  pending: { type: NonNullable<TrainingMachineState['pending']>['type']; operationId: string } | null;
  target: { mapId: string; khu: number; x: number | null; y: number | null; radius: number; attackIntervalMs: number; monsterType: string | null };
  protocol: { khuSelectionSupported: false; respawnSupported: false };
}

export interface NavigationRuntimeInfo {
  operationId: string | null;
  phase: PortalNavigationState['phase'] | 'idle';
  currentMapId: string | null;
  targetMapId: string | null;
  route: Array<Pick<PortalEdge, 'portalId' | 'fromMapId' | 'toMapId' | 'tx' | 'ty' | 'label'>>;
  routeIndex: number;
  attempt: number;
  maxAttempts: number;
  commandAt: number | null;
  deadlineAt: number | null;
  updatedAt: number | null;
  reason: string | null;
}

export function readStatePacketRealm(packet: Record<string, unknown>): string | null {
  if (typeof packet.realm === 'string' && packet.realm.trim()) return packet.realm;
  const save = packet.save;
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  const saveRealm = (save as Record<string, unknown>).realm;
  return typeof saveRealm === 'string' && saveRealm.trim() ? saveRealm : null;
}

export interface MoveToRuntimeInfo {
  requestId: string;
  operationId: string;
  status: 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';
  mapId: string;
  khu: number;
  x: number;
  y: number;
  updatedAt: number;
  reason: string | null;
}

export interface AccountRuntimeInfo {
  id: string;
  accountName: string;
  status: 'running' | 'stopped' | 'error';
  /** Raw connection state: DISCONNECTED | CONNECTING | HANDSHAKING | IN_GAME | RECONNECTING */
  connection: string;
  /** Last authentication error (wrong password, ...), null when fine. */
  authError: string | null;
  hasPassword: boolean;
  /** epoch ms when the current access token expires (null when unknown) */
  tokenExpiresAt: number | null;
  characterName: string;
  realm: string;
  /** Null until the canonical vitals snapshot is fresh and valid. */
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  /** Canonical vitals plus freshness/validity metadata. */
  vitals: VitalSnapshot;
  /** Age computed at the backend frame timestamp; null unless canonical vitals are fresh. */
  vitalsAgeMs: number | null;
  derivedMax: DerivedMaxSnapshot;
  downed: boolean | null;
  /** Weak presence signal from the self row; never treated as absolute HP. */
  selfPresence: { hpPercent: number | null; observedAt: number } | null;
  stones: number | null;
  stonesSnapshot: StonesSnapshot;
  mapId: string;
  khu: number;
  x: number;
  y: number;
  bagCount: number;
  latencyMs: number;
  activity: string;
  navigation: NavigationRuntimeInfo;
  moveTo: MoveToRuntimeInfo | null;
  training: TrainingRuntimeInfo;
  bag: Record<string, number>;
  farmMapId: string;
  farmKhu: number;
  farmX: number;
  farmY: number;
  soKhu: number | null;
  mapContext: {
    mapId: string | null;
    khu: number | null;
    soKhu: number | null;
    observedAt: number | null;
    fresh: boolean;
  };
  mapContextAgeMs: number | null;
  mapContextIsCurrent: boolean;
  lastAcceptedWorldAt: number | null;
  playersContext: { mapId: string | null; khu: number | null; observedAt: number | null; fresh: boolean };
  monstersContext: { mapId: string | null; khu: number | null; observedAt: number | null; fresh: boolean };
  /** Non-sensitive snap2 pipeline telemetry for diagnosing missing world snapshots. */
  worldSync: Snap2RuntimeStats;
  /** Indicates whether authoritative packets have populated each part of the snapshot. */
  dataStatus: {
    realm: boolean;
    hp: boolean;
    maxHp: boolean;
    mp: boolean;
    maxMp: boolean;
    stones: boolean;
    location: boolean;
    monsters: boolean;
    players: boolean;
  };
  monsters: Array<{ id: string; name?: string; x: number; y: number; hp?: number; maxHp?: number }>;
  players: Array<{ id: string; name?: string; x: number; y: number; realm?: string; hp?: number }>;
}

interface ActiveBot {
  client: TuTienClient;
  controller: BotController;
  tokenExpiresAt: number | null;
  dataStatus: AccountRuntimeInfo['dataStatus'];
  location: Partial<{ mapId: string; khu: number; x: number; y: number }>;
  monsters: AccountRuntimeInfo['monsters'];
  players: AccountRuntimeInfo['players'];
  vitals: VitalSnapshot;
  stonesSnapshot: StonesSnapshot;
  selfPresence: AccountRuntimeInfo['selfPresence'];
  mapContext: AccountRuntimeInfo['mapContext'];
  /** Core-client context epoch captured with the last authoritative map/khu packet. */
  mapContextEpoch: number | null;
  /** Server supplied map epoch; coordinate packets must echo this value to renew freshness. */
  mapEpoch: number | null;
  playersContext: AccountRuntimeInfo['playersContext'];
  monstersContext: AccountRuntimeInfo['monstersContext'];
  /** Last dashboard world broadcast; snap2 may arrive more frequently than WS clients need. */
  lastWorldSnapshotBroadcastAt: number;
  /** Receipt time of the most recent snap2 snapshot accepted by the worker context guard. */
  lastAcceptedWorldAt: number | null;
  lastAcceptedWorldObservedAt: number | null;
  lastMapEntryRequestAt: number;
  navigation: NavigationRuntimeInfo;
  navigationPromise?: Promise<boolean>;
  navigationTarget?: string;
  moveTo?: MoveToRuntimeInfo | null;
  moveToPromise?: Promise<void>;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAP_CONTEXT_TTL_MS = 15_000;

export function isMapContextFresh(context: AccountRuntimeInfo['mapContext'], now: number): boolean {
  return context.fresh && context.observedAt !== null && now - context.observedAt <= MAP_CONTEXT_TTL_MS;
}

export function mapContextRuntime(context: AccountRuntimeInfo['mapContext'], input: {
  now: number;
  contextEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
}): {
  context: AccountRuntimeInfo['mapContext'];
  ageMs: number | null;
  isCurrent: boolean;
} {
  const ageMs = context.observedAt === null ? null : Math.max(0, input.now - context.observedAt);
  const fresh = isMapContextFresh(context, input.now);
  return {
    context: { ...context, fresh },
    ageMs,
    isCurrent: isMapContextCurrent({ ...input, context, now: input.now }),
  };
}

export function refreshMapContextAge(context: AccountRuntimeInfo['mapContext'], acceptedAt: number): void {
  context.observedAt = acceptedAt;
  context.fresh = context.mapId !== null && context.khu !== null;
}

export function worldSnapshotRejectReason(input: {
  snapshot: { mapId: string; khu: number; contextEpoch: number; observedAt: number };
  context: AccountRuntimeInfo['mapContext'];
  contextEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
  lastAcceptedWorldObservedAt: number | null;
  now: number;
}): string | null {
  if (!input.context.fresh || input.context.mapId === null || input.context.khu === null) return 'map_context_unknown';
  if (input.contextEpoch === null || input.snapshot.contextEpoch !== input.contextEpoch
    || input.snapshot.contextEpoch !== input.clientEpoch) return 'context_epoch_mismatch';
  if (!input.clientContext.mapKnown || !input.clientContext.khuKnown) return 'client_context_unknown';
  if (input.snapshot.mapId !== input.context.mapId || input.snapshot.khu !== input.context.khu
    || input.snapshot.mapId !== input.clientContext.mapId || input.snapshot.khu !== input.clientContext.khu) {
    return 'map_or_khu_mismatch';
  }
  if (!Number.isFinite(input.snapshot.observedAt)) return 'invalid_observed_at';
  if (input.snapshot.observedAt > input.now + 1_000) return 'observed_at_in_future';
  if (input.lastAcceptedWorldObservedAt !== null && input.snapshot.observedAt < input.lastAcceptedWorldObservedAt) {
    return 'out_of_order_snapshot';
  }
  return null;
}

export function isMapContextCurrent(input: {
  context: AccountRuntimeInfo['mapContext'];
  now: number;
  contextEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
}): boolean {
  return isMapContextFresh(input.context, input.now)
    && input.contextEpoch !== null && input.contextEpoch === input.clientEpoch
    && input.clientContext.mapKnown && input.clientContext.khuKnown
    && input.clientContext.mapId === input.context.mapId
    && input.clientContext.khu === input.context.khu;
}

export function expectedNavigationMapId(navigation: NavigationRuntimeInfo): string | null {
  if (!['planning', 'moving_to_portal', 'waiting_map_confirmation'].includes(navigation.phase)) return null;
  return navigation.route[navigation.routeIndex]?.toMapId ?? null;
}

/** Runs before GameStateStore applies a map packet; inspect backend state only. */
export function shouldAcceptMapPacketBeforeApply(input: {
  packet: Pick<MapPacket, 'mapId' | 'khu' | 'ep'>;
  context: AccountRuntimeInfo['mapContext'];
  mapEpoch: number | null;
  expectedMapId: string | null;
}): boolean {
  const mapId = typeof input.packet.mapId === 'string' && input.packet.mapId.trim()
    ? input.packet.mapId.trim() : null;
  const khu = typeof input.packet.khu === 'number' && Number.isFinite(input.packet.khu)
    ? input.packet.khu : null;
  if (mapId === null || khu === null
    || (input.packet.ep !== undefined && !Number.isSafeInteger(input.packet.ep))) return false;

  const contextKnown = input.context.fresh && input.context.mapId !== null && input.context.khu !== null;
  if (!contextKnown) {
    // Welcome may carry the previous epoch; the first complete map packet
    // establishes the authoritative map context and its epoch.
    return true;
  }

  const changed = mapId !== input.context.mapId || khu !== input.context.khu;
  if (changed) {
    return input.expectedMapId !== null && mapId === input.expectedMapId
      && Number.isSafeInteger(input.packet.ep);
  }
  return input.mapEpoch !== null
    && Number.isSafeInteger(input.packet.ep)
    && input.packet.ep === input.mapEpoch;
}

/** Coordinate-only packets may renew age only while the core client's map and epoch still match. */
export function canRefreshMapContextFromMovement(input: {
  context: AccountRuntimeInfo['mapContext'];
  contextEpoch: number | null;
  mapEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
  packet: Record<string, unknown>;
}): boolean {
  return Number.isFinite(input.packet.x) && Number.isFinite(input.packet.y)
    && input.context.fresh && input.contextEpoch !== null
    && input.contextEpoch === input.clientEpoch
    && input.mapEpoch !== null && Number.isSafeInteger(input.packet.ep)
    && input.packet.ep === input.mapEpoch
    && input.clientContext.mapKnown && input.clientContext.khuKnown
    && input.clientContext.mapId === input.context.mapId
    && input.clientContext.khu === input.context.khu;
}

/**
 * Pre-apply gate for world-bearing state/you/snap packets. State packets that
 * contain only vitals/character fields do not claim world data and may pass;
 * any spatial claim must satisfy the same validator used by the backend commit.
 */
export function shouldAcceptWorldPacketBeforeApply(input: {
  source: 'state' | 'you' | 'snap';
  packet: Record<string, unknown>;
  context: AccountRuntimeInfo['mapContext'];
  mapEpoch: number | null;
  contextEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
}): boolean {
  const worldFields = ['mapId', 'khu', 'soKhu', 'x', 'y', 'p', 'e', 'ef'];
  if (!worldFields.some((field) => input.packet[field] !== undefined)) return true;
  const contextKnown = input.context.fresh && input.context.mapId !== null && input.context.khu !== null;
  if (contextKnown && (input.contextEpoch === null || input.contextEpoch !== input.clientEpoch
    || !input.clientContext.mapKnown || !input.clientContext.khuKnown
    || input.clientContext.mapId !== input.context.mapId || input.clientContext.khu !== input.context.khu)) {
    return false;
  }

  return validateWorldPacket({
    source: input.source,
    packet: input.packet,
    context: input.context,
    mapEpoch: input.mapEpoch,
    allowMovementRefresh: input.source === 'you' || input.source === 'state',
    contextEpoch: input.contextEpoch,
    clientContext: input.clientContext,
    clientEpoch: input.clientEpoch,
  }).accepted;
}

export function validateWorldPacket(input: {
  source: 'map' | 'state' | 'you' | 'snap';
  packet: Record<string, unknown>;
  context: AccountRuntimeInfo['mapContext'];
  mapEpoch: number | null;
  expectedMapId?: string | null;
  allowMovementRefresh: boolean;
  contextEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
}): { accepted: boolean; acceptsContext: boolean; mapEpoch: number | null } {
  const packetMapId = typeof input.packet.mapId === 'string' && input.packet.mapId.trim()
    ? input.packet.mapId.trim() : undefined;
  const packetKhu = typeof input.packet.khu === 'number' && Number.isFinite(input.packet.khu)
    ? input.packet.khu : undefined;
  const hasContextFields = input.packet.mapId !== undefined || input.packet.khu !== undefined
    || input.packet.soKhu !== undefined;
  const hasCompleteContext = packetMapId !== undefined && packetKhu !== undefined;
  const currentKnown = input.context.fresh && input.context.mapId !== null && input.context.khu !== null;
  const contextChanged = currentKnown && hasCompleteContext
    && (packetMapId !== input.context.mapId || packetKhu !== input.context.khu);
  const suppliedEpoch = input.packet.ep !== undefined;
  const epochValid = Number.isSafeInteger(input.packet.ep);

  if (input.source === 'map') {
    if (!hasCompleteContext || (suppliedEpoch && !epochValid)) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    if (!input.clientContext.mapKnown || !input.clientContext.khuKnown
      || input.clientContext.mapId !== packetMapId || input.clientContext.khu !== packetKhu) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    if (currentKnown && contextChanged
      && (!input.expectedMapId || packetMapId !== input.expectedMapId || !epochValid)) {
      // Map packets outside the active route cannot prove that a changed
      // context is current: ep may be static, so a delayed packet can look valid.
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    if (currentKnown && !contextChanged
      && (!epochValid || input.mapEpoch === null || input.packet.ep !== input.mapEpoch)) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    const nextEpoch = epochValid
      ? input.packet.ep as number
      : currentKnown ? input.mapEpoch : null;
    return { accepted: true, acceptsContext: true, mapEpoch: nextEpoch };
  }

  if (hasContextFields) {
    if (input.source === 'state' && !suppliedEpoch) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    if (input.source === 'snap' && currentKnown && !suppliedEpoch) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    if (!hasCompleteContext || (suppliedEpoch
      && (!epochValid || input.mapEpoch === null || input.packet.ep !== input.mapEpoch))) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    if (currentKnown && contextChanged) {
      return { accepted: false, acceptsContext: false, mapEpoch: input.mapEpoch };
    }
    // A state/snap packet can seed context only before any map context exists.
    return {
      accepted: true,
      acceptsContext: true,
      mapEpoch: epochValid ? input.packet.ep as number : input.source === 'snap' ? null : input.mapEpoch,
    };
  }

  const movementAccepted = input.allowMovementRefresh && canRefreshMapContextFromMovement({
    context: input.context,
    contextEpoch: input.contextEpoch,
    mapEpoch: input.mapEpoch,
    clientContext: input.clientContext,
    clientEpoch: input.clientEpoch,
    packet: input.packet,
  });
  return { accepted: movementAccepted, acceptsContext: false, mapEpoch: input.mapEpoch };
}

export function validateAndCommitWorldPacket(input: {
  source: 'map' | 'state' | 'you' | 'snap';
  packet: Record<string, unknown>;
  context: AccountRuntimeInfo['mapContext'];
  state: { mapEpoch: number | null; location: Partial<{ x: number; y: number }> };
  expectedMapId?: string | null;
  allowMovementRefresh: boolean;
  contextEpoch: number | null;
  clientContext: { mapId: string; khu: number; mapKnown: boolean; khuKnown: boolean };
  clientEpoch: number;
}): ReturnType<typeof validateWorldPacket> {
  const result = validateWorldPacket({
    source: input.source,
    packet: input.packet,
    context: input.context,
    mapEpoch: input.state.mapEpoch,
    expectedMapId: input.expectedMapId,
    allowMovementRefresh: input.allowMovementRefresh,
    contextEpoch: input.contextEpoch,
    clientContext: input.clientContext,
    clientEpoch: input.clientEpoch,
  });
  if (!result.accepted) return result;

  // Validate against the previous authoritative epoch; commit only afterwards.
  input.state.mapEpoch = result.mapEpoch;
  if (typeof input.packet.x === 'number' && Number.isFinite(input.packet.x)) input.state.location.x = input.packet.x;
  if (typeof input.packet.y === 'number' && Number.isFinite(input.packet.y)) input.state.location.y = input.packet.y;
  return result;
}

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

export function resolveMoveVitalError(downed: boolean | null, vitals: VitalSnapshot): 'character_down' | null {
  if (downed === true) return 'character_down';
  if (vitals.status === 'fresh'
    && (vitals.source === 'you' || vitals.source === 'hurt')
    && vitals.hp !== null
    && vitals.hp <= 0) return 'character_down';
  return null;
}

export function vitalsRuntimeAge(vitals: VitalSnapshot, now: number): number | null {
  if (vitals.status !== 'fresh' || vitals.observedAt === null || !Number.isFinite(vitals.observedAt)) return null;
  return Math.max(0, now - vitals.observedAt);
}

function moveVitalErrorForEntry(entry: ActiveBot): 'character_down' | null {
  return resolveMoveVitalError(entry.client.state.downed, entry.vitals);
}

export function resolveStrictVitalError(downed: boolean | null, vitals: VitalSnapshot, now = Date.now()): 'vitals_unknown' | 'character_down' | null {
  if (resolveMoveVitalError(downed, vitals) === 'character_down') return 'character_down';
  const ageMs = vitalsRuntimeAge(vitals, now);
  if (vitals.status !== 'fresh' || ageMs === null || ageMs > VITALS_ATTACK_MAX_AGE_MS || vitals.hp === null || vitals.hp <= 0) return 'vitals_unknown';
  return null;
}

function strictVitalError(entry: ActiveBot): 'vitals_unknown' | 'character_down' | null {
  return resolveStrictVitalError(entry.client.state.downed, entry.vitals);
}

const emptyStones = (): StonesSnapshot => ({
  value: null,
  status: 'unknown',
  source: null,
  observedAt: null,
});

const emptySnap2Stats = (): Snap2RuntimeStats => ({
  received: 0,
  accepted: 0,
  resyncs: 0,
  legacyReceived: 0,
  fullReceived: 0,
  fullRejected: 0,
  lastSequence: null,
  lastReceivedAt: null,
  lastAcceptedAt: null,
  lastLegacyReceivedAt: null,
  lastPacketFull: null,
  lastPacketKeys: [],
  lastFullSequence: null,
  lastFullEpoch: null,
  lastFullShape: null,
  lastFullRejectReason: null,
  lastRejectReason: null,
  monsterRowsSeen: 0,
  monsterPatchRowsSeen: 0,
  lastMonsterRowsAt: null,
});

const emptyNavigation = (): NavigationRuntimeInfo => ({
  operationId: null,
  phase: 'idle',
  currentMapId: null,
  targetMapId: null,
  route: [],
  routeIndex: 0,
  attempt: 0,
  maxAttempts: 0,
  commandAt: null,
  deadlineAt: null,
  updatedAt: null,
  reason: null,
});

export class WorkerPool {
  private activeBots: Map<string, ActiveBot> = new Map();
  private readonly stationaryProbe = new StationaryProbe();
  private readonly approachProbe = new ApproachProbe();
  private lastMoveToByAccount: Map<string, MoveToRuntimeInfo> = new Map();
  private observedMaps: Map<string, ObservedMap> = new Map();
  private lastWorldSnapshotRejectLogAt: Map<string, number> = new Map();
  private readonly auth = new SupabaseAuth({
    url: CONFIG.SUPABASE_URL,
    anonKey: CONFIG.SUPABASE_ANON_KEY,
    gameApiBase: CONFIG.GAME_SERVER_URL.replace(/^ws/i, 'http'),
  });

  /**
   * Verify credentials against Supabase WITHOUT starting a bot.
   * Throws AuthError (INVALID_CREDENTIALS / RATE_LIMITED / NETWORK ...).
   */
  public async verifyLogin(accountName: string, password: string) {
    return this.auth.signInWithPassword(accountName, password);
  }

  /**
   * Start a bot instance for an account
   */
  public async startAccount(accountId: string): Promise<boolean> {
    const account = db.getAccountById(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    if (this.activeBots.has(accountId)) {
      // Already running
      return true;
    }

    const creds = db.getCredentials(accountId);
    if (!creds.password && !creds.legacyToken) {
      const msg = 'Chưa có mật khẩu cho tài khoản này. Hãy nhập mật khẩu để bot tự đăng nhập.';
      db.updateAccount(accountId, { status: 'error', authError: msg });
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      throw new Error(msg);
    }

    try {
      const botConfig = db.getBotConfig(accountId);

      let entry!: ActiveBot;
      const client = new TuTienClient({
        serverUrl: CONFIG.GAME_SERVER_URL,
        accountName: account.accountName,
        password: creds.password,
        refreshToken: creds.refreshToken,
        token: creds.legacyToken,
        supabaseUrl: CONFIG.SUPABASE_URL,
        supabaseAnonKey: CONFIG.SUPABASE_ANON_KEY,
        proxyUrl: account.proxyUrl || undefined,
        mapPacketGuard: (packet, _state) => {
          // The core callback runs before state.updateMap. `entry` is assigned
          // before controller.start can connect; fail closed if ordering changes.
          if (!entry) return false;
          return shouldAcceptMapPacketBeforeApply({
            packet,
            context: entry.mapContext,
            mapEpoch: entry.mapEpoch,
            expectedMapId: expectedNavigationMapId(entry.navigation),
          });
        },
        worldPacketGuard: (source, packet, state) => {
          // This hook runs before core state mutation. Keep its decision based
          // on backend-authoritative context/epoch, never on packet-side writes.
          if (!entry) return false;
          return shouldAcceptWorldPacketBeforeApply({
            source,
            packet,
            context: entry.mapContext,
            mapEpoch: entry.mapEpoch,
            contextEpoch: entry.mapContextEpoch,
            clientContext: {
              mapId: state.mapId,
              khu: state.khu,
              mapKnown: state.mapKnown,
              khuKnown: state.khuKnown,
            },
            clientEpoch: state.contextEpoch,
          });
        },
        jitter: {
          minDelayMs: botConfig.delayRangeMs.min,
          maxDelayMs: botConfig.delayRangeMs.max,
        },
      });

      const controller = new BotController(accountId, client, botConfig);
      entry = {
        client,
        controller,
        tokenExpiresAt: null,
        dataStatus: { realm: false, hp: false, maxHp: false, mp: false, maxMp: false, stones: false, location: false, monsters: false, players: false },
        location: {},
        monsters: [],
        players: [],
        vitals: emptyVitals(),
        selfPresence: null,
        stonesSnapshot: emptyStones(),
        mapContext: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
        mapContextEpoch: null,
        mapEpoch: null,
        playersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
        monstersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
        lastWorldSnapshotBroadcastAt: 0,
        lastAcceptedWorldAt: null,
        lastAcceptedWorldObservedAt: null,
        lastMapEntryRequestAt: 0,
        navigation: emptyNavigation(),
        moveTo: this.lastMoveToByAccount.get(accountId) ?? null,
      };

      controller.setMapNavigation((mapId, shouldContinue) =>
        this.navigateMapAndWait(accountId, entry, mapId, shouldContinue));
      controller.setTrainingMovementExecutor((request) =>
        this.moveToTrainingArea(accountId, entry, request));
      controller.setVitalsRefreshRequester(() => this.refreshVitals(accountId));

      // Bind events
      controller.on('log', (log: BotLogMessage) => {
        const savedLog = db.addLog(log.accountId, log.level, log.module, log.message);
        wsHub.broadcastLog(savedLog);
      });

      controller.on('activityChange', (activity: string) => {
        wsHub.broadcastActivity(accountId, activity);
      });

      // Supabase rotates refresh tokens — persist the newest one so a restart needs no password login.
      client.on('sessionUpdated', (s: { refreshToken: string; expiresAt: number }) => {
        entry.tokenExpiresAt = s.expiresAt;
        db.updateCredentials(accountId, { refreshToken: s.refreshToken });
      });

      const resetWorldFreshness = () => {
        if (entry.moveTo && ['accepted', 'running'].includes(entry.moveTo.status)) {
          this.setMoveToStatus(accountId, entry, 'cancelled', 'connection_context_reset');
        }
        entry.location = {};
        entry.vitals = { ...client.state.vitals };
        entry.stonesSnapshot = { ...client.state.stonesSnapshot };
        entry.dataStatus.location = false;
        entry.dataStatus.hp = false;
        entry.dataStatus.maxHp = false;
        entry.dataStatus.mp = false;
        entry.dataStatus.maxMp = false;
        entry.dataStatus.stones = false;
        entry.dataStatus.players = false;
        entry.dataStatus.monsters = false;
        entry.mapContext = { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false };
        entry.mapContextEpoch = null;
        entry.mapEpoch = null;
        entry.lastAcceptedWorldAt = null;
        entry.lastAcceptedWorldObservedAt = null;
        entry.playersContext = { ...entry.playersContext, fresh: false };
        entry.monstersContext = { ...entry.monstersContext, fresh: false };
      };

      const syncCanonicalVitals = () => {
        entry.vitals = { ...client.state.vitals };
        entry.stonesSnapshot = { ...client.state.stonesSnapshot };
        const fresh = entry.vitals.status === 'fresh';
        entry.dataStatus.hp = fresh && entry.vitals.hp !== null;
        entry.dataStatus.maxHp = fresh && entry.vitals.maxHp !== null;
        entry.dataStatus.mp = fresh && entry.vitals.mp !== null;
        entry.dataStatus.maxMp = fresh && entry.vitals.maxMp !== null;
        entry.dataStatus.stones = entry.stonesSnapshot.status === 'fresh' && entry.stonesSnapshot.value !== null;
      };

      client.on('welcome', (packet: Record<string, unknown>) => {
        resetWorldFreshness();
        entry.mapEpoch = Number.isSafeInteger(packet.ep) ? packet.ep as number : null;
        if (db.getAccountById(accountId)?.authError) db.updateAccount(accountId, { authError: null });
        void this.stationaryProbe.schedule(() => {
          return {
            getSnapshot: () => this.getStationarySnapshot(entry),
            isConnected: () => client.isConnected(),
            sendMove: (x, y, dir, st, shouldSend) => entry.client.sendMove(x, y, dir, st, shouldSend),
            onYou: (listener) => {
              client.on('you', listener);
              return () => client.off('you', listener);
            },
            recordBatchStart: (input) => client.socket.beginStationaryProbeBatch(input),
            recordBatchEnd: (input) => client.socket.endStationaryProbeBatch(input),
            recordYou: (label, youPacket) => client.socket.recordStationaryProbeYou(label, youPacket),
            recordCancellation: (reason) => client.socket.recordStationaryProbeCancellation(reason),
          };
        });
        void this.approachProbe.schedule(() => ({
          getSnapshot: () => this.getApproachSnapshot(entry),
          isConnected: () => this.activeBots.get(accountId) === entry && client.isConnected(),
          startMoveTo: (input) => {
            this.validateMoveToTarget(input.mapId, input.goal.x, input.goal.y);
            const started = this.startMoveTo(
              accountId,
              entry,
              input.requestId,
              input.mapId,
              input.khu,
              input.goal.x,
              input.goal.y,
              input.arrivalRadius,
              input.shouldContinue,
            );
            return { operationId: started.operation.operationId, promise: started.promise };
          },
          cancelMoveTo: (operationId, reason) => this.cancelMoveToAndWait(accountId, entry, operationId, reason),
          isWalkablePoint: (mapId, point) => isWalkSegmentClear(mapId, point, point),
          nearestWalkable: (mapId, x, y, radiusTiles) => findNearestWalkableTarget(mapId, x, y, radiusTiles),
          pathLength: (mapId, from, to) => {
            const path = findWalkPath(mapId, from, {
              tx: Math.floor(to.x / WALK_TILE_SIZE),
              ty: Math.floor(to.y / WALK_TILE_SIZE),
            });
            if (path === null) return null;
            let length = 0;
            let previous = from;
            for (const waypoint of path) {
              length += Math.hypot(waypoint.x - previous.x, waypoint.y - previous.y);
              previous = waypoint;
            }
            return length + Math.hypot(to.x - previous.x, to.y - previous.y);
          },
          onHurt: (listener) => {
            client.on('hurt', listener);
            return () => client.off('hurt', listener);
          },
          wait: async (ms) => { await sleep(ms); },
          recordPlan: (record) => client.socket.recordApproachProbePlan(record),
          recordResult: (record) => client.socket.recordApproachProbeResult({
            status: record.status,
            reason: record.reason,
            elapsedMs: record.elapsedMs,
            replans: record.replans,
            finalDistance: record.finalDistance,
          }),
          recordCancellation: (reason) => client.socket.recordApproachProbeResult({
            status: 'cancelled',
            reason,
            elapsedMs: 0,
            replans: 0,
            finalDistance: Number.POSITIVE_INFINITY,
          }),
        }));
      });

      client.on('statusChange', (status: string) => {
        if (['DISCONNECTED', 'RECONNECTING', 'CONNECTING', 'HANDSHAKING'].includes(String(status))) {
          resetWorldFreshness();
        }
      });

      // Fatal authentication failure (wrong password / ticket rejected twice): stop cleanly, tell the UI.
      client.on('authFailed', (err: AuthError) => {
        db.updateAccount(accountId, { status: 'error', authError: err.message });
        const saved = db.addLog(accountId, 'error', 'Auth', `${err.message} Bot đã dừng.`);
        wsHub.broadcastLog(saved);
        void this.stopAccount(accountId, { keepStatus: true });
      });

      client.on('stateChange', () => {
        // GameStateStore emits this synchronously while processing the packet.
        // Sync first so the first account_updated frame already contains the
        // canonical snapshot, instead of a stale frame followed by a correction.
        syncCanonicalVitals();
        const overview = client.getOverview();
        db.updateAccount(accountId, {
          characterName: overview.name,
          ...(entry.dataStatus.realm ? { realm: overview.realm } : {}),
          ...(entry.stonesSnapshot.status === 'fresh' && entry.stonesSnapshot.value !== null
            ? { stones: entry.stonesSnapshot.value }
            : {}),
          status: 'running',
        });

        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });

      const updateWorldSnapshot = (
        packet: Record<string, unknown>,
        source: 'map' | 'state' | 'you' | 'snap',
        allowMovementRefresh = false,
      ) => {
        const packetMapId = typeof packet.mapId === 'string' && packet.mapId.trim() ? packet.mapId.trim() : undefined;
        const packetKhu = typeof packet.khu === 'number' && Number.isFinite(packet.khu) ? packet.khu : undefined;
        const packetSoKhu = typeof packet.soKhu === 'number' && Number.isFinite(packet.soKhu) && packet.soKhu > 0
          ? packet.soKhu
          : undefined;
        const acceptance = validateAndCommitWorldPacket({
          source,
          packet,
          context: entry.mapContext,
          state: entry,
          expectedMapId: expectedNavigationMapId(entry.navigation),
          allowMovementRefresh,
          contextEpoch: entry.mapContextEpoch,
          clientContext: {
            mapId: client.state.mapId,
            khu: client.state.khu,
            mapKnown: client.state.mapKnown,
            khuKnown: client.state.khuKnown,
          },
          clientEpoch: client.state.contextEpoch,
        });
        if (!acceptance.accepted) return;
        const mapChanged = entry.mapContext.fresh && packetMapId !== undefined
          && packetMapId !== entry.mapContext.mapId;
        const khuChanged = entry.mapContext.fresh && packetKhu !== undefined
          && packetKhu !== entry.mapContext.khu;

        if (mapChanged || khuChanged) {
          entry.lastAcceptedWorldAt = null;
          entry.lastAcceptedWorldObservedAt = null;
          if (entry.moveTo && ['accepted', 'running'].includes(entry.moveTo.status)) {
            this.setMoveToStatus(accountId, entry, 'cancelled', mapChanged ? 'map_changed' : 'khu_changed');
          }
          entry.location = {};
          entry.dataStatus.location = false;
          entry.dataStatus.players = false;
          entry.dataStatus.monsters = false;
          entry.playersContext = { mapId: null, khu: null, observedAt: null, fresh: false };
          entry.monstersContext = { mapId: null, khu: null, observedAt: null, fresh: false };
          if (mapChanged) {
            entry.mapContext.khu = null;
            entry.mapContext.soKhu = null;
          }
        }

        if (packetMapId !== undefined) {
          const previous = this.observedMaps.get(packetMapId);
          this.observedMaps.set(packetMapId, {
            mapId: packetMapId,
            soKhu: packetSoKhu ?? previous?.soKhu ?? null,
            lastSeenAt: Date.now(),
          });
          entry.mapContext.mapId = packetMapId;
          entry.location.mapId = packetMapId;
        }
        if (packetKhu !== undefined) {
          entry.mapContext.khu = packetKhu;
          entry.location.khu = packetKhu;
        }
        if (packetSoKhu !== undefined) entry.mapContext.soKhu = packetSoKhu;
        if (acceptance.acceptsContext) {
          entry.mapContext.observedAt = Date.now();
          entry.mapContextEpoch = client.state.contextEpoch;
        } else if (allowMovementRefresh && canRefreshMapContextFromMovement({
          context: entry.mapContext,
          contextEpoch: entry.mapContextEpoch,
          mapEpoch: entry.mapEpoch,
          clientContext: {
            mapId: client.state.mapId,
            khu: client.state.khu,
            mapKnown: client.state.mapKnown,
            khuKnown: client.state.khuKnown,
          },
          clientEpoch: client.state.contextEpoch,
          packet,
        })) {
          entry.mapContext.observedAt = Date.now();
        }
        // A validated map transition cleared the old location above; apply the
        // accepted packet coordinates to the new context after that reset.
        if (typeof packet.x === 'number' && Number.isFinite(packet.x)) entry.location.x = packet.x;
        if (typeof packet.y === 'number' && Number.isFinite(packet.y)) entry.location.y = packet.y;
        entry.mapContext.fresh = typeof entry.mapContext.mapId === 'string'
          && typeof entry.mapContext.khu === 'number';

        entry.dataStatus.location = entry.mapContext.fresh
          && typeof entry.location.mapId === 'string'
          && typeof entry.location.khu === 'number'
          && typeof entry.location.x === 'number'
          && typeof entry.location.y === 'number';
        if (Array.isArray(packet.e) || Array.isArray(packet.ef)) {
          const entityRows = (Array.isArray(packet.e) ? packet.e : packet.ef) as unknown[];
          entry.monsters = entityRows.filter((enemy: unknown): enemy is AccountRuntimeInfo['monsters'][number] =>
            !!enemy && typeof enemy === 'object' && typeof (enemy as { id?: unknown }).id === 'string'
            && typeof (enemy as { x?: unknown }).x === 'number' && typeof (enemy as { y?: unknown }).y === 'number'
          ).map((enemy) => ({ ...enemy }));
          const observedAt = Date.now();
          entry.monstersContext = {
            mapId: entry.mapContext.fresh ? entry.mapContext.mapId : null,
            khu: entry.mapContext.fresh ? entry.mapContext.khu : null,
            observedAt,
            fresh: entry.mapContext.fresh,
          };
          entry.dataStatus.monsters = entry.monstersContext.fresh;
        }
        if (Array.isArray(packet.p)) {
          entry.players = packet.p.filter((player): player is AccountRuntimeInfo['players'][number] =>
            !!player && typeof player === 'object' && typeof (player as { id?: unknown }).id === 'string'
            && typeof (player as { x?: unknown }).x === 'number' && typeof (player as { y?: unknown }).y === 'number'
          ).map((player) => ({ ...player }));
          const observedAt = Date.now();
          entry.playersContext = {
            mapId: entry.mapContext.fresh ? entry.mapContext.mapId : null,
            khu: entry.mapContext.fresh ? entry.mapContext.khu : null,
            observedAt,
            fresh: entry.mapContext.fresh,
          };
          entry.dataStatus.players = entry.playersContext.fresh;
        }
      };

      client.on('state', (packet: Record<string, unknown>) => {
        if (readStatePacketRealm(packet) !== null) entry.dataStatus.realm = true;
        syncCanonicalVitals();
        updateWorldSnapshot(packet, 'state', true);
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });
      client.on('status', (packet: Record<string, unknown>) => {
        syncCanonicalVitals();
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });
      client.on('formation', (packet: Record<string, unknown>) => {
        syncCanonicalVitals();
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });
      client.on('you', (packet: Record<string, unknown>) => {
        syncCanonicalVitals();
        // YouPacket's contract includes ep (unlike legacy snap). Allow its
        // movement-only shape through the refresh gate; the gate still requires
        // matching server mapEpoch, client context, and finite x/y.
        updateWorldSnapshot(packet, 'you', true);
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });
      client.on('hurt', (packet: Record<string, unknown>) => {
        syncCanonicalVitals();
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });
      client.on('revived', (packet: Record<string, unknown>) => {
        syncCanonicalVitals();
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });
      client.on('down', () => {
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });

      client.on('map', (packet: Record<string, unknown>) => {
        updateWorldSnapshot(packet, 'map');
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });

      client.on('snap', (packet: Record<string, unknown>) => {
        // Legacy snap is the authoritative baseline on some server revisions;
        // snap2 then carries the movement deltas. Do not discard the baseline.
        updateWorldSnapshot(packet, 'snap');
        wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      });

      client.on('worldSnapshot', (snapshot: {
        mapId: string; khu: number; contextEpoch: number; mapEpoch?: number;
        sequence: number; observedAt: number;
        players: AccountRuntimeInfo['players']; monsters: AccountRuntimeInfo['monsters'];
      }) => {
        // The core client emits atomically reduced snap2 snapshots. Require the
        // worker and core context to agree before refreshing map-context age.
        // Snapshots update entities only; they never update authoritative location.
        const receivedAt = Date.now();
        const rejectReason = worldSnapshotRejectReason({
          snapshot,
          context: entry.mapContext,
          contextEpoch: entry.mapContextEpoch,
          clientContext: {
            mapId: client.state.mapId,
            khu: client.state.khu,
            mapKnown: client.state.mapKnown,
            khuKnown: client.state.khuKnown,
          },
          clientEpoch: client.state.contextEpoch,
          lastAcceptedWorldObservedAt: entry.lastAcceptedWorldObservedAt,
          now: receivedAt,
        });
        if (rejectReason) {
          const throttleKey = `${accountId}:${rejectReason}`;
          const lastLoggedAt = this.lastWorldSnapshotRejectLogAt.get(throttleKey) ?? 0;
          if (receivedAt - lastLoggedAt >= 10_000) {
            this.lastWorldSnapshotRejectLogAt.set(throttleKey, receivedAt);
            console.warn(JSON.stringify({
              event: 'world_snapshot_rejected', accountId, reason: rejectReason,
              snapshotMapId: snapshot.mapId, snapshotKhu: snapshot.khu,
              snapshotContextEpoch: snapshot.contextEpoch,
              currentMapId: entry.mapContext.mapId, currentKhu: entry.mapContext.khu,
              currentContextEpoch: entry.mapContextEpoch, clientContextEpoch: client.state.contextEpoch,
              sequence: snapshot.sequence,
            }));
          }
          return;
        }
        entry.lastAcceptedWorldAt = receivedAt;
        entry.lastAcceptedWorldObservedAt = snapshot.observedAt;
        refreshMapContextAge(entry.mapContext, receivedAt);
        const players = snapshot.players.filter((player) => player && typeof player.id === 'string'
          && Number.isFinite(player.x) && Number.isFinite(player.y)).map((player) => ({ ...player }));
        const monsters = snapshot.monsters.filter((monster) => monster && typeof monster.id === 'string'
          && Number.isFinite(monster.x) && Number.isFinite(monster.y)).map((monster) => ({ ...monster }));
        entry.players = players;
        entry.monsters = monsters;
        entry.playersContext = { mapId: snapshot.mapId, khu: snapshot.khu, observedAt: snapshot.observedAt, fresh: true };
        entry.monstersContext = { mapId: snapshot.mapId, khu: snapshot.khu, observedAt: snapshot.observedAt, fresh: true };
        entry.dataStatus.players = true;
        entry.dataStatus.monsters = true;
        // Keep reducer state at wire cadence, but cap dashboard fan-out at 5 Hz.
        // This preserves responsive marker motion without broadcasting every snap2
        // packet when the game server is sending a higher-frequency stream.
        const now = Date.now();
        if (now - entry.lastWorldSnapshotBroadcastAt >= 200) {
          entry.lastWorldSnapshotBroadcastAt = now;
          wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
        }
      });

      this.activeBots.set(accountId, entry);
      db.updateAccount(accountId, { status: 'running', authError: null });

      controller.start();
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      return true;
    } catch (err: any) {
      db.updateAccount(accountId, { status: 'error' });
      db.addLog(accountId, 'error', 'Orchestrator', `Failed to start bot: ${err.message}`);
      throw err;
    }
  }

  /**
   * Stop an active bot instance
   */
  public async stopAccount(accountId: string, opts: { keepStatus?: boolean } = {}): Promise<boolean> {
    const entry = this.activeBots.get(accountId);
    const finalStatus = opts.keepStatus ? undefined : ({ status: 'stopped' } as const);

    if (!entry) {
      if (finalStatus) db.updateAccount(accountId, finalStatus);
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      return false;
    }

    try {
      if (entry.moveTo && ['accepted', 'running'].includes(entry.moveTo.status)) {
        this.setMoveToStatus(accountId, entry, 'cancelled', 'account_stopped');
      }
      this.activeBots.delete(accountId);
      entry.controller.stop();
      entry.client.dispose();
      if (finalStatus) db.updateAccount(accountId, finalStatus);
      wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
      return true;
    } catch (err: any) {
      db.addLog(accountId, 'error', 'Orchestrator', `Error stopping bot: ${err.message}`);
      return false;
    }
  }

  public async restartAccount(accountId: string): Promise<boolean> {
    await this.stopAccount(accountId);
    await sleep(1000);
    return await this.startAccount(accountId);
  }

  /** Start every account that has credentials, staggering logins to avoid a login storm. */
  public async startAll(): Promise<void> {
    const accounts = db.getAccounts();
    let first = true;
    for (const acc of accounts) {
      if (this.activeBots.has(acc.id)) continue;
      try {
        if (!first) {
          const { min, max } = CONFIG.LOGIN_STAGGER_MS;
          await sleep(min + Math.floor(Math.random() * (max - min)));
        }
        first = false;
        await this.startAccount(acc.id);
      } catch (err: any) {
        console.error(`Error starting account ${acc.id}:`, err?.message || err);
      }
    }
  }

  public async stopAll(): Promise<void> {
    const ids = Array.from(this.activeBots.keys());
    for (const id of ids) {
      await this.stopAccount(id);
    }
  }

  public refreshVitals(accountId: string, options: { allowNearMonsters?: boolean } = {}): Promise<VitalsRefreshResult> {
    const entry = this.activeBots.get(accountId);
    if (!entry) return Promise.resolve({ status: 'skipped', reason: 'disconnected', movesSent: 0 });
    return runVitalsRefresh({
      accountId,
      getSnapshot: () => this.getStationarySnapshot(entry),
      isConnected: () => this.activeBots.get(accountId) === entry && entry.client.isConnected(),
      operationLedger: entry.client.operationLedger,
      trainingPhase: entry.controller.getTrainingState().phase,
      sendMove: (x, y, dir, st, shouldSend) => entry.client.sendMove(x, y, dir, st, shouldSend),
      onYou: (listener) => {
        entry.client.on('you', listener);
        return () => entry.client.off('you', listener);
      },
      allowNearMonsters: options.allowNearMonsters === true,
    });
  }

  public getRuntimeInfo(accountId: string): AccountRuntimeInfo {
    const acc = db.getAccountById(accountId);
    const entry = this.activeBots.get(accountId);
    const authInfo = {
      authError: acc?.authError ?? null,
      hasPassword: !!acc?.encryptedPassword,
    };
    const trainingConfig = db.getBotConfig(accountId);
    const configuredMonsterType = (trainingConfig as unknown as Record<string, unknown>).trainingMonsterType;
    const trainingTarget: TrainingRuntimeInfo['target'] = {
      mapId: trainingConfig.farmMapId || '',
      khu: trainingConfig.farmKhu ?? 1,
      x: typeof trainingConfig.farmX === 'number' && Number.isFinite(trainingConfig.farmX) ? trainingConfig.farmX : null,
      y: typeof trainingConfig.farmY === 'number' && Number.isFinite(trainingConfig.farmY) ? trainingConfig.farmY : null,
      radius: trainingConfig.trainingRadius ?? 80,
      attackIntervalMs: trainingConfig.trainingAttackIntervalMs ?? 1000,
      monsterType: typeof configuredMonsterType === 'string' && configuredMonsterType.trim().length > 0
        ? configuredMonsterType.trim()
        : null,
    };
    const training: TrainingRuntimeInfo = entry
      ? (() => {
          const state = entry.controller.getTrainingState();
          return {
            enabled: trainingConfig.autoTraining === true,
            phase: state.phase,
            sessionId: state.sessionId,
            reason: state.reason ?? null,
            pending: state.pending ? { type: state.pending.type, operationId: state.pending.operationId } : null,
            target: trainingTarget,
            protocol: { khuSelectionSupported: false, respawnSupported: false },
          };
        })()
      : {
          enabled: trainingConfig.autoTraining === true,
          phase: trainingConfig.autoTraining === true ? 'SYNCING' : 'STOPPED',
          sessionId: null,
          reason: trainingConfig.autoTraining === true ? 'BOT_STOPPED_NO_AUTHORITATIVE_SNAPSHOT' : null,
          pending: null,
          target: trainingTarget,
          protocol: { khuSelectionSupported: false, respawnSupported: false },
        };

    if (!entry) {
      const botConfig = trainingConfig;
      return {
        id: accountId,
        accountName: acc?.accountName || 'Unknown',
        status: (acc?.status as any) || 'stopped',
        connection: 'DISCONNECTED',
        ...authInfo,
        tokenExpiresAt: null,
        characterName: acc?.characterName || acc?.accountName || 'Unknown',
        realm: '',
        hp: null,
        maxHp: null,
        mp: null,
        maxMp: null,
        vitals: emptyVitals(),
        vitalsAgeMs: null,
        derivedMax: emptyDerivedMax(),
        downed: null,
        selfPresence: null,
        stones: null,
        stonesSnapshot: emptyStones(),
        mapId: '',
        khu: 0,
        x: 0,
        y: 0,
        bagCount: 0,
        latencyMs: 0,
        activity: 'idle',
        navigation: emptyNavigation(),
        moveTo: this.lastMoveToByAccount.get(accountId) ?? null,
        training,
        bag: {},
        farmMapId: botConfig.farmMapId || '',
        farmKhu: botConfig.farmKhu ?? 0,
        farmX: botConfig.farmX ?? 0,
        farmY: botConfig.farmY ?? 0,
        dataStatus: { realm: false, hp: false, maxHp: false, mp: false, maxMp: false, stones: false, location: false, monsters: false, players: false },
        monsters: [],
        players: [],
        soKhu: null,
        mapContext: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
        mapContextAgeMs: null,
        mapContextIsCurrent: false,
        lastAcceptedWorldAt: null,
        playersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
        monstersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
        worldSync: emptySnap2Stats(),
      };
    }

    const overview = entry.client.getOverview();
    const botConfig = trainingConfig;
    const now = Date.now();
    const playersFresh = entry.playersContext.fresh && entry.playersContext.observedAt !== null
      && now - entry.playersContext.observedAt <= 5_000;
    const monstersFresh = entry.monstersContext.fresh && entry.monstersContext.observedAt !== null
      && now - entry.monstersContext.observedAt <= 5_000;
    const projectedMapContext = mapContextRuntime(entry.mapContext, {
      now,
      contextEpoch: entry.mapContextEpoch,
      clientContext: {
        mapId: entry.client.state.mapId,
        khu: entry.client.state.khu,
        mapKnown: entry.client.state.mapKnown,
        khuKnown: entry.client.state.khuKnown,
      },
      clientEpoch: entry.client.state.contextEpoch,
    });
    return {
      id: accountId,
      accountName: acc?.accountName || overview.name,
      status: 'running',
      connection: String(overview.connectionStatus),
      ...authInfo,
      tokenExpiresAt: entry.tokenExpiresAt,
      characterName: overview.name || acc?.characterName || 'Unknown',
      realm: entry.dataStatus.realm ? overview.realm : '',
      hp: entry.dataStatus.hp ? entry.vitals.hp : null,
      maxHp: entry.dataStatus.maxHp ? entry.vitals.maxHp : null,
      mp: entry.dataStatus.mp ? entry.vitals.mp : null,
      maxMp: entry.dataStatus.maxMp ? entry.vitals.maxMp : null,
      vitals: { ...entry.vitals },
      vitalsAgeMs: vitalsRuntimeAge(entry.vitals, now),
      derivedMax: { ...entry.client.state.derivedMax },
      downed: entry.client.state.downed,
      selfPresence: entry.client.state.selfPresence ? { ...entry.client.state.selfPresence } : null,
      stones: entry.stonesSnapshot.status === 'fresh' ? entry.stonesSnapshot.value : null,
      stonesSnapshot: { ...entry.stonesSnapshot },
      mapId: entry.dataStatus.location ? entry.location.mapId! : '',
      khu: entry.dataStatus.location ? entry.location.khu! : 0,
      x: entry.dataStatus.location ? entry.location.x! : 0,
      y: entry.dataStatus.location ? entry.location.y! : 0,
      bagCount: overview.bagCount,
      latencyMs: overview.latencyMs,
      activity: entry.controller.getActivity(),
      navigation: { ...entry.navigation, route: entry.navigation.route.map((edge) => ({ ...edge })) },
      moveTo: entry.moveTo ? { ...entry.moveTo } : null,
      training,
      bag: overview.bagItems,
      farmMapId: botConfig.farmMapId || '',
      farmKhu: botConfig.farmKhu ?? 0,
      farmX: botConfig.farmX ?? 0,
      farmY: botConfig.farmY ?? 0,
      dataStatus: { ...entry.dataStatus, monsters: entry.dataStatus.monsters && monstersFresh, players: entry.dataStatus.players && playersFresh },
      monsters: entry.dataStatus.monsters && monstersFresh ? entry.monsters.map((enemy) => ({ ...enemy })) : [],
      players: entry.dataStatus.players && playersFresh ? entry.players.map((player) => ({ ...player })) : [],
      soKhu: projectedMapContext.context.fresh ? entry.mapContext.soKhu : null,
      mapContext: projectedMapContext.context,
      mapContextAgeMs: projectedMapContext.ageMs,
      mapContextIsCurrent: projectedMapContext.isCurrent,
      lastAcceptedWorldAt: entry.lastAcceptedWorldAt,
      playersContext: { ...entry.playersContext, fresh: playersFresh },
      monstersContext: { ...entry.monstersContext, fresh: monstersFresh },
      worldSync: entry.client.getSnap2Stats(),
    };
  }

  public getAllRuntimes(): AccountRuntimeInfo[] {
    const accounts = db.getAccounts();
    return accounts.map((a) => this.getRuntimeInfo(a.id));
  }

  public getObservedMaps(): ObservedMap[] {
    return Array.from(this.observedMaps.values())
      .sort((a, b) => a.mapId.localeCompare(b.mapId))
      .map((map) => ({ ...map }));
  }

  /**
   * Return display metadata known by the public client, enriched with the
   * latest map packets seen by this server process. Packet data stays the
   * authority for `observed`, `soKhu`, and `lastSeenAt`.
   */
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

  private setNavigationRuntime(accountId: string, entry: ActiveBot, state: {
    operationId: string | null;
    navigation: PortalNavigationState;
    updatedAt?: number;
  }): void {
    entry.navigation = {
      operationId: state.operationId,
      phase: state.navigation.phase,
      currentMapId: state.navigation.currentMapId || null,
      targetMapId: state.navigation.targetMapId || null,
      route: state.navigation.route.map((edge) => ({
        portalId: edge.portalId,
        fromMapId: edge.fromMapId,
        toMapId: edge.toMapId,
        tx: edge.tx,
        ty: edge.ty,
        label: edge.label,
      })),
      routeIndex: state.navigation.routeIndex,
      attempt: state.navigation.retry.attempt,
      maxAttempts: state.navigation.retry.maxAttempts,
      commandAt: state.navigation.retry.commandAt,
      deadlineAt: state.navigation.retry.deadlineAt,
      updatedAt: state.updatedAt ?? Date.now(),
      reason: state.navigation.reason ?? null,
    };
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
  }

  private navigationIsCurrent(accountId: string, entry: ActiveBot, operationId: string): boolean {
    return this.activeBots.get(accountId) === entry
      && entry.navigation.operationId === operationId
      && entry.client.isConnected();
  }

  private moveToIsCurrent(accountId: string, entry: ActiveBot, operationId: string, shouldContinue: () => boolean): boolean {
    return this.activeBots.get(accountId) === entry
      && entry.moveTo?.operationId === operationId
      && ['accepted', 'running'].includes(entry.moveTo.status)
      && entry.client.isConnected()
      && shouldContinue();
  }

  private setMoveToStatus(accountId: string, entry: ActiveBot, status: MoveToRuntimeInfo['status'], reason: string | null = null): void {
    if (!entry.moveTo) return;
    entry.moveTo = { ...entry.moveTo, status, reason, updatedAt: Date.now() };
    this.lastMoveToByAccount.set(accountId, { ...entry.moveTo });
    wsHub.broadcastAccountUpdate(this.getRuntimeInfo(accountId));
  }

  private hasCurrentMapContext(entry: ActiveBot, now = Date.now()): boolean {
    return isMapContextCurrent({
      context: entry.mapContext,
      now,
      contextEpoch: entry.mapContextEpoch,
      clientContext: {
        mapId: entry.client.state.mapId,
        khu: entry.client.state.khu,
        mapKnown: entry.client.state.mapKnown,
        khuKnown: entry.client.state.khuKnown,
      },
      clientEpoch: entry.client.state.contextEpoch,
    });
  }

  /** Shared stationary snapshot/guard input for the opt-in harness and refresh. */
  private getStationarySnapshot(entry: ActiveBot): StationaryProbeSnapshot {
    const now = Date.now();
    const mapContextIsCurrent = this.hasCurrentMapContext(entry, now);
    const monstersFresh = entry.dataStatus.monsters
      && entry.monstersContext.fresh
      && entry.monstersContext.observedAt !== null
      && now - entry.monstersContext.observedAt <= 5_000
      && mapContextIsCurrent;
    const position = entry.dataStatus.location
      && typeof entry.location.x === 'number' && Number.isFinite(entry.location.x)
      && typeof entry.location.y === 'number' && Number.isFinite(entry.location.y)
      ? { x: entry.location.x, y: entry.location.y }
      : null;
    return {
      downed: entry.client.state.downed,
      monsters: monstersFresh ? entry.monsters.map((monster) => ({ x: monster.x, y: monster.y })) : [],
      moveToStatus: entry.moveTo?.status ?? null,
      navigationPhase: entry.navigation.phase,
      mapContextIsCurrent,
      position,
      dir: Number.isFinite(entry.client.state.dir) ? entry.client.state.dir : null,
    } satisfies StationaryProbeSnapshot;
  }

  private getApproachSnapshot(entry: ActiveBot): ApproachSnapshot {
    const now = Date.now();
    const mapContextIsCurrent = this.hasCurrentMapContext(entry, now);
    const monstersFresh = entry.dataStatus.monsters
      && entry.monstersContext.fresh
      && entry.monstersContext.observedAt !== null
      && now - entry.monstersContext.observedAt <= 5_000
      && mapContextIsCurrent;
    const position = entry.dataStatus.location
      && typeof entry.location.x === 'number' && Number.isFinite(entry.location.x)
      && typeof entry.location.y === 'number' && Number.isFinite(entry.location.y)
      ? { x: entry.location.x, y: entry.location.y }
      : null;
    return {
      inGame: entry.client.isConnected(),
      mapContextIsCurrent,
      mapId: typeof entry.mapContext.mapId === 'string' ? entry.mapContext.mapId : null,
      khu: typeof entry.mapContext.khu === 'number' ? entry.mapContext.khu : null,
      position,
      downed: entry.client.state.downed,
      moveToStatus: entry.moveTo?.status ?? null,
      moveToOperationId: entry.moveTo?.operationId ?? null,
      navigationActive: !!entry.navigationPromise
        || ['planning', 'moving_to_portal', 'waiting_map_confirmation'].includes(entry.navigation.phase),
      botRunning: true,
      vitals: {
        status: entry.vitals.status,
        observedAt: entry.vitals.observedAt,
        hp: entry.vitals.hp,
      },
      monsters: monstersFresh ? entry.monsters : [],
      monstersFresh,
      monstersObservedAt: monstersFresh ? entry.monstersContext.observedAt : null,
    } satisfies ApproachSnapshot;
  }

  private async cancelMoveToAndWait(
    accountId: string,
    entry: ActiveBot,
    operationId: string,
    reason: string,
  ): Promise<void> {
    if (entry.moveTo?.operationId !== operationId) return;
    const promise = entry.moveToPromise;
    if (entry.moveTo && ['accepted', 'running'].includes(entry.moveTo.status)) {
      this.setMoveToStatus(accountId, entry, 'cancelled', reason);
    }
    await promise?.catch(() => undefined);
  }

  private async runMoveTo(
    accountId: string,
    entry: ActiveBot,
    operationId: string,
    arrivalRadius: number,
    shouldContinue: () => boolean = () => true,
  ): Promise<void> {
    const operation = entry.moveTo!;
    const { mapId, khu, x: targetX, y: targetY } = operation;
    const startedAt = Date.now();
    const initialLocationObservedAt = entry.mapContext.observedAt ?? 0;
    const maxDurationMs = 45_000;
    const movementIntervalMs = 100;
    const maxStepPx = 68 * movementIntervalMs / 1000;
    let lastProgressAt = startedAt;
    let lastPosition = { x: entry.location.x!, y: entry.location.y! };
    let stalledRetries = 0;
    this.setMoveToStatus(accountId, entry, 'running');
    while (Date.now() - startedAt < maxDurationMs) {
      if (!this.moveToIsCurrent(accountId, entry, operationId, shouldContinue)) {
        this.setMoveToStatus(accountId, entry, 'cancelled', 'operation_cancelled_or_disconnected');
        return;
      }
      if (!entry.dataStatus.location || !this.hasCurrentMapContext(entry)
        || entry.mapContext.mapId !== mapId || entry.mapContext.khu !== khu) {
        this.setMoveToStatus(accountId, entry, 'failed', 'world_context_changed');
        return;
      }
      const moveVitalError = moveVitalErrorForEntry(entry);
      if (moveVitalError) {
        this.setMoveToStatus(accountId, entry, 'failed', moveVitalError);
        return;
      }
      const current = { x: entry.location.x!, y: entry.location.y! };
      const deltaX = targetX - current.x;
      const deltaY = targetY - current.y;
      if (Math.hypot(deltaX, deltaY) <= arrivalRadius
        && isWalkSegmentClear(mapId, current, { x: targetX, y: targetY })
        && (entry.mapContext.observedAt ?? 0) > initialLocationObservedAt) {
        this.setMoveToStatus(accountId, entry, 'arrived');
        return;
      }
      const path = findWalkPath(mapId, current, {
        tx: Math.floor(targetX / WALK_TILE_SIZE), ty: Math.floor(targetY / WALK_TILE_SIZE),
      });
      if (!path) {
        this.setMoveToStatus(accountId, entry, 'blocked', 'no_walk_path');
        return;
      }
      if (path.length === 0 && !isWalkSegmentClear(mapId, current, { x: targetX, y: targetY })) {
        this.setMoveToStatus(accountId, entry, 'blocked', 'target_collision_blocked');
        return;
      }
      const waypoint = path[0] ?? { x: targetX, y: targetY };
      const dx = waypoint.x - current.x;
      const dy = waypoint.y - current.y;
      const distance = Math.hypot(dx, dy);
      const step = Math.min(maxStepPx, Math.max(1, distance));
      const next = {
        x: Math.round(current.x + dx / Math.max(distance, 1) * step),
        y: Math.round(current.y + dy / Math.max(distance, 1) * step),
      };
      const direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 2 : 1) : (dy >= 0 ? 0 : 3);
      const sent = await entry.client.sendMove(next.x, next.y, direction, 'walk',
        () => this.moveToIsCurrent(accountId, entry, operationId, shouldContinue));
      if (!sent) {
        if (!this.moveToIsCurrent(accountId, entry, operationId, shouldContinue)) {
          this.setMoveToStatus(accountId, entry, 'cancelled', 'operation_cancelled_or_disconnected');
          return;
        }
        this.setMoveToStatus(accountId, entry, 'failed', 'movement_command_rejected');
        return;
      }
      await sleep(movementIntervalMs);
      const observed = { x: entry.location.x!, y: entry.location.y! };
      if (Math.hypot(observed.x - lastPosition.x, observed.y - lastPosition.y) >= 0.5) {
        lastPosition = observed;
        lastProgressAt = Date.now();
        stalledRetries = 0;
      } else if (Date.now() - lastProgressAt >= 1_000) {
        stalledRetries += 1;
        lastProgressAt = Date.now();
        if (stalledRetries >= 3) {
          this.setMoveToStatus(accountId, entry, 'blocked', 'authoritative_position_stalled');
          return;
        }
      }
    }
    this.setMoveToStatus(accountId, entry, 'failed', 'movement_deadline_exceeded');
  }

  private validateMoveToTarget(mapId: string, x: number, y: number): void {
    const grid = getWalkGrid(mapId);
    if (!grid || x < 0 || y < 0 || x >= grid.width * WALK_TILE_SIZE || y >= grid.height * WALK_TILE_SIZE) {
      throw new Error('target_out_of_bounds');
    }
    if (!isWalkableTile(mapId, Math.floor(x / WALK_TILE_SIZE), Math.floor(y / WALK_TILE_SIZE))) {
      throw new Error('target_blocked');
    }
  }

  private startMoveTo(
    accountId: string,
    entry: ActiveBot,
    requestId: string,
    mapId: string,
    khu: number,
    x: number,
    y: number,
    arrivalRadius: number,
    shouldContinue: () => boolean = () => true,
  ): { operation: MoveToRuntimeInfo; promise: Promise<void> } {
    if (entry.navigationPromise || entry.moveToPromise) throw new Error('operation_in_progress');
    const operationId = randomUUID();
    entry.moveTo = {
      requestId, operationId, status: 'accepted', mapId, khu, x, y, updatedAt: Date.now(), reason: null,
    };
    const promise = this.runMoveTo(accountId, entry, operationId, arrivalRadius, shouldContinue);
    entry.moveToPromise = promise;
    void promise.finally(() => { if (entry.moveToPromise === promise) entry.moveToPromise = undefined; });
    return { operation: { ...entry.moveTo }, promise };
  }

  private async moveToTrainingArea(
    accountId: string,
    entry: ActiveBot,
    request: { operationId: string; mapId: string; khu: number; x: number; y: number; arrivalRadius: number; shouldContinue: () => boolean },
  ): Promise<boolean> {
    if (this.activeBots.get(accountId) !== entry) throw new Error('Bot chưa chạy.');
    if (!entry.client.isConnected()) throw new Error('Game client chưa kết nối.');
    const { mapId, khu } = request;
    if (entry.mapContext.mapId !== mapId || entry.mapContext.khu !== khu
      || !this.hasCurrentMapContext(entry) || !entry.dataStatus.location) {
      throw new Error('world_context_stale_or_mismatch');
    }
    this.validateMoveToTarget(mapId, request.x, request.y);
    const moveVitalError = moveVitalErrorForEntry(entry);
    if (moveVitalError) throw new Error(moveVitalError);
    const { promise } = this.startMoveTo(
      accountId, entry, `training:${request.operationId}`, mapId, khu, request.x, request.y,
      request.arrivalRadius, request.shouldContinue,
    );
    await promise;
    return entry.moveTo?.requestId === `training:${request.operationId}` && entry.moveTo.status === 'arrived';
  }

  public requestMoveTo(accountId: string, input: {
    requestId: string; mapId: string; khu: number; x: number; y: number; arrivalRadius?: number;
  }): MoveToRuntimeInfo {
    const entry = this.activeBots.get(accountId);
    if (!entry) throw new Error('Bot chưa chạy.');
    if (!entry.client.isConnected()) throw new Error('Game client chưa kết nối.');
    this.validateMoveToTarget(input.mapId, input.x, input.y);
    const context = entry.mapContext;
    if (!this.hasCurrentMapContext(entry) || !entry.dataStatus.location
      || context.mapId !== input.mapId || context.khu !== input.khu) throw new Error('world_context_stale_or_mismatch');
    const moveVitalError = moveVitalErrorForEntry(entry);
    if (moveVitalError) throw new Error(moveVitalError);
    const previous = entry.moveTo;
    if (previous?.requestId === input.requestId) {
      if (previous.mapId !== input.mapId || previous.khu !== input.khu || previous.x !== input.x || previous.y !== input.y) {
        throw new Error('request_id_conflict');
      }
      return { ...previous };
    }
    return this.startMoveTo(accountId, entry, input.requestId, input.mapId, input.khu,
      input.x, input.y, input.arrivalRadius ?? 16).operation;
  }

  public cancelMoveTo(accountId: string, operationId: string): MoveToRuntimeInfo {
    const entry = this.activeBots.get(accountId);
    if (!entry?.moveTo) throw new Error('move_to_not_found');
    if (entry.moveTo.operationId !== operationId) throw new Error('operation_id_mismatch');
    if (!['accepted', 'running'].includes(entry.moveTo.status)) return { ...entry.moveTo };
    this.setMoveToStatus(accountId, entry, 'cancelled', 'cancelled_by_request');
    return { ...entry.moveTo };
  }

  private async waitForNavigationObservation(
    predicate: () => boolean,
    timeoutMs: number,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!shouldContinue()) return false;
      if (predicate()) return true;
      await sleep(500);
    }
    return predicate();
  }

  private async walkToPortal(
    accountId: string,
    entry: ActiveBot,
    operationId: string,
    edge: PortalEdge,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    if (!this.hasCurrentMapContext(entry) || !entry.dataStatus.location
      || typeof entry.location.x !== 'number' || typeof entry.location.y !== 'number') return false;
    const path = findWalkPath(edge.fromMapId, { x: entry.location.x, y: entry.location.y }, { tx: edge.tx, ty: edge.ty });
    if (!path) return false;
    // The server validates movement as a continuous stream. Sending one
    // packet with a whole-tile jump is not equivalent to the official client:
    // the public client reports roughly every 100ms at about 68px/s. Stream
    // short, rounded waypoints so collision/speed validation sees the same
    // shape and the portal trigger can observe the authoritative tile.
    const movementIntervalMs = 100;
    const movementSpeedPxPerSecond = 68;
    const maxStepPx = movementSpeedPxPerSecond * (movementIntervalMs / 1000);
    const deadline = Date.now() + 45_000;
    let lastObserved = { x: entry.location.x, y: entry.location.y };
    let lastProgressAt = Date.now();

    // Re-plan from the latest server echo after every movement tick. The
    // public client can predict locally, but the bot has no local physics
    // simulation; continuing from a rejected/clipped point would compound the
    // error and send the next segment from an impossible coordinate.
    while (Date.now() < deadline) {
      if (!this.navigationIsCurrent(accountId, entry, operationId) || !shouldContinue()) return false;
      if (!this.hasCurrentMapContext(entry) || !entry.dataStatus.location
        || entry.mapContext.mapId !== edge.fromMapId) return false;
      const current = { x: entry.location.x, y: entry.location.y };
      if (typeof current.x !== 'number' || typeof current.y !== 'number') return false;
      const currentTx = Math.floor(current.x / 32);
      const currentTy = Math.floor(current.y / 32);
      if (currentTx === edge.tx && currentTy === edge.ty) return true;

      const remainingPath = findWalkPath(edge.fromMapId, current, { tx: edge.tx, ty: edge.ty });
      if (!remainingPath || remainingPath.length === 0) return false;
      const waypoint = remainingPath[0];
      const dx = waypoint.x - current.x;
      const dy = waypoint.y - current.y;
      const distance = Math.hypot(dx, dy);
      const step = Math.min(maxStepPx, Math.max(1, distance));
      const next = {
        x: Math.round(current.x + (dx / Math.max(distance, 1)) * step),
        y: Math.round(current.y + (dy / Math.max(distance, 1)) * step),
      };
      const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 2 : 1) : (dy >= 0 ? 0 : 3);
      const sent = await entry.client.sendMove(
        next.x,
        next.y,
        dir,
        'walk',
        () => this.navigationIsCurrent(accountId, entry, operationId) && shouldContinue(),
      );
      if (!sent) return false;
      await sleep(movementIntervalMs);

      const observedX = entry.location.x;
      const observedY = entry.location.y;
      if (typeof observedX === 'number' && typeof observedY === 'number') {
        const moved = Math.hypot(observedX - (lastObserved.x ?? observedX), observedY - (lastObserved.y ?? observedY));
        if (moved >= 0.5) {
          lastProgressAt = Date.now();
          lastObserved = { x: observedX, y: observedY };
        }
      }
      if (Date.now() - lastProgressAt > 2_500) return false;
    }
    return this.hasCurrentMapContext(entry) && entry.dataStatus.location
      && Math.floor((entry.location.x ?? Number.NaN) / 32) === edge.tx
      && Math.floor((entry.location.y ?? Number.NaN) / 32) === edge.ty;
  }

  private async runPortalNavigation(
    accountId: string,
    entry: ActiveBot,
    operationId: string,
    initialState: PortalNavigationState,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    let navigation = planNavigation(initialState);
    this.setNavigationRuntime(accountId, entry, { operationId, navigation });
    if (navigation.phase === 'arrived') return true;
    if (navigation.phase === 'blocked') return false;

    const route = navigation.route;
    for (let routeIndex = 0; routeIndex < route.length; routeIndex += 1) {
      const edge = route[routeIndex];
      navigation = { ...navigation, routeIndex, phase: 'moving_to_portal', reason: undefined };
      this.setNavigationRuntime(accountId, entry, { operationId, navigation });

      let edgeConfirmed = false;
      for (let attempt = 0; attempt < navigation.retry.maxAttempts && !edgeConfirmed; attempt += 1) {
        if (!this.navigationIsCurrent(accountId, entry, operationId) || !shouldContinue()) {
          navigation = { ...navigation, phase: 'failed', reason: 'navigation_cancelled' };
          this.setNavigationRuntime(accountId, entry, { operationId, navigation });
          return false;
        }

        // A previous attempt may have succeeded after its timeout. Never issue
        // another command if the authoritative map already advanced.
        const currentMap = this.hasCurrentMapContext(entry) ? entry.mapContext.mapId : null;
        if (currentMap === edge.toMapId) {
          navigation = {
            ...navigation,
            currentMapId: currentMap,
            routeIndex: routeIndex + 1,
            phase: routeIndex + 1 === route.length ? 'arrived' : 'moving_to_portal',
            retry: { ...navigation.retry, attempt: 0, commandAt: null, deadlineAt: null },
            reason: undefined,
          };
          this.setNavigationRuntime(accountId, entry, { operationId, navigation });
          edgeConfirmed = true;
          break;
        }
        if (currentMap !== edge.fromMapId) {
          navigation = { ...navigation, phase: 'failed', reason: 'unexpected_map_before_portal' };
          this.setNavigationRuntime(accountId, entry, { operationId, navigation });
          return false;
        }

        const baselineObservedAt = entry.mapContext.observedAt ?? 0;
        navigation = {
          ...navigation,
          phase: 'moving_to_portal',
          retry: { ...navigation.retry, attempt, commandAt: null, deadlineAt: null },
          reason: undefined,
        };
        this.setNavigationRuntime(accountId, entry, { operationId, navigation });

        const atPortal = await this.walkToPortal(accountId, entry, operationId, edge, shouldContinue);

        // Some server builds trigger the portal as soon as the move reaches
        // the portal tile. Accept only a newer authoritative map packet.
        if (this.hasCurrentMapContext(entry) && entry.mapContext.mapId === edge.toMapId
          && (entry.mapContext.observedAt ?? 0) > baselineObservedAt) {
          navigation = {
            ...navigation,
            currentMapId: edge.toMapId,
            routeIndex: routeIndex + 1,
            phase: routeIndex + 1 === route.length ? 'arrived' : 'moving_to_portal',
            retry: { ...navigation.retry, attempt: 0, commandAt: null, deadlineAt: null },
            reason: undefined,
          };
          this.setNavigationRuntime(accountId, entry, { operationId, navigation });
          edgeConfirmed = true;
          break;
        }
        if (!atPortal) continue;

        const commandAt = Date.now();
        navigation = markWaitingForMapConfirmation(navigation, commandAt);
        this.setNavigationRuntime(accountId, entry, { operationId, navigation });
        const enterSent = await entry.client.enterMap(
          edge.toMapId,
          () => this.navigationIsCurrent(accountId, entry, operationId) && shouldContinue(),
        );
        if (!enterSent) {
          navigation = expireMapConfirmation(navigation, Date.now() + navigation.retry.timeoutMs);
          this.setNavigationRuntime(accountId, entry, { operationId, navigation });
          continue;
        }

        const confirmed = await this.waitForNavigationObservation(
          () => this.hasCurrentMapContext(entry)
            && entry.mapContext.mapId === edge.toMapId
            && (entry.mapContext.observedAt ?? 0) > commandAt,
          navigation.retry.timeoutMs,
          () => this.navigationIsCurrent(accountId, entry, operationId) && shouldContinue(),
        );
        if (!confirmed) {
          navigation = expireMapConfirmation(navigation, Date.now() + navigation.retry.timeoutMs);
          this.setNavigationRuntime(accountId, entry, { operationId, navigation });
          continue;
        }

        navigation = confirmObservedMap(navigation, {
          mapId: edge.toMapId,
          observedAt: entry.mapContext.observedAt ?? Date.now(),
        });
        this.setNavigationRuntime(accountId, entry, { operationId, navigation });
        edgeConfirmed = navigation.currentMapId === edge.toMapId;
      }

      if (!edgeConfirmed) {
        navigation = { ...navigation, phase: 'failed', reason: navigation.reason || 'portal_navigation_timeout' };
        this.setNavigationRuntime(accountId, entry, { operationId, navigation });
        return false;
      }
    }

    navigation = { ...navigation, phase: 'arrived', currentMapId: entry.mapContext.mapId ?? navigation.targetMapId, reason: undefined };
    this.setNavigationRuntime(accountId, entry, { operationId, navigation });
    return this.hasCurrentMapContext(entry) && entry.mapContext.mapId === navigation.targetMapId;
  }

  private startPortalNavigation(
    accountId: string,
    entry: ActiveBot,
    mapId: string,
    shouldContinue: () => boolean,
  ): { operationId: string; mapId: string; route: NavigationRuntimeInfo['route'] } {
    if (entry.moveToPromise) throw new Error('Bot đang thực hiện click-to-move.');
    const currentMapId = entry.mapContext.mapId;
    if (!this.hasCurrentMapContext(entry) || !entry.dataStatus.location || !currentMapId) {
      throw new Error('Chưa có snapshot map/khu/tọa độ authoritative để đi tới portal.');
    }
    const initialState = planNavigation(createNavigationState(currentMapId, mapId, {
      now: Date.now(),
      timeoutMs: 10_000,
      maxAttempts: 3,
    }));
    if (initialState.phase === 'blocked') {
      throw new Error(`Chưa có tuyến portal đã xác minh từ ${currentMapId} tới ${mapId}.`);
    }
    const operationId = `nav_${randomUUID()}`;
    entry.navigationTarget = mapId;
    const promise = this.runPortalNavigation(accountId, entry, operationId, initialState, shouldContinue);
    entry.navigationPromise = promise;
    void promise.then(
      () => {
        if (entry.navigationPromise === promise) entry.navigationPromise = undefined;
      },
      () => {
        if (entry.navigationPromise === promise) entry.navigationPromise = undefined;
      },
    );
    return {
      operationId,
      mapId,
      route: initialState.route.map((edge) => ({
        portalId: edge.portalId,
        fromMapId: edge.fromMapId,
        toMapId: edge.toMapId,
        tx: edge.tx,
        ty: edge.ty,
        label: edge.label,
      })),
    };
  }

  private async navigateMapAndWait(
    accountId: string,
    entry: ActiveBot,
    mapId: string,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    if (entry.navigationPromise) {
      if (entry.navigationTarget !== mapId) return false;
      return await entry.navigationPromise;
    }
    if (entry.moveToPromise) throw new Error('Bot đang thực hiện click-to-move.');
    this.startPortalNavigation(accountId, entry, mapId, shouldContinue);
    if (entry.navigation.phase === 'arrived') return true;
    return await entry.navigationPromise!;
  }

  public async requestMapEntry(accountId: string, mapId: string): Promise<{
    status: 'navigation_started' | 'already_at_destination';
    mapId: string;
    operationId: string | null;
    route: NavigationRuntimeInfo['route'];
  }> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mapId)) {
      throw new Error('mapId không hợp lệ. Chỉ chấp nhận 1–64 ký tự chữ, số, gạch dưới hoặc gạch ngang.');
    }
    const entry = this.activeBots.get(accountId);
    if (!entry) throw new Error('Bot chưa chạy; cần khởi động tài khoản trước khi yêu cầu chuyển map.');
    if (!entry.client.isConnected()) throw new Error('Game client chưa kết nối; chưa gửi được yêu cầu chuyển map.');
    const now = Date.now();
    if (entry.navigationPromise) {
      if (entry.navigationTarget === mapId) throw new Error('Đang có một tuyến portal tới map này; hãy chờ snapshot xác nhận.');
      throw new Error('Bot đang điều hướng qua portal tới một map khác.');
    }
    if (now - entry.lastMapEntryRequestAt < 5000) {
      throw new Error('Vui lòng chờ trước khi gửi yêu cầu chuyển map tiếp theo.');
    }
    entry.lastMapEntryRequestAt = now;
    if (this.hasCurrentMapContext(entry) && entry.mapContext.mapId === mapId) {
      return { status: 'already_at_destination', mapId, operationId: null, route: [] };
    }
    const started = this.startPortalNavigation(accountId, entry, mapId, () => this.activeBots.get(accountId) === entry);
    return { status: 'navigation_started', ...started };
  }

  public async triggerAction(accountId: string, action: string): Promise<any> {
    if (action === 'sell' || action === 'checkin') {
      throw new Error(`Action '${action}' is temporarily disabled; only 'farm' is currently available.`);
    }
    if (action !== 'farm') {
      throw new Error(`Unsupported action '${action}'. Only 'farm' is currently available.`);
    }
    const entry = this.activeBots.get(accountId);
    if (!entry) {
      throw new Error('Bot is not active. Please start the account first.');
    }

    return await entry.controller.triggerFarmPass();
  }

  public updateBotConfig(accountId: string, config: any): void {
    const entry = this.activeBots.get(accountId);
    if (entry) {
      entry.controller.updateConfig(config);
    }
  }
}

export const workerPool = new WorkerPool();
